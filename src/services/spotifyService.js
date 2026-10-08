import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService.js';

const FUNCTIONS_REGION = 'asia-southeast1';
const BROWSE_TTL_MS = 12 * 60 * 1000;

let browseCache = null;
let browseCacheAt = 0;
let browseCacheLimit = 0;
let browseInflight = null;
let browseInflightLimit = 0;

function normalizeBrowsePayload(data, limit = 20) {
  return {
    recommended: Array.isArray(data?.recommended) ? data.recommended.slice(0, limit) : [],
    trending: Array.isArray(data?.trending) ? data.trending.slice(0, limit) : [],
  };
}

function normalizeBrowseLimit(limit) {
  return Math.min(25, Math.max(4, Math.floor(Number(limit) || 20)));
}

function isBrowseCacheFresh(limit = 0) {
  return Boolean(browseCache) && browseCacheLimit >= limit && (Date.now() - browseCacheAt) < BROWSE_TTL_MS;
}

/** Sync snapshot for instant UI when opening the search sheet. */
export function getCachedBrowseMusicTracks() {
  return isBrowseCacheFresh() ? browseCache : null;
}

async function fetchBrowseMusicTracks({ limit = 20 } = {}) {
  const { app } = requireFirebase();
  const browseFn = httpsCallable(
    getFunctions(app, FUNCTIONS_REGION),
    'browseMusicTracks',
    { timeout: 20000 },
  );

  const result = await browseFn({
    limit: normalizeBrowseLimit(limit),
  });

  const payload = normalizeBrowsePayload(result?.data, limit);
  browseCache = payload;
  browseCacheAt = Date.now();
  browseCacheLimit = limit;
  return payload;
}

/**
 * Warm browse charts in the background so the search sheet opens with data ready.
 */
export function prefetchBrowseMusicTracks({ limit = 20, force = false } = {}) {
  const requestedLimit = normalizeBrowseLimit(limit);
  if (!force && isBrowseCacheFresh(requestedLimit)) return Promise.resolve(browseCache);
  if (browseInflight) {
    if (browseInflightLimit >= requestedLimit) return browseInflight;
    return browseInflight.then(() => prefetchBrowseMusicTracks({ limit: requestedLimit, force }));
  }

  browseInflightLimit = requestedLimit;
  browseInflight = fetchBrowseMusicTracks({ limit: requestedLimit })
    .catch((err) => {
      // Keep stale cache if refresh fails.
      if (browseCache) return browseCache;
      throw err;
    })
    .finally(() => {
      browseInflight = null;
      browseInflightLimit = 0;
    });

  return browseInflight;
}

/** Search one page of tracks, preserving the selected provider across pages. */
export async function searchSpotifyTracksPage({ q, limit = 10, offset = 0, source } = {}) {
  const query = typeof q === 'string' ? q.trim() : '';
  if (!query) return { tracks: [], hasMore: false, nextOffset: 0, source: null };

  const pageSize = Math.min(10, Math.max(1, Math.floor(Number(limit) || 10)));
  const pageOffset = Math.min(1000, Math.max(0, Math.floor(Number(offset) || 0)));

  const { app } = requireFirebase();
  const searchFn = httpsCallable(
    getFunctions(app, FUNCTIONS_REGION),
    'searchSpotifyTracks',
    { timeout: 15000 },
  );

  const result = await searchFn({
    q: query.slice(0, 100),
    limit: pageSize,
    offset: pageOffset,
    ...(source === 'spotify' || source === 'itunes' ? { source } : {}),
  });

  const data = result?.data;
  return {
    tracks: Array.isArray(data?.tracks) ? data.tracks : [],
    hasMore: Boolean(data?.hasMore),
    nextOffset: Number.isInteger(data?.nextOffset) ? data.nextOffset : pageOffset + pageSize,
    source: data?.source === 'spotify' || data?.source === 'itunes' ? data.source : null,
  };
}

/** Legacy single-page search API used by existing callers. */
export async function searchSpotifyTracks(options = {}) {
  const page = await searchSpotifyTracksPage(options);
  return page.tracks;
}

/**
 * Browse Thailand recommended + trending charts for the empty search state.
 * Uses in-memory cache first; refreshes in background when stale.
 */
export async function browseMusicTracks({ limit = 20, force = false } = {}) {
  const requestedLimit = normalizeBrowseLimit(limit);
  if (!force && isBrowseCacheFresh(requestedLimit)) {
    return browseCache;
  }

  if (!force && browseInflight) {
    return prefetchBrowseMusicTracks({ limit: requestedLimit });
  }

  if (!force && browseCache && browseCacheLimit >= requestedLimit) {
    // Serve stale immediately, refresh quietly.
    prefetchBrowseMusicTracks({ limit: requestedLimit }).catch(() => {});
    return browseCache;
  }

  return prefetchBrowseMusicTracks({ limit: requestedLimit, force });
}
