export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system',
  autoplay: 'always',
  recommendation: 'balanced',
  publicUsername: '',
  notifications: Object.freeze({ email: true, push: true, sms: false, team: true }),
});

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system',
    autoplay: ['always', 'wifi', 'never'].includes(source.autoplay) ? source.autoplay : 'always',
    recommendation: ['balanced', 'recent'].includes(source.recommendation) ? source.recommendation : 'balanced',
    publicUsername: typeof source.publicUsername === 'string' ? source.publicUsername.trim().slice(0, 30) : '',
    notifications: Object.fromEntries(Object.entries(DEFAULT_PREFERENCES.notifications).map(([key, fallback]) => [
      key, typeof source.notifications?.[key] === 'boolean' ? source.notifications[key] : fallback,
    ])),
  };
}

export function canAutoplay(mode, network) {
  if (mode === 'never') return false;
  if (mode === 'wifi') return network?.type === 'wifi' && network?.isConnected === true;
  return true;
}

export function profileActivityTime(profile) {
  const value = profile?.lastSeen || profile?.updatedAt || profile?.createdAt;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function orderRecommendedProfiles(profiles, recommendation) {
  if (recommendation !== 'recent') return profiles;
  return [...profiles].sort((first, second) => profileActivityTime(second) - profileActivityTime(first));
}
