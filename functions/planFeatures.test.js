import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { entitlementFromSubscriber, hasPlanFeature, isPlusActive, membershipState, PLAN_FEATURES, requireFeature } from './plusEntitlements.js';

// Load the app's pure plan module (ESM syntax under a non-module package) into a sandbox.
function clientPlans() {
  const source = readFileSync(new URL('../src/data/plans.js', import.meta.url), 'utf8')
    .replace(/^export (const|function) /gm, '$1 ');
  const names = [...source.matchAll(/^(?:const|function) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((match) => match[1]);
  const context = vm.createContext({});
  vm.runInContext(`${source}\nthis.exports = { ${names.join(', ')} };`, context);
  return context.exports;
}
const client = clientPlans();
// vm objects come from another realm; compare plain JSON copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const now = 1_800_000_000_000;
const plusRecord = { source: 'revenuecat', entitlementId: 'campusmate_plus', activeUntil: now + 1000, verifiedAt: now - 1 };

test('client and server feature matrices are identical', () => {
  assert.deepEqual(plain(client.PLAN_FEATURES), plain(PLAN_FEATURES));
  assert.deepEqual(plain(client.PLUS_BENEFITS.map((item) => item.feature).sort()), Object.keys(PLAN_FEATURES.plus).sort());
});

test('free unlocks no paid feature; plus unlocks exactly the Plus features', () => {
  for (const feature of Object.keys(PLAN_FEATURES.plus)) {
    assert.equal(client.hasFeature('free', feature), false, feature);
    assert.equal(client.hasFeature('plus', feature), true, feature);
  }
});

test('loading, unknown plans and unknown features never unlock', () => {
  for (const plan of [null, undefined, 'loading', 'Plus', 'PLUS', 'pro', '__proto__', 'constructor', 1, {}]) {
    for (const feature of Object.keys(PLAN_FEATURES.plus)) assert.equal(client.hasFeature(plan, feature), false, `${String(plan)} ${feature}`);
  }
  assert.equal(client.hasFeature('plus', 'everything'), false);
  assert.equal(client.hasFeature('plus', 'toString'), false);
  assert.equal(hasPlanFeature(plusRecord, 'everything', now), false);
  assert.equal(hasPlanFeature(plusRecord, '__proto__', now), false);
});

test('client and server agree on who is Plus, including expiry and malformed records', () => {
  const cases = [plusRecord, { ...plusRecord, activeUntil: now }, { ...plusRecord, activeUntil: now - 1 },
    { ...plusRecord, verifiedAt: 0 }, { ...plusRecord, source: 'client' }, { ...plusRecord, entitlementId: 'Campusmate_Plus' },
    { ...plusRecord, activeUntil: String(now + 1000) }, { ...plusRecord, activeUntil: (now + 1000) / 1000 + 0.5 }, null, {}];
  for (const record of cases) assert.equal(client.isPlusRecord(record, now), isPlusActive(record, now), JSON.stringify(record));
  assert.deepEqual(membershipState(plusRecord, now).features, PLAN_FEATURES.plus);
  assert.deepEqual(membershipState({ ...plusRecord, activeUntil: now - 1 }, now).features, PLAN_FEATURES.free);
  assert.throws(() => requireFeature(null, 'incognito', now), { code: 'permission-denied' });
  assert.doesNotThrow(() => requireFeature(plusRecord, 'incognito', now));
});

test('paid matching preferences are stripped for free and preserved (not changeable) on save', () => {
  const stored = { faculty: 'วิศวกรรมศาสตร์', years: ['2'], ageMin: 18, genders: ['female'] };
  const free = client.stripPaidMatchingPreferences(stored, false);
  assert.equal(free.faculty, 'all'); assert.deepEqual(plain(free.years), []); assert.deepEqual(plain(free.genders), ['female']);
  assert.equal(client.stripPaidMatchingPreferences(stored, true), stored);
  const saved = client.keepPaidMatchingPreferences({ ...stored, faculty: 'all', years: ['4'], ageMin: 20 }, stored, false);
  assert.equal(saved.faculty, 'วิศวกรรมศาสตร์'); assert.deepEqual(plain(saved.years), ['2']); assert.equal(saved.ageMin, 20);
  assert.deepEqual(plain(client.keepPaidMatchingPreferences({ years: ['4'] }, {}, false).years), []);
  assert.deepEqual(plain(client.keepPaidMatchingPreferences({ years: ['4'] }, stored, true).years), ['4']);
});

test('Google Play base-plan subscription keys are matched to the entitlement', () => {
  const payload = (subscriptions, entitlement = {}) => ({ subscriber: { entitlements: { campusmate_plus: {
    product_identifier: 'plus_sub', expires_date: new Date(now + 5000).toISOString(), ...entitlement } }, subscriptions } });
  const sub = { store: 'play_store', is_sandbox: false };
  assert.equal(isPlusActive(entitlementFromSubscriber(payload({ plus_sub: sub }), now), now), true);
  assert.equal(isPlusActive(entitlementFromSubscriber(payload({ 'plus_sub:monthly': sub }, { product_plan_identifier: 'monthly' }), now), now), true);
  assert.equal(isPlusActive(entitlementFromSubscriber(payload({ 'plus_sub:annual': sub }), now), now), true);
  assert.equal(isPlusActive(entitlementFromSubscriber(payload({ other: sub }), now), now), false);
});
