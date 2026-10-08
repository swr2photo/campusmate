import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { requireFirebase } from './dbService';
import { PLUS_ENTITLEMENT_ID } from '../data/plans';
const extra = () => Constants.expoConfig?.extra || {};
let sdk, sdkUser = null, queue = Promise.resolve();
function serialized(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; }
function purchases() { if (!sdk) sdk = require('react-native-purchases').default; return sdk; }
// The SDK's default log handler routes its ERROR level to console.error, which raises
// the dev error overlay for routine events such as the user closing the store sheet.
const CANCELLED_LOG = /PurchaseCancelledError|USER_CANCELED|PURCHASE_CANCELLED|cancell?ed by (the )?user/i;
let logHandlerInstalled = false;
function installLogHandler(client) {
  if (logHandlerInstalled) return;
  logHandlerInstalled = true;
  try {
    const { LOG_LEVEL } = require('react-native-purchases');
    client.setLogHandler((level, message) => {
      const text = `[RevenueCat] ${message}`;
      if (level === LOG_LEVEL.ERROR || level === LOG_LEVEL.WARN) {
        // A cancelled purchase is a normal outcome, not a failure.
        if (CANCELLED_LOG.test(String(message))) { if (__DEV__) console.log(text); return; }
        console.warn(text);
        return;
      }
      if (!__DEV__) return;
      if (level === LOG_LEVEL.INFO) console.info(text);
      else console.debug(text);
    });
  } catch (error) {
    logHandlerInstalled = false;
    if (__DEV__) console.warn('[RevenueCat] Unable to install log handler:', error?.message || error);
  }
}
/** True when the store reported that the user backed out of the purchase sheet. */
export function isPurchaseCancelled(error) {
  if (!error) return false;
  if (error.userCancelled === true) return true;
  try {
    const { PURCHASES_ERROR_CODE } = require('react-native-purchases');
    return String(error.code) === String(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR);
  } catch {
    return false;
  }
}
function bounded(operation) {
  let timer;
  return Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('เชื่อมต่อสโตร์นานเกินไป กรุณาลองอีกครั้ง')), 25000);
  })]).finally(() => clearTimeout(timer));
}
function apiKey() { return Platform.OS === 'ios' ? extra().revenueCatIosKey : Platform.OS === 'android' ? extra().revenueCatAndroidKey : ''; }
function assertCurrentAccount(uid) {
  if (!uid || getAuth(requireFirebase().app).currentUser?.uid !== uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
}
// On a returning launch the app signs in from the fast-boot cache before Firebase Auth
// restores its session, so `currentUser` is briefly null. Wait for that restore instead
// of failing the store and server calls made at startup.
const ACCOUNT_WAIT_MS = 20000;
function waitForAccount(uid) {
  if (!uid) return Promise.reject(new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง'));
  const auth = getAuth(requireFirebase().app);
  if (auth.currentUser?.uid === uid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false, unsubscribe = null, timer = null;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error); else resolve();
    };
    timer = setTimeout(() => finish(new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง')), ACCOUNT_WAIT_MS);
    unsubscribe = onAuthStateChanged(auth, (current) => {
      if (current?.uid === uid) finish();
      else if (current) finish(new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง'));
    });
    if (done) unsubscribe();
  });
}
export function membershipConfigured() { return extra().plusBackendEnabled === true; }
export function purchasesConfigured() { return membershipConfigured() && Boolean(apiKey()); }
export function subscribeMembership(uid, onData, onError) {
  const { db } = requireFirebase();
  return onSnapshot(doc(db, 'entitlements', uid), { includeMetadataChanges: true },
    (snapshot) => onData(snapshot.data() || null, { fromCache: snapshot.metadata.fromCache }), onError);
}
export async function syncMembership(expectedUid) {
  const { app } = requireFirebase();
  if (expectedUid) await waitForAccount(expectedUid);
  const uid = expectedUid || getAuth(app).currentUser?.uid;
  if (!uid || getAuth(app).currentUser?.uid !== uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
  const result = (await httpsCallable(getFunctions(app, 'asia-southeast1'), 'syncMembership', { timeout: 30000 })({})).data;
  if (getAuth(app).currentUser?.uid !== uid) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
  return result;
}
export async function initializePurchases(uid) {
  if (!purchasesConfigured() || !uid) return [];
  await waitForAccount(uid);
  return serialized(async () => {
    assertCurrentAccount(uid);
    const client = purchases();
    installLogHandler(client);
    if (!await client.isConfigured()) client.configure({ apiKey: apiKey(), appUserID: uid });
    else if (sdkUser !== uid) await bounded(client.logIn(uid));
    sdkUser = uid;
    assertCurrentAccount(uid);
    const offerings = await bounded(client.getOfferings());
    return (offerings.current?.availablePackages || []).filter((entry) => ['MONTHLY', 'ANNUAL'].includes(entry.packageType));
  });
}
// Last good store packages per account, kept in memory so the paywall opens with prices.
const packageCache = new Map();
const packageLoads = new Map();
export function getCachedPackages(uid) { return (uid && packageCache.get(uid)) || []; }
/**
 * Configures the store SDK for `uid` (once) and returns its MONTHLY/ANNUAL packages.
 * Concurrent callers share one request. An empty result means the store is not ready
 * yet (e.g. Play Billing still connecting); callers retry, and the cache is kept.
 */
export function loadMembershipPackages(uid) {
  if (!purchasesConfigured() || !uid) return Promise.resolve([]);
  const pending = packageLoads.get(uid);
  if (pending) return pending;
  const load = initializePurchases(uid).then((next) => {
    if (next.length) packageCache.set(uid, next);
    else if (__DEV__) console.log('[Membership] The store returned no Plus packages yet.');
    return next.length ? next : getCachedPackages(uid);
  }, (error) => {
    if (__DEV__) console.log('[Membership] Store packages not ready:', error?.message || error);
    throw error;
  }).finally(() => { packageLoads.delete(uid); });
  packageLoads.set(uid, load);
  return load;
}
export function releasePurchases(uid) {
  packageCache.delete(uid);
  return serialized(async () => {
    if (sdk && sdkUser === uid) {
      sdkUser = null;
      if (await sdk.isConfigured() && !await sdk.isAnonymous()) await sdk.logOut();
    }
  });
}
/**
 * The store's view of the Plus entitlement, used only to unlock the UI right after a
 * purchase/restore while the server confirms it in the background. It is never cached
 * and never sent anywhere; server-enforced features still rely on the server record.
 */
export function storePlusFromCustomerInfo(info, now = Date.now()) {
  const entitlement = info?.entitlements?.active?.[PLUS_ENTITLEMENT_ID];
  if (!entitlement || entitlement.isActive === false) return null;
  const expires = Number(entitlement.expirationDateMillis ?? Date.parse(entitlement.expirationDate || ''));
  // A non-expiring entitlement gets a short window; the server record replaces it.
  const activeUntil = Number.isFinite(expires) && expires > now ? Math.round(expires) : now + 3600000;
  return {
    record: {
      source: 'revenuecat', entitlementId: PLUS_ENTITLEMENT_ID, activeUntil, verifiedAt: now,
      managementUrl: typeof info.managementURL === 'string' ? info.managementURL : null,
      productId: typeof entitlement.productIdentifier === 'string' ? entitlement.productIdentifier : null,
      store: typeof entitlement.store === 'string' ? entitlement.store : null,
    },
    willRenew: entitlement.willRenew !== false,
  };
}
/** Resolves to { cancelled: true } or { cancelled: false, plus } where plus may be null (e.g. pending payment). */
export function purchaseMembership(uid, storePackage) {
  return serialized(async () => {
    assertCurrentAccount(uid);
    if (!purchasesConfigured() || sdkUser !== uid) throw new Error('ยังซื้อสมาชิกไม่ได้ กรุณาลองอีกครั้ง');
    // Recover an already-owned subscription before opening another purchase.
    let info = await bounded(purchases().getCustomerInfo());
    assertCurrentAccount(uid);
    if (!info.entitlements?.active?.[PLUS_ENTITLEMENT_ID]) {
      try { info = (await purchases().purchasePackage(storePackage)).customerInfo; }
      catch (error) {
        // Closing the store sheet is a silent no-op: no error, no server sync.
        if (isPurchaseCancelled(error)) return { cancelled: true, plus: null };
        const { PURCHASES_ERROR_CODE } = require('react-native-purchases');
        if (String(error.code) !== String(PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR)) throw error;
        info = await bounded(purchases().restorePurchases());
      }
    }
    // The server confirms the purchase separately (MembershipContext); this only reports the store's answer.
    return { cancelled: false, plus: storePlusFromCustomerInfo(info) };
  });
}
/** Resolves to { plus } from the store; plus is null when the store account has no active Plus. */
export function restoreMembership(uid) {
  return serialized(async () => {
    assertCurrentAccount(uid);
    if (!purchasesConfigured() || sdkUser !== uid) throw new Error('ยังคืนค่าสมาชิกไม่ได้ กรุณาลองอีกครั้ง');
    const info = await bounded(purchases().restorePurchases());
    return { plus: storePlusFromCustomerInfo(info) };
  });
}
