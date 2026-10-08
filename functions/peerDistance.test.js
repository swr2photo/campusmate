import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDistancePrivacyFloor,
  haversineKm,
  sanitizePeerUserIds,
  visibleDistanceKm,
} from './peerDistance.js';

test('floors displayed distance at 700 meters', () => {
  assert.equal(applyDistancePrivacyFloor(0.12), 0.7);
  assert.equal(applyDistancePrivacyFloor(0.7), 0.7);
  assert.equal(applyDistancePrivacyFloor(1.234), 1.234);
  assert.equal(applyDistancePrivacyFloor(-1), null);
});

test('haversine returns a real kilometer distance', () => {
  const km = haversineKm(7.006, 100.498, 7.01, 100.498);
  assert.ok(km > 0.4 && km < 0.5);
});

test('visible distance never exposes coordinates and honors sharing flags', () => {
  const viewer = { latitude: 7.006, longitude: 100.498, locationEnabled: true };
  const nearby = { latitude: 7.0062, longitude: 100.498, locationEnabled: true };
  assert.equal(visibleDistanceKm(viewer, nearby), 0.7);
  assert.equal(visibleDistanceKm(viewer, { ...nearby, locationEnabled: false }), null);
});

test('peer id sanitizer drops the caller and invalid ids', () => {
  assert.deepEqual(
    sanitizePeerUserIds(['self', 'peer-1', 'peer-1', '../../x', 'peer-2'], 'self'),
    ['peer-1', 'peer-2'],
  );
});
