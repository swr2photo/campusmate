import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoveryProfile, buildPublicProfile } from './discoveryProfile.js';

test('buildDiscoveryProfile keeps only bounded public discovery fields', () => {
  const profile = buildDiscoveryProfile('user-1', {
    isDiscoverable: true,
    name: '  Alice  ',
    email: 'alice@example.com',
    latitude: 7.1,
    longitude: 100.5,
    matchingPreferences: { ageMin: 18 },
    avatarUri: 'https://example.com/avatar.jpg',
    meetup: {
      id: 'spot-1',
      name: 'Library',
      latitude: 7.1,
      longitude: 100.5,
      schedule: { date: '2026-09-07', startTime: '10:00', endTime: '11:00' },
    },
  });

  assert.equal(profile.id, 'user-1');
  assert.equal(profile.name, 'Alice');
  assert.equal(profile.isDiscoverable, true);
  assert.equal(profile.email, undefined);
  assert.equal(profile.latitude, undefined);
  assert.equal(profile.matchingPreferences, undefined);
  assert.equal(profile.meetup.latitude, undefined);
  assert.equal(profile.meetup.longitude, undefined);
  assert.equal(profile.meetup.name, 'Library');
});

test('buildDiscoveryProfile removes profiles that explicitly opt out', () => {
  assert.equal(buildDiscoveryProfile('user-2', { isDiscoverable: false }), null);
});

test('buildDiscoveryProfile removes profiles that are still new users completing setup', () => {
  assert.equal(buildDiscoveryProfile('user-new', { isNewUser: true }), null);
});

test('buildDiscoveryProfile keeps legacy profiles discoverable by default', () => {
  const profile = buildDiscoveryProfile('user-3', {});
  assert.equal(profile.isDiscoverable, true);
});

test('buildPublicProfile rebuilds an owner document without private fields', () => {
  const profile = buildPublicProfile('user-4', {
    isDiscoverable: true,
    name: 'Alice',
    email: 'alice@example.com',
    latitude: 7.1,
    longitude: 100.5,
    matchingPreferences: { ageMin: 18 },
    privacy: {
      showAge: false,
      showFaculty: false,
      showActivity: false,
      showAvailability: false,
      showLocation: false,
    },
    age: 20,
    faculty: 'คณะวิทยาศาสตร์',
    activity: 'running',
    availability: 'ช่วงเย็น',
    avatarUri: 'https://example.com/avatar.jpg',
    meetup: { id: 'spot-1', name: 'Library', latitude: 7.1, longitude: 100.5 },
  });

  assert.equal(profile.id, 'user-4');
  assert.equal(profile.isDiscoverable, true);
  assert.equal(profile.name, 'Alice');
  assert.equal(profile.avatarUri, 'https://example.com/avatar.jpg');
  assert.equal(profile.age, undefined);
  assert.equal(profile.faculty, undefined);
  assert.equal(profile.activity, undefined);
  assert.equal(profile.availability, undefined);
  assert.equal(profile.meetup, undefined);
  assert.equal(profile.email, undefined);
  assert.equal(profile.latitude, undefined);
  assert.equal(profile.matchingPreferences, undefined);
});

test('buildPublicProfile treats a missing visibility flag as discoverable', () => {
  const profile = buildPublicProfile('legacy-user', {
    name: 'Legacy User',
    avatarUri: 'https://example.com/avatar.jpg',
  });

  assert.equal(profile.isDiscoverable, true);
});
