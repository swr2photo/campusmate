import AsyncStorage from '@react-native-async-storage/async-storage';
import { isReliablePreviewUrl, pickItunesPreview } from '../utils/trackPlayback';

const CACHE_PREFIX = '@campusmate_preview_track:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A song Apple does not carry stays missing for a while; remembering that keeps
// every later tap from waiting on the same empty searches again.
const MISS_TTL_MS = 30 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 2500;
// Rows prefetch quietly; Apple's search API throttles bursts (~20 calls/min),
// so background lookups run two at a time and a tap jumps the queue.
const MAX_BACKGROUND_LOOKUPS = 2;

const memoryCache = new Map();
const missCache = new Map();
const inflight = new Map();
const backgroundQueue = [];
let backgroundRunning = 0;

function cacheKey(track) {
  const name = String(track?.name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const artist = String(track?.artists || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${name}__${artist}`;
}

function primaryArtistName(track) {
  return String(track?.artists || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim();
}

async function fetchItunesResults(term) {
  const query = [
    `term=${encodeURIComponent(term)}`,
    'media=music',
    'entity=song',
    'limit=10',
    'country=TH',
  ].join('&');
  const response = await fetch(`https://itunes.apple.com/search?${query}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`iTunes search HTTP ${response.status}`);
    error.transient = true;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

// Returns a preview, `null` for a confirmed miss, or throws when the network or
// rate limit prevented an answer (not cached, so a later tap can retry).
async function searchItunesPreview(track) {
  const title = String(track?.name || '').trim();
  if (!title) return null;
  const artist = primaryArtistName(track);
  const withArtist = await fetchItunesResults(`${title} ${artist}`.trim());
  const hit = pickItunesPreview(track, withArtist);
  if (hit || !artist) return hit;
  // Store listings often spell the artist differently from Spotify; the title
  // alone still has to match the artist inside pickItunesPreview.
  return pickItunesPreview(track, await fetchItunesResults(title));
}

function pumpBackgroundQueue() {
  while (backgroundRunning < MAX_BACKGROUND_LOOKUPS && backgroundQueue.length) {
    const job = backgroundQueue.shift();
    if (job.started) continue;
    backgroundRunning += 1;
    job.start().finally(() => {
      backgroundRunning -= 1;
      pumpBackgroundQueue();
    });
  }
}

async function lookup(track, key) {
  try {
    const stored = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.data?.previewUrl && Date.now() - parsed.savedAt < CACHE_TTL_MS) {
        memoryCache.set(key, parsed);
        return parsed.data;
      }
    }
  } catch (_) {}

  let data;
  try {
    data = await searchItunesPreview(track);
  } catch (_) {
    return null;
  }
  if (!data?.previewUrl) {
    missCache.set(key, Date.now());
    return null;
  }
  const payload = { savedAt: Date.now(), data };
  memoryCache.set(key, payload);
  try {
    await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch (_) {}
  return data;
}

/**
 * Finds a short direct audio file (Apple's 30 s preview) for a song. Playback
 * always starts at the beginning of that file, so the saved passage does not
 * limit the lookup. One small request; no video player is booted.
 *
 * `priority: 'background'` queues row prefetches behind user taps.
 */
export function resolvePlayablePreview(track, { priority = 'user' } = {}) {
  if (!track?.name) return Promise.resolve(null);
  if (isReliablePreviewUrl(track.previewUrl)) return Promise.resolve({ previewUrl: track.previewUrl.trim() });

  const key = cacheKey(track);
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return Promise.resolve(cached.data);
  const missedAt = missCache.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return Promise.resolve(null);

  const existing = inflight.get(key);
  if (existing) {
    // A tap must not wait behind other rows' queued prefetches.
    if (priority !== 'background' && !existing.job.started) {
      existing.job.start();
    }
    return existing.promise;
  }

  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  const job = {
    started: false,
    start() {
      if (job.started) return promise;
      job.started = true;
      lookup(track, key)
        .catch(() => null)
        .then((data) => {
          inflight.delete(key);
          resolvePromise(data);
        });
      return promise;
    },
  };
  inflight.set(key, { job, promise });

  if (priority === 'background') {
    backgroundQueue.push(job);
    pumpBackgroundQueue();
  } else {
    job.start();
  }
  return promise;
}
