import { ACTIVITY_CATEGORIES } from './activityCategories';

export const MATCHING_AGE_MIN = 18;
export const MATCHING_AGE_MAX = 35;
export const MATCHING_DEFAULT_AGE_MAX = 35;
export const MATCHING_AGE_VALUES = Array.from(
  { length: MATCHING_AGE_MAX - MATCHING_AGE_MIN + 1 },
  (_, index) => MATCHING_AGE_MIN + index
);

export function normalizeMatchingAge(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(MATCHING_AGE_MAX, Math.max(MATCHING_AGE_MIN, parsed));
}

export const MATCHING_YEAR_OPTIONS = [
  { value: 'ชั้นปีที่ 1', label: 'ปี 1', icon: 'graduationcap.fill' },
  { value: 'ชั้นปีที่ 2', label: 'ปี 2', icon: 'graduationcap.fill' },
  { value: 'ชั้นปีที่ 3', label: 'ปี 3', icon: 'graduationcap.fill' },
  { value: 'ชั้นปีที่ 4', label: 'ปี 4 ขึ้นไป', icon: 'graduationcap.fill' },
  { value: 'ปริญญาโท', label: 'ปริญญาโท', icon: 'graduationcap.fill' },
  { value: 'ปริญญาเอก', label: 'ปริญญาเอก', icon: 'graduationcap.fill' },
];

export const MATCHING_GENDER_OPTIONS = [
  { value: 'male', label: 'ชาย', icon: 'person.fill' },
  { value: 'female', label: 'หญิง', icon: 'person.fill' },
  { value: 'trans_male', label: 'ชายข้ามเพศ', icon: 'person.2.fill' },
  { value: 'trans_female', label: 'หญิงข้ามเพศ', icon: 'person.2.fill' },
  { value: 'nonbinary', label: 'นอนไบนารี', icon: 'person.2.fill' },
  { value: 'genderfluid', label: 'เจนเดอร์ฟลูอิด', icon: 'person.2.fill' },
  { value: 'bigender', label: 'ไบเจนเดอร์', icon: 'person.2.fill' },
  { value: 'agender', label: 'อะเจนเดอร์', icon: 'person.2.fill' },
  { value: 'queer', label: 'เควียร์', icon: 'person.2.fill' },
  { value: 'other', label: 'เพศอื่น ๆ', icon: 'person.2.fill' },
  { value: 'unspecified', label: 'ไม่ประสงค์ระบุ', icon: 'person.2.fill' },
];

const ACTIVITY_ICONS = {
  running: 'figure.run',
  gym: 'dumbbell.fill',
  sports: 'sportscourt.fill',
  study: 'book.closed.fill',
  chill: 'cup.and.saucer.fill',
  other: 'sparkles',
};

export const MATCHING_ACTIVITY_OPTIONS = ACTIVITY_CATEGORIES
  .filter((category) => category.id !== 'all')
  .map((category) => ({
    value: category.id,
    label: category.label,
    icon: ACTIVITY_ICONS[category.id] || 'sparkles',
  }));

export const MATCHING_PACE_OPTIONS = [
  { value: 'เดิน / เริ่มต้น', label: 'เดิน / เริ่มต้น', icon: 'speedometer' },
  { value: 'Pace 8:00+ นาที/กม.', label: 'Pace 8:00+ นาที/กม.', icon: 'speedometer' },
  { value: 'Pace 7:00 - 8:00 นาที/กม.', label: 'Pace 7:00–8:00', icon: 'speedometer' },
  { value: 'Pace 6:00 - 7:00 นาที/กม.', label: 'Pace 6:00–7:00', icon: 'speedometer' },
  { value: 'Pace 5:00 - 6:00 นาที/กม.', label: 'Pace 5:00–6:00', icon: 'speedometer' },
  { value: 'Pace ต่ำกว่า 5:00 นาที/กม.', label: 'Pace ต่ำกว่า 5:00', icon: 'speedometer' },
];

export const MATCHING_AVAILABILITY_OPTIONS = [
  { value: 'morning', label: 'ช่วงเช้า', icon: 'clock.fill' },
  { value: 'afternoon', label: 'ช่วงบ่าย', icon: 'clock.fill' },
  { value: 'evening', label: 'ช่วงเย็น', icon: 'sunset.fill' },
  { value: 'night', label: 'ช่วงดึก', icon: 'clock.fill' },
];

// Keep the availability filter and the profile's detailed time slots on the
// same clock. Night includes the hours after midnight as well, so a slot such
// as 00:00–05:00 is not silently ignored by the matcher.
export const AVAILABILITY_PERIOD_RANGES = {
  morning: [[6 * 60, 12 * 60]],
  afternoon: [[12 * 60, 18 * 60]],
  evening: [[18 * 60, 21 * 60]],
  night: [[21 * 60, 24 * 60], [0, 6 * 60]],
};

export function timeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || hour < 0
    || hour > 24
    || minute < 0
    || minute > 59
    || (hour === 24 && minute !== 0)
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function legacyAvailabilityMatches(availability, periods) {
  if (typeof availability !== 'string' || !availability.trim()) return false;
  const normalized = availability.toLowerCase();
  if (normalized.includes('ตลอดเวลา') || normalized.includes('anytime')) return true;
  const keywords = {
    morning: ['เช้า', 'morning'],
    afternoon: ['บ่าย', 'afternoon'],
    evening: ['เย็น', 'ค่ำ', 'evening'],
    night: ['ดึก', 'กลางคืน', 'night'],
  };
  return periods.some((period) => keywords[period]?.some((keyword) => normalized.includes(keyword)));
}

export function matchesAvailabilityPeriods(profile, periods) {
  const validPeriods = (Array.isArray(periods) ? periods : [])
    .filter((period) => AVAILABILITY_PERIOD_RANGES[period]);
  if (!validPeriods.length) return true;

  if (legacyAvailabilityMatches(profile?.availability, validPeriods)) return true;

  const slots = Array.isArray(profile?.availabilitySlots) ? profile.availabilitySlots : [];
  return slots.some((slot) => {
    const start = timeToMinutes(slot?.start);
    const end = timeToMinutes(slot?.end);
    if (start == null || end == null || end <= start) return false;

    return validPeriods.some((period) => (
      AVAILABILITY_PERIOD_RANGES[period].some(([periodStart, periodEnd]) => (
        start < periodEnd && end > periodStart
      ))
    ));
  });
}

export function createMatchingOptionState(options, selectedValues) {
  const selected = Array.isArray(selectedValues) ? selectedValues : [];
  const allSelected = selected.length === 0;
  return Object.fromEntries(options.map(({ value }) => [
    value,
    allSelected || selected.includes(value),
  ]));
}

export function getSelectedMatchingValues(options, state) {
  const selected = options
    .filter(({ value }) => state?.[value])
    .map(({ value }) => value);
  return selected.length === options.length ? [] : selected;
}
