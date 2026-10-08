export const CAMPUS_CENTER = { latitude: 7.008453, longitude: 100.497914 };

export function getSpotCoordinates(spot) {
  const lat = spot?.latitude ?? spot?.lat;
  const lng = spot?.longitude ?? spot?.lng;
  if (lat == null || lng == null || (typeof lat === 'string' && !lat.trim())
    || (typeof lng === 'string' && !lng.trim())
    || !['string', 'number'].includes(typeof lat) || !['string', 'number'].includes(typeof lng)) return null;
  const latitude = Number(lat), longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function externalMapUrl(spot) {
  const point = getSpotCoordinates(spot);
  const query = point ? `${point.latitude},${point.longitude}` : (spot?.name || 'มหาวิทยาลัยสงขลานครินทร์ หาดใหญ่');
  const placeId = spot?.location?.placeId || spot?.placeId;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''}`;
}
