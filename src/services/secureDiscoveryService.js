import { AppState } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { stripPaidMatchingPreferences } from '../data/plans';
import { mergeDiscoveryPhoto } from '../utils/discoveryPresentation';
import { RUST_BACKEND, rpc, rustClient, rustUid, waitForRustSession } from './rust/backend';
import { onBackendChange } from './rust/events';

const refreshers = new Set();
// The native backend always enforces visibility on the server.
export const secureDiscoveryConfigured = () => RUST_BACKEND || Constants.expoConfig?.extra?.secureDiscoveryEnabled === true;
// A returning launch renders the fast-boot session before Firebase Auth has
// restored `currentUser` (initialisation reloads the user over the network).
// Callers that run during that gap must wait for the restore instead of
// treating it as signed out; otherwise AppContext latches a permanent
// "please sign in" error on every cold start (same race membershipService
// already guards with waitForAccount).
const AUTH_READY_TIMEOUT_MS = 15000;
export async function waitForAuthReady(auth) {
  if (auth.currentUser || typeof auth.authStateReady !== 'function') return auth.currentUser;
  let timer;
  await Promise.race([
    auth.authStateReady().catch(() => {}),
    new Promise((resolve) => { timer = setTimeout(resolve, AUTH_READY_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  return auth.currentUser;
}
export async function secureDiscoveryCall(name, data = {}) {
  if (RUST_BACKEND) {
    const uid = rustUid() || await waitForRustSession();
    if (!uid) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
    const result = await rpc(name, data);
    if (rustUid() !== uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
    return result;
  }
  if (!secureDiscoveryConfigured()) throw new Error('ฟังก์ชันนี้ยังไม่เปิดให้ใช้งาน');
  // Only await when Auth is still restoring, so signed-in calls keep their timing.
  const { app } = requireFirebase(), auth = getAuth(app), uid = (auth.currentUser || await waitForAuthReady(auth))?.uid;
  if (!uid) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
  const result = (await httpsCallable(getFunctions(app, 'asia-southeast1'), name, { timeout: 45000 })(data)).data;
  if (getAuth(app).currentUser?.uid !== uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
  return result;
}
// Ranked discovery from the Rust matching service. HTTPS only, Firebase ID
// token per request. Returns null when the service is not configured or not
// reachable so callers fall back to the getDiscoveryPage callable.
const MATCHING_TIMEOUT_MS = 8000;
const RANKED_CURSOR_PREFIX = 'm1.';
const matchingServiceUrl = () => Constants.expoConfig?.extra?.matchingServiceUrl || '';
async function rankedDiscoveryPage(data) {
  const base = matchingServiceUrl();
  if (!base) return null;
  const { app } = requireFirebase(), auth = getAuth(app);
  const user = auth.currentUser || await waitForAuthReady(auth);
  if (!user) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MATCHING_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${base}/v1/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
  } catch {
    return null; // offline, timeout or DNS: let the callable try
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => null);
  if (getAuth(app).currentUser?.uid !== user.uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
  if (response.ok && Array.isArray(body?.profiles)) return body;
  // Warming up / outage: fall back. Validation, auth and paywall errors are
  // real answers and surface exactly like callable errors.
  if (response.status >= 500) return null;
  const error = body?.error || {};
  const rawMessage = error.message || 'โหลดรายการไม่สำเร็จ';
  const cleanMessage = typeof rawMessage === 'string' ? rawMessage.replace(/\s*\[\d{3}\]/g, '').trim() : rawMessage;
  throw Object.assign(new Error(cleanMessage), { code: `functions/${error.code || 'internal'}`, details: error.details });
}
export async function fetchDiscoveryPage({ filters = {}, cursor = null } = {}) {
  if (RUST_BACKEND) return secureDiscoveryCall('getDiscoveryPage', { filters, cursor: typeof cursor === 'string' ? cursor : null });
  const rankedCursor = typeof cursor === 'string' && cursor.startsWith(RANKED_CURSOR_PREFIX);
  if (!cursor || rankedCursor) {
    const ranked = await rankedDiscoveryPage({ filters, cursor });
    if (ranked) return ranked;
  }
  // Callable cursors are opaque UUIDs; a ranked cursor restarts from page one
  // (the subscriber de-duplicates by id).
  return secureDiscoveryCall('getDiscoveryPage', { filters, cursor: rankedCursor ? null : cursor });
}
export function refreshSecureDiscovery() {
  return Promise.all(Array.from(refreshers, (refresh) => Promise.resolve(refresh()).catch(() => {})));
}
export async function recordSecureDiscoveryAction(targetUserId, kind, likeMessage = '', actionId = Crypto.randomUUID()) {
  const result = await secureDiscoveryCall('recordDiscoveryAction', { targetUserId, kind, likeMessage, actionId });
  refreshSecureDiscovery(); return { ...result, matched: result.status === 'accepted' };
}
export async function rewindSecureDiscoveryAction() {
  let result;
  // Each receipt is idempotent; every call consumes at most twenty unavailable
  // history entries. Continue past blocked/deleted/accepted entries in order.
  do { result = await secureDiscoveryCall('rewindDiscoveryAction', { actionId: Crypto.randomUUID() }); } while (result.hasMore && !result.profile);
  refreshSecureDiscovery(); return result;
}
export async function respondToSecureLike(targetUserId, response) {
  const result = await secureDiscoveryCall('respondToIncomingLike', { targetUserId, response });
  refreshSecureDiscovery(); return result;
}

function changes(uid, refresh, onError, options = {}) {
  const register = options.register !== false;
  const watchDecisions = options.watchDecisions !== false;
  const intervalMs = Number(options.intervalMs) || (RUST_BACKEND ? 60000 : 30000);
  const topics = options.topics || ['decisions', 'membership', 'blocks', 'profile', 'config'];
  if (RUST_BACKEND) {
    const active = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, intervalMs);
    const stops = uid ? topics.map((topic) => onBackendChange(topic, refresh)) : [];
    if (register) refreshers.add(refresh);
    return () => { active.remove(); clearInterval(timer); stops.forEach((stop) => stop()); if (register) refreshers.delete(refresh); };
  }
  const { db } = requireFirebase();
  const active = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
  const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, intervalMs);
  const offSignal = uid && watchDecisions ? onSnapshot(doc(db, 'matchingSignals', uid), refresh, onError) : () => {};
  const offMember = uid ? onSnapshot(doc(db, 'entitlements', uid), refresh, onError) : () => {};
  const offFeed = onSnapshot(doc(db, 'app_config', 'discoveryRevision'), refresh, onError);
  if (register) refreshers.add(refresh);
  return () => { active.remove(); clearInterval(timer); offSignal(); offMember(); offFeed(); if (register) refreshers.delete(refresh); };
}
export function subscribeSecureProfile(userId, callback, onError) {
  if (!userId) {
    callback?.(null);
    return () => {};
  }
  const auth = RUST_BACKEND ? null : getAuth(requireFirebase().app);
  const currentUid = () => (RUST_BACKEND ? rustUid() : auth.currentUser?.uid);
  let disposed = false, running = false, again = false, uid = null, off = () => {};
  const refresh = async () => {
    if (disposed) return;
    if (currentUid() !== uid) { callback(null); return; }
    if (running) { again = true; return; }
    running = true;
    try {
      const result = await secureDiscoveryCall('getVisibleProfiles', { userIds: [userId] });
      if (!disposed) callback(result.profiles[0] || null);
    } catch (reason) {
      if (!disposed) {
        if (/permission-denied|unauthenticated|not-found/.test(String(reason?.code || ''))) callback(null);
        onError?.(reason);
      }
    } finally {
      running = false;
      if (again && !disposed) { again = false; void refresh(); }
    }
  };
  const start = (signedInUid) => {
    if (disposed) return;
    if (!signedInUid) { callback?.(null); return; }
    uid = signedInUid;
    off = changes(uid, refresh, onError);
    void refresh();
  };
  if (RUST_BACKEND) {
    if (rustUid()) start(rustUid());
    else void waitForRustSession().then(start, () => start(null));
  } else if (auth.currentUser?.uid) start(auth.currentUser.uid);
  else void waitForAuthReady(auth).then((user) => start(user?.uid));
  return () => { disposed = true; off(); };
}
export function subscribeSecureDecisions(uid, callback, onError) {
  if (!uid || typeof uid !== 'string') {
    callback?.({ incomingDecisions: [], outgoingDecisions: [], pendingCount: 0, hasMorePending: false, isLoadingMorePending: false });
    const noop = () => {};
    noop.loadMore = () => {};
    return noop;
  }
  let disposed = false, running = false, again = false, pageCount = 1, state = null;
  const fromSummary = (summary) => (summary.pendingLikes || []).map((like) => ({ id: like.decisionId, decisionId: like.decisionId,
    fromUserId: like.profile?.id || like.fromUserId, toUserId: uid, type: 'like', status: 'pending',
    likeMessage: like.likeMessage, createdAt: like.createdAt,
    profile: like.profile }));
  const refresh = async (append = false) => {
    if (disposed) return;
    if (running) { if (!append) again = true; return; }
    if (append && !state?.hasMorePending) return;
    running = true;
    if (append && state) callback({ ...state, isLoadingMorePending: true });
    try {
      let next = append ? { ...state } : await secureDiscoveryCall('getMyDecisionState');
      const pages = append ? 1 : pageCount - 1;
      for (let index = 0; index < pages && next.hasMorePending; index++) {
        const summary = await secureDiscoveryCall('getIncomingLikeSummary', { cursor: next.nextPendingCursor });
        // Revocation returns count-only. Drop identities from every older page.
        const decisions = summary.identitiesAvailable === true
          ? [...next.incomingDecisions, ...fromSummary(summary)]
          : next.incomingDecisions.filter((decision) => decision.status === 'accepted');
        const pendingProfiles = summary.identitiesAvailable === true
          ? [...(next.pendingProfiles || []), ...(summary.pendingLikes || []).map((l) => l.profile).filter(Boolean)]
          : [];
        next = { ...next, incomingDecisions: [...new Map(decisions.map((entry) => [entry.id, entry])).values()],
          pendingProfiles,
          pendingCount: summary.pendingCount, hasMorePending: summary.hasMore, nextPendingCursor: summary.nextCursor };
      }
      if (append) pageCount += 1;
      state = { ...next, isLoadingMorePending: false };
      if (!disposed) callback(state);
    } catch (reason) {
      if (!disposed) {
        state = { incomingDecisions: [], outgoingDecisions: [], pendingCount: 0, hasMorePending: false, isLoadingMorePending: false };
        callback(state); onError?.(reason);
      }
    }
    finally { running = false; if (again && !disposed) { again = false; void refresh(); } }
  };
  const off = changes(uid, () => { void refresh(); }, onError);
  void refresh();
  const unsubscribe = () => { disposed = true; off(); };
  unsubscribe.loadMore = () => refresh(true);
  return unsubscribe;
}
export function createSecureProfilesSubscription(onProfiles, onError, options = {}) {
  const auth = RUST_BACKEND ? { get currentUser() { const id = rustUid(); return id ? { uid: id } : null; } } : getAuth(requireFirebase().app);
  let uid = auth.currentUser?.uid;
  const deckWatch = {
    register: false,
    watchDecisions: false,
    intervalMs: 180000,
    topics: ['membership', 'blocks', 'profile', 'config'],
  };
  let disposed = false, busy = false, again = false, pageCount = 1, cursor = null, hasMore = false, profiles = [], nextRecycleAt = null;
  let recycledProfileIds = [];
  const info = (loading) => options.onPageInfo?.({ source: 'discovery', hasMore, loading, nextRecycleAt, recycledProfileIds });
  const fetchPage = async (append) => {
    if (disposed) return;
    const currentUid = auth.currentUser?.uid || uid;
    if (!currentUid) {
      if (!disposed) {
        profiles = []; cursor = null; hasMore = false; pageCount = 1;
        onProfiles([]);
        info(false);
      }
      return;
    }
    if (busy) { if (!append) again = true; return; }
    if (append && !hasMore) return;
    // Only "load more" is reported as loading; background revalidation (30 s timer,
    // revision/entitlement signals) must not put an empty deck back into its skeleton.
    busy = true; if (append) info(true);
    try {
      const previousById = new Map(profiles.map((profile) => [profile.id, profile]));
      const merged = new Map((append ? profiles : []).map((profile) => [profile.id, profile]));
      const recycled = new Set();
      let nextCursor = append ? cursor : null, nextHasMore = true;
      const pages = append ? 1 : pageCount;
      for (let index = 0; index < pages && nextHasMore; index++) {
        const result = await fetchDiscoveryPage({ filters: options.filters || {}, cursor: nextCursor });
        if (disposed) return;
        nextCursor = result.nextCursor; nextHasMore = result.hasMore;
        nextRecycleAt = Number(result.nextRecycleAt) > 0 ? Number(result.nextRecycleAt) : null;
        (Array.isArray(result.recycledProfileIds) ? result.recycledProfileIds : []).forEach(id => { if (typeof id === 'string') recycled.add(id); });
        result.profiles.forEach((profile) => {
          if (!profile?.id) return;
          merged.set(profile.id, mergeDiscoveryPhoto(previousById.get(profile.id), profile));
        });
      }
      if (append) pageCount += 1;
      cursor = nextCursor; hasMore = nextHasMore; profiles = [...merged.values()];
      recycledProfileIds = [...recycled];
      if (!again) onProfiles(profiles);
    } catch (reason) {
      const isPlusError = reason?.code === 'functions/permission-denied'
        || reason?.details?.reason === 'PLUS_REQUIRED'
        || (typeof reason?.message === 'string' && reason.message.includes('CampusMate Plus'));
      if (isPlusError && !disposed && options.filters && Object.keys(options.filters).length > 0) {
        try {
          const basicFilters = toBasicServerDiscoveryFilters(options.filters);
          const basicResult = await fetchDiscoveryPage({ filters: basicFilters, cursor: null });
          if (!disposed && Array.isArray(basicResult?.profiles)) {
            cursor = basicResult.nextCursor;
            hasMore = basicResult.hasMore;
            profiles = basicResult.profiles;
            nextRecycleAt = Number(basicResult.nextRecycleAt) > 0 ? Number(basicResult.nextRecycleAt) : null;
            recycledProfileIds = Array.isArray(basicResult.recycledProfileIds) ? basicResult.recycledProfileIds.filter(id => typeof id === 'string') : [];
            if (!again) onProfiles(profiles);
            onError?.(reason, { feed: false, fallback: true });
            return;
          }
        } catch (_) {}
      }
      if (!disposed) {
        // A background refresh must not blank a deck the person is already looking at.
        if (!profiles.length) {
          profiles = []; cursor = null; hasMore = false; pageCount = 1; onProfiles([]);
          onError?.(reason, { feed: true });
        }
      }
    }
    finally {
      busy = false;
      if (!disposed) {
        info(false);
        // A revision or entitlement signal arriving during pagination must
        // still revalidate every loaded page before exposing the final feed.
        if (again) { again = false; void fetchPage(false); }
      }
    }
  };
  let offChanges = changes(uid, () => { void fetchPage(false); }, onError, deckWatch);
  const watchAccount = (listener) => (RUST_BACKEND
    ? rustClient().subscribe((user) => listener(user ? { uid: user.uid } : null))
    : onAuthStateChanged(auth, listener));
  const offAuth = watchAccount((user) => {
    if (disposed) return;
    const nextUid = user?.uid;
    if (nextUid !== uid) {
      uid = nextUid;
      offChanges();
      offChanges = changes(uid, () => { void fetchPage(false); }, onError, deckWatch);
      void fetchPage(false);
    }
  });
  void fetchPage(false);
  return {
    loadMore: () => fetchPage(true),
    refresh: () => fetchPage(false),
    unsubscribe: () => {
      disposed = true;
      offAuth();
      offChanges();
    }
  };
}

// `plus` = the viewer currently has the advancedFilters entitlement (see src/data/plans.js).
export function toServerDiscoveryFilters(preferences = {}, profile = {}, plus = false) {
  const faculty = preferences.sameFacultyOnly ? profile.faculty : preferences.faculty;
  return { minAge: preferences.ageMin ?? 18, maxAge: preferences.ageMax ?? 100, distanceKm: Number(preferences.maxDistance) || 0,
    genders: preferences.genders || [], activities: preferences.activities || [],
    faculties: plus && faculty && faculty !== 'all' ? [faculty] : [], years: plus ? preferences.years || [] : [],
    availabilityPeriods: [], availabilityWeekdays: [],
    paces: plus ? preferences.paces || [] : [], requirePhoto: preferences.requirePhoto === true,
    requireAvailability: false, activityDetails: preferences.activityDetails || {} };
}
export function toBasicServerDiscoveryFilters(filters = {}) {
  return {
    minAge: typeof filters.minAge === 'number' ? filters.minAge : 18,
    maxAge: typeof filters.maxAge === 'number' ? filters.maxAge : 100,
    distanceKm: Number(filters.distanceKm) || 0,
    genders: Array.isArray(filters.genders) ? filters.genders : [],
    activities: Array.isArray(filters.activities) ? filters.activities : [],
    faculties: [],
    years: [],
    availabilityPeriods: [],
    availabilityWeekdays: [],
    paces: [],
    requirePhoto: filters.requirePhoto === true,
    requireAvailability: false,
    activityDetails: filters.activityDetails && typeof filters.activityDetails === 'object' ? filters.activityDetails : {},
  };
}
// Plan gates apply in every discovery mode (secure callable or legacy Firestore).
export function allowedMatchingPreferences(preferences = {}, canUseAdvancedFilters = false) {
  return stripPaidMatchingPreferences(preferences || {}, canUseAdvancedFilters === true);
}
