// "Chemistry" between me and another student, from real profile data only:
// the server's compatibility score when it sent one, otherwise the share of
// activities and favourite songs/artists we actually have in common.

function activityIds(profile) {
  const list = [profile?.interests, profile?.activities].find((value) => Array.isArray(value) && value.length);
  return new Set((list || [profile?.activity]).filter((id) => id && id !== 'other' && id !== 'all'));
}

function musicKeys(profile) {
  const keys = new Set();
  (Array.isArray(profile?.favoriteTracks) ? profile.favoriteTracks : []).forEach((track) => {
    if (track?.id) keys.add(`t:${track.id}`);
    String(track?.artists || track?.artist || '').split(/,\s*/).filter(Boolean).forEach((artist) => keys.add(`a:${artist.toLowerCase()}`));
  });
  return keys;
}

function overlap(first, second) {
  let shared = 0;
  first.forEach((value) => { if (second.has(value)) shared += 1; });
  return shared;
}

/** `{ score, source, sharedActivities, sharedMusic }`; score is null with no signal at all. */
export function chemistryFor(me, other) {
  const server = Number(other?.compatibility);
  const mine = activityIds(me);
  const theirs = activityIds(other);
  const sharedActivities = overlap(mine, theirs);
  const sharedMusic = overlap(musicKeys(me), musicKeys(other));
  if (Number.isFinite(server) && server >= 0 && server <= 100) {
    return { score: Math.round(server), source: 'server', sharedActivities, sharedMusic };
  }
  const union = new Set([...mine, ...theirs]).size;
  if (!union && !sharedMusic) return { score: null, source: 'none', sharedActivities, sharedMusic };
  const activityPart = union ? (sharedActivities / union) * 80 : 0;
  const musicPart = Math.min(20, sharedMusic * 10);
  return { score: Math.round(activityPart + musicPart), source: 'interests', sharedActivities, sharedMusic };
}

/** Strong match: the server says so, or we share music or several activities. */
export function hasChemistry(result) {
  if (!result || result.score == null) return false;
  if (result.source === 'server') return result.score >= 70;
  return result.sharedMusic > 0 || result.sharedActivities >= 2 || result.score >= 50;
}
