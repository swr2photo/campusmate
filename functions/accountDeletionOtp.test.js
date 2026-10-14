import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountDeletionOtp } from './accountDeletionOtp.js';
import { deleteLegacyAvatar } from './accountDeletionMedia.js';

function fixture() {
  const rows = new Map(), deliveries = [];
  let time = 1_800_000_000_000, email = 'test@example.test', failEmail = false, pending = Promise.resolve();
  const snapshot = ref => ({ exists: rows.has(ref.path), data: () => rows.get(ref.path), get: key => rows.get(ref.path)?.[key] });
  const db = {
    doc: path => ({ path, get: async () => snapshot({ path }) }),
    runTransaction: fn => {
      const result = pending.then(async () => {
        const writes = [];
        const value = await fn({ get: async ref => snapshot(ref),
          set: (ref, data) => writes.push(() => rows.set(ref.path, data)),
          update: (ref, data) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...data })),
          delete: ref => writes.push(() => rows.delete(ref.path)),
        });
        writes.forEach(write => write());
        return value;
      });
      pending = result.catch(() => {});
      return result;
    },
  };
  const api = createAccountDeletionOtp({ db, auth: { getUser: async () => ({ email }) }, now: () => time,
    sendEmail: async message => { if (failEmail) throw new Error('simulated email outage'); deliveries.push(message); },
  });
  const request = (uid = 'owner', code) => ({ auth: { uid, token: { auth_time: time / 1000 } }, data: { code } });
  return { api, rows, deliveries, request, advance: ms => { time += ms; }, changeEmail: () => { email = 'changed@example.test'; }, failEmail: () => { failEmail = true; } };
}

test('deletion requires signed-in caller, recent login and a server-verified code', async () => {
  const f = fixture();
  for (const action of ['send', 'verify', 'authorize']) await assert.rejects(f.api[action]({}), { code: 'unauthenticated' });
  f.rows.set('accountDeletionOtps/owner', { code: '123456', verified: true });
  await assert.rejects(f.api.authorize(f.request()), { code: 'failed-precondition' });
  await f.api.send(f.request());
  await assert.rejects(f.api.authorize(f.request()), { code: 'failed-precondition' });
  await f.api.verify(f.request('owner', f.deliveries[0].code));
  const stale = f.request(); stale.auth.token.auth_time -= 301;
  await assert.rejects(f.api.authorize(stale), { code: 'failed-precondition' });
  const authorization = await f.api.authorize(f.request());
  assert.equal(authorization.uid, 'owner');
  await f.api.complete(authorization);
  await assert.rejects(f.api.authorize(f.request()), { code: 'failed-precondition' });
});

test('email handoff, rate limits and hashed storage never return or persist the OTP in plaintext', async () => {
  const f = fixture();
  const result = await f.api.send(f.request());
  assert.deepEqual(Object.keys(result).sort(), ['email', 'sent']);
  const stored = f.rows.get('accountDeletionChallenges/owner');
  assert.equal(stored.code, undefined);
  assert.equal(stored.codeHash.length, 64);
  assert.equal(stored.purgeAt.toMillis(), stored.expiresAt);
  await assert.rejects(f.api.send(f.request()), { code: 'resource-exhausted' });
  assert.equal(f.deliveries.length, 1);
});

test('mail failure never reports sent or leaves an authorized challenge', async () => {
  const f = fixture(); f.failEmail();
  await assert.rejects(f.api.send(f.request()), { code: 'unavailable' });
  assert.equal(f.rows.get('accountDeletionChallenges/owner').state, 'failed');
  await assert.rejects(f.api.authorize(f.request()), { code: 'failed-precondition' });
});

test('wrong codes commit attempts and parallel guesses lock after five attempts', async () => {
  const f = fixture(); await f.api.send(f.request());
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.api.verify(f.request('owner', '000000'))));
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(f.rows.get('accountDeletionChallenges/owner').attempts, 5);
  await assert.rejects(f.api.verify(f.request('owner', f.deliveries[0].code)), { code: 'resource-exhausted' });
});

test('codes are scoped to the authenticated identity, email, latest request and expiry', async () => {
  const f = fixture(); await f.api.send(f.request());
  const first = f.deliveries[0].code;
  await assert.rejects(f.api.verify(f.request('other', first)), { code: 'failed-precondition' });
  f.advance(60_001); await f.api.send(f.request());
  // Same six digits can occur by chance, so check old challenges by their ID.
  const newer = f.rows.get('accountDeletionChallenges/owner').id;
  await f.api.complete({ uid: 'owner', challengeId: 'old-id' });
  assert.equal(f.rows.get('accountDeletionChallenges/owner').id, newer);
  await f.api.verify(f.request('owner', f.deliveries.at(-1).code));
  f.changeEmail(); await assert.rejects(f.api.authorize(f.request()), { code: 'failed-precondition' });
  f.advance(600_001); await assert.rejects(f.api.verify(f.request('owner', first)), { code: 'failed-precondition' });
});

test('avatar cleanup uses caller UID and forwards auth only to the fixed Worker without redirects', async () => {
  const calls = [];
  await deleteLegacyAvatar({ auth: { uid: 'owner' }, data: { userId: 'victim' }, rawRequest: { headers: { authorization: 'Bearer test-only' } } }, async (url, options) => {
    calls.push({ url, options }); return { ok: false, status: 404 };
  });
  assert.equal(calls[0].url, 'https://campusmate-upload.comcamp.workers.dev/avatar/owner');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.method, 'DELETE');
  await assert.rejects(deleteLegacyAvatar({ auth: { uid: 'owner' } }), { code: 'unauthenticated' });
  await assert.rejects(deleteLegacyAvatar({ auth: { uid: 'owner' }, rawRequest: { headers: { authorization: 'Bearer test-only' } } }, async () => ({ ok: false, status: 503 })), { code: 'unavailable' });
});
