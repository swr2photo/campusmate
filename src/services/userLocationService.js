import AsyncStorage from '@react-native-async-storage/async-storage';

const storageKey = (userId) => `@campusmate:last_location:${userId}`;

export function hasUsableCoordinates(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export async function loadCachedUserLocation(userId) {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const latitude = Number(parsed?.latitude);
    const longitude = Number(parsed?.longitude);
    if (!hasUsableCoordinates(latitude, longitude)) return null;
    return {
      latitude,
      longitude,
      updatedAt: Number(parsed?.updatedAt) || 0,
      source: 'cache',
    };
  } catch {
    return null;
  }
}

export async function saveCachedUserLocation(userId, latitude, longitude) {
  if (!userId || !hasUsableCoordinates(latitude, longitude)) return;
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify({
      latitude,
      longitude,
      updatedAt: Date.now(),
    }));
  } catch {
    // Offline cache is best-effort only.
  }
}

/**
 * Prefer a fresh GPS fix; if that fails, fall back to the OS last-known
 * position, then the app's cached last-used location, then profile coords.
 */
export async function resolveUserLocation({
  Location,
  profileLatitude = null,
  profileLongitude = null,
  cachedLocation = null,
}) {
  const fallbacks = [];
  if (hasUsableCoordinates(cachedLocation?.latitude, cachedLocation?.longitude)) {
    fallbacks.push({
      latitude: cachedLocation.latitude,
      longitude: cachedLocation.longitude,
      accuracy: null,
      source: 'cache',
      updatedAt: cachedLocation.updatedAt || 0,
    });
  }
  if (hasUsableCoordinates(profileLatitude, profileLongitude)) {
    fallbacks.push({
      latitude: profileLatitude,
      longitude: profileLongitude,
      accuracy: null,
      source: 'profile',
      updatedAt: 0,
    });
  }

  let lastKnown = null;
  try {
    const known = await Location.getLastKnownPositionAsync({
      maxAge: 1000 * 60 * 60 * 24 * 7,
      requiredAccuracy: 5000,
    });
    if (known?.coords && hasUsableCoordinates(known.coords.latitude, known.coords.longitude)) {
      lastKnown = {
        latitude: known.coords.latitude,
        longitude: known.coords.longitude,
        accuracy: Number.isFinite(known.coords.accuracy) ? known.coords.accuracy : null,
        source: 'lastKnown',
        updatedAt: Number(known.timestamp) || Date.now(),
      };
    }
  } catch {
    // Some devices throw when no last-known fix exists.
  }

  try {
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    });
    if (current?.coords && hasUsableCoordinates(current.coords.latitude, current.coords.longitude)) {
      const accuracy = Number.isFinite(current.coords.accuracy) ? current.coords.accuracy : null;
      // Very coarse fixes are less trustworthy than a recent last-known/cached point.
      if (accuracy != null && accuracy > 5000 && lastKnown && (lastKnown.accuracy == null || lastKnown.accuracy <= accuracy)) {
        return lastKnown;
      }
      return {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy,
        source: 'current',
        updatedAt: Number(current.timestamp) || Date.now(),
      };
    }
  } catch {
    // Fall through to last-known / cache / profile.
  }

  if (lastKnown) return lastKnown;
  return fallbacks[0] || null;
}
