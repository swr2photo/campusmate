import { getSpotCoordinates } from './mapCoordinates';

export function placeDetailRows(spot) {
  const point = getSpotCoordinates(spot);
  return [
    { icon: 'tag.fill', label: 'ประเภทสถานที่', value: spot?.categoryLabel },
    { icon: 'square.grid.2x2.fill', label: 'หมวดกิจกรรม', value: spot?.group },
    { icon: 'mappin.and.ellipse', label: 'ที่อยู่', value: spot?.address || spot?.formattedAddress },
    { icon: 'location.fill', label: 'ระยะทางจากคุณ', value: spot?.distance },
    { icon: 'star.fill', label: 'คะแนนสถานที่', value: spot?.rating != null ? `${spot.rating} / 5` : null },
    { icon: 'person.2.fill', label: 'ช่วงเวลาคนเยอะ', value: spot?.busyTime },
    { icon: 'clock.fill', label: 'เวลาเปิด', value: Array.isArray(spot?.openingHours) ? spot.openingHours.join('\n') : (typeof spot?.openingHours === 'string' ? spot.openingHours : null) },
    { icon: 'calendar', label: 'นัดหมายของคุณ', value: spot?.schedule?.date ? `${spot.schedule.date} · ${spot.schedule.startTime || ''}–${spot.schedule.endTime || ''}` : spot?.scheduledAt },
    { icon: 'map.fill', label: 'พิกัดสถานที่', value: point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : null },
  ].filter((row) => row.value != null && row.value !== '');
}
