// node --test scripts/test-photo-verification-client.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoVerification, publicDecision, publicGestureStep, publicStatus } from '../src/services/photoVerificationProtocol.mjs';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function harness({ responses = {}, present } = {}) {
  const calls = [];
  const client = {
    async request(path, options = {}) {
      calls.push({ path, ...options });
      const reply = responses[path];
      const value = typeof reply === 'function' ? reply(calls) : reply;
      if (value instanceof Error) throw value;
      return value;
    },
  };
  const presented = [];
  const bridge = {
    isAvailable: () => true,
    present: async (options) => { presented.push(options); return present ? present(options) : { streamCompleted: true }; },
  };
  const flow = createPhotoVerification({ client, bridge, consentVersion: 'v1', sleep: async () => {} });
  return { flow, calls, presented };
}

const created = { verificationId: ID, sessionId: 'aws-session', region: 'ap-southeast-7', state: 'CREATED',
  credentials: { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't', expiration: '2026-10-12T10:00:00Z' } };
const createPath = '/v1/identity/photo-verifications';
const completePath = `/v1/identity/photo-verifications/${ID}/complete`;

test('the decision comes from the server, not the native callback', async () => {
  const { flow, calls, presented } = harness({ responses: {
    [createPath]: created,
    [completePath]: { verificationId: ID, status: 'FAILED', badge: 'PHOTO_VERIFIED', reason: 'FACE_NOT_MATCHED', similarity: 99 },
  } });
  const result = await flow.run({ consent: true });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.badge, null, 'a badge is only shown for VERIFIED');
  assert.equal(result.similarity, undefined);
  assert.deepEqual(calls.map((call) => call.path), [createPath, completePath]);
  assert.deepEqual(calls[0].body, { consent: true, consentVersion: 'v1' });
  assert.equal(presented[0].sessionId, 'aws-session');
});

test('no consent, no session', async () => {
  const { flow, calls } = harness();
  const result = await flow.run({ consent: false });
  assert.equal(result.reason, 'CONSENT_REQUIRED');
  assert.equal(calls.length, 0);
});

test('cancelling before or during session creation never opens a camera', async () => {
  const controller = new AbortController();
  controller.abort();
  const early = harness();
  assert.equal((await early.flow.run({ consent: true, signal: controller.signal })).reason, 'CANCELLED');
  assert.equal(early.calls.length, 0);
  const pending = new AbortController();
  const h = harness({ responses: { [createPath]: () => { pending.abort(); return created; } } });
  assert.equal((await h.flow.run({ consent: true, signal: pending.signal })).reason, 'CANCELLED');
  assert.equal(h.presented.length, 0);
  assert.equal(h.calls[0].signal, pending.signal);
});

test('cancelling after gestures prevents the next native screen and completing a cancelled stream', async () => {
  const controller = new AbortController();
  const h = harness({ responses: { [createPath]: { ...created, gestures: ['CENTER'] } } });
  const result = await h.flow.run({ consent: true, signal: controller.signal, performGestures: async () => {
    controller.abort(); return { completed: true };
  } });
  assert.equal(result.reason, 'CANCELLED');
  assert.equal(h.presented.length, 0);
  const afterStream = new AbortController();
  const streamed = harness({ responses: { [createPath]: created }, present: () => {
    afterStream.abort(); return { streamCompleted: true };
  } });
  assert.equal((await streamed.flow.run({ consent: true, signal: afterStream.signal })).reason, 'CANCELLED');
  assert.equal(streamed.calls.some((call) => call.path === completePath), false);
});

test('cancelling a result request does not mirror a late verified response', async () => {
  const controller = new AbortController();
  let mirrored = false;
  const flow = createPhotoVerification({ consentVersion: 'v1', bridge: { isAvailable: () => true, present: async () => ({ streamCompleted: true }) },
    client: { request: async (path, options) => {
      if (path === createPath) return created;
      assert.equal(options.signal, controller.signal);
      controller.abort();
      return { status: 'VERIFIED', badge: 'PHOTO_VERIFIED' };
    } }, syncBadge: async () => { mirrored = true; return { badge: 'PHOTO_VERIFIED' }; } });
  assert.equal((await flow.run({ consent: true, signal: controller.signal })).reason, 'CANCELLED');
  assert.equal(mirrored, false);
});

test('a missing native module never falls back to a photo upload', async () => {
  const calls = [];
  const flow = createPhotoVerification({
    client: { request: async (path) => { calls.push(path); return {}; } },
    bridge: { isAvailable: () => false },
    consentVersion: 'v1',
  });
  assert.equal((await flow.run({ consent: true })).reason, 'NATIVE_UNAVAILABLE');
  assert.equal(calls.length, 0);
});

test('cancelling the camera does not call complete', async () => {
  const { flow, calls } = harness({ responses: { [createPath]: created }, present: () => ({ streamCompleted: false }) });
  assert.equal((await flow.run({ consent: true })).reason, 'CANCELLED');
  assert.deepEqual(calls.map((call) => call.path), [createPath]);
});

test('a short result delay is retried, then the verified decision is shown', async () => {
  let attempts = 0;
  const awaiting = Object.assign(new Error('wait'), { code: 'unavailable', details: { reason: 'AWAITING_RESULT' } });
  const { flow } = harness({ responses: {
    [createPath]: created,
    [completePath]: () => (++attempts < 3 ? awaiting : { verificationId: ID, status: 'VERIFIED', badge: 'PHOTO_VERIFIED', verifiedAt: '2026-10-12T03:45:00Z' }),
  } });
  const result = await flow.run({ consent: true });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.badge, 'PHOTO_VERIFIED');
  assert.equal(attempts, 3);
});

test('server error codes become safe messages', async () => {
  const limited = Object.assign(new Error('x'), { code: 'resource-exhausted', details: { reason: 'RATE_LIMITED' } });
  const { flow } = harness({ responses: { [createPath]: limited } });
  const result = await flow.run({ consent: true });
  assert.equal(result.reason, 'RATE_LIMITED');
  assert.match(result.message, /30 นาที/);
});

test('publicDecision drops unknown fields', () => {
  assert.deepEqual(Object.keys(publicDecision({ status: 'VERIFIED', badge: 'PHOTO_VERIFIED', confidence: 99, verifiedAt: 'x' })).sort(),
    ['badge', 'reason', 'status', 'verificationId', 'verifiedAt']);
});

test('the no-flash check is requested and passed to the native screen', async () => {
  const { flow, calls, presented } = harness({ responses: {
    [createPath]: { ...created, challenge: 'FACE_MOVEMENT' },
    [completePath]: { verificationId: ID, status: 'REVIEW_REQUIRED', reason: 'REVIEW_REQUIRED' },
  } });
  const result = await flow.run({ consent: true, noFlash: true });
  assert.deepEqual(calls[0].body, { consent: true, consentVersion: 'v1', challenge: 'FACE_MOVEMENT' });
  assert.equal(presented[0].challenge, 'FACE_MOVEMENT');
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.badge, null);
});

test('a reply that would start flashing lights after a no-flash request is refused', async () => {
  const { flow, presented } = harness({ responses: { [createPath]: { ...created, challenge: 'FACE_MOVEMENT_AND_LIGHT' } } });
  assert.equal((await flow.run({ consent: true, noFlash: true })).reason, 'SERVICE_UNAVAILABLE');
  assert.equal(presented.length, 0);
});

test('legacy badges ask for re-verification and unknown statuses fail closed', () => {
  const legacy = publicStatus({ status: 'LEGACY', badge: 'PHOTO_VERIFIED', legacyGraceUntil: '2026-12-31T00:00:00Z', score: 1 });
  assert.equal(legacy.needsReverification, true);
  assert.equal(legacy.badge, 'PHOTO_VERIFIED');
  assert.equal(legacy.score, undefined);
  const forged = publicStatus({ status: 'SUPER_VERIFIED', badge: 'PHOTO_VERIFIED' });
  assert.equal(forged.status, 'UNVERIFIED');
  assert.equal(forged.badge, null);
  assert.equal(publicStatus({ status: 'REVOKED', badge: 'PHOTO_VERIFIED' }).badge, null);
});

test('appeals and alternative requests send only validated fields', async () => {
  const appealPath = `/v1/identity/photo-verifications/${ID}/appeal`;
  const alternativePath = '/v1/identity/photo-verification/alternative';
  const { flow, calls } = harness({ responses: { [appealPath]: { appeal: 'OPEN' }, [alternativePath]: { requestId: ID, status: 'OPEN' } } });
  assert.equal((await flow.appeal('../../admin', 'x')).ok, false);
  assert.equal((await flow.appeal(ID, '  it is me  ')).ok, true);
  assert.deepEqual(calls.at(-1).body, { note: 'it is me' });
  assert.equal((await flow.requestAlternative({ reason: 'APPROVE_ME' })).ok, false);
  const requested = await flow.requestAlternative({ reason: 'PHOTOSENSITIVITY', note: 'x'.repeat(900) });
  assert.equal(requested.requestId, ID);
  assert.equal(calls.at(-1).body.note.length, 500);
  assert.deepEqual(calls.map((call) => call.path), [appealPath, alternativePath]);
});

test('a verified decision is mirrored to the profile badge, other outcomes are not', async () => {
  let syncs = 0;
  const make = (status, syncBadge) => {
    const calls = [];
    const client = { async request(path, options = {}) { calls.push(path); return path === createPath ? created : { verificationId: ID, status, badge: status === 'VERIFIED' ? 'PHOTO_VERIFIED' : null, reason: status === 'VERIFIED' ? null : 'FACE_NOT_MATCHED' }; } };
    const bridge = { isAvailable: () => true, present: async () => ({ streamCompleted: true }) };
    return createPhotoVerification({ client, bridge, consentVersion: 'v1', syncBadge, sleep: async () => {} });
  };
  const synced = await make('VERIFIED', async () => { syncs += 1; return { badge: 'PHOTO_VERIFIED' }; }).run({ consent: true });
  assert.equal(synced.badgeSynced, true);
  assert.equal(syncs, 1);
  const failed = await make('FAILED', async () => { syncs += 1; return { badge: 'PHOTO_VERIFIED' }; }).run({ consent: true });
  assert.equal(failed.badge, null);
  assert.equal(syncs, 1, 'a failed decision never asks for a badge');
  const offline = await make('VERIFIED', async () => { throw new Error('offline'); }).run({ consent: true });
  assert.equal(offline.status, 'VERIFIED');
  assert.equal(offline.badgeSynced, false);
  assert.match(offline.message, /ซิงก์/);
});

const gesturePath = `/v1/identity/photo-verifications/${ID}/gestures`;
const withGestures = { ...created, gestures: ['CENTER', 'TURN_RIGHT', 'BLINK', 'NOD_DOWN', 'TURN_LEFT'], gesturesExpiresAt: '2026-10-21T10:02:00Z' };

test('gestures run in the server order before the AWS camera, each frame judged by the server', async () => {
  const order = [];
  const { flow, calls, presented } = harness({ responses: {
    [createPath]: withGestures,
    [gesturePath]: (all) => {
      const step = all.at(-1).body.step;
      return { verificationId: ID, passed: true, nextStep: step + 1, nextGesture: withGestures.gestures[step + 1], complete: step === 4, similarity: 99 };
    },
    [completePath]: { verificationId: ID, status: 'VERIFIED', badge: 'PHOTO_VERIFIED', verifiedAt: '2026-10-21T10:03:00Z' },
  } });
  const stages = [];
  const result = await flow.run({
    consent: true,
    onStage: (stage) => stages.push(stage),
    performGestures: async ({ gestures, expiresAt, submit }) => {
      assert.equal(presented.length, 0, 'the AWS camera waits for the gestures');
      assert.equal(expiresAt, '2026-10-21T10:02:00Z');
      let reply;
      for (const [step, name] of gestures.entries()) {
        order.push(name);
        reply = await submit(step, `frame-${step}`);
        assert.equal(reply.passed, true);
        assert.equal(reply.similarity, undefined, 'no score reaches the screen');
      }
      return { completed: reply.complete };
    },
  });
  assert.deepEqual(order, withGestures.gestures);
  assert.deepEqual(stages, ['creating', 'gestures', 'capturing', 'checking']);
  assert.deepEqual(calls.filter((call) => call.path === gesturePath).map((call) => call.body), [0, 1, 2, 3, 4].map((step) => ({ step, frame: `frame-${step}` })));
  assert.equal(presented.length, 1);
  assert.equal(result.status, 'VERIFIED');
});

test('a gesture phase that is cancelled, fails or cannot run never reaches the AWS camera', async () => {
  const notConfirmed = Object.assign(new Error('x'), { code: 'failed-precondition', details: { reason: 'GESTURE_NOT_CONFIRMED' } });
  for (const [performGestures, expected] of [
    [async () => ({ completed: false }), 'CANCELLED'],
    [async () => { throw Object.assign(new Error('closed'), { code: 'CANCELLED' }); }, 'CANCELLED'],
    [async ({ submit }) => { await submit(0, 'frame'); return { completed: true }; }, 'GESTURE_NOT_CONFIRMED'],
    [null, 'NATIVE_UNAVAILABLE'],
  ]) {
    const { flow, calls, presented } = harness({ responses: { [createPath]: withGestures, [gesturePath]: notConfirmed } });
    const result = await flow.run({ consent: true, performGestures });
    assert.equal(result.reason, expected);
    assert.equal(presented.length, 0);
    assert.equal(calls.some((call) => call.path === completePath), false);
  }
  const { flow } = harness({ responses: { [createPath]: { ...withGestures, gestures: ['CENTER', 'SMILE_AT_ADMIN'] } } });
  assert.equal((await flow.run({ consent: true, performGestures: async () => ({ completed: true }) })).reason, 'SERVICE_UNAVAILABLE');
});

test('a busy gesture step is retried and invalid frames are not sent', async () => {
  let tries = 0;
  const busy = Object.assign(new Error('wait'), { code: 'aborted', details: { reason: 'AWAITING_RESULT' } });
  const { flow, calls } = harness({ responses: {
    [createPath]: { ...withGestures, gestures: ['CENTER'] },
    [gesturePath]: () => (++tries < 2 ? busy : { passed: false, reason: 'MULTIPLE_FACES', retriesLeft: 6, confidence: 12 }),
    [completePath]: { verificationId: ID, status: 'FAILED', reason: 'FACE_NOT_MATCHED' },
  } });
  await flow.run({ consent: true, performGestures: async ({ submit }) => {
    await assert.rejects(submit(-1, 'frame'), { code: 'FRAME_UNUSABLE' });
    await assert.rejects(submit(0, ''), { code: 'FRAME_UNUSABLE' });
    const reply = await submit(0, 'frame');
    assert.deepEqual(reply, { passed: false, complete: false, nextStep: null, nextGesture: null, reason: 'MULTIPLE_FACES', retriesLeft: 6, hint: null, progress: 0 });
    return { completed: true };
  } });
  assert.equal(tries, 2);
  assert.equal(calls.filter((call) => call.path === gesturePath).length, 2);
});

test('publicGestureStep keeps only known gestures and drops scores', () => {
  assert.deepEqual(publicGestureStep({ passed: true, nextStep: 2, nextGesture: 'OPEN_ADMIN', complete: false, similarity: 99 }),
    { passed: true, complete: false, nextStep: 2, nextGesture: null, reason: null, retriesLeft: null, hint: null, progress: 0 });
  assert.equal(publicGestureStep({ passed: 'yes', complete: true }).complete, false);
});

test('a batch of recent frames is sent as frames, bounded, with guidance kept', async () => {
  const { flow, calls } = harness({ responses: {
    [createPath]: { ...created, gestures: ['TURN_LEFT'], gesturesExpiresAt: '2026-10-21T10:00:00Z' },
    [gesturePath]: { passed: false, reason: 'GESTURE_NOT_DETECTED', hint: 'TURN_MORE', progress: 0.6, retriesLeft: 8 },
  } });
  await flow.run({ consent: true, performGestures: async ({ submit }) => {
    await assert.rejects(submit(0, []), { code: 'FRAME_UNUSABLE' });
    await assert.rejects(submit(0, ['a', 'b', 'c', 'd']), { code: 'FRAME_UNUSABLE' });
    await assert.rejects(submit(0, ['a', '']), { code: 'FRAME_UNUSABLE' });
    const reply = await submit(0, ['a', 'b'], { probe: true });
    assert.equal(reply.hint, 'TURN_MORE');
    assert.equal(reply.progress, 0.6);
    return { completed: false };
  } });
  assert.deepEqual(calls.filter((call) => call.path === gesturePath).map((call) => call.body), [{ step: 0, frames: ['a', 'b'], probe: true }]);
  assert.equal(publicGestureStep({ passed: false, progress: 7 }).progress, 1);
  assert.equal(publicGestureStep({ passed: false, progress: 'far' }).progress, 0);
  assert.equal(publicGestureStep({ passed: true, progress: 0.5 }).progress, 0);
});

test('probe uploads retain the public distance hint and never expose face scores', async () => {
  const gesturePath = `/v1/identity/photo-verifications/${ID}/gestures`;
  const { flow, calls } = harness({ responses: {
    [createPath]: { ...created, gestures: ['CENTER'], gesturesExpiresAt: '2026-10-21T10:00:00Z' },
    [gesturePath]: { passed: false, reason: 'GESTURE_NOT_DETECTED', hint: 'TOO_FAR', retriesLeft: 8, similarity: 99, frame: 'private' },
  } });
  const result = await flow.run({ consent: true, performGestures: async ({ submit }) => {
    const reply = await submit(0, 'camera-frame', { probe: true });
    assert.equal(reply.hint, 'TOO_FAR');
    assert.equal(reply.retriesLeft, 8);
    assert.equal(reply.similarity, undefined);
    assert.equal(reply.frame, undefined);
    return { completed: false };
  } });
  assert.equal(result.reason, 'CANCELLED');
  assert.deepEqual(calls.find((call) => call.path === gesturePath).body, { step: 0, frame: 'camera-frame', probe: true });
  assert.equal(publicGestureStep({ passed: false, hint: 'OPEN_ADMIN' }).hint, null);
  assert.equal(publicGestureStep({ passed: true, hint: 'TOO_CLOSE' }).hint, null);
  assert.equal(publicGestureStep({ passed: false, hint: 'TOO_CLOSE' }).hint, 'TOO_CLOSE');
});

test('without the AWS module only a development preview runs the gestures, and it never reaches complete', async () => {
  const run = async (previewWithoutLiveness) => {
    const calls = [];
    const flow = createPhotoVerification({
      client: { request: async (path, options = {}) => {
        calls.push(path);
        if (path === createPath) return withGestures;
        if (path === gesturePath) return { passed: true, complete: options.body.step === 4, nextStep: options.body.step + 1 };
        return { verificationId: ID, status: 'VERIFIED', badge: 'PHOTO_VERIFIED' };
      } },
      bridge: { isAvailable: () => false },
      consentVersion: 'v1',
      sleep: async () => {},
    });
    const result = await flow.run({ consent: true, previewWithoutLiveness, performGestures: async ({ gestures, submit }) => {
      for (const step of gestures.keys()) await submit(step, 'frame');
      return { completed: true };
    } });
    return { result, calls };
  };
  const release = await run(false);
  assert.equal(release.result.reason, 'NATIVE_UNAVAILABLE');
  assert.equal(release.calls.length, 0);
  const preview = await run(true);
  assert.equal(preview.result.reason, 'LIVENESS_PREVIEW_ONLY');
  assert.equal(preview.result.badge, null);
  assert.equal(preview.calls.includes(completePath), false);
  assert.equal(preview.calls.filter((path) => path === gesturePath).length, 5);
});

test('an account that must confirm its email gets that reason before any camera opens', async () => {
  for (const reason of ['EMAIL_NOT_VERIFIED', 'CAMPUS_EMAIL_REQUIRED']) {
    const refused = Object.assign(new Error('Verify your email address to continue'), { code: 'permission-denied', details: { reason } });
    const { flow, presented } = harness({ responses: { [createPath]: refused } });
    const result = await flow.run({ consent: true });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.reason, reason, 'the server reason survives, so the sheet can say "confirm your email" instead of "did not pass"');
    assert.match(result.message, /อีเมล/);
    assert.equal(presented.length, 0, 'no face check ran');
  }
});
