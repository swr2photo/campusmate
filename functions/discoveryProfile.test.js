import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoveryProfile, buildPublicProfile } from './discoveryProfile.js';

test('buildDiscoveryProfile keeps only bounded public discovery fields', () => {
  const profile = buildDiscoveryProfile('user-1', {
    isDiscoverable: true,
    isFaceVerified: true,
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

test('buildDiscoveryProfile keeps legacy face-verified profiles discoverable by default', () => {
  const profile = buildDiscoveryProfile('user-3', { isFaceVerified: true });
  assert.equal(profile.isDiscoverable, true);
  assert.equal(profile.isFaceVerified, true);
});

test('buildDiscoveryProfile leaves out owners who have not passed face verification', () => {
  // Accounts created before the requirement have no flag at all.
  assert.equal(buildDiscoveryProfile('legacy', { name: 'Legacy', avatarUri: 'https://example.com/a.jpg' }), null);
  for (const value of [false, 'true', 1, null]) {
    assert.equal(buildDiscoveryProfile('user-x', { name: 'X', isFaceVerified: value }), null);
  }
  // The public projection keeps the server-written flag so discovery can be rebuilt from it.
  const verified = buildPublicProfile('user-v', { name: 'Verified', isFaceVerified: true, faceMatchScore: 97 });
  assert.equal(verified.isFaceVerified, true);
  assert.equal(buildDiscoveryProfile('user-v', verified).isFaceVerified, true);
  assert.equal(buildPublicProfile('user-u', { name: 'Unverified' }).isFaceVerified, undefined);
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

test('gallery image URLs survive public and discovery projections within the eight-photo limit', () => {
  const photos = Array.from({ length: 9 }, (_, index) => `https://cdn.example.test/gallery/${index}.jpg`);
  const gallery = [
    `  ${photos[0]}  `,
    'file:///local/photo.jpg',
    'data:image/jpeg;base64,abc',
    'http://cdn.example.test/insecure.jpg',
    null,
    ...photos.slice(1),
    photos[0],
  ];

  const publicProfile = buildPublicProfile('user-gallery', {
    name: 'Gallery User',
    isFaceVerified: true,
    gallery,
    privacy: { showActivity: false, showFaculty: false },
  });
  assert.deepEqual(publicProfile.gallery, photos.slice(0, 8));

  const discoveryProfile = buildDiscoveryProfile('user-gallery', publicProfile);
  assert.deepEqual(discoveryProfile.gallery, photos.slice(0, 8));
  assert.equal(buildPublicProfile('user-empty', { gallery: ['file:///local/photo.jpg'] }).gallery, undefined);
  assert.equal(buildDiscoveryProfile('user-empty', { isFaceVerified: true, gallery: ['file:///local/photo.jpg'] }).gallery, undefined);
});

test('activityDetails survive both projections and respect showActivity', () => {
  const source = {
    isDiscoverable: true,
    isFaceVerified: true,
    name: 'Bee',
    activities: ['running', 'sports'],
    activityDetails: {
      running: { pace: 'Pace 6:00 - 7:00 นาที/กม.', timeOfDay: ['เย็น', '', 7] },
      sports: { sports: ['แบดมินตัน'], level: '  จริงจัง / แข่งขัน ' },
      'Bad Key!': { x: 'y' },
      empty: {},
    },
  };

  const publicProfile = buildPublicProfile('user-5', source);
  assert.deepEqual(publicProfile.activityDetails, {
    running: { pace: 'Pace 6:00 - 7:00 นาที/กม.', timeOfDay: ['เย็น'] },
    sports: { sports: ['แบดมินตัน'], level: 'จริงจัง / แข่งขัน' },
  });

  const discoveryProfile = buildDiscoveryProfile('user-5', publicProfile);
  assert.deepEqual(discoveryProfile.activityDetails, publicProfile.activityDetails);

  const hidden = buildPublicProfile('user-5', { ...source, privacy: { showActivity: false } });
  assert.equal(hidden.activityDetails, undefined);
});

test('legacy pace is mirrored into the running detail and back', () => {
  const fromLegacy = buildPublicProfile('user-6', {
    activities: ['running'],
    pace: 'Pace 8:00+ นาที/กม.',
  });
  assert.deepEqual(fromLegacy.activityDetails, { running: { pace: 'Pace 8:00+ นาที/กม.' } });

  const fromDetail = buildPublicProfile('user-7', {
    activities: ['running'],
    activityDetails: { running: { pace: 'เดิน / เริ่มต้น' } },
  });
  assert.equal(fromDetail.pace, 'เดิน / เริ่มต้น');

  const notRunning = buildPublicProfile('user-8', { activities: ['gym'], pace: 'เดิน / เริ่มต้น' });
  assert.equal(notRunning.activityDetails, undefined);
});

test('buildPublicProfile treats a missing visibility flag as discoverable', () => {
  const profile = buildPublicProfile('legacy-user', {
    name: 'Legacy User',
    avatarUri: 'https://example.com/avatar.jpg',
  });

  assert.equal(profile.isDiscoverable, true);
});

test('avatar revision is preserved while unrelated profile timestamps change', () => {
  const source = { name: 'Avatar', isFaceVerified: true, avatarUri: 'https://example.com/avatar.jpg', avatarRevision: 123, updatedAt: 900 };
  const first = buildPublicProfile('avatar-owner', source);
  const edited = buildPublicProfile('avatar-owner', { ...source, bio: 'New bio', updatedAt: 1000 });
  assert.equal(edited.avatarRevision, first.avatarRevision);
  assert.equal(buildDiscoveryProfile('avatar-owner', edited).avatarRevision, 123);
  assert.equal(buildPublicProfile('avatar-owner', { ...source, avatarRevision: -1 }).avatarRevision, undefined);
});

test('availabilitySlots preserves date, day, start, end, label in projections', () => {
  const slots = [
    { date: '2026-09-27', day: 'sun', start: '00:00', end: '00:30', label: 'อา. 27 ก.ย.' },
    { date: '2026-09-27', day: 'sun', start: '00:00', end: '24:00', label: 'อา. 27 ก.ย.' },
  ];
  const source = {
    isDiscoverable: true,
    isFaceVerified: true,
    name: 'SlotTester',
    availabilitySlots: slots,
  };
  const publicProfile = buildPublicProfile('user-slots', source);
  assert.deepEqual(publicProfile.availabilitySlots, slots);

  const discoveryProfile = buildDiscoveryProfile('user-slots', publicProfile);
  assert.deepEqual(discoveryProfile.availabilitySlots, slots);
});
