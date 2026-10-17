import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Every exported function loads index.js on a cold start. SDKs that only a
// few handlers need must load on first use so the rest do not pay for them.
test('loading index.js does not load the Vision or Expo push SDKs', async () => {
  await import('./index.js');
  const loaded = Object.keys(createRequire(import.meta.url).cache);
  assert.ok(loaded.some((path) => path.includes('@google-cloud/firestore')), 'module cache is observable');
  for (const sdk of ['@google-cloud/vision', 'expo-server-sdk']) {
    assert.equal(loaded.some((path) => path.includes(`node_modules/${sdk}/`)), false, `${sdk} loads lazily`);
  }
});
