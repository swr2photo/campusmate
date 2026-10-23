export function getPlaybackRange(startMs, endMs, durationSeconds = 0) {
  const start = Math.max(0, Number(startMs) || 0) / 1000;
  const rawEnd = Number(endMs) / 1000;
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (duration && start >= duration) return null;
  const end = rawEnd > start ? Math.min(rawEnd, duration || Infinity) : (duration || null);
  if (end != null && end <= start) return null;
  return { start, end };
}

export function previewFitsProviderClip(startMs, endMs) {
  return (Number(startMs) || 0) < 30000 && (Number(endMs) || 0) <= 30000;
}

export function spotifyListenUrl(track) {
  const external = typeof track?.externalUrl === 'string' ? track.externalUrl.trim() : '';
  if (/^https?:\/\//i.test(external)) return external;
  const id = String(track?.id || track?.trackId || '').trim();
  if (/^[A-Za-z0-9]{22}$/.test(id)) return `https://open.spotify.com/track/${id}`;
  const query = [track?.name, track?.artists].filter(Boolean).join(' ').trim();
  return query ? `https://open.spotify.com/search/${encodeURIComponent(query)}` : '';
}

// Spotify's preview host often answers slowly or refuses the file. A direct
// Apple preview starts in one request, so prefer it when both exist.
export function isReliablePreviewUrl(url) {
  return typeof url === 'string'
    && /^https?:\/\//i.test(url)
    && !/p\.scdn\.co|spotify\.com/i.test(url);
}

export function canUseTrackPreview(track) {
  if (typeof track?.previewUrl !== 'string' || !track.previewUrl.trim()) return false;
  // The passage is a position in the full song. A 30 s preview can play it
  // only when the whole passage is inside that file. A saved YouTube id does
  // not change that: the iframe player is the slow path.
  return previewFitsProviderClip(track.previewStartMs, track.previewEndMs);
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryArtist(artists) {
  return normalizeTitle(String(artists || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i)[0]);
}

function scoreItunesPreview(track, item) {
  const previewUrl = typeof item?.previewUrl === 'string' ? item.previewUrl.trim() : '';
  if (!/^https?:\/\//i.test(previewUrl)) return -1;
  const title = normalizeTitle(track?.name);
  const itemTitle = normalizeTitle(item?.trackName);
  if (!title || !itemTitle) return -1;
  let score = 0;
  if (itemTitle === title) score += 60;
  else if (itemTitle.includes(title) || title.includes(itemTitle)) score += 35;
  else return -1;

  const artist = primaryArtist(track?.artists);
  const itemArtist = normalizeTitle(item?.artistName);
  if (!artist) score += 10;
  else if (itemArtist.includes(artist) || artist.includes(itemArtist)) score += 30;
  else score -= 25;

  const expected = Number(track?.durationMs);
  const actual = Number(item?.trackTimeMillis);
  if (expected > 1000 && actual > 1000) {
    const delta = Math.abs(expected - actual);
    if (delta < 10000) score += 15;
    else if (delta > 45000) score -= 40;
  }
  return score;
}

export function pickItunesPreview(track, items) {
  let best = null;
  let bestScore = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const score = scoreItunesPreview(track, item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  if (!best || bestScore < 50) return null;
  const durationMs = Number(best.trackTimeMillis);
  return {
    previewUrl: best.previewUrl.trim(),
    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs: Math.round(durationMs) } : {}),
  };
}
