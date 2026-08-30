export const ACTIVITY_LABELS = {
  running: 'วิ่ง',
  gym: 'เข้ายิม / ฟิตเนส',
  sports: 'เล่นกีฬา',
  study: 'อ่านหนังสือ / ติวสอบ',
  chill: 'คุยเล่น / คาเฟ่',
  other: 'กิจกรรมอื่น ๆ',
};

export function getActivityLabel(activity, activityLabel, activities) {
  if (Array.isArray(activities) && activities.length > 0) {
    return activities.map((a) => ACTIVITY_LABELS[a] || a).join(', ');
  }
  if (activityLabel && String(activityLabel).trim()) return activityLabel;
  if (Array.isArray(activity)) {
    return activity.map((a) => ACTIVITY_LABELS[a] || a).join(', ');
  }
  if (activity && ACTIVITY_LABELS[activity]) return ACTIVITY_LABELS[activity];
  return activity || '';
}

export function genderLabel(gender) {
  return ({
    male: 'ชาย',
    female: 'หญิง',
    nonbinary: 'นอนไบนารี',
    unspecified: 'ไม่ระบุ',
    other: 'อื่น ๆ',
  })[gender] || gender;
}

export function formatDistance(distKm) {
  if (distKm == null) return '';
  if (distKm < 1) {
    return Math.round(distKm * 1000) + ' เมตร';
  }
  return distKm.toFixed(1) + ' กม.';
}

export function formatReadableDate(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  const parts = str.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 0 && month < 12) {
      const d = new Date(year, month, day);
      const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
      const thaiMonths = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
      ];
      const thaiYear = year > 2400 ? year : year + 543;
      const dayName = thaiDays[d.getDay()];
      return `วัน${dayName}ที่ ${day} ${thaiMonths[month]} ${thaiYear}`;
    }
  }
  return str;
}
