import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2WorkerUpload } from '../../functions/r2UploadTicket.js';
import { handleMedia, verifyUploadTicket } from './index.js';
import { createDeleteTicket } from '../../functions/adminModeration.js';

const key = 'chat_media/party/1700000000_test.enc';
const secret = 'a-test-only-key-with-at-least-32-characters';
const domain = 'https://media.example.test';
function setup() {
  const objects = new Map();
  let reads = 0;
  const cached = new Map();
  const tasks = [];
  const ctx = { waitUntil: (task) => tasks.push(task) };
  const env = { R2_UPLOAD_SIGNING_KEY: secret, ALLOWED_ORIGINS: 'https://getcampusmate.app', MEDIA: {
    async put(path, bytes, options) {
      if (objects.has(path) && options?.onlyIf?.get('If-None-Match') === '*') return null;
      objects.set(path, { bytes, size: bytes.byteLength, httpEtag: '"test-etag"', uploaded: new Date(), httpMetadata: options?.httpMetadata });
      return objects.get(path);
    },
    async get(path) { reads += 1; const value = objects.get(path); return value && { ...value, range: { offset: 0, length: value.size }, body: new Response(value.bytes).body }; },
    async head(path) { return objects.get(path); },
    async delete(path) { objects.delete(path); },
  } };
  const cache = {
    async put(request, response) { cached.set(request.url, new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers })); },
    async match(request) { return cached.get(request.url)?.clone(); },
    async delete(request) { return cached.delete(request.url); },
  };
  return { env, ctx, cache, objects, tasks, reads: () => reads };
}
function signedUpload(overrides = {}) {
  const signed = createR2WorkerUpload({ domain, secret, objectKey: key });
  return new Request(signed.uploadUrl, { method: 'PUT', body: new Uint8Array(100), headers: signed.uploadHeaders, ...overrides });
}

test('signed deletion removes R2, bypasses remote cached copies, rejects uploads and is retryable', async () => {
  const { env, ctx, cache, objects, tasks } = setup();
  await handleMedia(signedUpload(), env, ctx, cache);
  const cached = await handleMedia(new Request(`${domain}/${key}`), env, ctx, cache);
  await cached.arrayBuffer(); await Promise.all(tasks);
  const remoteCache = { match: async () => new Response('old ciphertext') };
  const remove = token => new Request(`${domain}/moderate/${key}`, { method: 'DELETE', headers: { Authorization: 'Bearer '+token } });
  const uploadToken = createR2WorkerUpload({ domain, secret, objectKey:key }).uploadHeaders.Authorization.slice(7);
  assert.equal((await handleMedia(remove(uploadToken),env,ctx,cache)).status,403);
  assert.equal((await handleMedia(remove(createDeleteTicket(key,secret+'wrong')),env,ctx,cache)).status,403);
  const token = createDeleteTicket(key,secret);
  assert.equal(await verifyUploadTicket(token,key,secret),null);
  assert.equal((await handleMedia(remove(token),env,ctx,cache)).status,204);
  assert.equal(objects.has(key),false);
  assert.equal((await handleMedia(new Request(`${domain}/${key}`),env,ctx,remoteCache)).status,404);
  assert.equal((await handleMedia(signedUpload(),env,ctx,cache)).status,410);
  assert.equal((await handleMedia(remove(token),env,ctx,cache)).status,204);
  assert.equal((await handleMedia(remove(createDeleteTicket(key,secret,Date.now()-301000)),env,ctx,cache)).status,403);
});

test('Firebase ticket interoperates with Web Crypto and rejects forged, expired and wrong-path capabilities', async () => {
  const now = Date.now();
  const signed = createR2WorkerUpload({ domain, secret, objectKey: key, now });
  const ticket = signed.uploadHeaders.Authorization.slice(7);
  assert.ok(await verifyUploadTicket(ticket, key, secret, now));
  assert.equal(await verifyUploadTicket(ticket, key.replace('party', 'other'), secret, now), null);
  assert.equal(await verifyUploadTicket(ticket, key, `${secret}wrong`, now), null);
  assert.equal(await verifyUploadTicket(ticket, key, secret, now + 301000), null);
  assert.throws(() => createR2WorkerUpload({ domain, secret, objectKey: '../plaintext.jpg' }));
});

test('unsigned, plaintext, oversized and incomplete uploads never write R2', async () => {
  const { env, ctx, cache, objects } = setup();
  const cases = [
    new Request(`${domain}/upload/${key}`, { method: 'PUT', body: 'bad' }),
    signedUpload({ headers: { ...createR2WorkerUpload({ domain, secret, objectKey: key }).uploadHeaders, 'Content-Type': 'image/jpeg' } }),
    signedUpload({ headers: { ...createR2WorkerUpload({ domain, secret, objectKey: key }).uploadHeaders, 'Content-Length': '99999999' } }),
    signedUpload({ body: new Uint8Array(2) }),
    signedUpload({ headers: { ...createR2WorkerUpload({ domain, secret, objectKey: key }).uploadHeaders, 'Content-Length': '101' } }),
  ];
  for (const request of cases) assert.ok((await handleMedia(request, env, ctx, cache)).status >= 400);
  assert.equal(objects.size, 0);
});

test('immutable uploads cannot be overwritten and cached ciphertext GETs do not read R2 again', async () => {
  const setupState = setup();
  const { env, ctx, cache, tasks, objects } = setupState;
  assert.equal((await handleMedia(signedUpload(), env, ctx, cache)).status, 201);
  assert.equal((await handleMedia(signedUpload(), env, ctx, cache)).status, 409);
  assert.equal(objects.get(key).httpMetadata.cacheControl, 'public, max-age=31536000, immutable');
  const first = await handleMedia(new Request(`${domain}/${key}`), env, ctx, cache);
  assert.equal(first.status, 200, 'R2 full-object range metadata must not turn ordinary GET into 206');
  assert.equal(first.headers.get('X-CampusMate-Cache'), 'MISS');
  assert.equal((await first.arrayBuffer()).byteLength, 100);
  await Promise.all(tasks);
  const second = await handleMedia(new Request(`${domain}/${key}?cmv=123`), env, ctx, cache);
  assert.equal(second.headers.get('X-CampusMate-Cache'), 'HIT');
  assert.equal(setupState.reads(), 1);
  assert.equal((await second.arrayBuffer()).byteLength, 100);
});

test('plaintext objects, unrelated paths and missing objects are never delivered or cached', async () => {
  const { env, ctx, cache, objects, tasks } = setup();
  objects.set(key, { httpMetadata: { contentType: 'image/jpeg' } });
  for (const path of [key, 'users/u/avatar.jpg', 'chat_media/party/plaintext.jpg', 'chat_media/party/missing.enc']) {
    const response = await handleMedia(new Request(`${domain}/${path}`), env, ctx, cache);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(tasks.length, 0);
});

test('CORS responses are isolated from cached objects and reject unknown origins', async () => {
  const { env, ctx, cache, tasks } = setup();
  await handleMedia(signedUpload(), env, ctx, cache);
  const first = await handleMedia(new Request(`${domain}/${key}`, { headers: { Origin: 'https://getcampusmate.app' } }), env, ctx, cache);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://getcampusmate.app');
  await first.arrayBuffer();
  await Promise.all(tasks);
  const second = await handleMedia(new Request(`${domain}/${key}`), env, ctx, cache);
  assert.equal(second.headers.get('Access-Control-Allow-Origin'), null);
  const bad = await handleMedia(new Request(`${domain}/${key}`, { headers: { Origin: 'https://unknown.test' } }), env, ctx, cache);
  assert.equal(bad.status, 403);
});
