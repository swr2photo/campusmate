// node --test scripts/test-face-gesture-detector.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessGesture, readFace, ringTicks } from '../src/utils/faceGestureDetector.mjs';

const face = (overrides = {}) => readFace({
  faces: 1, yaw: 0, pitch: 0, roll: 0, leftEyeOpen: 0.95, rightEyeOpen: 0.9, centerX: 0.5, centerY: 0.48, size: 0.45, ...overrides,
});

test('framing problems come before any gesture', () => {
  assert.equal(assessGesture('CENTER', face({ faces: 0 })).hint, 'NO_FACE');
  assert.equal(assessGesture('TURN_LEFT', face({ faces: 2 })).hint, 'MULTIPLE_FACES');
  assert.equal(assessGesture('CENTER', face({ size: 0.1 })).hint, 'TOO_FAR');
  assert.equal(assessGesture('CENTER', face({ size: 0.95 })).hint, 'TOO_CLOSE');
  assert.equal(assessGesture('CENTER', face({ centerX: 0.9 })).hint, 'OFF_CENTER');
  // A turned head drifts sideways in the frame; that is expected.
  assert.equal(assessGesture('TURN_RIGHT', face({ centerX: 0.75, yaw: 30 })).ready, true);
  assert.equal(assessGesture('CENTER', null).hint, 'NO_FACE');
});

test('looking straight with open eyes is ready, a sideways glance is not', () => {
  assert.equal(assessGesture('CENTER', face()).ready, true);
  const glance = assessGesture('CENTER', face({ yaw: 18 }));
  assert.equal(glance.ready, false);
  assert.equal(glance.hint, 'LOOK_STRAIGHT');
  assert.equal(assessGesture('CENTER', face({ leftEyeOpen: 0.1, rightEyeOpen: 0.2 })).ready, false);
});

test('a blink needs both eyes closed while facing the camera', () => {
  assert.equal(assessGesture('BLINK', face()).ready, false);
  assert.equal(assessGesture('BLINK', face({ leftEyeOpen: 0.1, rightEyeOpen: 0.2 })).ready, true);
  assert.equal(assessGesture('BLINK', face({ leftEyeOpen: 0.1, rightEyeOpen: 0.8 })).ready, false, 'a wink is not a blink');
  assert.equal(assessGesture('BLINK', face({ leftEyeOpen: -1, rightEyeOpen: -1 })).ready, false);
  assert.equal(assessGesture('BLINK', face({ leftEyeOpen: -1, rightEyeOpen: 0.1 })).ready, false, 'an unknown eye is not a closed eye');
  assert.ok(assessGesture('BLINK', face({ leftEyeOpen: 0.5, rightEyeOpen: 0.5 })).progress > 0.5);
});

test('turns fill progress with the angle and the second turn must go the other way', () => {
  const half = assessGesture('TURN_LEFT', face({ yaw: 10 }));
  assert.equal(half.ready, false);
  assert.ok(Math.abs(half.progress - 0.5) < 0.01);
  const first = assessGesture('TURN_LEFT', face({ yaw: -28 }));
  assert.equal(first.ready, true);
  assert.equal(first.sign, -1);
  const same = assessGesture('TURN_RIGHT', face({ yaw: -30 }), { firstTurnSign: -1 });
  assert.equal(same.ready, false);
  assert.equal(same.hint, 'OTHER_WAY');
  assert.equal(same.progress, 0);
  assert.equal(assessGesture('TURN_RIGHT', face({ yaw: 27 }), { firstTurnSign: -1 }).ready, true);
  assert.equal(assessGesture('TURN_RIGHT', face({ yaw: 27, pitch: 35 })).ready, false);
});

test('a nod needs pitch, not yaw', () => {
  assert.equal(assessGesture('NOD_DOWN', face({ pitch: -18 })).ready, true);
  assert.equal(assessGesture('NOD_DOWN', face({ pitch: -18, yaw: 30 })).ready, false);
  assert.equal(assessGesture('NOD_DOWN', face({ pitch: -5 })).ready, false);
  assert.equal(assessGesture('SMILE', face()).ready, false);
});

test('malformed native events never look ready', () => {
  const broken = readFace({ faces: 1.5, yaw: 'left', size: Number.NaN });
  assert.equal(broken.faces, 0);
  assert.equal(assessGesture('CENTER', broken).ready, false);
  assert.equal(readFace(undefined), null);
});

test('ring ticks: passed steps done, current step lit by progress', () => {
  const ticks = ringTicks({ total: 60, steps: 5, passed: 2, progress: 0.5 });
  assert.equal(ticks.filter((tick) => tick === 'done').length, 24);
  assert.equal(ticks.filter((tick) => tick === 'active').length, 6);
  assert.deepEqual(ticks.slice(24, 31), ['active', 'active', 'active', 'active', 'active', 'active', 'idle']);
  assert.equal(ringTicks({ total: 60, steps: 5, passed: 5, progress: 0 }).every((tick) => tick === 'done'), true);
});
