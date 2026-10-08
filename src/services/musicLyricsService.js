import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService.js';

const FUNCTIONS_REGION = 'asia-southeast1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const cache = new Map();
const inflight = new Map();

function cacheKey(track) {
  return [track?.id, track?.name, track?.artists, track?.albumName, track?.durationMs]
    .map((part) => String(part ?? '').trim().toLocaleLowerCase())
    .join('\u0000');
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function normalizeResult(data) {
  const lines = Array.isArray(data?.lines)
    ? data.lines
      .filter((line) => Number.isFinite(line?.timeMs) && typeof line?.text === 'string')
      .map((line) => ({ timeMs: line.timeMs, text: line.text }))
    : [];
  let suggestedLines = Array.isArray(data?.suggestedLines)
    ? data.suggestedLines.filter((line) => typeof line === 'string')
    : [];
  let suggestedLineStartMs = Number.isFinite(data?.suggestedLineStartMs)
    ? data.suggestedLineStartMs
    : null;

  if (suggestedLineStartMs == null && lines.length > 0) {
    const passage = findRepeatedLyricPassage(lines);
    if (passage.suggestedLineStartMs != null) {
      suggestedLines = passage.suggestedLines;
      suggestedLineStartMs = passage.suggestedLineStartMs;
    }
  }

  return {
    status: data?.status === 'found' ? 'found' : 'not_found',
    lines,
    plainLyrics: typeof data?.plainLyrics === 'string' ? data.plainLyrics : '',
    suggestedLines,
    suggestedLineStartMs,
    source: 'LRCLIB',
  };
}

function parseSyncedLyrics(value) {
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
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

async function fetchDirectLrclib(track) {
  try {
    const title = encodeURIComponent(String(track?.name || '').trim().slice(0, 100));
    const artist = encodeURIComponent(String(track?.artists || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim().slice(0, 100));
    if (!title || !artist) return null;
    const url = `https://lrclib.net/api/get?track_name=${title}&artist_name=${artist}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CampusMate/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.plainLyrics || data?.syncedLyrics) {
        const lines = parseSyncedLyrics(data.syncedLyrics);
        const passage = findRepeatedLyricPassage(lines);
        return {
          status: 'found',
          lines,
          plainLyrics: data.plainLyrics || lines.map((l) => l.text).join('\n'),
          suggestedLines: passage.suggestedLines,
          suggestedLineStartMs: passage.suggestedLineStartMs,
          source: 'LRCLIB',
        };
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Lyrics are loaded only after selecting a song. suggestedLineStartMs refers to
 * the full song; preview audio has no published offset and cannot use it to seek.
 */
export function getTrackLyrics({ track } = {}) {
  if (!track?.name || !track?.artists || track.artists === 'Unknown') {
    return Promise.resolve(normalizeResult(null));
  }
  const key = cacheKey(track);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      const { app } = requireFirebase();
      const callable = httpsCallable(
        getFunctions(app, FUNCTIONS_REGION),
        'getMusicLyrics',
        { timeout: 5000 },
      );
      const response = await callable({
        name: String(track.name).slice(0, 200),
        artists: String(track.artists).slice(0, 200),
        ...(track.albumName ? { albumName: String(track.albumName).slice(0, 200) } : {}),
        ...(Number.isFinite(track.durationMs) ? { durationMs: track.durationMs } : {}),
      });
      const value = normalizeResult(response?.data);
      if (value.status === 'found') {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        return value;
      }
    } catch (_) {}

    // Fallback directly to LRCLIB API from client
    const directResult = await fetchDirectLrclib(track);
    const value = normalizeResult(directResult);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}
