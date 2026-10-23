export function formatDiscoveryWait(deadline, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Number(deadline) - now) / 1000) || 0);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function getDiscoverySummary(candidate) {
  const raw = candidate?.compatibility;
  const score = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
  const reasons = Array.isArray(candidate?.matchReasons)
    ? candidate.matchReasons.filter(reason => typeof reason === 'string' && reason.trim()).map(reason => reason.trim())
    : [];
  return {
    score: Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null,
    reason: reasons.slice(0, 2).join(' · ') || 'แตะเพื่อดูโปรไฟล์และสิ่งที่สนใจ',
  };
}

export function getUniqueProfileTracks(tracks) {
  const seen = new Set();
  return (Array.isArray(tracks) ? tracks : []).filter(track => {
    if (!track?.id || !track?.name || seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

// A later discovery payload can omit a photo the device already showed.
// Keep the last real image instead of flashing an empty card.
export function mergeDiscoveryPhoto(previous, next) {
  if (!next || typeof next !== 'object') return previous || null;
  if (!previous || typeof previous !== 'object') return next;
  const gallery = Array.isArray(next.gallery) && next.gallery.length
    ? next.gallery
    : (Array.isArray(previous.gallery) ? previous.gallery : next.gallery);
  return {
    ...next,
    avatarUri: next.avatarUri || previous.avatarUri || null,
    gallery,
    avatarRevision: next.avatarRevision ?? previous.avatarRevision,
  };
}

// Consume only photos already exposed by the public profile/privacy policy.
export function getProfilePhotos(profile, requestUri = (uri) => uri) {
  const avatar = profile?.avatarUri
    || profile?.photoURL
    || profile?.photoUrl
    || profile?.avatarUrl
    || (Array.isArray(profile?.photos) ? profile.photos[0] : undefined);
  const gallery = [
    ...(Array.isArray(profile?.gallery) ? profile.gallery : []),
    ...(Array.isArray(profile?.photos) ? profile.photos : []),
  ];
  return [...new Set([avatar, ...gallery].filter((uri) => typeof uri === 'string' && uri.trim())
    .map((uri) => {
      const resolved = requestUri(uri, uri === avatar ? profile?.avatarRevision : undefined);
      return resolved || (typeof uri === 'string' && /^https?:\/\//i.test(uri.trim()) ? uri.trim() : null);
    }).filter(Boolean))];
}

