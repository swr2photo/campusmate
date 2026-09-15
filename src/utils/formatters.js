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
  if (activityLabel && String(activityLabel).trim() && !activityLabel.includes('???')) return activityLabel;
  if (Array.isArray(activity)) {
    return activity.map((a) => ACTIVITY_LABELS[a] || a).join(', ');
  }
  if (activity && ACTIVITY_LABELS[activity]) return ACTIVITY_LABELS[activity];
  return (activityLabel && !activityLabel.includes('???') ? activityLabel : '') || activity || '';
}

export function genderLabel(gender) {
  return ({
    male: 'ชาย',
    female: 'หญิง',
    trans_male: 'ชายข้ามเพศ',
    trans_female: 'หญิงข้ามเพศ',
    nonbinary: 'นอนไบนารี',
    genderfluid: 'เจนเดอร์ฟลูอิด',
    bigender: 'ไบเจนเดอร์',
    agender: 'อะเจนเดอร์',
    queer: 'เควียร์',
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

export function formatAvailabilitySlots(slots, options = {}) {
  const { compact = false } = options;
  if (!Array.isArray(slots) || slots.length === 0) return '';

  const thaiDaysFull = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const thaiDaysShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  // Group slots by date
  const dateGroups = new Map();
  const rawStringSlots = [];

  // Sort slots chronologically
  const sortedSlots = [...slots].filter(Boolean).sort((a, b) => {
    if (typeof a === 'string' || typeof b === 'string') return 0;
    const dateA = a?.date ? String(a.date).trim() : '';
    const dateB = b?.date ? String(b.date).trim() : '';
    const startA = a?.start ? String(a.start).trim() : '';
    const startB = b?.start ? String(b.start).trim() : '';
    return `${dateA}|${startA}`.localeCompare(`${dateB}|${startB}`);
  });

  sortedSlots.forEach((slot) => {
    if (!slot) return;
    if (typeof slot === 'string') {
      const trimmed = slot.trim();
      if (trimmed) rawStringSlots.push(trimmed);
      return;
    }
    if (typeof slot !== 'object' || Array.isArray(slot)) return;

    const start = slot.start ? String(slot.start).trim() : '';
    const end = slot.end ? String(slot.end).trim() : '';
    const timeStr = start && end ? `${start}-${end}` : start || end;

    const rawDate = slot.date ? String(slot.date).trim() : '';
    let dateLabel = '';

    if (rawDate) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        if (month >= 0 && month < 12) {
          const d = new Date(year, month, day);
          const dayIndex = d.getDay();
          if (compact) {
            dateLabel = `${thaiDaysShort[dayIndex]} ${day} ${thaiMonths[month]}`;
          } else {
            dateLabel = `วัน${thaiDaysFull[dayIndex]} ${day} ${thaiMonths[month]}`;
          }
        }
      }
      if (!dateLabel) {
        dateLabel = rawDate;
      }
    }

    const key = dateLabel || '__no_date__';
    if (!dateGroups.has(key)) {
      dateGroups.set(key, { label: dateLabel, times: [] });
    }
    if (timeStr && !dateGroups.get(key).times.includes(timeStr)) {
      dateGroups.get(key).times.push(timeStr);
    }
  });

  const lines = [];
  dateGroups.forEach(({ label, times }) => {
    const timesStr = times.join(', ');
    if (label && timesStr) {
      lines.push(`${label} · ${timesStr}`);
    } else if (label) {
      lines.push(label);
    } else if (timesStr) {
      lines.push(timesStr);
    }
  });

  if (rawStringSlots.length > 0) {
    lines.push(...rawStringSlots);
  }

  return lines.join(compact ? ', ' : '\n');
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


