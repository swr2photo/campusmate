import { AppState } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { stripPaidMatchingPreferences } from '../data/plans';

const refreshers = new Set();
export const secureDiscoveryConfigured = () => Constants.expoConfig?.extra?.secureDiscoveryEnabled === true;
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
  if (!secureDiscoveryConfigured()) throw new Error('ฟังก์ชันนี้ยังไม่เปิดให้ใช้งาน');
  // Only await when Auth is still restoring, so signed-in calls keep their timing.
  const { app } = requireFirebase(), auth = getAuth(app), uid = (auth.currentUser || await waitForAuthReady(auth))?.uid;
  if (!uid) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
  const result = (await httpsCallable(getFunctions(app, 'asia-southeast1'), name, { timeout: 45000 })(data)).data;
  if (getAuth(app).currentUser?.uid !== uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
  return result;
}
export function refreshSecureDiscovery() { refreshers.forEach((refresh) => refresh()); }
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

function changes(uid, refresh, onError) {
  const { db } = requireFirebase();
  const active = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
  const timer = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 30000);
  const offSignal = uid ? onSnapshot(doc(db, 'matchingSignals', uid), refresh, onError) : () => {};
  const offMember = uid ? onSnapshot(doc(db, 'entitlements', uid), refresh, onError) : () => {};
  const offFeed = onSnapshot(doc(db, 'app_config', 'discoveryRevision'), refresh, onError);
  refreshers.add(refresh);
  return () => { active.remove(); clearInterval(timer); offSignal(); offMember(); offFeed(); refreshers.delete(refresh); };
}
export function subscribeSecureProfile(userId, callback, onError) {
  if (!userId) {
    callback?.(null);
    return () => {};
  }
  const { app } = requireFirebase(), auth = getAuth(app);
  let disposed = false, running = false, again = false, uid = null, off = () => {};
  const refresh = async () => {
    if (disposed) return;
    if (getAuth(app).currentUser?.uid !== uid) { callback(null); return; }
    if (running) { again = true; return; }
    running = true;
    try {
      const result = await secureDiscoveryCall('getVisibleProfiles', { userIds: [userId] });
      if (!disposed) callback(result.profiles[0] || null);
    } catch (reason) {
      if (!disposed) { callback(null); onError?.(reason); }
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
  if (auth.currentUser?.uid) start(auth.currentUser.uid);
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
  const fromSummary = (summary) => summary.pendingLikes.map((like) => ({ id: like.decisionId, decisionId: like.decisionId,
    fromUserId: like.profile.id, toUserId: uid, type: 'like', status: 'pending',
    likeMessage: like.likeMessage, createdAt: like.createdAt }));
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
        next = { ...next, incomingDecisions: [...new Map(decisions.map((entry) => [entry.id, entry])).values()],
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
  const { app } = requireFirebase();
  const auth = getAuth(app);
  let uid = auth.currentUser?.uid;
  let disposed = false, busy = false, again = false, pageCount = 1, cursor = null, hasMore = false, profiles = [];
  const info = (loading) => options.onPageInfo?.({ source: 'discovery', hasMore, loading });
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
      const merged = new Map((append ? profiles : []).map((profile) => [profile.id, profile]));
      let nextCursor = append ? cursor : null, nextHasMore = true;
      const pages = append ? 1 : pageCount;
      for (let index = 0; index < pages && nextHasMore; index++) {
        const result = await secureDiscoveryCall('getDiscoveryPage', { filters: options.filters || {}, cursor: nextCursor });
        if (disposed) return;
        nextCursor = result.nextCursor; nextHasMore = result.hasMore;
        result.profiles.forEach((profile) => merged.set(profile.id, profile));
      }
      if (append) pageCount += 1;
      cursor = nextCursor; hasMore = nextHasMore; profiles = [...merged.values()];
      if (!again) onProfiles(profiles);
    } catch (reason) {
      if (!disposed) { profiles = []; cursor = null; hasMore = false; pageCount = 1; onProfiles([]); onError?.(reason, { feed: true }); }
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
  let offChanges = changes(uid, () => { void fetchPage(false); }, onError);
  const offAuth = onAuthStateChanged(auth, (user) => {
    if (disposed) return;
    const nextUid = user?.uid;
    if (nextUid !== uid) {
      uid = nextUid;
      offChanges();
      offChanges = changes(uid, () => { void fetchPage(false); }, onError);
      void fetchPage(false);
    }
  });
  void fetchPage(false);
  return {
    loadMore: () => fetchPage(true),
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
    availabilityPeriods: plus ? preferences.availabilityPeriods || [] : [], availabilityWeekdays: plus ? preferences.weekdays || [] : [],
    paces: plus ? preferences.paces || [] : [], requirePhoto: preferences.requirePhoto === true,
    requireAvailability: plus && preferences.requireAvailability === true, activityDetails: preferences.activityDetails || {} };
}
// Plan gates apply in every discovery mode (secure callable or legacy Firestore).
export function allowedMatchingPreferences(preferences = {}, canUseAdvancedFilters = false) {
  return stripPaidMatchingPreferences(preferences || {}, canUseAdvancedFilters === true);
}
