import { randomUUID, createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { loadVisibleProfiles } from './secureProfileAccess.js';
import { validateDiscoveryFilters } from './profileVisibilityPolicy.js';
import { visibleDistanceKm } from './peerDistance.js';

const PERIODS = { morning: [[360, 720]], afternoon: [[720, 1080]], evening: [[1080, 1260]], night: [[1260, 1440], [0, 360]] };
const WORDS = { morning: ['เช้า', 'morning'], afternoon: ['บ่าย', 'afternoon'], evening: ['เย็น', 'ค่ำ', 'evening'], night: ['ดึก', 'กลางคืน', 'night'] };
function minutes(value) {
  const match = typeof value === 'string' && /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour <= 24 && minute < 60 && (hour < 24 || minute === 0) ? hour * 60 + minute : null;
}
export function matchesServerFilters(profile, filters, distance) {
  const selected = (key, value) => !filters[key].length || filters[key].includes(String(value || ''));
  const age = Number(profile.age);
  if (!Number.isFinite(age) || age < filters.minAge || age > filters.maxAge || !selected('genders', profile.gender)
    || !selected('faculties', profile.faculty) || !selected('years', profile.year) || !selected('paces', profile.pace)) return false;
  const activities = [...(profile.activities || []), profile.activity];
  if (filters.activities.length && !filters.activities.some((value) => activities.includes(value))) return false;
  if (filters.requirePhoto && !(profile.avatarUri || profile.photoURL || profile.photos?.length)) return false;
  for (const [activity, fields] of Object.entries(filters.activityDetails || {})) {
    if (!activities.includes(activity)) return false;
    for (const [key, selected] of Object.entries(fields)) {
      const value = profile.activityDetails?.[activity]?.[key];
      if (selected.length && !selected.some((choice) => Array.isArray(value) ? value.includes(choice) : choice === value)) return false;
    }
  }
  if (filters.distanceKm > 0 && (distance == null || distance > filters.distanceKm)) return false;
  const slots = Array.isArray(profile.availabilitySlots) ? profile.availabilitySlots : [];
  if (filters.requireAvailability && !slots.length && !String(profile.availability || '').trim()) return false;
  if (filters.availabilityPeriods.length) {
    const text = String(profile.availability || '').toLowerCase();
    const legacy = text.includes('ตลอดเวลา') || text.includes('anytime') || filters.availabilityPeriods.some((value) => WORDS[value]?.some((word) => text.includes(word)));
    const overlap = slots.some((slot) => {
      const start = minutes(slot.start), end = minutes(slot.end);
      return start != null && end != null && end > start && filters.availabilityPeriods.some((value) => PERIODS[value]?.some(([a, b]) => start < b && end > a));
    });
    if (!legacy && !overlap) return false;
  }
  if (filters.availabilityWeekdays.length && !slots.some((slot) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date || '')) return false;
    const date = new Date(`${slot.date}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === slot.date
      && filters.availabilityWeekdays.includes(String(date.getUTCDay()));
  })) return false;
  return true;
}

export function createDiscoveryApi({ db, now = Date.now, makeCursor = randomUUID }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
    const [member, viewer] = await db.getAll(db.doc(`entitlements/${uid}`), db.doc(`users/${uid}`));
    if (!viewer.exists) throw new HttpsError('failed-precondition', 'บัญชีไม่พร้อมใช้งาน');
    const filters = validateDiscoveryFilters(request.data?.filters || {}, member.data(), now());
    const scope = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
    let query = db.collection('discoveryProfiles').where('isDiscoverable', '==', true).orderBy('__name__', 'asc');
    const token = request.data?.cursor;
    if (token) {
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new HttpsError('invalid-argument', 'หน้ารายการไม่ถูกต้อง');
      const saved = (await db.doc(`discoveryPageCursors/${uid}/tokens/${token}`).get()).data();
      if (!Number.isFinite(saved?.expiresAt?.toMillis?.()) || saved.expiresAt.toMillis() <= now() || saved.scope !== scope
        || !/^[A-Za-z0-9_-]{1,128}$/.test(saved.documentId || '')) throw new HttpsError('invalid-argument', 'หน้ารายการหมดอายุ กรุณาโหลดใหม่');
      query = query.startAfter(saved.documentId);
    }
    const page = await query.limit(30).get(), ids = page.docs.map((doc) => doc.id).filter((id) => id !== uid);
    const profiles = await loadVisibleProfiles(db, uid, ids, now);
    const peers = ids.length ? await db.getAll(...ids.map((id) => db.doc(`users/${id}`))) : [];
    const actions = ids.length ? await db.getAll(...ids.map((id) => db.doc(`decisions/${uid}_${id}`))) : [];
    const privateById = new Map(ids.map((id, index) => [id, peers[index].data()]));
    const actedOn = new Set(ids.filter((id, index) => {
      const decision = actions[index].data();
      return decision?.fromUserId === uid && decision?.toUserId === id && ['pending', 'accepted'].includes(decision.status);
    }));
    // Recheck privilege after network reads, including expiry during this call.
    validateDiscoveryFilters(filters, (await db.doc(`entitlements/${uid}`).get()).data(), now());
    const result = profiles.flatMap((profile) => {
      const distance = visibleDistanceKm(viewer.data(), privateById.get(profile.id));
      return !actedOn.has(profile.id) && matchesServerFilters(privateById.get(profile.id) || {}, filters, distance) ? [{ ...profile, distance }] : [];
    });
    let nextCursor = null;
    if (page.size === 30) {
      nextCursor = makeCursor();
      await db.doc(`discoveryPageCursors/${uid}/tokens/${nextCursor}`).set({ documentId: page.docs.at(-1).id, scope, expiresAt: Timestamp.fromMillis(now() + 15 * 60000) });
    }
    return { profiles: result, hasMore: page.size === 30, nextCursor };
  };
}
