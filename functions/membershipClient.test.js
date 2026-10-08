import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/services/membershipService.js', import.meta.url), 'utf8').replace(/^import[^\n]+\r?\n/gm, '').replace(/^export /gm, '');
const activeInfo = (active) => ({ entitlements: { active: active ? { campusmate_plus: { expirationDateMillis: Date.now() + 86400000, productIdentifier: 'plus_monthly', store: 'PLAY_STORE' } } : {} } });
function client({ active = false, purchaseError, restored = active } = {}) {
  const calls = [];
  const sdk = { isConfigured: async () => true, logIn: async () => calls.push('login'), getOfferings: async () => ({ current: { availablePackages: [] } }),
    getCustomerInfo: async () => activeInfo(active),
    purchasePackage: async () => { calls.push('purchase'); if (purchaseError) throw purchaseError; return { customerInfo: activeInfo(true) }; },
    restorePurchases: async () => { calls.push('restore'); return activeInfo(restored); } };
  const context = vm.createContext({ __DEV__: false, PLUS_ENTITLEMENT_ID: 'campusmate_plus', Platform: { OS: 'android' },
    Constants: { expoConfig: { extra: { plusBackendEnabled: true, revenueCatAndroidKey: 'public' } } },
    require: () => ({ default: sdk, PURCHASES_ERROR_CODE: { PRODUCT_ALREADY_PURCHASED_ERROR: '6' } }),
    requireFirebase: () => ({ app: {} }), getAuth: () => ({ currentUser: { uid: 'owner' } }), onAuthStateChanged: () => () => {}, getFunctions: () => ({}),
    httpsCallable: () => async () => { calls.push('verify'); return { data: { plus: true } }; }, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return { api: context, calls };
}
// The store answer only unlocks the UI optimistically; the server record stays the authority
// and is confirmed separately through syncMembership (MembershipContext runs it in the background).
test('active store entitlement skips purchase and reports the store Plus without granting server access', async () => {
  const { api, calls } = client({ active: true }); await api.initializePurchases('owner');
  const result = await api.purchaseMembership('owner', {});
  assert.equal(result.cancelled, false);
  assert.equal(result.plus.record.entitlementId, 'campusmate_plus');
  assert.equal(result.plus.record.source, 'revenuecat');
  assert.deepEqual(calls, ['login']);
});
test('already-owned store error restores the purchase and reports it', async () => {
  const { api, calls } = client({ purchaseError: { code: '6' }, restored: true }); await api.initializePurchases('owner');
  const result = await api.purchaseMembership('owner', {});
  assert.ok(result.plus);
  assert.deepEqual(calls, ['login', 'purchase', 'restore']);
});
test('cancelled store purchase never restores or grants access', async () => {
  const { api, calls } = client({ purchaseError: { userCancelled: true, code: '1' } }); await api.initializePurchases('owner');
  const result = await api.purchaseMembership('owner', {});
  assert.equal(result.cancelled, true);
  assert.equal(result.plus, null);
  assert.deepEqual(calls, ['login', 'purchase']);
});
test('restore without an active store entitlement reports no Plus', async () => {
  const { api, calls } = client({ restored: false }); await api.initializePurchases('owner');
  assert.equal((await api.restoreMembership('owner')).plus, null);
  assert.deepEqual(calls, ['login', 'restore']);
});
test('server verification is a separate callable request', async () => {
  const { api, calls } = client({ active: true });
  assert.equal((await api.syncMembership('owner')).plus, true);
  assert.deepEqual(calls, ['verify']);
});
