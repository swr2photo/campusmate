export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system',
  autoplay: 'always',
  recommendation: 'balanced',
  publicUsername: '',
  showOnlineStatus: true,
  muteAutoplayVideo: true,
  notifications: Object.freeze({ email: false, push: true, sms: false, team: true }),
});

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system',
    autoplay: ['always', 'wifi', 'never'].includes(source.autoplay) ? source.autoplay : 'always',
    recommendation: ['balanced', 'recent'].includes(source.recommendation) ? source.recommendation : 'balanced',
    publicUsername: typeof source.publicUsername === 'string' ? source.publicUsername.trim().slice(0, 30) : '',
    showOnlineStatus: source.showOnlineStatus !== false,
    muteAutoplayVideo: source.muteAutoplayVideo !== false,
    notifications: Object.fromEntries(Object.entries(DEFAULT_PREFERENCES.notifications).map(([key, fallback]) => [
      key, typeof source.notifications?.[key] === 'boolean' ? source.notifications[key] : fallback,
    ])),
  };
}

export function validatePreferencePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new Error('ไม่พบการตั้งค่าที่จะบันทึก');
  for (const [key, value] of Object.entries(patch)) {
    let valid;
    switch (key) {
      case 'theme': valid = ['system', 'light', 'dark'].includes(value); break;
      case 'autoplay': valid = ['always', 'wifi', 'never'].includes(value); break;
      case 'recommendation': valid = ['balanced', 'recent'].includes(value); break;
      case 'showOnlineStatus': case 'muteAutoplayVideo': valid = typeof value === 'boolean'; break;
      case 'publicUsername': valid = typeof value === 'string' && (value === '' || /^[a-z0-9_.]{3,30}$/.test(value)); break;
      case 'notifications': valid = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
        && Object.entries(value).every(([channel, flag]) => ['email', 'push', 'sms', 'team'].includes(channel) && typeof flag === 'boolean'); break;
      default: valid = false;
    }
    if (!valid) throw new Error(key === 'publicUsername' ? 'ใช้ a–z, 0–9, จุด หรือขีดล่าง จำนวน 3–30 ตัวอักษร' : 'การตั้งค่าไม่ถูกต้อง กรุณาลองใหม่');
  }
  return patch;
}

export function canAutoplay(mode, network) {
  if (mode === 'never') return false;
  if (mode === 'wifi') return network?.type === 'wifi' && network?.isConnected === true;
  return true;
}

export function profileActivityTime(profile) {
  const value = profile?.updatedAt || profile?.createdAt;
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
