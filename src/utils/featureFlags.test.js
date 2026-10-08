import test from 'node:test';
import assert from 'node:assert/strict';
import { isCallFeatureAllowed } from './featureFlags.js';

test('allows Game🥰 by user ID', () => {
  const user = { uid: 'gJrQKDW1bNNB0LzlNQ79fqiU0kl1', email: 'any@psu.ac.th' };
  const profile = { id: 'gJrQKDW1bNNB0LzlNQ79fqiU0kl1', name: 'Game🥰' };
  assert.equal(isCallFeatureAllowed(user, profile), true);
});

test('allows Game🥰 by campus email', () => {
  const user = { uid: 'random-uid', email: '6710210317@psu.ac.th' };
  const profile = { campusEmail: '6710210317@psu.ac.th' };
  assert.equal(isCallFeatureAllowed(user, profile), true);
});

test('allows user with canCall or isTester flag in profile', () => {
  assert.equal(isCallFeatureAllowed(null, { canCall: true }), true);
  assert.equal(isCallFeatureAllowed(null, { isTester: true }), true);
  assert.equal(isCallFeatureAllowed(null, { role: 'admin' }), true);
});

test('rejects unauthorized accounts without flags', () => {
  const user = { uid: 'random-user-123', email: 'other@psu.ac.th' };
  const profile = { id: 'random-user-123', name: 'Normal User', studentId: '6810210999' };
  assert.equal(isCallFeatureAllowed(user, profile), false);
});

test('handles empty or null parameters gracefully', () => {
  assert.equal(isCallFeatureAllowed(null, null), false);
  assert.equal(isCallFeatureAllowed(undefined, undefined), false);
});
