export const MIN_VISIBLE_DISTANCE_KM = 0.7;
export const PEER_DISTANCE_ID_LIMIT = 50;
export const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function haversineKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) return null;
  if (lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) return null;

  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function applyDistancePrivacyFloor(distanceKm) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  const flooredKm = Math.max(distanceKm, MIN_VISIBLE_DISTANCE_KM);
  return Math.round(flooredKm * 1000) / 1000;
}

export function isLocationSharingEnabled(profile) {
  return profile?.locationEnabled !== false;
}

export function hasUsableCoordinates(profile) {
  return typeof profile?.latitude === 'number'
    && Number.isFinite(profile.latitude)
    && typeof profile?.longitude === 'number'
    && Number.isFinite(profile.longitude)
    && profile.latitude >= -90
    && profile.latitude <= 90
    && profile.longitude >= -180
    && profile.longitude <= 180;
}

export function sanitizePeerUserIds(userIds, callerId) {
  if (!Array.isArray(userIds)) return [];
  const uniqueIds = [];
  const seen = new Set();
  for (const value of userIds) {
    if (typeof value !== 'string' || !USER_ID_PATTERN.test(value)) continue;
    if (value === callerId || seen.has(value)) continue;
    seen.add(value);
    uniqueIds.push(value);
    if (uniqueIds.length >= PEER_DISTANCE_ID_LIMIT) break;
  }
  return uniqueIds;
}

export function visibleDistanceKm(fromProfile, toProfile) {
  if (!isLocationSharingEnabled(fromProfile) || !isLocationSharingEnabled(toProfile)) return null;
  if (!hasUsableCoordinates(fromProfile) || !hasUsableCoordinates(toProfile)) return null;
  return applyDistancePrivacyFloor(haversineKm(
    fromProfile.latitude,
    fromProfile.longitude,
    toProfile.latitude,
    toProfile.longitude,
  ));
}
