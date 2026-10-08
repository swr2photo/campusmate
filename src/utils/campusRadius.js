import { CAMPUS_CENTER } from './mapCoordinates';
export const PSU_HAT_YAI = CAMPUS_CENTER;
export const PARTY_RADIUS_METERS = 3000;

export function distanceFromCampusMeters(point) {
  const rad = Math.PI / 180;
  const dLat = (point.latitude - PSU_HAT_YAI.latitude) * rad;
  const dLng = (point.longitude - PSU_HAT_YAI.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(point.latitude * rad) * Math.cos(PSU_HAT_YAI.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinPartyRadius(point) {
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
    && distanceFromCampusMeters(point) <= PARTY_RADIUS_METERS;
}
