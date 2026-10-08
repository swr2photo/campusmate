export const MIN_VISIBLE_DISTANCE_KM = 0.7;

export function applyDistancePrivacyFloor(distanceKm) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  return Math.max(distanceKm, MIN_VISIBLE_DISTANCE_KM);
}

export function formatPersonDistance(distanceKm) {
  const km = applyDistancePrivacyFloor(distanceKm);
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} เมตร`;
  return `${km.toFixed(1)} กม.`;
}
