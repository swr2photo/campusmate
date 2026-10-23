export function presencePresentation(record, now = Date.now()) {
  if (record?.visible !== true) return { label: '', isOnline: false, visible: false };
  const until = Number(record.expiresAt) || 0, last = Number(record.lastActiveAt) || 0;
  if (record.isOnline === true && until > now) return { label: 'ออนไลน์', isOnline: true, visible: true };
  if (!last) return { label: '', isOnline: false, visible: true };
  const elapsed = Math.max(0, now - last);
  const unit = [[365 * 86400000, 'ปี'], [30 * 86400000, 'เดือน'], [86400000, 'วัน'], [3600000, 'ชั่วโมง'], [60000, 'นาที']].find(([duration]) => elapsed >= duration);
  return { label: unit ? `ใช้งานเมื่อ ${Math.floor(elapsed / unit[0])} ${unit[1]}ที่แล้ว` : 'ใช้งานเมื่อสักครู่', isOnline: false, visible: true };
}
