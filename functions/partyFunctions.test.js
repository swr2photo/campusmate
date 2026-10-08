import test from 'node:test';
import assert from 'node:assert/strict';
import { pointDistanceMeters, scheduleFrom, validPoint } from './partyFunctions.js';

const campus = { latitude: 7.008453, longitude: 100.497914 };

test('party radius accepts campus and rejects a point beyond 3 km', () => {
  assert.equal(pointDistanceMeters(campus), 0);
  assert.equal(validPoint(campus), true);
  assert.equal(validPoint({ latitude: campus.latitude + 0.0269, longitude: campus.longitude }), true);
  assert.equal(validPoint({ latitude: campus.latitude + 0.0271, longitude: campus.longitude }), false);
  assert.equal(validPoint({ latitude: Number.NaN, longitude: campus.longitude }), false);
});

test('party schedule uses Thailand time and rejects expired or reversed times', () => {
  const schedule = scheduleFrom({ date: '2099-01-01', startTime: '14:00', endTime: '16:00' });
  assert.equal(schedule.startsAt.toDate().toISOString(), '2099-01-01T07:00:00.000Z');
  assert.throws(() => scheduleFrom({ date: '2099-01-01', startTime: '16:00', endTime: '14:00' }));
  assert.throws(() => scheduleFrom({ date: '2020-01-01', startTime: '14:00', endTime: '16:00' }));
  assert.throws(() => scheduleFrom({ date: '2099-02-30', startTime: '14:00', endTime: '16:00' }));
});
