// node --test scripts/test-photo-verification-client.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoVerification, publicDecision, publicStatus } from '../src/services/photoVerificationProtocol.mjs';

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
