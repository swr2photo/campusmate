import AsyncStorage from '@react-native-async-storage/async-storage';

const FAST_BOOT_KEY = '@campusmate:fast_boot_v1';
const FAST_BOOT_FEED_LIMIT = 8;

let memoryCache = null;
let revision = 0;
let writes = Promise.resolve();

function persist(write) {
  writes = writes.catch(() => {}).then(write);
  return writes;
}

function compactFastBootProfiles() {
  // Discovery profiles are dynamic and session-specific. Never persist them
  // in fastBoot to prevent stale/phantom cards flashing on launch.
  return [];
}

export async function getFastBootData() {
  if (memoryCache) return memoryCache;
  const readingRevision = revision;
  try {
    const raw = await AsyncStorage.getItem(FAST_BOOT_KEY);
    if (revision !== readingRevision) return memoryCache;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    memoryCache = parsed;
    return parsed;
  } catch (e) {
    return null;
  }
}

export function getFastBootMemory() {
  return memoryCache;
}

export async function saveFastBootData({ user, profile, userId } = {}) {
  try {
    if (userId && memoryCache?.user?.id !== userId) return;
    if (profile?.id && memoryCache?.user?.id !== profile.id) return;
    const switched = user !== undefined && user?.id !== memoryCache?.user?.id;
    const prev = switched ? {} : memoryCache || {};
    const data = {
      user: user !== undefined ? user : prev.user || null,
      profile: profile !== undefined ? profile : prev.profile || null,
      availableProfiles: [],
      hasEnteredBefore: true,
      savedAt: Date.now(),
    };
    revision += 1;
    memoryCache = data;
    await persist(() => AsyncStorage.setItem(FAST_BOOT_KEY, JSON.stringify(data)));
  } catch (e) {
    console.warn('[fastBootService] Failed to save fast boot data:', e);
  }
}

export async function clearFastBootData() {
  revision += 1;
  memoryCache = null;
  try {
    await persist(() => AsyncStorage.removeItem(FAST_BOOT_KEY));
  } catch (e) {
    console.warn('[fastBootService] Failed to clear fast boot data:', e);
  }
}
