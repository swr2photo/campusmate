import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const preset = createRequire(require.resolve('babel-preset-expo'));
function load(path, deps = {}) {
  const result = { exports: {} };
  const code = babel.transformSync(readFileSync(path, 'utf8'), { babelrc: false, configFile: false,
    plugins: [preset.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in deps)) throw new Error(`Missing mock ${id}`);
    return deps[id];
  }, result, result.exports);
  return result.exports;
}
const policy = load('src/utils/chatVideoPolicy.js');
const edits = load('src/utils/videoEdit.js', { './chatVideoPolicy': policy });
assert.deepEqual(edits.initialVideoRange(120000), { startMs: 0, endMs: 60000 });
assert.deepEqual(edits.moveVideoHandle({ startMs: 0, endMs: 60000 }, 'end', 120000, 120000), { startMs: 60000, endMs: 120000 });
for (const duration of [300, 1000, 59000, 60000, 60001, 600000]) {
  let range = edits.initialVideoRange(duration);
  for (const side of ['start', 'end', 'start', 'end']) {
    for (const value of [-1000, 0, 400, 1500, 90000, duration + 999]) {
      range = edits.moveVideoHandle(range, side, value, duration);
      assert.doesNotThrow(() => edits.validateVideoEdit(duration, range));
    }
  }
}
assert.throws(() => edits.validateVideoEdit(120000, { startMs: 0, endMs: 60001 }));
const nativeCalls = [];
const processor = load('src/services/videoProcessingService.js', {
  expo: { requireOptionalNativeModule: () => ({ exportVideo: async (...args) => {
    nativeCalls.push(args); return { uri: 'file://export.mp4', duration: args[2] - args[1] };
  } }) },
  'expo-file-system/legacy': { getInfoAsync: async () => ({ size: 100 }), deleteAsync: async () => {} },
  '../utils/chatVideoPolicy': policy, '../utils/videoEdit': edits,
});
await processor.exportChatVideo({ uri: 'file://original.mov', duration: 120000 }, { startMs: 45000, endMs: 105000, muted: true });
assert.deepEqual(nativeCalls[0], ['file://original.mov', 45000, 105000, true, 'preview']);

// Durable upgrade queue: medium first; failed high upload resumes after reload.
const files = new Map(), records = new Map(), exports = [], uploads = [];
let uid = 'alice', failHigh = true;
const fsMock = {
  documentDirectory: 'file://private/', makeDirectoryAsync: async uri => files.set(uri, ''),
  copyAsync: async ({ to }) => files.set(to, 'original'),
  writeAsStringAsync: async (uri, text) => files.set(uri, text),
  readAsStringAsync: async uri => files.get(uri),
  getInfoAsync: async uri => ({ exists: [...files.keys()].some(key => key.startsWith(uri)) }),
  readDirectoryAsync: async uri => [...new Set([...files.keys()].filter(key => key.startsWith(uri)).map(key => key.slice(uri.length).split('/')[0]).filter(Boolean))],
  deleteAsync: async uri => { for (const key of files.keys()) if (key.startsWith(uri)) files.delete(key); },
};
const deps = {
  'expo-file-system/legacy': fsMock,
  'firebase/auth': { getAuth: () => ({ currentUser: { uid } }) },
  './dbService': { requireFirebase: () => ({ app: {}, db: 'db' }) },
  'firebase/firestore': {
    doc: (...parts) => parts.join('/'), collection: (...parts) => parts.join('/'), Timestamp: { now: () => 1 },
    getDoc: async path => ({ exists: () => !path.includes('videoRenditions') || records.has(path), data: () => ({ senderId: 'alice' }) }),
    setDoc: async (path, record) => records.set(path, record), getDocs: async () => ({ docs: [] }),
  },
  './videoProcessingService': { exportChatVideo: async (asset, edit, quality) => {
    assert.equal(edit.muted, true); assert.equal(edit.startMs, 45000); exports.push(quality);
    return { uri: quality, duration: 60000 };
  }, discardVideoExport: async () => {} },
  './chatMediaService': { uploadChatMedia: async (uri, options) => {
    assert.equal(options.conversationKey, 'key'); uploads.push(uri);
    if (uri === 'high' && failHigh) throw Error('offline');
    return `encrypted:${uri}`;
  } },
  './chatEncryptionService': { getOrFetchConversationKey: async () => 'key',
    encryptMessageRecord: record => ({ ciphertext: `encrypted:${record.mediaUrl}`, id: record.id }), decryptMessageRecord: value => value },
};
let queue = load('src/services/videoUpgradeService.js', deps);
await queue.stageVideoUpgrade({ userId: 'alice', conversationId: 'room', messageId: 'video', asset: { uri: 'original', duration: 120000 }, edit: { startMs: 45000, endMs: 105000, muted: true }, mode: 'once' });
await queue.resumeVideoUpgrades('alice');
assert.deepEqual(uploads, ['medium', 'high']);
assert.equal(records.size, 1);
assert.ok([...files.keys()].some(path => path.endsWith('job.json')));
queue = load('src/services/videoUpgradeService.js', deps);
uid = 'bob'; await queue.resumeVideoUpgrades('alice'); assert.equal(uploads.length, 2);
uid = 'alice'; failHigh = false; await queue.resumeVideoUpgrades('alice');
assert.deepEqual(uploads, ['medium', 'high', 'high']);
assert.equal(records.size, 2);
assert.equal([...files.keys()].some(path => path.endsWith('job.json')), false);
for (const file of ['src/components/ChatVideoComposer.js', 'src/components/ChatMediaComposer.js', 'src/components/ChatVideoBubble.js', 'src/services/videoUpgradeService.js', 'src/context/AppContext.js']) {
  babel.parseSync(readFileSync(file, 'utf8'), { babelrc: false, configFile: false, parserOpts: { sourceType: 'module', plugins: ['jsx'] } });
}
console.log('PASS: trim bounds, mute/export arguments, encrypted quality order, persistent retries, account isolation, cleanup, syntax');
