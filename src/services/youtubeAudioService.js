import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@campusmate_yt_track:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const memoryCache = new Map();
const inflight = new Map();

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDurationSeconds(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function buildCacheKey(track) {
  const name = normalizeText(track?.name);
  const artist = normalizeText(track?.artists);
  return `${name}__${artist}`;
}

async function searchInnertube(query) {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240313.01.00',
            hl: 'th',
            gl: 'TH',
          },
        },
        query,
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const section = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    const items = section?.[0]?.itemSectionRenderer?.contents || [];
    const videos = items
      .map((item) => item.videoRenderer)
      .filter(Boolean)
      .filter((v) => v.videoId && typeof v.videoId === 'string');
    return videos.length ? videos : null;
  } catch (_) {
    return null;
  }
}

/**
 * Searches YouTube for official audio/video matching the given track.
 * Parses initial embedded data to find valid video IDs and durations.
 */
async function fetchYouTubeCandidates(track) {
  const title = String(track?.name || '').trim();
  const artist = String(track?.artists || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim();
  const query = `${title} ${artist}`.trim();
  if (!query) return null;

  // 1. Fast path: Innertube JSON API (< 300ms, no HTML download)
  let videos = await searchInnertube(query);

  // 2. Fallback path: HTML scraping if Innertube is unavailable
  if (!videos || !videos.length) {
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'th,en;q=0.9',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const html = await response.text();
        const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const section = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
          const items = section?.[0]?.itemSectionRenderer?.contents || [];
          videos = items
            .map((item) => item.videoRenderer)
            .filter(Boolean)
            .filter((v) => v.videoId && typeof v.videoId === 'string');
        } else {
          const rawMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((m) => m[1]);
          const uniqueIds = Array.from(new Set(rawMatches)).slice(0, 5);
          if (uniqueIds.length) {
            return {
              videoId: uniqueIds[0],
              durationMs: track?.durationMs || 0,
              candidates: uniqueIds,
            };
          }
        }
      }
    } catch (_) {}
  }

  if (!videos || !videos.length) return null;

  const expectedSeconds = Number.isFinite(track?.durationMs) && track.durationMs > 1000
    ? track.durationMs / 1000
    : null;

  const candidates = [];
  for (const v of videos) {
    const rawLen = v.lengthText?.simpleText || '';
    const durSec = parseDurationSeconds(rawLen);
    // Ignore 1-hour loops or 15-second shorts if we know the expected song length
    if (durSec > 900) continue; // > 15 minutes is usually a full album/loop
    if (durSec > 0 && durSec < 45) continue; // < 45s is usually a teaser/short
    if (expectedSeconds && durSec > 0 && Math.abs(durSec - expectedSeconds) > Math.max(60, expectedSeconds * 0.35)) {
      // Significantly different length — keep as lower priority
      candidates.push({
        videoId: v.videoId,
        durationMs: durSec * 1000,
        title: v.title?.runs?.map((r) => r.text).join('') || '',
        score: -10,
      });
      continue;
    }

    const videoTitle = normalizeText(v.title?.runs?.map((r) => r.text).join(''));
    let score = 0;
    if (videoTitle.includes(normalizeText(title))) score += 20;
    if (videoTitle.includes(normalizeText(artist))) score += 15;
    if (videoTitle.includes('official audio') || videoTitle.includes('audio')) score += 10;
    if (videoTitle.includes('official mv') || videoTitle.includes('official music video')) score += 8;
    if (videoTitle.includes('lyric')) score += 5;

    candidates.push({
      videoId: v.videoId,
      durationMs: durSec * 1000 || (track?.durationMs || 0),
      title: v.title?.runs?.map((r) => r.text).join('') || '',
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return {
      videoId: videos[0].videoId,
      durationMs: track?.durationMs || 0,
      candidates: videos.slice(0, 5).map((v) => v.videoId),
    };
  }

  return {
    videoId: candidates[0].videoId,
    durationMs: candidates[0].durationMs || (track?.durationMs || 0),
    title: candidates[0].title,
    candidates: candidates.map((c) => c.videoId),
  };
}

/**
 * Resolves a track to its YouTube video ID and duration.
 * Uses tiered caching: Memory Map -> AsyncStorage -> YouTube Search.
 */
export async function resolveYouTubeTrack(track) {
  if (!track?.name) return null;
  const key = buildCacheKey(track);

  // 1. Check memory cache
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.savedAt < CACHE_TTL_MS) {
    return mem.data;
  }

  // Deduplicate inflight requests for the same track
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    // 2. Check AsyncStorage
    try {
      const stored = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.data?.videoId && Date.now() - parsed.savedAt < CACHE_TTL_MS) {
          memoryCache.set(key, parsed);
          return parsed.data;
        }
      }
    } catch (_) {}

    // 3. Fetch from YouTube
    const data = await fetchYouTubeCandidates(track);
    if (data?.videoId) {
      const payload = { savedAt: Date.now(), data };
      memoryCache.set(key, payload);
      try {
        await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(payload));
      } catch (_) {}
      return data;
    }
    return null;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}
