import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
function loadModule(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const names = [...source.matchAll(/export (?:async )?function\s+(\w+)|export const\s+(\w+)/g)].map((match) => match[1] || match[2]);
  const code = source.replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/^export\s*\{[^}]+\}(?:\s*from\s*[^;]+)?;?\s*$/gm, '')
    .replace(/\bexport (?=(?:async )?function|const)/g, '');
  const context = { ...dependencies, Uint8Array, Array, Date, Map, Promise, URL, process: dependencies.process || { env: {} }, setTimeout, clearTimeout,
    console: { info() {}, warn() {} }, exports: {} };
  vm.runInNewContext(`${code}\nObject.assign(exports, {${names.join(',')}});`, context, { filename: relative });
  return context.exports;
}

const policy = loadModule('src/utils/imagePolicy.js');
const key = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(8);

test('image resize bounds portrait/landscape and does not upscale', () => {
  assert.equal(JSON.stringify(policy.imageResizeActions(2000, 4000, 1440)), '[{"resize":{"height":1440}}]');
  assert.equal(JSON.stringify(policy.imageResizeActions(4000, 2000, 1440)), '[{"resize":{"width":1440}}]');
  assert.equal(policy.imageResizeActions(300, 500, 1440).length, 0);
});

test('version URL survives prefetch and keeps signed URLs unchanged', () => {
  const url = 'https://cdn.example/avatar.jpg?foo=1&cmv=100#photo';
  const versioned = policy.getRemoteImageRequestUrl(url, { seconds: 2, nanoseconds: 1000000 });
  assert.equal(versioned, 'https://cdn.example/avatar.jpg?foo=1&cmv=2001#photo');
  assert.equal(policy.getRemoteImageRequestUrl(versioned), versioned);
  assert.equal(policy.getRemoteImageRequestUrl('https://cdn.example/photo.jpg?X-Amz-Signature=secret', 9), 'https://cdn.example/photo.jpg?X-Amz-Signature=secret');
  assert.notEqual(policy.getRemoteImageRequestUrl(url, 1), policy.getRemoteImageRequestUrl(url, 2));
});

test('avatar CDN mapping is opt in and limited to the verified legacy bucket', () => {
  const url = 'https://pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev/users/alice/avatar.jpg?cmv=7';
  assert.equal(policy.rewriteProfileImageUrl(url), url);
  assert.equal(policy.rewriteProfileImageUrl(url, 'images.getcampusmate.app'), 'https://images.getcampusmate.app/users/alice/avatar.jpg?cmv=7');
  assert.equal(policy.rewriteProfileImageUrl('https://other.r2.dev/users/alice/avatar.jpg', 'images.getcampusmate.app'), 'https://other.r2.dev/users/alice/avatar.jpg');
  assert.equal(policy.rewriteProfileImageUrl(url, 'images.example/path'), url);
});

test('avatar ownership recognizes only the exact configured CDN host', () => {
  const host = 'images.getcampusmate.app';
  assert.equal(policy.getR2AvatarOwnerId(`https://${host}/users/alice/avatar.jpg?cmv=7`, host), 'alice');
  assert.equal(policy.getR2AvatarOwnerId(`https://${host}/users/bob/avatar.jpg`, host), 'bob');
  assert.equal(policy.getR2AvatarOwnerId(`https://${host}.evil.example/users/alice/avatar.jpg`, host), null);
  assert.equal(policy.getR2AvatarOwnerId(`https://other.example/users/alice/avatar.jpg`, host), null);
  assert.equal(policy.getR2AvatarOwnerId(`https://${host}/users/alice/avatar.jpg`), null);
  assert.equal(policy.getR2AvatarOwnerId('https://pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev/users/alice/avatar.jpg', host), 'alice');
});

function mediaFixture({ failEncryption = false, failModeration = false } = {}) {
  const files = new Map([['file:///original.jpg', { data: Buffer.from('image').toString('base64'), size: 5 }]]);
  const counters = { downloads: 0, uploads: 0, sign: 0, encrypt: 0, moderation: 0 };
  const FileSystem = {
    cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' }, FileSystemUploadType: { BINARY_CONTENT: 0 },
    async getInfoAsync(uri) { return files.has(uri) ? { exists: true, size: files.get(uri).size } : { exists: false }; },
    async makeDirectoryAsync(uri) { files.set(uri, { size: 0 }); },
    async downloadAsync(url, uri) {
      counters.downloads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const data = url.includes('broken') ? Buffer.from('partial') : Buffer.from([7, 1, 2, 3]);
      files.set(uri, { data: data.toString('base64'), size: data.length });
      return { status: url.includes('broken') ? 503 : 200, uri };
    },
    async writeAsStringAsync(uri, data) { files.set(uri, { data, size: Buffer.from(data, 'base64').length }); },
    async readAsStringAsync(uri) { if (!files.has(uri)) throw new Error('missing'); return files.get(uri).data; },
    async moveAsync({ from, to }) { files.set(to, files.get(from)); files.delete(from); },
    async deleteAsync(uri) { files.delete(uri); },
    async readDirectoryAsync(uri) { return [...files.keys()].filter((name) => name.startsWith(uri)).map((name) => name.slice(uri.length)).filter(Boolean); },
    async uploadAsync(_url, _uri, options) { counters.uploads += 1; counters.headers = options.headers; return { status: 200 }; },
  };
  const dependencies = {
    ...policy, FileSystem, Platform: { OS: 'android' },
    Crypto: { CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_, value) => createHash('sha256').update(value).digest('hex') },
    compressUploadImage: async (uri) => ({ uri }), validateChatVideo() {}, requireFirebase: () => ({ app: {} }),
    verifyImageSafety: async () => { counters.moderation += 1; if (failModeration) throw new Error('unsafe'); },
    bytesToBase64: (bytes) => Buffer.from(bytes).toString('base64'), base64ToBytes: (value) => new Uint8Array(Buffer.from(value, 'base64')),
    encryptMediaBytes: (bytes, activeKey) => { counters.encrypt += 1; if (failEncryption) throw new Error('encrypt failed'); return new Uint8Array([activeKey[0], ...bytes]); },
    decryptMediaBytes: (bytes, activeKey) => { if (bytes[0] !== activeKey[0]) throw new Error('wrong key'); return bytes.slice(1); },
    getFunctions: () => ({}), httpsCallable: () => async (request) => {
      counters.sign += 1;
      counters.request = request;
      return { data: { success: true, uploadUrl: 'https://put.example/', downloadUrl: 'https://cdn.example/new.enc',
        uploadHeaders: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } } };
    },
  };
  return { service: loadModule('src/services/chatMediaService.js', dependencies), files, counters, dependencies };
}

test('concurrent decrypted image loads share one download and reuse disk after restart', async () => {
  const fixture = mediaFixture();
  const url = 'https://cdn.example/photo.enc';
  const uris = await Promise.all(Array.from({ length: 12 }, () => fixture.service.getDecryptedMediaUri(url, { conversationKey: key })));
  assert.equal(new Set(uris).size, 1);
  assert.match(uris[0], /^file:\/\/\/cache\/decrypted_media\/[a-f0-9]{64}-[a-f0-9]{64}\.jpg$/);
  assert.equal(fixture.counters.downloads, 1);
  const restarted = loadModule('src/services/chatMediaService.js', fixture.dependencies);
  assert.equal(await restarted.getDecryptedMediaUri(url, { conversationKey: key }), uris[0]);
  assert.equal(fixture.counters.downloads, 1);
  assert.equal(fixture.service.getSyncCachedMediaUri(url), null);
  assert.equal(fixture.service.getSyncCachedMediaUri(url, 'image', otherKey), null);
  assert.equal(await fixture.service.getDecryptedMediaUri(url), null);
  assert.equal(await fixture.service.getDecryptedMediaUri(url, { conversationKey: otherKey }), null);
});

test('failed legacy download cannot leave a reusable partial file', async () => {
  const fixture = mediaFixture();
  assert.equal(await fixture.service.getDecryptedMediaUri('https://cdn.example/broken.jpg'), null);
  assert.equal([...fixture.files.keys()].filter((name) => name.includes('decrypted_media/') && /\.jpg/.test(name)).length, 0);
});

test('upload uses v2 signed headers and does not send plaintext after encryption failure', async () => {
  const good = mediaFixture();
  await good.service.uploadChatMedia('file:///original.jpg', { conversationId: 'room', conversationKey: key });
  assert.equal(good.counters.request.uploadProtocolVersion, 2);
  assert.equal(good.counters.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(good.counters.request.extension, 'enc');
  const failed = mediaFixture({ failEncryption: true });
  await assert.rejects(failed.service.uploadChatMedia('file:///original.jpg', { conversationId: 'room', conversationKey: key }), /encrypt failed/);
  assert.equal(failed.counters.uploads, 0);
  const unsafe = mediaFixture({ failModeration: true });
  await assert.rejects(unsafe.service.uploadChatMedia('file:///original.jpg', { conversationId: 'room', conversationKey: key }), /unsafe/);
  assert.equal(unsafe.counters.encrypt, 0);
  assert.equal(unsafe.counters.uploads, 0);
  await assert.rejects(good.service.uploadChatMedia('file:///original.jpg', { conversationId: 'room' }), /กุญแจ/);
});

test('iOS avatar prefetch deduplicates and reuses expo-image disk cache', async () => {
  let diskPath = null;
  let requests = 0;
  const fixture = loadModule('src/utils/useRemoteImage.js', {
    ...policy, Platform: { OS: 'ios' },
    Image: { getCachePathAsync: async () => diskPath,
      prefetch: async () => { requests += 1; await new Promise((resolve) => setTimeout(resolve, 5)); diskPath = '/native-cache/avatar'; return true; } },
    FileSystem: { getInfoAsync: async () => ({ exists: true }) },
  });
  const results = await Promise.all([fixture.prefetchRemoteImage('https://cdn.example/avatar.jpg', 9), fixture.prefetchRemoteImage('https://cdn.example/avatar.jpg', 9)]);
  assert.equal(results[0], 'file:///native-cache/avatar');
  assert.equal(results[0], results[1]);
  await fixture.prefetchRemoteImage('https://cdn.example/avatar.jpg', 9);
  assert.equal(requests, 1);
});

test('visible images get the CDN/version URL synchronously without a file download', () => {
  const api = loadModule('src/utils/useRemoteImage.js', {
    ...policy, process: { env: { EXPO_PUBLIC_PROFILE_CDN_DOMAIN: 'images.getcampusmate.app' } },
    Image: new Proxy({}, { get() { throw new Error('visible image must not wait for native disk IO'); } }),
  });
  const url = 'https://pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev/users/alice/avatar.jpg';
  assert.equal(api.getImageRequestUri(url, 25), 'https://images.getcampusmate.app/users/alice/avatar.jpg?cmv=25');
  assert.equal(api.getImageRequestUri('file:///picked.jpg', 25), 'file:///picked.jpg');
  assert.equal(api.getImageRequestUri('content://picked/1'), 'content://picked/1');
  assert.equal(api.getImageRequestUri(null), null);
  assert.equal(api.getImageRequestUri('https://cdn.example/a?X-Amz-Signature=secret', 25), 'https://cdn.example/a?X-Amz-Signature=secret');
});

test('revoking an image access scope prevents an in-flight prefetch from returning a stale file URI', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  let path = null;
  const fixture = loadModule('src/utils/useRemoteImage.js', {
    ...policy,
    Image: { getCachePathAsync: async () => path, prefetch: async () => { await pending; path = '/private/old.jpg'; return true; } },
    FileSystem: { getInfoAsync: async () => ({ exists: true }) },
  });
  const stale = fixture.prefetchRemoteImage('https://cdn.example/private.jpg');
  await Promise.resolve(); await Promise.resolve();
  const clearing = fixture.clearRemoteImageReferences();
  finish();
  assert.equal(await stale, null);
  await clearing;
});

test('profile lookahead is bounded, uses display cache keys and stops scheduling after unmount', async () => {
  let cleanup, active = 0, peak = 0;
  const requested = [];
  const paths = new Map();
  const api = loadModule('src/utils/useRemoteImage.js', {
    ...policy, useEffect: (effect) => { cleanup = effect(); },
    Image: {
      getCachePathAsync: async (url) => paths.get(url),
      prefetch: async (url, cache) => {
        assert.equal(cache, 'memory-disk'); requested.push(url); peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        paths.set(url, '/cache/' + requested.length); active--; return true;
      },
    }, FileSystem: { getInfoAsync: async () => ({ exists: true }) },
  });
  const profiles = Array.from({ length: 100 }, (_, id) => ({ avatarUri: `https://cdn.example/${id}.jpg`, updatedAt: 9, avatarRevision: 7 }));
  api.useProfileImagePrefetch(profiles);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(requested.length, 3); assert.equal(peak, 2);
  assert.equal(requested[0], api.getImageRequestUri(profiles[0].avatarUri, profiles[0].avatarRevision));
  requested.length = 0;
  api.useProfileImagePrefetch(profiles.slice(3));
  await Promise.resolve(); await Promise.resolve(); cleanup();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(requested.length <= 2);
});

test('preview warms only ordinary image media, skips disappearing media and bounds the lookahead', () => {
  const api = loadModule('src/services/chatPreviewMedia.js');
  const urls = api.getPreviewImageUrls([
    { mediaUrl: 'https://cdn.example/old.enc', mediaType: 'image' },
    { mediaUrl: 'https://cdn.example/current.enc', mediaUrls: ['https://cdn.example/current.enc', 'https://cdn.example/second.enc'], mediaType: 'image' },
    { mediaUrl: 'https://cdn.example/once.enc', viewMode: 'once' },
    { mediaUrl: 'https://cdn.example/replay.enc', viewMode: 'replay' },
    { mediaUrl: 'https://cdn.example/video.enc', mediaType: 'video' },
    { mediaUrl: 'https://cdn.example/audio.enc', audioUrl: 'https://cdn.example/audio.enc' },
    { mediaUrl: 'https://cdn.example/deleted.enc', isDeleted: true },
  ]);
  assert.equal(JSON.stringify(urls), '["https://cdn.example/current.enc","https://cdn.example/second.enc"]');
});

test('press-in preview and mounted encrypted image share one download and a key scoped to the account', async () => {
  const fixture = mediaFixture(); let keyReads = 0;
  const preview = loadModule('src/services/chatPreviewMedia.js', {
    ...policy, getDecryptedMediaUri: fixture.service.getDecryptedMediaUri,
    peekCachedConversationKey: () => null,
    getOrFetchConversationKey: async (room, uid) => { assert.equal(room, 'room'); assert.equal(uid, 'alice'); keyReads++; return key; },
  });
  const room = { id: 'room', messages: [{ mediaUrl: 'https://cdn.example/current.enc', mediaType: 'image' }] };
  await Promise.all([preview.warmChatPreviewMedia(room, 'alice'), preview.warmChatPreviewMedia(room, 'alice')]);
  assert.equal(keyReads, 1); assert.equal(fixture.counters.downloads, 1);
  await fixture.service.getDecryptedMediaUri(room.messages[0].mediaUrl, { conversationKey: key });
  assert.equal(fixture.counters.downloads, 1);
  assert.equal(fixture.service.getSyncCachedMediaUri(room.messages[0].mediaUrl, 'image', otherKey), null);
});

test('switching a recycled encrypted image hides the old URI and keeps the new image loading', async () => {
  const slots = []; let cursor = 0, effect, deps, cleanup;
  const api = loadModule('src/hooks/useDecryptedMedia.js', {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useCallback: (callback) => callback,
    useEffect: (callback, next) => { if (!deps || next.some((value, i) => value !== deps[i])) { effect = callback; deps = next; } },
    getSyncCachedMediaUri: () => null,
    getDecryptedMediaUri: async (url) => `file:///cache/${url.endsWith('a.enc') ? 'a' : 'b'}.jpg`,
  });
  function render(url) { cursor = 0; return api.useDecryptedMedia(url, { conversationKey: key, conversationId: 'room', currentUserId: 'alice' }); }
  render('https://cdn.example/a.enc'); cleanup = effect(); effect = null;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(render('https://cdn.example/a.enc').uri, 'file:///cache/a.jpg');
  const next = render('https://cdn.example/b.enc');
  assert.equal(next.uri, null); assert.equal(next.loading, true); assert.equal(next.error, null);
  cleanup(); cleanup = effect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(render('https://cdn.example/b.enc').uri, 'file:///cache/b.jpg'); cleanup();
});
