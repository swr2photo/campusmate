import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRunner } from '../src/utils/faceGestureRunner.mjs';

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const face = (overrides = {}) => ({ faces: 1, yaw: 0, pitch: 0, size: 0.45, leftEyeOpen: 0.9, rightEyeOpen: 0.9, ...overrides });
function harness(options = {}) {
  const timers = new Map();
  const calls = [];
  const changes = [];
  const outcomes = [];
  let id = 0;
  const runner = createGestureRunner({
    gestures: ['TURN_LEFT'], nativeTracking: true,
    capture: async () => { calls.push('capture'); return { base64: 'frame' }; },
    submit: async (...args) => { calls.push(args); return { passed: true, complete: true }; },
    ...options,
    onChange: (state) => changes.push(state),
    onDone: () => outcomes.push('done'), onFail: (code) => outcomes.push(code), onCancel: () => outcomes.push('cancel'),
    schedule: (fn) => { timers.set(++id, fn); return id; }, unschedule: (key) => timers.delete(key),
  });
  const tick = async () => {
    const entry = timers.entries().next().value;
    if (entry) { timers.delete(entry[0]); entry[1](); }
    await flush();
  };
  runner.setActive(true);
  return { runner, timers, calls, changes, outcomes, tick };
}

test('a single qualifying turn starts capture immediately, without holding; only server can pass it', async () => {
  const reply = deferred();
  const h = harness({ submit: (...args) => { h.calls.push(args); return reply.promise; } });
  h.runner.faceUpdate(face({ yaw: 25 }));
  assert.equal(h.calls[0], 'capture', 'capture starts before any timer');
  h.runner.faceUpdate(face({ yaw: 0 })); // The person has already relaxed.
  await flush();
  assert.equal(h.runner.getState().phase, 'sending');
  assert.equal(h.runner.getState().passed, 0);
  assert.deepEqual(h.calls[1], [0, 'frame', { probe: true }]);
  reply.resolve({ passed: true, complete: true });
  await flush();
  assert.equal(h.runner.getState().passed, 1);
  await h.tick();
  assert.deepEqual(h.outcomes, ['done']);
});

test('capture requests the exact native frame that detected the gesture', async () => {
  const frames = [];
  const h = harness({ capture: async (id) => { frames.push(id); return { base64: 'detected-frame' }; } });
  h.runner.faceUpdate(face({ yaw: 25, frameId: 47 }));
  assert.deepEqual(frames, [47]);
  h.runner.dispose();
});

test('blink and nod need one qualifying frame; looking straight needs two consecutive updates', async () => {
  for (const [gesture, event] of [['BLINK', face({ leftEyeOpen: 0.1, rightEyeOpen: 0.1 })], ['NOD_DOWN', face({ pitch: 20 })]]) {
    const h = harness({ gestures: [gesture] });
    h.runner.faceUpdate(event);
    assert.equal(h.calls[0], 'capture', gesture);
    h.runner.dispose();
  }
  const h = harness({ gestures: ['CENTER'] });
  h.runner.faceUpdate(face());
  assert.equal(h.calls.length, 0);
  h.runner.faceUpdate(face({ yaw: 30 }));
  h.runner.faceUpdate(face());
  assert.equal(h.calls.length, 0, 'interrupted centre updates restart the short stability check');
  h.runner.faceUpdate(face());
  assert.equal(h.calls[0], 'capture');
  h.runner.dispose();
});

test('fallback keeps capturing during a request and sends the newest frames together', async () => {
  let n = 0;
  const reply = deferred();
  const h = harness({
    nativeTracking: false, capture: async () => ({ base64: `f${++n}` }),
    submit: (...args) => { h.calls.push(args); return reply.promise; },
  });
  h.runner.cameraReady();
  await flush();
  assert.deepEqual(h.calls, [[0, ['f1'], { probe: true }]]);
  for (let i = 0; i < 4; i += 1) await h.tick();
  assert.equal(h.calls.length, 1, 'one request at a time');
  reply.resolve({ passed: false, reason: 'GESTURE_NOT_DETECTED', hint: 'TURN_MORE', progress: 0.4, retriesLeft: 8 });
  await flush();
  assert.equal(h.runner.getState().hint, 'TURN_MORE');
  assert.equal(h.runner.getState().progress, 0.4);
  assert.equal(h.runner.getState().passed, 0);
  assert.deepEqual(h.calls[1], [0, ['f3', 'f4', 'f5'], { probe: true }], 'frames captured in flight go out at once, newest three');
  h.runner.dispose();
});

test('a passed step drops its frames and captures nothing during the check mark', async () => {
  let n = 0;
  const sent = [];
  const h = harness({
    nativeTracking: false, gestures: ['CENTER', 'BLINK'], capture: async () => ({ base64: `f${++n}` }),
    submit: async (step, frames) => {
      sent.push([step, frames]);
      return step === 0 ? { passed: true, complete: false, nextStep: 1, nextGesture: 'BLINK' }
        : { passed: false, reason: 'GESTURE_NOT_DETECTED', hint: 'CLOSE_EYES', retriesLeft: 8 };
    },
  });
  h.runner.cameraReady();
  await flush();
  assert.equal(h.runner.getState().phase, 'passed');
  assert.equal(h.timers.size, 1, 'only the pause is scheduled');
  await h.tick();
  await flush();
  assert.equal(h.runner.getState().step, 1);
  assert.deepEqual(sent, [[0, ['f1']], [1, ['f2']]]);
  assert.equal(h.runner.getState().hint, 'CLOSE_EYES');
  h.runner.dispose();
});

test('native and server distance hints block misleading success; mismatch is never hidden', async () => {
  const h = harness({ submit: async () => ({ passed: false, reason: 'FACE_NOT_MATCHED', hint: 'TOO_CLOSE', retriesLeft: 7 }) });
  h.runner.faceUpdate(face({ yaw: 30, size: 0.1 }));
  assert.equal(h.runner.getState().hint, 'TOO_FAR');
  assert.equal(h.calls.length, 0);
  h.runner.faceUpdate(face({ yaw: 30, size: 0.9 }));
  assert.equal(h.runner.getState().hint, 'TOO_CLOSE');
  h.runner.faceUpdate(face({ yaw: 30 }));
  await flush();
  assert.equal(h.runner.getState().hint, 'FACE_NOT_MATCHED');
  assert.equal(h.runner.getState().passed, 0);
  h.runner.dispose();
});

test('background before capture finishes prevents upload; resume waits for fallback camera readiness', async () => {
  const frame = deferred();
  const h = harness({ nativeTracking: false, capture: () => { h.calls.push('capture'); return frame.promise; } });
  h.runner.cameraReady();
  await flush();
  assert.deepEqual(h.calls, ['capture']);
  h.runner.setActive(false);
  frame.resolve({ base64: 'frame' });
  await flush();
  assert.deepEqual(h.calls, ['capture'], 'a frame from before the pause is never uploaded');
  h.runner.setActive(true);
  await flush();
  assert.deepEqual(h.calls, ['capture'], 'waits for the camera to be ready again');
  h.runner.cameraReady();
  await flush();
  assert.equal(h.calls.filter((call) => call === 'capture').length, 2);
  h.runner.dispose();
});

test('background server acknowledgement is retained, but completion cannot start AWS until foreground', async () => {
  const reply = deferred();
  const h = harness({ submit: () => reply.promise });
  h.runner.faceUpdate(face({ yaw: 30 }));
  await flush();
  h.runner.setActive(false);
  reply.resolve({ passed: true, complete: true });
  await flush();
  await h.tick();
  assert.equal(h.runner.getState().passed, 1);
  assert.deepEqual(h.outcomes, []);
  h.runner.setActive(true);
  assert.deepEqual(h.outcomes, ['done']);
});

test('cancel and dispose ignore late network results and clear scheduled work', async () => {
  for (const method of ['cancel', 'dispose']) {
    const reply = deferred();
    const h = harness({ submit: () => reply.promise });
    h.runner.faceUpdate(face({ yaw: 30 }));
    await flush();
    h.runner[method]();
    const updates = h.changes.length;
    reply.resolve({ passed: true, complete: true });
    await flush();
    assert.equal(h.changes.length, updates);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.outcomes, method === 'cancel' ? ['cancel'] : []);
  }
});

test('all five server acknowledgements are required; opposite turn and exact sequence are preserved', async () => {
  const gestures = ['CENTER', 'BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'NOD_DOWN'];
  const h = harness({ gestures, submit: async (step) => ({ passed: true, complete: step === 4, nextStep: step + 1, nextGesture: gestures[step + 1] }) });
  const frames = [face(), face({ leftEyeOpen: 0.1, rightEyeOpen: 0.1 }), face({ yaw: -25 }), face({ yaw: 25 }), face({ pitch: 20 })];
  for (let step = 0; step < gestures.length; step += 1) {
    if (step === 0) h.runner.faceUpdate(frames[step]);
    if (step === 3) {
      h.runner.faceUpdate(face({ yaw: -25 }));
      assert.equal(h.runner.getState().hint, 'OTHER_WAY');
      assert.equal(h.runner.getState().passed, 3);
    }
    h.runner.faceUpdate(frames[step]);
    await flush();
    assert.equal(h.runner.getState().passed, step + 1);
    await h.tick();
  }
  assert.deepEqual(h.outcomes, ['done']);
});

test('premature completion, skipped steps and exhausted retries fail closed', async () => {
  for (const reply of [{ passed: true, complete: true }, { passed: true, complete: false, nextStep: 2, nextGesture: 'BLINK' }, { passed: false, reason: 'MULTIPLE_FACES', retriesLeft: 0 }]) {
    const h = harness({ gestures: ['TURN_LEFT', 'BLINK'], submit: async () => reply });
    h.runner.faceUpdate(face({ yaw: 30 }));
    await flush();
    assert.equal(h.runner.getState().passed, 0);
    assert.equal(h.outcomes.length, 1);
    assert.notEqual(h.outcomes[0], 'done');
  }
});

test('transient errors retry finitely and never overlap requests', async () => {
  let inFlight = 0;
  let most = 0;
  const h = harness({
    nativeTracking: false,
    submit: async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      throw { code: 'SERVICE_UNAVAILABLE' };
    },
  });
  h.runner.cameraReady();
  for (let i = 0; i < 12; i += 1) await h.tick();
  assert.deepEqual(h.outcomes, ['SERVICE_UNAVAILABLE']);
  assert.equal(most, 1);
  assert.equal(h.timers.size, 0);
});

test('a capture without a frame is retried, then fails closed', async () => {
  const h = harness({ nativeTracking: false, capture: async () => null });
  h.runner.cameraReady();
  for (let i = 0; i < 8; i += 1) await h.tick();
  assert.deepEqual(h.outcomes, ['CAPTURE_FAILED']);
  assert.equal(h.timers.size, 0);
});
