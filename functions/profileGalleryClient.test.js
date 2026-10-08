import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/profileGalleryService.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\r?\n/gm, '').replace(/^export /gm, '');

function client({ data = { userId: 'owner', url: 'https://example.test/gallery.jpg' }, error } = {}) {
  const calls = { reads: [], payloads: [], callable: [] };
  const context = vm.createContext({
    FileSystem: { EncodingType: { Base64: 'base64' }, readAsStringAsync: async (uri) => { calls.reads.push(uri); return '/9j/2Q=='; } },
    requireFirebase: () => ({ app: {} }),
    getFunctions: (_, region) => ({ region }),
    httpsCallable: (functions, name) => {
      calls.callable.push({ region: functions.region, name });
      return async (payload) => { calls.payloads.push(payload); if (error) throw error; return { data }; };
    },
  });
  vm.runInContext(source, context);
  return { upload: context.uploadGalleryImage, calls };
}

test('gallery client reads local images and sends image bytes without a client-selected UID', async () => {
  const { upload, calls } = client();
  assert.equal(await upload('file:///gallery.jpg', 'owner'), 'https://example.test/gallery.jpg');
  assert.deepEqual(calls.reads, ['file:///gallery.jpg']);
  assert.deepEqual(Object.keys(calls.payloads[0]), ['imageBase64']);
  assert.equal(calls.payloads[0].imageBase64, '/9j/2Q==');
  assert.deepEqual(calls.callable, [{ region: 'asia-southeast1', name: 'uploadProfileGalleryImage' }]);
});

test('gallery client supports processed JPEG data URIs', async () => {
  const { upload, calls } = client();
  await upload('data:image/jpeg;base64,/9j/2Q==', 'owner');
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.payloads[0].imageBase64, '/9j/2Q==');
});

test('gallery client rejects foreign account responses and unsafe URLs', async () => {
  for (const data of [{ userId: 'other', url: 'https://example.test/photo.jpg' }, { userId: 'owner', url: 'http://example.test/photo.jpg' }, null]) {
    await assert.rejects(client({ data }).upload('file:///gallery.jpg', 'owner'));
  }
});

test('gallery client preserves moderation errors for the editor notice', async () => {
  for (const status of ['blocked', 'unavailable']) {
    const error = Object.assign(new Error('Moderation failed'), { details: { moderationStatus: status, reason: 'adult' } });
    await assert.rejects(client({ error }).upload('file:///gallery.jpg', 'owner'), (caught) => caught === error
      && (status === 'blocked' ? caught.isModerationViolation && caught.reason === 'adult' : caught.isModerationUnavailable));
  }
});
