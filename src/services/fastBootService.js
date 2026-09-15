import AsyncStorage from '@react-native-async-storage/async-storage';

const FAST_BOOT_KEY = '@campusmate:fast_boot_v1';

let memoryCache = null;

export async function getFastBootData() {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(FAST_BOOT_KEY);
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

export async function saveFastBootData({ user, profile }) {
  try {
    const prev = memoryCache || {};
    const data = {
      user: user !== undefined ? user : prev.user || null,
      profile: profile !== undefined ? profile : prev.profile || null,
      hasEnteredBefore: true,
      savedAt: Date.now(),
    };
    memoryCache = data;
    await AsyncStorage.setItem(FAST_BOOT_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[fastBootService] Failed to save fast boot data:', e);
  }
}

export async function clearFastBootData() {
  memoryCache = null;
  try {
    await AsyncStorage.removeItem(FAST_BOOT_KEY);
  } catch (e) {
    console.warn('[fastBootService] Failed to clear fast boot data:', e);
  }
}
