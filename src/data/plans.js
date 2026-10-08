/**
 * Single source of truth for CampusMate plans and what each plan unlocks.
 *
 * The matrix mirrors the user-facing CampusMate Plus comparison (MembershipScreen)
 * and the server copy in functions/plusEntitlements.js (PLAN_FEATURES). Keep the
 * two in sync; functions/planFeatures.test.js fails if they drift.
 *
 * Pure module (no React Native imports) so it can be unit-tested with node.
 */

export const PLAN_FREE = 'free';
export const PLAN_PLUS = 'plus';
export const PLUS_ENTITLEMENT_ID = 'campusmate_plus';

export const FEATURE_NO_ADS = 'noAds';
export const FEATURE_ADVANCED_FILTERS = 'advancedFilters';
export const FEATURE_INCOMING_LIKE_PROFILES = 'incomingLikeProfiles';
export const FEATURE_UNLIMITED_REWIND = 'unlimitedRewind';
export const FEATURE_INCOGNITO = 'incognito';

export const PLAN_FEATURES = Object.freeze({
  [PLAN_FREE]: Object.freeze({
    [FEATURE_NO_ADS]: false,
    [FEATURE_ADVANCED_FILTERS]: false,
    [FEATURE_INCOMING_LIKE_PROFILES]: false,
    [FEATURE_UNLIMITED_REWIND]: false,
    [FEATURE_INCOGNITO]: false,
  }),
  [PLAN_PLUS]: Object.freeze({
    [FEATURE_NO_ADS]: true,
    [FEATURE_ADVANCED_FILTERS]: true,
    [FEATURE_INCOMING_LIKE_PROFILES]: true,
    [FEATURE_UNLIMITED_REWIND]: true,
    [FEATURE_INCOGNITO]: true,
  }),
});

/** Paywall copy, one row per Plus feature (shown on the CampusMate Plus screen). */
export const PLUS_BENEFITS = Object.freeze([
  { feature: 'noAds', icon: 'sparkles', label: 'ใช้งานโดยไม่มีโฆษณา' },
  { feature: 'advancedFilters', icon: 'slider.horizontal.3', label: 'ตัวกรองคณะ ชั้นปี เวลาและจังหวะกิจกรรม' },
  { feature: 'incomingLikeProfiles', icon: 'heart.fill', label: 'ดูว่าใครกดถูกใจคุณ' },
  { feature: 'unlimitedRewind', icon: 'arrow.uturn.backward', label: 'ย้อนกลับรายการที่ข้ามหรือถูกใจได้ไม่จำกัด' },
  { feature: 'incognito', icon: 'eye.slash.fill', label: 'ให้เฉพาะคนที่คุณถูกใจและคนที่จับคู่แล้วเห็นโปรไฟล์' },
]);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Unknown plans, unknown features and the loading state (plan == null) never unlock anything. */
export function hasFeature(plan, feature) {
  if (typeof plan !== 'string' || !own(PLAN_FEATURES, plan)) return false;
  const features = PLAN_FEATURES[plan];
  return typeof feature === 'string' && own(features, feature) && features[feature] === true;
}

export function featuresForPlan(plan) {
  const base = PLAN_FEATURES[PLAN_FREE];
  return Object.fromEntries(Object.keys(base).map((feature) => [feature, hasFeature(plan, feature)]));
}

/** Client mirror of the server's isPlusActive(): server-verified RevenueCat entitlement that has not expired. */
export function isPlusRecord(record, now = Date.now()) {
  return Boolean(record)
    && record.source === 'revenuecat'
    && record.entitlementId === PLUS_ENTITLEMENT_ID
    && Number.isSafeInteger(record.activeUntil) && record.activeUntil > now
    && Number.isSafeInteger(record.verifiedAt) && record.verifiedAt > 0;
}

export function planForRecord(record, now = Date.now()) {
  return isPlusRecord(record, now) ? PLAN_PLUS : PLAN_FREE;
}

// Matching preferences that only CampusMate Plus may use
// ("ตัวกรองคณะ ชั้นปี เวลาและจังหวะกิจกรรม").
export const FREE_MATCHING_DEFAULTS = Object.freeze({
  faculty: 'all',
  sameFacultyOnly: false,
  years: [],
  paces: [],
  availabilityPeriods: [],
  weekdays: [],
  requireAvailability: false,
});
export const ADVANCED_MATCHING_KEYS = Object.freeze(Object.keys(FREE_MATCHING_DEFAULTS));

/** Preferences that may be applied right now (paid keys reset to free defaults when not allowed). */
export function stripPaidMatchingPreferences(preferences, allowAdvanced) {
  const source = preferences && typeof preferences === 'object' ? preferences : {};
  if (allowAdvanced === true) return source;
  return { ...source, ...FREE_MATCHING_DEFAULTS };
}

/**
 * Preferences to persist. Without the advanced-filters entitlement, paid keys keep
 * their previously stored values (so an expired or still-loading subscriber does
 * not lose them) and cannot be changed.
 */
export function keepPaidMatchingPreferences(next, previous, allowAdvanced) {
  const result = { ...(next && typeof next === 'object' ? next : {}) };
  if (allowAdvanced === true) return result;
  const stored = previous && typeof previous === 'object' ? previous : {};
  for (const key of ADVANCED_MATCHING_KEYS) {
    if (own(stored, key)) result[key] = stored[key];
    else result[key] = FREE_MATCHING_DEFAULTS[key];
  }
  return result;
}
