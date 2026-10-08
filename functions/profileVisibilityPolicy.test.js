import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canViewProfile, validateDiscoveryFilters, validateVisibilityChange } from './profileVisibilityPolicy.js';
const now = 1800000000000, active = { source: 'revenuecat', entitlementId: 'campusmate_plus', verifiedAt: now, activeUntil: now + 5000 };
const subject = { viewerId: 'bob', ownerId: 'alice', ownerExists: true, ownerFaceVerified: true, visibilityMode: 'incognito', ownerEntitlement: active, now };
test('incognito allows only owner-liked viewers and established matches', () => {
  assert.equal(canViewProfile(subject), false);
  assert.equal(canViewProfile({ ...subject, ownerLikedViewer: true }), true);
  assert.equal(canViewProfile({ ...subject, matched: true }), true);
  assert.equal(canViewProfile({ ...subject, blocked: true, matched: true, ownerLikedViewer: true }), false);
  assert.equal(canViewProfile({ ...subject, ownerExists: false, matched: true }), false);
  assert.equal(canViewProfile({ ...subject, viewerId: 'alice' }), true);
});
test('expired incognito remains private until explicit public choice; matches continue', () => {
  assert.equal(canViewProfile({ ...subject, now: now + 5000, ownerLikedViewer: true }), false);
  assert.equal(canViewProfile({ ...subject, now: now + 5000, matched: true }), true);
  assert.equal(canViewProfile({ ...subject, now: now + 5000, visibilityMode: 'public' }), true);
  assert.equal(validateVisibilityChange('public', null, now), 'public');
  assert.throws(() => validateVisibilityChange('incognito', null, now), { code: 'permission-denied' });
});
test('profiles are hidden from others until the owner passes face verification', () => {
  const pub = { viewerId: 'bob', ownerId: 'alice', ownerExists: true, visibilityMode: 'public', now };
  // Accounts created before the requirement have no flag at all: hidden (fail closed).
  assert.equal(canViewProfile(pub), false);
  assert.equal(canViewProfile({ ...pub, ownerFaceVerified: false }), false);
  for (const value of ['true', 1, null, undefined, {}]) assert.equal(canViewProfile({ ...pub, ownerFaceVerified: value }), false);
  assert.equal(canViewProfile({ ...pub, ownerFaceVerified: true }), true);
  // A liked-viewer exception does not bypass verification for incognito owners.
  assert.equal(canViewProfile({ ...subject, ownerFaceVerified: false, ownerLikedViewer: true }), false);
});
test('unverified owners stay visible only to themselves outside chat', () => {
  const pub = { viewerId: 'bob', ownerId: 'alice', ownerExists: true, visibilityMode: 'public', now };
  assert.equal(canViewProfile({ ...pub, viewerId: 'alice' }), true);
  assert.equal(canViewProfile({ ...pub, matched: true }), false);
  assert.equal(canViewProfile({ ...pub, matched: true, blocked: true }), false);
  // Verification does not override other visibility rules.
  assert.equal(canViewProfile({ ...pub, ownerFaceVerified: true, ownerDiscoverable: false }), false);
  assert.equal(canViewProfile({ ...pub, ownerFaceVerified: true, ownerIsNew: true }), false);
  assert.equal(canViewProfile({ ...pub, ownerFaceVerified: true, blocked: true }), false);
});
test('direct API advanced-filter payload cannot bypass Plus', () => {
  assert.equal(validateDiscoveryFilters({ genders: ['male'], activities: ['running'], minAge: 18, maxAge: 30 }, null, now).maxAge, 30);
  for (const key of ['faculties', 'years', 'availabilityPeriods', 'availabilityWeekdays', 'paces']) {
    assert.throws(() => validateDiscoveryFilters({ [key]: ['value'] }, null, now), { code: 'permission-denied' });
    assert.equal(validateDiscoveryFilters({ [key]: ['value'] }, active, now)[key].length, 1);
  }
  assert.throws(() => validateDiscoveryFilters({ plus: true }, active, now), { code: 'invalid-argument' });
  assert.throws(() => validateDiscoveryFilters({ distanceKm: Infinity }, null, now), { code: 'invalid-argument' });
  assert.throws(() => validateDiscoveryFilters({ activities: ['__proto__'], activityDetails: JSON.parse('{"__proto__":{"choices":["x"]}}') }, active, now), { code: 'invalid-argument' });
});
