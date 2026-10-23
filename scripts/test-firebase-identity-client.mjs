import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirebaseIdentityClient } from '../src/services/firebaseIdentityProtocol.mjs';

test('Firebase identity client cannot send a token to business routes, redirects or untrusted origins', async () => {
  for (const origin of ['http://example.test', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?x=y']) {
    assert.throws(() => createFirebaseIdentityClient({ origin }));
  }
  let calls = 0;
  const client = createFirebaseIdentityClient({ origin: 'https://identity.example.test', getIdToken: async () => 'synthetic-token', fetch: async () => { calls++; } });
  for (const path of ['/v1/auth/me', '/v1/admin/identity-reviews', '/v1/identity/../auth/me', '//other.test', '/v1/identity/%2e%2e/auth']) {
    await assert.rejects(client.request(path));
  }
  assert.equal(calls, 0);
});
test('fresh auth token is requested each time and only safe server errors are returned', async () => {
  let calls = 0;
  const client = createFirebaseIdentityClient({ origin: 'https://identity.example.test', getIdToken: async () => `synthetic-${++calls}`,
    fetch: async (url, options) => {
      assert.equal(url, 'https://identity.example.test/v1/identity/photo-verification');
      assert.equal(options.headers.Authorization, `Bearer synthetic-${calls}`);
      assert.equal(options.redirect, 'error');
      return { ok: false, json: async () => ({ error: { code: 'permission-denied', details: { reason: 'EMAIL_NOT_VERIFIED' } } }) };
    } });
  await assert.rejects(client.request('/v1/identity/photo-verification'), e => e.details.reason === 'EMAIL_NOT_VERIFIED');
  await assert.rejects(client.request('/v1/identity/photo-verification'));
  assert.equal(calls, 2);
});

test('a server result arriving after an account change is discarded', async () => {
  let subject = 'alice';
  const client = createFirebaseIdentityClient({ origin: 'https://identity.example.test', getUserId: () => subject,
    getIdToken: async () => 'synthetic-token', fetch: async () => {
      subject = 'bob';
      return { ok: true, json: async () => ({ status: 'VERIFIED', badge: 'PHOTO_VERIFIED' }) };
    } });
  await assert.rejects(client.request('/v1/identity/photo-verification'), e => e.code === 'account-changed');
});

test('request cancellation aborts fetch and exposes only CANCELLED', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let requestSignal;
  const client = createFirebaseIdentityClient({ origin: 'https://identity.example.test', getIdToken: async () => 'synthetic-token',
    fetch: async (_url, options) => {
      requestSignal = options.signal;
      started();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } });
  const request = client.request('/v1/identity/photo-verification', { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(request, (error) => error.code === 'CANCELLED');
  assert.equal(requestSignal.aborted, true);
});

test('cancelling while fetching the auth token never transmits it', async () => {
  const controller = new AbortController();
  let fetches = 0;
  const client = createFirebaseIdentityClient({ origin: 'https://identity.example.test',
    getIdToken: async () => { controller.abort(); return 'synthetic-token'; }, fetch: async () => { fetches += 1; } });
  await assert.rejects(client.request('/v1/identity/photo-verification', { signal: controller.signal }), (error) => error.code === 'CANCELLED');
  assert.equal(fetches, 0);
});
