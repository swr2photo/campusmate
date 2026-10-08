import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const code = await readFile('src/utils/adPolicy.js', 'utf8');
const { mayRequestNativeAd, isDiscoveryAdDue, insertActivityAdSlots } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('no native ad request while Plus, entitlement unknown, unconfigured or offline', () => {
  const permitted = { enabled: true, platformConfigured: true, membershipReady: true, serverConfirmed: true, plus: false };
  assert.equal(mayRequestNativeAd(permitted), true);
  for (const flag of ['enabled', 'platformConfigured', 'membershipReady', 'serverConfirmed']) assert.equal(mayRequestNativeAd({ ...permitted, [flag]: false }), false);
  assert.equal(mayRequestNativeAd({ ...permitted, plus: true }), false);
  assert.equal(mayRequestNativeAd({ ...permitted, plus: undefined }), false);
});
test('slots occur after 10 discovery actions and 6 activity items', () => {
  assert.equal(isDiscoveryAdDue(0), false); assert.equal(isDiscoveryAdDue(9), false);
  assert.equal(isDiscoveryAdDue(10), true); assert.equal(isDiscoveryAdDue(20), true);
  assert.equal(isDiscoveryAdDue(-10), false);
  const items = Array.from({ length: 13 }, (_, id) => ({ id: `item-${id}` }));
  const list = insertActivityAdSlots(items);
  assert.equal(list.length, 15); assert.equal(list[6].kind, 'native-ad'); assert.equal(list[13].kind, 'native-ad');
  assert.deepEqual(list.filter((item) => item.kind !== 'native-ad'), items);
});
