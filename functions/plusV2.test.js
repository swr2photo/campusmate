import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRevenueCatSubscriber, fetchRevenueCatV2Subscriber, entitlementFromSubscriber, isPlusActive } from './plusEntitlements.js';
const now = Date.now();
const subscription = { product_id: 'prod1', gives_access: true, pending_payment: false, current_period_ends_at: now + 60000,
  store: 'play_store', environment: 'production', entitlements: { items: [{ lookup_key: 'campusmate_plus' }] } };
const ok = (items, next_page = null) => ({ ok: true, status: 200, json: async () => ({ items, next_page }) });
test('V2 secret rejection falls back to V2 and confirms a store subscription', async () => {
  const urls = [];
  const payload = await fetchRevenueCatSubscriber('owner', 'secret', async (url) => {
    urls.push(url);
    return urls.length === 1 ? { ok: false, status: 403, json: async () => ({ code: 7723 }) } : ok([subscription]);
  }, 'proj1');
  assert.equal(urls.length, 2);
  assert.equal(isPlusActive(entitlementFromSubscriber(payload, now), now), true);
});
test('V2 rejects revoked, pending, other entitlements, test stores and malformed expiry', async () => {
  for (const changes of [{ gives_access: false }, { pending_payment: true }, { entitlements: { items: [{ lookup_key: 'other' }] } },
    { store: 'test_store' }, { current_period_ends_at: null }]) {
    const payload = await fetchRevenueCatV2Subscriber('owner', 'secret', 'proj1', async () => ok([{ ...subscription, ...changes }]));
    assert.equal(isPlusActive(entitlementFromSubscriber(payload, now), now), false);
  }
});
test('V2 sandbox follows existing server policy', async () => {
  const payload = await fetchRevenueCatV2Subscriber('owner', 'secret', 'proj1', async () => ok([{ ...subscription, environment: 'sandbox' }]));
  assert.equal(isPlusActive(entitlementFromSubscriber(payload, now), now), false);
  assert.equal(isPlusActive(entitlementFromSubscriber(payload, now, true), now), true);
});
test('V2 follows customer pages and refuses foreign pagination URLs', async () => {
  let calls = 0;
  const payload = await fetchRevenueCatV2Subscriber('owner', 'secret', 'proj1', async () => ++calls === 1
    ? ok([], '/v2/projects/proj1/customers/owner/subscriptions?starting_after=old') : ok([subscription]));
  assert.equal(isPlusActive(entitlementFromSubscriber(payload, now), now), true);
  await assert.rejects(fetchRevenueCatV2Subscriber('owner', 'secret', 'proj1', async () => ok([], 'https://other.test/steal')));
});
