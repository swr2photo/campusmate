import { timingSafeEqual } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export const PLUS_ENTITLEMENT = 'campusmate_plus';

// Server copy of the plan/feature matrix. Must equal PLAN_FEATURES in
// src/data/plans.js (checked by planFeatures.test.js).
export const PLAN_FEATURES = Object.freeze({
  free: Object.freeze({ noAds: false, advancedFilters: false, incomingLikeProfiles: false, unlimitedRewind: false, incognito: false }),
  plus: Object.freeze({ noAds: true, advancedFilters: true, incomingLikeProfiles: true, unlimitedRewind: true, incognito: true }),
});
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export function planFor(record, now = Date.now()) { return isPlusActive(record, now) ? 'plus' : 'free'; }
// Unknown features never unlock.
export function hasPlanFeature(record, feature, now = Date.now()) {
  const features = PLAN_FEATURES[planFor(record, now)];
  return typeof feature === 'string' && own(features, feature) && features[feature] === true;
}
export function requireFeature(record, feature, now = Date.now()) {
  if (!hasPlanFeature(record, feature, now)) throw new HttpsError('permission-denied', 'ฟีเจอร์นี้สำหรับ CampusMate Plus', { reason: 'PLUS_REQUIRED', feature });
}
export function isPlusActive(record, now = Date.now()) {
  return record?.source === 'revenuecat' && record?.entitlementId === PLUS_ENTITLEMENT
    && Number.isSafeInteger(record.activeUntil) && record.activeUntil > now
    && Number.isSafeInteger(record.verifiedAt) && record.verifiedAt > 0;
}

export function membershipState(record, now = Date.now()) {
  const plan = planFor(record, now);
  return { plus: plan === 'plus', plan, activeUntil: record?.activeUntil || 0, productId: record?.productId || null,
    store: record?.store || null, managementUrl: record?.managementUrl || null,
    verifiedAt: record?.verifiedAt || 0,
    features: { ...PLAN_FEATURES[plan] } };
}

export function entitlementFromSubscriber(payload, now = Date.now(), allowSandbox = false) {
  const subscriber = payload?.subscriber;
  if (!subscriber || typeof subscriber !== 'object') throw new Error('Invalid subscriber response');
  const entitlement = subscriber.entitlements?.[PLUS_ENTITLEMENT];
  const productId = entitlement?.product_identifier;
  // Google Play base plans may be keyed "<subscription_id>:<base_plan_id>".
  const subscriptions = subscriber.subscriptions && typeof subscriber.subscriptions === 'object' ? subscriber.subscriptions : {};
  const planId = typeof entitlement?.product_plan_identifier === 'string' ? entitlement.product_plan_identifier : '';
  const subscription = !productId ? null : subscriptions[productId]
    || (planId ? subscriptions[`${productId}:${planId}`] : null)
    || Object.entries(subscriptions).find(([key]) => key.startsWith(`${productId}:`))?.[1]
    || (String(productId).includes(':') ? subscriptions[String(productId).split(':')[0]] : null)
    || null;
  const expiration = entitlement?.expires_date ? Date.parse(entitlement.expires_date) : NaN;
  const graceExpiration = Date.parse(entitlement?.grace_period_expires_date || subscription?.grace_period_expires_date || '');
  const permitted = subscription && (subscription.is_sandbox === false || (allowSandbox && subscription.is_sandbox === true))
    && ['app_store', 'play_store'].includes(subscription.store);
  // Never accept lifetime/promotional/test-store entitlements for the paid plan.
  const activeUntil = permitted && Number.isSafeInteger(expiration) && !subscription.refunded_at
    ? Math.max(expiration, Number.isSafeInteger(graceExpiration) ? graceExpiration : 0, 0) : 0;
  let managementUrl = null;
  try {
    const link = new URL(subscriber.management_url);
    if (link.protocol === 'https:' && !link.username && !link.password
      && ['apps.apple.com', 'play.google.com'].includes(link.hostname)) managementUrl = link.href;
  } catch { /* no management link */ }
  return { source: 'revenuecat', entitlementId: PLUS_ENTITLEMENT, activeUntil, verifiedAt: now,
    productId: typeof productId === 'string' && productId.length <= 200 ? productId : null,
    store: permitted ? subscription.store : null,
    environment: subscription?.is_sandbox ? 'SANDBOX' : 'PRODUCTION', managementUrl };
}

export async function fetchRevenueCatSubscriber(uid, apiKey, request = fetch, projectId = process.env.REVENUECAT_PROJECT_ID) {
  if (!apiKey) throw new HttpsError('failed-precondition', 'ระบบสมาชิกยังไม่เปิดให้ใช้งาน');
  const response = await request(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (response.ok) return payload;
  if (response.status === 403 && payload.code === 7723 && projectId) {
    return fetchRevenueCatV2Subscriber(uid, apiKey, projectId, request);
  }
  throw new HttpsError('unavailable', 'ตรวจสอบสมาชิกไม่ได้ กรุณาลองอีกครั้ง');
}

// V2 keys cannot call V1. Normalize server-verified subscriptions into the
// same conservative policy (store, sandbox, expiry and refund checks).
export async function fetchRevenueCatV2Subscriber(uid, apiKey, projectId, request = fetch) {
  const base = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}`;
  let url = `${base}/customers/${encodeURIComponent(uid)}/subscriptions?limit=100`;
  const items = [];
  for (let page = 0; url && page < 20; page++) {
    const response = await request(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404 && page === 0) return { subscriber: { entitlements: {}, subscriptions: {} } };
    if (!response.ok) throw new HttpsError('unavailable', 'ตรวจสอบสมาชิกไม่ได้ กรุณาลองอีกครั้ง');
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new HttpsError('unavailable', 'ข้อมูลสมาชิกไม่สมบูรณ์ กรุณาลองอีกครั้ง');
    items.push(...data.items);
    url = data.next_page ? new URL(data.next_page, 'https://api.revenuecat.com').href : null;
    if (url && !url.startsWith(`${base}/customers/${encodeURIComponent(uid)}/subscriptions?`)) throw new HttpsError('unavailable', 'ข้อมูลสมาชิกไม่สมบูรณ์');
  }
  if (url) throw new HttpsError('unavailable', 'ข้อมูลสมาชิกไม่สมบูรณ์');
  const active = items.filter((item) => item.gives_access === true && item.pending_payment !== true
    && ['production', 'sandbox'].includes(item.environment) && ['play_store', 'app_store'].includes(item.store)
    && item.entitlements?.items?.some((entitlement) => entitlement.lookup_key === PLUS_ENTITLEMENT)
    && Number.isSafeInteger(item.current_period_ends_at))
    .sort((a, b) => b.current_period_ends_at - a.current_period_ends_at);
  const selected = active.find((item) => item.environment === 'production') || active[0];
  if (!selected) return { subscriber: { entitlements: {}, subscriptions: {} } };
  return { subscriber: { entitlements: { [PLUS_ENTITLEMENT]: {
    product_identifier: selected.product_id, expires_date: new Date(selected.current_period_ends_at).toISOString(),
  } }, subscriptions: { [selected.product_id]: { store: selected.store, is_sandbox: selected.environment === 'sandbox' } },
  management_url: selected.store === 'play_store' ? 'https://play.google.com/store/account/subscriptions' : 'https://apps.apple.com/account/subscriptions' } };
}

// A monotonically increasing request generation prevents an older network
// response arriving after a refund/transfer from re-granting revoked access.
export function createEntitlementSynchronizer({ db, getSubscriber, now = Date.now, allowSandbox = false }) {
  return async (uid) => {
    const ref = db.collection('entitlements').doc(uid);
    const generation = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const next = (snapshot.data()?.syncGeneration || 0) + 1;
      tx.set(ref, { syncGeneration: next }, { merge: true });
      return next;
    });
    const verified = entitlementFromSubscriber(await getSubscriber(uid), now(), allowSandbox);
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.data()?.syncGeneration !== generation) return membershipState(snapshot.data(), now());
      tx.set(ref, verified, { merge: true });
      return membershipState(verified, now());
    });
  };
}

export function requirePlus(record, now = Date.now()) {
  if (!isPlusActive(record, now)) throw new HttpsError('permission-denied', 'ฟีเจอร์นี้สำหรับ CampusMate Plus', { reason: 'PLUS_REQUIRED' });
}

export function verifyWebhookAuthorization(actual, expected) {
  if (typeof expected !== 'string' || expected.length < 24 || typeof actual !== 'string') return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function webhookUserIds(event) {
  const candidates = [event?.app_user_id, event?.original_app_user_id,
    ...(Array.isArray(event?.aliases) ? event.aliases : []),
    ...(Array.isArray(event?.transferred_from) ? event.transferred_from : []),
    ...(Array.isArray(event?.transferred_to) ? event.transferred_to : [])];
  return [...new Set(candidates.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128
    && !id.startsWith('$RCAnonymousID:') && !id.includes('/') && !/[\u0000-\u001f]/.test(id)))].slice(0, 20);
}

export function createRevenueCatWebhook({ db, sync, getAuthorization, userExists, now = Date.now }) {
  return async (request, response) => {
    if (request.method !== 'POST') return response.status(405).send('Method not allowed');
    if (!verifyWebhookAuthorization(request.get('authorization'), getAuthorization())) return response.status(401).send('Unauthorized');
    const event = request.body?.event;
    if (typeof event?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(event.id)) return response.status(400).send('Invalid event');
    const ref = db.collection('revenueCatEvents').doc(event.id);
    if ((await ref.get()).data()?.processedAt) return response.status(200).send('Already processed');
    const ids = webhookUserIds(event);
    try {
      for (let index = 0; index < ids.length; index += 4) {
        await Promise.all(ids.slice(index, index + 4).map(async (uid) => { if (await userExists(uid)) await sync(uid); }));
      }
      // Mark only after successful API verification. A 503 permits provider retries.
      await ref.set({ processedAt: now(), type: typeof event.type === 'string' ? event.type.slice(0, 80) : 'UNKNOWN' });
      return response.status(200).send('Processed');
    } catch { return response.status(503).send('Retry later'); }
  };
}
