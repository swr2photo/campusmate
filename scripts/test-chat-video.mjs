import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const policy = await import('../src/utils/chatVideoPolicy.js');
const { chatPreviewText } = await import('../src/utils/chatPreviewText.js');
assert.equal(chatPreviewText(null, '[วิดีโอ]'), 'วิดีโอ');
for (const mode of ['once', 'replay', 'chat']) {
  assert.equal(chatPreviewText({ mediaType: 'video', videoMode: mode, text: '[วิดีโอ]' }), `วิดีโอ · ${policy.VIDEO_MODES[mode]}`);
  assert.equal(chatPreviewText({ mediaType: 'video', videoMode: mode, text: 'ทดสอบ' }), `วิดีโอ · ${policy.VIDEO_MODES[mode]}: ทดสอบ`);
}
assert.equal(chatPreviewText({ text: 'สวัสดี' }), 'สวัสดี');
for (const path of ['src/components/InstagramMessageOverlay.js', 'src/components/ChatPreviewModal.js', 'src/screens/ChatScreen.js', 'src/screens/ChatScreen.ios.js']) {
  babel.parseSync(readFileSync(path, 'utf8'), { babelrc: false, configFile: false, parserOpts: { sourceType: 'module', plugins: ['jsx'] } });
}
const asset = { uri: 'file:///clip.mp4', duration: 60000, fileSize: 1024 };
for (const mode of ['once', 'replay', 'chat']) assert.equal(policy.validateChatVideo(asset, mode), asset);
for (const duration of [60001, 0, -1, NaN, Infinity, undefined]) {
  assert.throws(() => policy.validateChatVideo({ ...asset, duration }));
}
assert.throws(() => policy.validateChatVideo(asset, 'invalid'));
assert.throws(() => policy.validateChatVideo({ ...asset, fileSize: policy.MAX_VIDEO_BYTES + 1 }));
assert.throws(() => policy.validateChatVideo({ ...asset, fileSize: undefined }));
const reply = await import('../src/utils/messageReply.js');
for (const videoMode of ['once', 'replay', 'chat']) {
  const snapshot = reply.createReplySnapshot({ id: 'v', mediaType: 'video', videoMode, mediaUrl: 'secret.enc' });
  assert.equal(snapshot.mediaUrl, undefined);
  assert.equal(snapshot.mediaType, 'video');
}
// Exercise the real encryption module with native-only dependencies stubbed.
const source = readFileSync('src/services/chatEncryptionService.js', 'utf8');
const module = { exports: {} };
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
const code = babel.transformSync(source, { babelrc: false, configFile: false, plugins: [presetRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
const crypto = require('node:crypto');
const nacl = require('tweetnacl');
new Function('require', 'module', 'exports', code)((id) => {
  if (id === 'tweetnacl') return nacl;
  if (id === 'expo-crypto') return { getRandomBytes: n => new Uint8Array(crypto.randomBytes(n)) };
  if (id.endsWith('messageReply')) return reply;
  return {};
}, module, module.exports);
const key = nacl.randomBytes(32);
for (const size of [1, 2, 3, 16383, 16384, 16385, 1024 * 1024]) {
  const binary = crypto.randomBytes(size);
  const encoded = module.exports.bytesToBase64(binary);
  assert.equal(encoded, binary.toString('base64'));
  assert.deepEqual(module.exports.base64ToBytes(encoded), new Uint8Array(binary));
}
for (const videoMode of ['once', 'replay', 'chat']) {
  const message = { id: videoMode, senderId: 'alice', createdAt: 1, text: '[วิดีโอ]', mediaType: 'video', videoMode, videoDuration: 60000, mediaUrl: 'https://example.test/clip.enc' };
  const encrypted = module.exports.encryptMessageRecord(message, key);
  assert.equal(encrypted.mediaUrl, undefined);
  assert.equal(encrypted.videoMode, videoMode);
  assert.equal(encrypted.videoDuration, 60000);
  const decrypted = module.exports.decryptMessageRecord(encrypted, key);
  assert.equal(decrypted.mediaType, 'video');
  assert.equal(decrypted.videoMode, videoMode);
  assert.equal(decrypted.videoDuration, 60000);
  assert.equal(decrypted.mediaUrl, message.mediaUrl);
}
for (const path of ['src/screens/ChatRoomScreen.js', 'src/screens/ChatRoomScreen.ios.js', 'src/components/ChatVideoBubble.js', 'src/components/ChatVideoComposer.js', 'src/components/ChatMediaPickerSheet.js', 'src/services/chatMediaService.js', 'src/services/chatVideoService.js']) {
  babel.parseSync(readFileSync(path, 'utf8'), { babelrc: false, configFile: false, parserOpts: { sourceType: 'module', plugins: ['jsx'] } });
}
const mediaModule = { exports: {} };
const mediaCode = babel.transformSync(readFileSync('src/services/chatMediaService.js', 'utf8'), {
  babelrc: false, configFile: false, plugins: [presetRequire.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
new Function('require', 'module', 'exports', mediaCode)(id => {
  if (id.endsWith('chatVideoPolicy')) return policy;
  if (id === 'expo-file-system/legacy') return {
    getInfoAsync: async () => ({ exists: true, size: 1024 }),
    readAsStringAsync: async () => 'AA==', EncodingType: { Base64: 'base64' },
  };
  if (id.endsWith('dbService')) return { requireFirebase: () => ({ app: {} }) };
  if (id.endsWith('chatEncryptionService')) return {
    base64ToBytes: () => new Uint8Array([0]),
    encryptMediaBytes: () => { throw new Error('encryption-failed'); },
  };
  return {};
}, mediaModule, mediaModule.exports);
await assert.rejects(mediaModule.exports.uploadChatMedia(asset.uri, { conversationId: 'c', mediaType: 'video', videoDuration: 60001 }), /60/);
await assert.rejects(mediaModule.exports.uploadChatMedia(asset.uri, { conversationId: 'c', mediaType: 'video', videoDuration: 60000 }), /กุญแจ/);
await assert.rejects(mediaModule.exports.uploadChatMedia(asset.uri, { conversationId: 'c', mediaType: 'video', videoDuration: 60000, conversationKey: key }), /encryption-failed/);
for (const path of ['src/components/ChatCameraModal.js', 'src/components/ChatProtectedImageBubble.js', 'src/components/ChatImageViewerModal.js', 'src/components/ChatMediaComposer.js', 'src/components/ChatImageEditorModal.js']) {
  babel.parseSync(readFileSync(path, 'utf8'), { babelrc: false, configFile: false, parserOpts: { sourceType: 'module', plugins: ['jsx'] } });
}
// Concurrent preview/playback must share one complete decrypted file, and failures must be retryable.
const files = new Map();
let downloads = 0;
let httpStatus = 200;
const plain = new Uint8Array([0, 1, 2, 3, 255]);
const encryptedPayload = module.exports.bytesToBase64(module.exports.encryptMediaBytes(plain, key));
const loader = { exports: {} };
new Function('require', 'module', 'exports', mediaCode)(id => {
  if (id.endsWith('chatEncryptionService')) return module.exports;
  if (id === 'expo-file-system/legacy') return {
    cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
    getInfoAsync: async path => ({ exists: files.has(path), size: files.get(path)?.length || 0 }),
    makeDirectoryAsync: async path => { files.set(path, ''); },
    downloadAsync: async (_url, path) => { downloads++; await new Promise(resolve => setTimeout(resolve, 5)); files.set(path, encryptedPayload); return { status: httpStatus }; },
    readAsStringAsync: async path => { assert.ok(files.has(path)); return files.get(path); },
    writeAsStringAsync: async (path, value) => { files.set(path, value); },
    moveAsync: async ({ from, to }) => { assert.ok(files.has(from)); files.set(to, files.get(from)); files.delete(from); },
    deleteAsync: async path => { files.delete(path); },
  };
  return {};
}, loader, loader.exports);
const options = { conversationKey: key, mediaType: 'video' };
const urls = await Promise.all(Array.from({ length: 4 }, () => loader.exports.getDecryptedMediaUri('https://test/video.enc', options)));
assert.equal(downloads, 1);
assert.ok(urls.every(uri => uri === urls[0]));
assert.equal(files.get(urls[0]), module.exports.bytesToBase64(plain));
assert.ok([...files.keys()].every(path => !path.includes('tmp_')));
httpStatus = 404;
await assert.rejects(loader.exports.getDecryptedMediaUri('https://test/retry.enc', options), /HTTP 404/);
httpStatus = 200;
assert.ok(await loader.exports.getDecryptedMediaUri('https://test/retry.enc', options));
await assert.rejects(loader.exports.getDecryptedMediaUri('https://test/missing.enc', { mediaType: 'video' }), /กุญแจ/);
await assert.rejects(loader.exports.getDecryptedMediaUri('https://test/wrong-key.enc', { ...options, conversationKey: nacl.randomBytes(32) }));
console.log('PASS: video policy, encryption, fail-closed uploads, concurrent media loading, retry after HTTP failure, missing/wrong keys, and changed JSX syntax');
