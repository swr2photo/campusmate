import { HttpsError } from 'firebase-functions/v2/https';
import { hasPlanFeature, requireFeature } from './plusEntitlements.js';

/**
 * A profile is shown to other people only after its owner passed face verification
 * (`users/{uid}.isFaceVerified === true`, written only by completeFaceVerification).
 * Accounts created before the requirement have no such field and stay hidden until they
 * verify. Conversation messages use separate participant authorization.
 */
export function canViewProfile({ viewerId, ownerId, ownerExists, ownerDiscoverable = true, ownerIsNew = false,
  ownerFaceVerified = false, blocked = false, matched = false, ownerLikedViewer = false, visibilityMode = 'public',
  ownerEntitlement, now = Date.now() }) {
  if (!viewerId || !ownerId || !ownerExists) return false;
  if (viewerId === ownerId) return true;
  if (blocked) return false;
  if (ownerFaceVerified !== true) return false;
  if (matched) return true;
  if (!ownerDiscoverable || ownerIsNew) return false;
  if (visibilityMode === 'incognito') {
    // An expired incognito member stays private until explicitly choosing public.
    return hasPlanFeature(ownerEntitlement, 'incognito', now) && ownerLikedViewer === true;
  }
  return visibilityMode === 'public'; // unknown/corrupt modes fail closed
}

export function validateVisibilityChange(mode, entitlement, now = Date.now()) {
  if (!['public', 'incognito'].includes(mode)) throw new HttpsError('invalid-argument', 'รูปแบบการแสดงโปรไฟล์ไม่ถูกต้อง');
  if (mode === 'incognito') requireFeature(entitlement, 'incognito', now);
  return mode;
}

const ADVANCED_KEYS = ['faculties', 'years', 'availabilityPeriods', 'availabilityWeekdays', 'paces'];
export function validateDiscoveryFilters(input = {}, entitlement, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsError('invalid-argument', 'ตัวกรองไม่ถูกต้อง');
  const allowed = ['genders', 'minAge', 'maxAge', 'distanceKm', 'activities', 'requirePhoto', 'requireAvailability', 'activityDetails', ...ADVANCED_KEYS];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new HttpsError('invalid-argument', 'ตัวกรองไม่ถูกต้อง');
  const result = { minAge: 18, maxAge: 100, distanceKm: 0 };
  for (const key of ['minAge', 'maxAge', 'distanceKm']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) throw new HttpsError('invalid-argument', 'ตัวกรองตัวเลขไม่ถูกต้อง');
    result[key] = input[key];
  }
  if (!Number.isInteger(result.minAge) || !Number.isInteger(result.maxAge) || result.minAge < 18
    || result.maxAge > 100 || result.minAge > result.maxAge || result.distanceKm < 0 || result.distanceKm > 100) {
    throw new HttpsError('invalid-argument', 'ช่วงตัวกรองไม่ถูกต้อง');
  }
  for (const key of ['genders', 'activities', ...ADVANCED_KEYS]) {
    const values = input[key] || [];
    if (!Array.isArray(values) || values.length > 30 || values.some((value) => typeof value !== 'string' || !value.length || value.length > 100)) {
      throw new HttpsError('invalid-argument', 'รายการตัวกรองไม่ถูกต้อง');
    }
    result[key] = [...new Set(values)];
  }
  for (const key of ['requirePhoto', 'requireAvailability']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new HttpsError('invalid-argument', 'เงื่อนไขตัวกรองไม่ถูกต้อง');
    result[key] = input[key] === true;
  }
  const details = input.activityDetails || {};
  if (typeof details !== 'object' || Array.isArray(details) || Object.keys(details).length > 30) throw new HttpsError('invalid-argument', 'รายละเอียดกิจกรรมไม่ถูกต้อง');
  result.activityDetails = {};
  for (const [activity, fields] of Object.entries(details)) {
    if (['__proto__', 'prototype', 'constructor'].includes(activity) || !result.activities.includes(activity) || !fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 20) {
      throw new HttpsError('invalid-argument', 'รายละเอียดกิจกรรมไม่ถูกต้อง');
    }
    result.activityDetails[activity] = {};
    for (const [key, values] of Object.entries(fields)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !/^[a-zA-Z0-9_-]{1,50}$/.test(key) || !Array.isArray(values) || values.length > 20
        || values.some((value) => typeof value !== 'string' || !value.length || value.length > 100)) throw new HttpsError('invalid-argument', 'รายละเอียดกิจกรรมไม่ถูกต้อง');
      result.activityDetails[activity][key] = [...new Set(values)];
    }
  }
  if (ADVANCED_KEYS.some((key) => result[key].length) || result.requireAvailability) requireFeature(entitlement, 'advancedFilters', now);
  return result;
}
