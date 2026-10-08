import assert from 'node:assert/strict';
import { test } from 'node:test';
// The root project is CommonJS; load the standalone Worker as ESM.
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
const { servePlacePhoto } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const url = `https://photos.example.com/places/spot-reservoir-heart/${'a'.repeat(64)}.webp`;

test('public photo GET caches once, HEAD and conditional GET reuse that object', async () => {
  let reads = 0; let cached = null; const pending = [];
  const cache = { match: async () => cached?.clone(), put: async (_key, response) => { cached = response; } };
  const env = { PLACE_PHOTOS: { get: async () => { reads++; return { body: new Uint8Array([1, 2]), size: 2, httpEtag: '"hash"' }; } } };
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const response = await servePlacePhoto(new Request(url), env, ctx, cache); await Promise.all(pending);
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /immutable/);
  assert.equal((await servePlacePhoto(new Request(`${url}?tracking=1`, { method: 'HEAD' }), env, ctx, cache)).status, 200);
  const unchanged = await servePlacePhoto(new Request(url, { headers: { 'If-None-Match': '"hash"' } }), env, ctx, cache);
  assert.equal(unchanged.status, 304); assert.equal(reads, 1);
});

test('worker never exposes uploads, chat objects, listings or cached missing objects', async () => {
  const cache = { match: async () => null, put: async () => { throw new Error('must not cache errors'); } };
  const env = { PLACE_PHOTOS: { get: async () => null } };
  const ctx = { waitUntil: () => { throw new Error('must not cache errors'); } };
  for (const path of ['/chat_media/private.enc', '/places/', '/places/spot-test/no-hash.webp']) {
    assert.equal((await servePlacePhoto(new Request(`https://photos.example.com${path}`), env, ctx, cache)).status, 404);
  }
  assert.equal((await servePlacePhoto(new Request(url, { method: 'PUT' }), env, ctx, cache)).status, 405);
  const missing = await servePlacePhoto(new Request(url), env, ctx, cache);
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('Cache-Control'), 'no-store');
});
