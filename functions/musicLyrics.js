import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const LRCLIB_BASE = 'https://lrclib.net/api';
const LRCLIB_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'CampusMate/1.0 (https://getcampusmate.app)',
};
const MAX_LYRICS_LENGTH = 24_000;
const MAX_LINES = 400;

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryArtist(value) {
  return String(value || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim();
}

function matchesTrack(record, title, artist) {
  if (!record || typeof record !== 'object') return false;
  const recordTitle = normalizedText(record.trackName || record.name);
  const requestedTitle = normalizedText(title);
  const recordArtist = normalizedText(record.artistName);
  const requestedArtist = normalizedText(primaryArtist(artist));
  return Boolean(recordTitle && requestedTitle && recordArtist && requestedArtist)
    && recordTitle === requestedTitle
    && (recordArtist === requestedArtist || recordArtist.startsWith(`${requestedArtist} `));
}

function hasLyrics(record) {
  return !record?.instrumental && Boolean(record?.plainLyrics || record?.syncedLyrics);
}

function durationDifferenceSeconds(record, durationMs) {
  const recordedSeconds = Number(record?.duration);
  if (!Number.isFinite(durationMs) || durationMs < 1000
    || !Number.isFinite(recordedSeconds) || recordedSeconds < 1) return null;
  return Math.abs(recordedSeconds - (durationMs / 1000));
}

function isStrongMetadataMatch(record, { albumName, durationMs }) {
  if (!record) return false;
  const album = normalizedText(albumName);
  const recordAlbum = normalizedText(record.albumName);
  if (album && (!recordAlbum || album !== recordAlbum)) return false;
  const difference = durationDifferenceSeconds(record, durationMs);
  if (Number.isFinite(durationMs) && durationMs >= 1000 && (difference === null || difference > 3)) {
    return false;
  }
  return true;
}

/** Rank exact title/artist matches. Album is a preference because singles and compilations differ. */
export function selectLyricsRecord(records, { title, artist, albumName = '', durationMs = NaN }) {
  const requestedAlbum = normalizedText(albumName);
  const requestedDurationSeconds = Number.isFinite(durationMs) && durationMs >= 1000
    ? durationMs / 1000
    : null;
  let best = null;
  let bestScore = -Infinity;
  for (const record of records) {
    if (!matchesTrack(record, title, artist) || !hasLyrics(record)) continue;
    const difference = durationDifferenceSeconds(record, durationMs);
    // A large full-song duration gap usually means a different live/remix version.
    if (difference !== null && requestedDurationSeconds !== null
      && difference > Math.max(20, Math.min(30, requestedDurationSeconds * 0.08))) continue;

    let score = 0;
    if (difference !== null) {
      if (difference <= 3) score += 60 - (difference * 2);
      else if (difference <= 10) score += 30 - difference;
      else score -= difference;
    }
    const recordAlbum = normalizedText(record.albumName);
    if (requestedAlbum && recordAlbum === requestedAlbum) score += 15;
    if (record.syncedLyrics) score += 40;
    if (score > bestScore) {
      best = record;
      bestScore = score;
    }
  }
  return best;
}

export function parseSyncedLyrics(value) {
  if (typeof value !== 'string') return [];
  const lines = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const match = rawLine.match(/^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/u);
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || seconds >= 60) continue;
    const fraction = match[3] || '0';
    const timeMs = (minutes * 60 + seconds) * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3));
    const text = match[4].trim().slice(0, 500);
    if (text) lines.push({ timeMs, text });
    if (lines.length >= MAX_LINES) break;
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Find a repeated 2–4 line passage. This is a lyric heuristic, not a popularity metric. */
export function findRepeatedLyricPassage(lines) {
  const textLines = lines
    .map((line) => (typeof line === 'string' ? { text: line, timeMs: null } : line))
    .filter((line) => typeof line?.text === 'string' && normalizedText(line.text).length >= 3);
  const keys = textLines.map((line) => normalizedText(line.text));
  for (const size of [4, 3, 2]) {
    const firstByPassage = new Map();
    for (let i = 0; i <= keys.length - size; i += 1) {
      const key = keys.slice(i, i + size).join('\u0000');
      const first = firstByPassage.get(key);
      if (first !== undefined && i - first >= size + 2) {
        return {
          suggestedLines: textLines.slice(first, first + size).map((line) => line.text),
          suggestedLineStartMs: Number.isFinite(textLines[first].timeMs)
            ? textLines[first].timeMs
            : null,
        };
      }
      if (first === undefined) firstByPassage.set(key, i);
    }
  }
  return { suggestedLines: [], suggestedLineStartMs: null };
}

export function compactLyrics(record) {
  const suppliedPlainLyrics = typeof record?.plainLyrics === 'string'
    ? record.plainLyrics.trim().slice(0, MAX_LYRICS_LENGTH)
    : '';
  const lines = parseSyncedLyrics(record?.syncedLyrics);
  const plainLyrics = suppliedPlainLyrics || lines.map((line) => line.text).join('\n').slice(0, MAX_LYRICS_LENGTH);
  const fallbackLines = plainLyrics.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).slice(0, MAX_LINES);
  const suggestion = findRepeatedLyricPassage(lines.length ? lines : fallbackLines);
  if (record?.instrumental || (!plainLyrics && !lines.length)) {
    return { status: 'not_found', lines: [], plainLyrics: '', suggestedLines: [], suggestedLineStartMs: null, source: 'LRCLIB' };
  }
  return { status: 'found', lines, plainLyrics, ...suggestion, source: 'LRCLIB' };
}

async function fetchLrclib(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: LRCLIB_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    logger.warn('[MusicLyrics] LRCLIB request failed', { message: String(error?.message || error) });
    throw new HttpsError('unavailable', 'โหลดเนื้อเพลงไม่สำเร็จ ลองอีกครั้ง');
  }
  if (response.status === 404) return null;
  if (response.status === 429) {
    throw new HttpsError('resource-exhausted', 'บริการเนื้อเพลงกำลังมีผู้ใช้งานมาก ลองอีกครั้ง');
  }
  if (!response.ok) {
    logger.warn('[MusicLyrics] LRCLIB HTTP error', { status: response.status });
    throw new HttpsError('unavailable', 'โหลดเนื้อเพลงไม่สำเร็จ ลองอีกครั้ง');
  }
  try {
    return await response.json();
  } catch (_) {
    throw new HttpsError('unavailable', 'โหลดเนื้อเพลงไม่สำเร็จ ลองอีกครั้ง');
  }
}

function buildLrclibUrl(path, title, artist, albumName, durationMs) {
  const url = new URL(`${LRCLIB_BASE}/${path}`);
  url.searchParams.set('track_name', title);
  url.searchParams.set('artist_name', artist);
  if (albumName) url.searchParams.set('album_name', albumName);
  if (Number.isFinite(durationMs) && durationMs >= 1000 && durationMs <= 3_600_000) {
    url.searchParams.set('duration', String(Math.round(durationMs / 1000)));
  }
  return url;
}

const notFound = () => compactLyrics(null);

export const getMusicLyrics = onCall({ region: 'asia-southeast1', maxInstances: 20 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนดูเนื้อเพลง');
  }
  const title = typeof request.data?.name === 'string' ? request.data.name.trim().slice(0, 200) : '';
  const artists = typeof request.data?.artists === 'string' ? request.data.artists.trim().slice(0, 200) : '';
  if (!title || !artists || artists === 'Unknown') {
    throw new HttpsError('invalid-argument', 'ต้องระบุชื่อเพลงและศิลปิน');
  }
  const artist = primaryArtist(artists);
  const albumName = typeof request.data?.albumName === 'string'
    ? request.data.albumName.trim().slice(0, 200)
    : '';
  const durationMs = Number(request.data?.durationMs);

  const metadata = { title, artist, albumName, durationMs };
  const exact = await fetchLrclib(buildLrclibUrl('get', title, artist, albumName, durationMs));
  if (matchesTrack(exact, title, artist) && hasLyrics(exact) && isStrongMetadataMatch(exact, metadata) && Boolean(exact?.syncedLyrics)) {
    return compactLyrics(exact);
  }

  // LRCLIB asks clients to space requests. Search when metadata suggests an alternate version or when exact only has plain lyrics.
  await new Promise((resolve) => setTimeout(resolve, 250));
  let candidates;
  try {
    candidates = await fetchLrclib(buildLrclibUrl('search', title, artist));
  } catch (error) {
    // A transient search failure should not hide an already fetched, plausible match.
    const fallback = selectLyricsRecord([exact], metadata);
    if (fallback) return compactLyrics(fallback);
    throw error;
  }
  const match = selectLyricsRecord([exact, ...(Array.isArray(candidates) ? candidates : [])], metadata);
  return match ? compactLyrics(match) : notFound();
});
