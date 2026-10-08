import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCallDuration } from './callDuration.js';

test('formatCallDuration formats zero and small seconds correctly', () => {
  assert.equal(formatCallDuration(0), '00:00');
  assert.equal(formatCallDuration(5), '00:05');
  assert.equal(formatCallDuration(9), '00:09');
  assert.equal(formatCallDuration(59), '00:59');
});

test('formatCallDuration formats minutes and seconds correctly', () => {
  assert.equal(formatCallDuration(60), '01:00');
  assert.equal(formatCallDuration(75), '01:15');
  assert.equal(formatCallDuration(600), '10:00');
  assert.equal(formatCallDuration(1425), '23:45');
});

test('formatCallDuration handles long durations beyond 1 hour', () => {
  assert.equal(formatCallDuration(3600), '60:00');
  assert.equal(formatCallDuration(3665), '61:05');
});

test('formatCallDuration guards against negative and invalid inputs', () => {
  assert.equal(formatCallDuration(-10), '00:00');
  assert.equal(formatCallDuration(null), '00:00');
  assert.equal(formatCallDuration(undefined), '00:00');
  assert.equal(formatCallDuration(12.7), '00:12');
});
