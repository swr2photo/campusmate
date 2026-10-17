import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEntitlementSynchronizer, createRevenueCatWebhook, entitlementDiscoveryFingerprint, entitlementFromSubscriber, isPlusActive,
  membershipState, requirePlus, verifyWebhookAuthorization, webhookUserIds } from './plusEntitlements.js';
const now = 1_800_000_000_000;
function subscriber(until = now + 1000, overrides = {}) {
  return { subscriber: { entitlements: { campusmate_plus: { product_identifier: 'plus_monthly', expires_date: new Date(until).toISOString() } },
    subscriptions: { plus_monthly: { store: 'play_store', is_sandbox: false, ...overrides } }, management_url: 'https://play.google.com/store/account/subscriptions' } };
}

test('purchase, cancellation until paid expiry, expiry, grace and refund use server state', () => {
  const record = entitlementFromSubscriber(subscriber(), now);
  assert.equal(isPlusActive(record, now), true); assert.equal(isPlusActive(record, now + 1000), false);
  assert.equal(isPlusActive(entitlementFromSubscriber(subscriber(now + 1000, { unsubscribe_detected_at: new Date(now).toISOString() }), now), now), true);
  assert.equal(isPlusActive(entitlementFromSubscriber(subscriber(now - 1000, { grace_period_expires_date: new Date(now + 5000).toISOString() }), now), now), true);
  assert.equal(isPlusActive(entitlementFromSubscriber(subscriber(now + 1000, { refunded_at: new Date(now).toISOString() }), now), now), false);
  assert.equal(membershipState(record, now + 1000).features.incognito, false);
  assert.throws(() => requirePlus({ plus: true, activeUntil: now + 9999 }, now), { code: 'permission-denied' });
});

test('sandbox, test store and lifetime promotional entitlements cannot unlock production', () => {
  assert.equal(isPlusActive(entitlementFromSubscriber(subscriber(now + 1000, { is_sandbox: true }), now), now), false);
  assert.equal(isPlusActive(entitlementFromSubscriber(subscriber(now + 1000, { is_sandbox: true }), now, true), now), true);
  assert.equal(isPlusActive(entitlementFromSubscriber(subscriber(now + 1000, { store: 'test_store' }), now, true), now), false);
  const promotion = subscriber(); promotion.subscriber.entitlements.campusmate_plus.expires_date = null;
  assert.equal(isPlusActive(entitlementFromSubscriber(promotion, now), now), false);
});

function database() {
  const data = new Map(); let queue = Promise.resolve();
  const ref = (id) => ({ id, get: async () => ({ data: () => data.get(id) }), set: async (value) => data.set(id, value) });
  return { data, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: (fn) => { const result = queue.then(() => fn({ get: (r) => r.get(), set: (r, value) => data.set(r.id, { ...data.get(r.id), ...value }) })); queue = result.catch(() => {}); return result; } };
}
test('a delayed old response cannot re-grant access after a newer refund', async () => {
  const db = database(); let resolveOld; let count = 0;
  const sync = createEntitlementSynchronizer({ db, now: () => now,
    getSubscriber: () => ++count === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : subscriber(now - 1000) });
  const old = sync('alice'); while (!resolveOld) await new Promise((resolve) => setImmediate(resolve));
  await sync('alice'); resolveOld(subscriber()); await old;
  assert.equal(isPlusActive(db.data.get('entitlements/alice'), now), false);
});

test('a routine re-verification leaves the entitlement document untouched', async () => {
  const db = database(); let clock = now;
  const writes = [];
  const transaction = db.runTransaction;
  db.runTransaction = (fn) => transaction((tx) => fn({ ...tx, set: (ref, value) => { writes.push(ref.id); return tx.set(ref, value); } }));
  const sync = createEntitlementSynchronizer({ db, now: () => clock, getSubscriber: () => subscriber(now + 60_000) });
  assert.equal((await sync('alice')).plus, true);
  assert.deepEqual(writes, ['entitlementSyncs/alice', 'entitlements/alice']);
  writes.length = 0; clock += 1000;
  assert.equal((await sync('alice')).plus, true);
  assert.deepEqual(writes, ['entitlementSyncs/alice']);
  assert.equal(db.data.get('entitlements/alice').verifiedAt, now);
  writes.length = 0; clock = now + 24 * 60 * 60 * 1000;
  await sync('alice');
  assert.deepEqual(writes, ['entitlementSyncs/alice', 'entitlements/alice']);
});

test('discovery is signalled only for entitlement changes it can observe', () => {
  const base = entitlementFromSubscriber(subscriber(), now);
  const same = entitlementDiscoveryFingerprint(base);
  assert.equal(entitlementDiscoveryFingerprint({ ...base, verifiedAt: now + 5000, syncGeneration: 7 }), same);
  assert.equal(entitlementDiscoveryFingerprint({ syncGeneration: 3, ...base }), same);
  assert.notEqual(entitlementDiscoveryFingerprint({ ...base, activeUntil: 0 }), same);
  assert.notEqual(entitlementDiscoveryFingerprint({ ...base, verifiedAt: 0 }), same);
  assert.notEqual(entitlementDiscoveryFingerprint({ ...base, isAdmin: true }), same);
  assert.equal(entitlementDiscoveryFingerprint(undefined), null);
  assert.notEqual(entitlementDiscoveryFingerprint(base), entitlementDiscoveryFingerprint(undefined));
});

test('webhooks authenticate, re-fetch transfers and process duplicate events once', async () => {
  const authorization = 'Bearer ' + 'secret'.repeat(6), db = database(), users = [];
  const handle = createRevenueCatWebhook({ db, getAuthorization: () => authorization, userExists: async () => true,
    sync: async (uid) => { users.push(uid); }, now: () => now });
  const response = () => ({ code: 0, status(code) { this.code = code; return this; }, send() { return this; } });
  const request = { method: 'POST', get: () => authorization, body: { event: { id: 'event-1', type: 'TRANSFER',
    app_user_id: 'alice', transferred_from: ['alice'], transferred_to: ['bob'], aliases: ['$RCAnonymousID:xyz'] } } };
  assert.equal((await handle({ ...request, get: () => 'fake' }, response())).code, 401);
  assert.deepEqual(users, []);
  assert.equal((await handle(request, response())).code, 200);
  assert.equal((await handle(request, response())).code, 200);
  assert.deepEqual(users, ['alice', 'bob']);
  assert.equal(verifyWebhookAuthorization('', ''), false);
  assert.deepEqual(webhookUserIds({ app_user_id: '../alice' }), []);
});
