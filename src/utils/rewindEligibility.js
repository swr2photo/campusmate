// Per-device hint for the last opened profile swiped away. The server's
// canRewind state and authorized rewind mutation decide actual eligibility;
// an empty or stale local hint must not veto an available server rewind.

const listeners = new Set();
let openedProfileId = null;
let eligibleProfileId = null;

function emit() {
  listeners.forEach((listener) => listener(eligibleProfileId));
}

export function noteProfileOpened(profileId) {
  if (typeof profileId === 'string' && profileId) openedProfileId = profileId;
}

export function noteSwipeDismiss(profileId) {
  const next = profileId && profileId === openedProfileId ? profileId : null;
  openedProfileId = null;
  if (eligibleProfileId === next) return;
  eligibleProfileId = next;
  emit();
}

export function noteDismissWithoutOpen(profileId) {
  if (!profileId || openedProfileId === profileId) openedProfileId = null;
  if (!eligibleProfileId) return;
  eligibleProfileId = null;
  emit();
}

export function rewindEligibleProfileId() {
  return eligibleProfileId;
}

export function clearRewindEligibility() {
  openedProfileId = null;
  if (!eligibleProfileId) return;
  eligibleProfileId = null;
  emit();
}

export function subscribeRewindEligibility(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
