import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// entitlementSyncs/{uid} holds the membership sync generation. Deleting it
// with the account also cancels a sync already in flight, which would
// otherwise recreate entitlements/{uid} for a deleted user.
test('both account deletion paths remove the membership sync generation', () => {
  const selfService = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const deleteUserData = selfService.slice(selfService.indexOf('export const deleteUserData'), selfService.indexOf('export const reportAppVersion'));
  assert.match(deleteUserData, /\['entitlements', 'entitlementSyncs',/);
  const admin = readFileSync(new URL('./adminAccountDeletion.js', import.meta.url), 'utf8');
  assert.match(admin, /const ownedCollections=\[[^\]]*'entitlements','entitlementSyncs'/);
});
