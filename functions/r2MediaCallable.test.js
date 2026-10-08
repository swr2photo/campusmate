import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createR2WorkerUpload } from './r2UploadTicket.js';
import { getChatMediaCacheControl, ENCRYPTED_MEDIA_CACHE_CONTROL, LEGACY_MEDIA_CACHE_CONTROL } from './r2Service.js';

// Exercise the real authorization/signing boundary without initializing Admin
// or making network requests. The SDK signing contract is covered separately.
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function makeCallable({ name, members = ['member'], rekeyRequired = false, worker = false, secret = 'test-signing-key-with-at-least-32-characters' } = {}) {
  const start = source.indexOf(`export const ${name} = onCall(`);
  const end = source.indexOf(name === 'uploadChatMedia' ? '/**\n * getR2ChatUploadUrl' : 'let visionClientInstance', start);
  const calls = { sign: [], saves: [], tickets: [] };
  let handler;
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const context = vm.createContext({
    onCall: (_options, callback) => { handler = callback; },
    HttpsError,
    REGION: 'asia-southeast1',
    R2_FUNCTION_SECRETS: [],
    Buffer,
    crypto: { randomUUID: () => 'token', randomBytes: () => ({ toString: () => 'random' }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    process: { env: worker ? { CAMPUSMATE_R2_WORKER_ENABLED: 'true', CAMPUSMATE_R2_WORKER_DOMAIN: 'https://media.example.test', R2_UPLOAD_SIGNING_KEY: secret } : {} },
    createR2WorkerUpload: (options) => { calls.tickets.push(options); return createR2WorkerUpload(options); },
    db: { collection: () => ({ doc: () => ({ get: async () => ({
      exists: true,
      data: () => ({ memberIds: members, participants: members }),
      get: () => rekeyRequired,
    }) }) }) },
    isR2Configured: () => true,
    getR2Config: () => ({ publicDomain: 'https://media.example.test', bucketName: 'chat', deliveryMode: 'cdn' }),
    generateR2ObjectKey: () => 'chat_media/room/immutable.enc',
    getR2S3Client: () => ({}),
    generateR2UploadPresignedUrl: async (_client, options) => { calls.sign.push(options); return 'https://signed.example.test'; },
    buildR2DownloadUrl: () => 'https://media.example.test/chat_media/room/immutable.enc',
    getChatMediaCacheControl,
    getStorage: () => ({ bucket: () => ({
      name: 'firebase-bucket',
      file: () => ({ save: async (_bytes, options) => { calls.saves.push(options); } }),
    }) }),
  });
  vm.runInContext(source.slice(start, end).replace('export const', 'const'), context);
  return { handler, calls };
}

const encryptedRequest = {
  auth: { uid: 'member' },
  data: { groupChatId: 'party', mediaType: 'image', extension: 'enc',
    contentType: 'application/octet-stream', uploadProtocolVersion: 2 },
};

test('v2 response returns exactly the signed upload headers', async () => {
  const { handler, calls } = makeCallable({ name: 'getR2ChatUploadUrl' });
  const response = await handler(encryptedRequest);
  assert.equal(response.uploadHeaders['Content-Type'], calls.sign[0].contentType);
  assert.equal(response.uploadHeaders['Cache-Control'], calls.sign[0].cacheControl);
  assert.equal(response.uploadHeaders['Cache-Control'], ENCRYPTED_MEDIA_CACHE_CONTROL);
  assert.equal(response.downloadUrl.startsWith('https://media.example.test/'), true);
});

test('v1 clients require no new PUT headers', async () => {
  const { handler, calls } = makeCallable({ name: 'getR2ChatUploadUrl' });
  const response = await handler({ ...encryptedRequest, data: { ...encryptedRequest.data, uploadProtocolVersion: undefined } });
  assert.equal(response.uploadHeaders['Cache-Control'], undefined);
  assert.equal(calls.sign[0].cacheControl, undefined);
});

test('plaintext legacy uploads cannot request shared CDN cache', async () => {
  const { handler, calls } = makeCallable({ name: 'getR2ChatUploadUrl' });
  await handler({ auth: { uid: 'member' }, data: { conversationId: 'room', mediaType: 'image',
    extension: 'jpg', contentType: 'image/jpeg', uploadProtocolVersion: 2 } });
  assert.equal(calls.sign[0].cacheControl, LEGACY_MEDIA_CACHE_CONTROL);
});

test('group membership, encryption and rotation guards run before signing', async () => {
  for (const scenario of [{ members: ['someone-else'], request: encryptedRequest, code: 'permission-denied' },
    { rekeyRequired: true, request: encryptedRequest, code: 'permission-denied' },
    { request: { ...encryptedRequest, auth: null }, code: 'unauthenticated' },
    { request: { ...encryptedRequest, data: { ...encryptedRequest.data, extension: 'jpg', contentType: 'image/jpeg' } }, code: 'invalid-argument' }]) {
    const { handler, calls } = makeCallable({ name: 'getR2ChatUploadUrl', ...scenario });
    await assert.rejects(handler(scenario.request), (error) => error.code === scenario.code);
    assert.equal(calls.sign.length, 0);
  }
});

test('Firebase callable fallback stores the same ciphertext cache metadata', async () => {
  const { handler, calls } = makeCallable({ name: 'uploadChatMedia' });
  await handler({ ...encryptedRequest, data: { ...encryptedRequest.data, base64Data: 'AQID' } });
  assert.equal(calls.saves[0].metadata.cacheControl, ENCRYPTED_MEDIA_CACHE_CONTROL);
});

test('Worker ticket is issued only for authorized protocol 2 ciphertext', async () => {
  const { handler, calls } = makeCallable({ name: 'getR2ChatUploadUrl', worker: true });
  const response = await handler(encryptedRequest);
  assert.equal(response.uploadUrl, 'https://media.example.test/upload/chat_media/room/immutable.enc');
  assert.match(response.uploadHeaders.Authorization, /^Bearer [\w-]+\.[\w-]+$/);
  assert.equal(response.uploadHeaders['Cache-Control'], 'no-store');
  assert.equal(calls.tickets.length, 1);
  assert.equal(calls.sign.length, 0);
  for (const scenario of [{ members: ['someone-else'], code: 'permission-denied' },
    { rekeyRequired: true, code: 'permission-denied' }]) {
    const guarded = makeCallable({ name: 'getR2ChatUploadUrl', worker: true, ...scenario });
    await assert.rejects(guarded.handler(encryptedRequest), (error) => error.code === scenario.code);
    assert.equal(guarded.calls.tickets.length, 0);
  }
});

test('Worker secret failure falls back to Firebase and old clients retain the existing route', async () => {
  const broken = makeCallable({ name: 'getR2ChatUploadUrl', worker: true, secret: '' });
  assert.equal((await broken.handler(encryptedRequest)).provider, 'firebase');
  assert.equal(broken.calls.sign.length, 0);
  const old = makeCallable({ name: 'getR2ChatUploadUrl', worker: true });
  await old.handler({ ...encryptedRequest, data: { ...encryptedRequest.data, uploadProtocolVersion: undefined } });
  assert.equal(old.calls.tickets.length, 0);
  assert.equal(old.calls.sign.length, 1);
});
