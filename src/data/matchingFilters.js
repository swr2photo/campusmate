import {
  ACTIVITY_CATEGORIES,
  RUNNING_PACE_OPTIONS,
  getActivityCategory,
  getActivityDetailFields,
} from './activityCategories';

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
  { value: 'ชั้นปีที่ 4', label: 'ปี 4+', icon: 'graduationcap.fill' },
  { value: 'ปริญญาโท', label: 'ป.โท', icon: 'graduationcap.fill' },
  { value: 'ปริญญาเอก', label: 'ป.เอก', icon: 'graduationcap.fill' },
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

export const MATCHING_ACTIVITY_OPTIONS = ACTIVITY_CATEGORIES
  .filter((category) => category.id !== 'all')
  .map((category) => ({
    value: category.id,
    label: category.shortLabel || category.label,
    icon: category.symbol || 'sparkles',
    primary: category.primary === true,
  }));

export const MATCHING_PRIMARY_ACTIVITY_OPTIONS = MATCHING_ACTIVITY_OPTIONS.filter((option) => option.primary);
export const MATCHING_MORE_ACTIVITY_OPTIONS = MATCHING_ACTIVITY_OPTIONS.filter((option) => !option.primary);

const PACE_SHORT_LABELS = ['เดิน', '8:00+', '7–8', '6–7', '5–6', '< 5'];
export const MATCHING_PACE_OPTIONS = RUNNING_PACE_OPTIONS.map((value, index) => ({
  value,
  label: PACE_SHORT_LABELS[index] || value,
  icon: 'speedometer',
}));

export const MATCHING_AVAILABILITY_OPTIONS = [
  { value: 'morning', label: 'เช้า', icon: 'clock.fill' },
  { value: 'afternoon', label: 'บ่าย', icon: 'clock.fill' },
  { value: 'evening', label: 'เย็น', icon: 'sunset.fill' },
  { value: 'night', label: 'ดึก', icon: 'clock.fill' },
];

export const MATCHING_PRIMARY_GENDER_VALUES = ['male', 'female'];
export const MATCHING_PRIMARY_GENDER_OPTIONS = MATCHING_GENDER_OPTIONS.filter(
  (option) => MATCHING_PRIMARY_GENDER_VALUES.includes(option.value)
);
export const MATCHING_MORE_GENDER_OPTIONS = MATCHING_GENDER_OPTIONS.filter(
  (option) => !MATCHING_PRIMARY_GENDER_VALUES.includes(option.value)
);

export const MATCHING_WEEKDAY_OPTIONS = [
  { value: '1', label: 'จ', longLabel: 'จันทร์' },
  { value: '2', label: 'อ', longLabel: 'อังคาร' },
  { value: '3', label: 'พ', longLabel: 'พุธ' },
  { value: '4', label: 'พฤ', longLabel: 'พฤหัสบดี' },
  { value: '5', label: 'ศ', longLabel: 'ศุกร์' },
  { value: '6', label: 'ส', longLabel: 'เสาร์' },
  { value: '0', label: 'อา', longLabel: 'อาทิตย์' },
];

export const MATCHING_DISTANCE_PRESETS = [3, 5, 10, 25, 50];
export const MATCHING_UNLIMITED_DISTANCE = 0;

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
  const unrestricted = selected.length === 0 || selected.length === options.length;
  return Object.fromEntries(options.map(({ value }) => [
    value,
    !unrestricted && selected.includes(value),
  ]));
}

export function getSelectedMatchingValues(options, state) {
  const selected = options
    .filter(({ value }) => state?.[value])
    .map(({ value }) => value);
  return selected.length === options.length ? [] : selected;
}

export function isMatchingOptionUnrestricted(options, state) {
  return !options.some(({ value }) => state?.[value]);
}

export function toggleMatchingOption(options, state, value) {
  const next = { ...state, [value]: !state?.[value] };
  const selectedCount = options.reduce((count, option) => (
    count + (next[option.value] ? 1 : 0)
  ), 0);
  if (selectedCount === 0 || selectedCount === options.length) {
    return createMatchingOptionState(options);
  }
  return next;
}

export function matchesAvailabilityWeekdays(profile, weekdays) {
  const selected = (Array.isArray(weekdays) ? weekdays : [])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (!selected.length) return true;

  const selectedSet = new Set(selected);
  const slots = Array.isArray(profile?.availabilitySlots) ? profile.availabilitySlots : [];
  let hasDatedSlot = false;
  const matchesDay = slots.some((slot) => {
    const rawDate = slot?.date ? String(slot.date).trim() : '';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
    if (!match) return false;
    hasDatedSlot = true;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return selectedSet.has(date.getDay());
  });
  return !hasDatedSlot || matchesDay;
}

// ---------------------------------------------------------------------------
// Per-activity detail filters. Stored in matchingPreferences.activityDetails as
// { [activityId]: { [fieldKey]: string[] } }. An empty list (or missing key)
// means "any". Running pace keeps its dedicated `paces` preference, so it is
// excluded here to avoid two competing filters for the same value.
// ---------------------------------------------------------------------------
const DETAIL_FILTER_MAX_OPTIONS = 20;

export function getFilterableActivityDetailFields(activityId) {
  return getActivityDetailFields(activityId).filter((field) => (
    (field.type === 'select' || field.type === 'multi')
    && Array.isArray(field.options)
    && !(activityId === 'running' && field.key === 'pace')
  ));
}

export function getActivityDetailFilterOptions(activityId) {
  const category = getActivityCategory(activityId);
  const fields = getFilterableActivityDetailFields(activityId);
  if (!category || !fields.length) return null;
  return {
    id: activityId,
    label: category.label,
    symbol: category.symbol,
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      options: field.options.map((option) => ({ value: option, label: option })),
    })),
  };
}

export function sanitizeActivityDetailFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([activityId, fieldsValue]) => {
    const fields = getFilterableActivityDetailFields(activityId);
    if (!fields.length || !fieldsValue || typeof fieldsValue !== 'object' || Array.isArray(fieldsValue)) return;
    const clean = {};
    fields.forEach((field) => {
      const list = fieldsValue[field.key];
      if (!Array.isArray(list)) return;
      const selected = Array.from(new Set(
        list.filter((item) => typeof item === 'string' && field.options.includes(item))
      )).slice(0, DETAIL_FILTER_MAX_OPTIONS);
      // Selecting every option is the same as no filter.
      if (selected.length && selected.length < field.options.length) clean[field.key] = selected;
    });
    if (Object.keys(clean).length) result[activityId] = clean;
  });
  return result;
}

export function hasActivityDetailFilters(filters) {
  return Object.keys(sanitizeActivityDetailFilters(filters)).length > 0;
}

export function toggleActivityDetailFilter(filters, activityId, fieldKey, option) {
  const current = sanitizeActivityDetailFilters(filters);
  const list = current[activityId]?.[fieldKey] || [];
  const nextList = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
  return sanitizeActivityDetailFilters({
    ...current,
    [activityId]: { ...(current[activityId] || {}), [fieldKey]: nextList },
  });
}

export function clearActivityDetailFilter(filters, activityId, fieldKey) {
  const current = sanitizeActivityDetailFilters(filters);
  if (!current[activityId]) return current;
  const next = { ...current, [activityId]: { ...current[activityId] } };
  if (fieldKey) delete next[activityId][fieldKey];
  else delete next[activityId];
  if (next[activityId] && !Object.keys(next[activityId]).length) delete next[activityId];
  return next;
}

// Drop filters for activities the user no longer has selected so a stale
// sports filter cannot hide everyone once "sports" is unticked.
export function pruneActivityDetailFilters(filters, selectedActivities) {
  const current = sanitizeActivityDetailFilters(filters);
  const selected = Array.isArray(selectedActivities) ? selectedActivities : [];
  if (!selected.length) return {};
  return Object.fromEntries(Object.entries(current).filter(([activityId]) => selected.includes(activityId)));
}

export function matchesActivityDetailFilters(profile, filters) {
  const active = sanitizeActivityDetailFilters(filters);
  const activityIds = Object.keys(active);
  if (!activityIds.length) return true;
  const details = profile?.activityDetails && typeof profile.activityDetails === 'object'
    ? profile.activityDetails
    : {};
  // Filters on different activities are OR-ed (the profile matches if it
  // satisfies any one of the filtered activities); fields inside an activity
  // are AND-ed. This mirrors how the activity chips themselves behave.
  return activityIds.some((activityId) => {
    const entry = details[activityId];
    if (!entry || typeof entry !== 'object') return false;
    return Object.entries(active[activityId]).every(([fieldKey, wanted]) => {
      const value = entry[fieldKey];
      const values = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
      return values.some((item) => wanted.includes(item));
    });
  });
}

export function profileHasPhoto(profile) {
  return ['avatarUri', 'photoURL', 'photoUrl', 'avatarUrl']
    .some((field) => typeof profile?.[field] === 'string' && profile[field].trim().length > 0);
}

export function profileHasAvailability(profile) {
  if (Array.isArray(profile?.availabilitySlots) && profile.availabilitySlots.length > 0) return true;
  return typeof profile?.availability === 'string' && profile.availability.trim().length > 0;
}
