import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compareConversationsByActivity, conversationActivityMillis, retainLoadingConversations } from '../src/utils/conversationOrder.js';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const epoch = 1800000000000;
const room = (id, offset, extra = {}) => ({ id, lastMessageAt: epoch + offset, ...extra });
const ordered = (rooms) => [...rooms].sort(compareConversationsByActivity).map(({ id }) => id);
assert.deepEqual(ordered([room('old', 1, { updatedAt: epoch + 9999 }), room('new', 2)]), ['new', 'old']);
assert.deepEqual(ordered([room('received', 3, { lastMessageSenderId: 'other' }), room('sent', 4, { lastMessageSenderId: 'me' })]), ['sent', 'received']);
assert.deepEqual(ordered([room('old', 1, { messages: [{ createdAt: epoch + 5, pendingSync: true }] }), room('new', 2)]), ['old', 'new']);
for (const timestamp of [new Date(epoch), { seconds: epoch / 1000 }, { _seconds: epoch / 1000 }, { toMillis: () => epoch }, new Date(epoch).toISOString()]) {
  assert.equal(conversationActivityMillis({ lastMessageAt: timestamp }), epoch);
}
assert.deepEqual(ordered([room('b', 1), room('a', 1)]), ['a', 'b']);
assert.equal(conversationActivityMillis({ updatedAt: epoch }), 0);
assert.deepEqual(retainLoadingConversations([room('cached', 1), room('deleted', 2)], [room('new', 3)], ['cached']).map(({ id }) => id), ['new', 'cached']);

// Exercise the actual subscription with in-memory Firestore listeners.
const path = 'src/services/firestoreService.js';
const source = readFileSync(path, 'utf8');
const start = source.indexOf('export function subscribeToConversations(');
const end = source.indexOf('\n}\n', start) + 2;
const listeners = new Map();
const outputs = [];
const errors = [];
let releaseOlder;
const olderGate = new Promise((resolve) => { releaseOlder = resolve; });
const dependencies = {
  requireFirebase: () => ({ db: {} }),
  getOrCreateEncryptionIdentity: async () => ({}),
  collection: (_db, ...parts) => parts.join('/'),
  where: () => ({}), orderBy: () => ({}), limit: () => ({}),
  query: (path) => path,
  onSnapshot: (path, callback) => { listeners.set(path, callback); return () => listeners.delete(path); },
  toMillis: (value) => typeof value === 'number' ? value : 0,
  isValidConversationEncryption: () => false,
  ensureConversationEncryption: async (id) => {
    if (id === 'r1') await olderGate;
    return { conversationKey: 'key', data: {}, messages: [] };
  },
  decryptConversationMessageList: (_id, messages) => messages || [],
  toSafePublicProfile: (_id, profile) => profile,
  conversationRenderSignature: JSON.stringify,
  compareConversationsByActivity,
  ENCRYPTED_PREVIEW: 'encrypted',
};
const subscribe = new Function(...Object.keys(dependencies), `${source.slice(start, end).replace('export ', '')}; return subscribeToConversations;`)(...Object.values(dependencies));
const stop = subscribe('me', (rooms, info) => outputs.push({ rooms, info, listeners: listeners.size }), (error) => errors.push(error));
let data = Array.from({ length: 7 }, (_, i) => room(`r${i}`, i, { participants: ['me', 'other'] }));
const root = () => listeners.get('conversations')({
  docs: data.map((entry) => ({ id: entry.id })),
  docChanges: () => data.map((entry) => ({ type: 'modified', doc: { id: entry.id, data: () => entry } })),
  metadata: { fromCache: false, hasPendingWrites: false },
});
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (errors.length) throw errors[0];
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for subscription');
}
root();
await until(() => outputs.length > 0);
assert.deepEqual(outputs[0].rooms.map(({ id }) => id), ['r6', 'r5', 'r4', 'r3', 'r2']);
assert.equal(outputs[0].listeners, 6); // root + first five message listeners
assert.deepEqual(outputs[0].info.loadingConversationIds, ['r1', 'r0']);
releaseOlder();
await until(() => outputs.at(-1).rooms.length === 7);
data[0] = { ...data[0], updatedAt: epoch + 999 };
root();
await until(() => outputs.at(-1).rooms.find(({ id }) => id === 'r0')?.updatedAt === epoch + 999);
assert.equal(outputs.at(-1).rooms[0].id, 'r6');
data[0] = { ...data[0], lastMessageAt: epoch + 1000, lastMessageSenderId: 'me' };
root();
await until(() => outputs.at(-1).rooms[0].id === 'r0');
data = data.filter(({ id }) => id !== 'r3');
root();
await until(() => !outputs.at(-1).rooms.some(({ id }) => id === 'r3'));
assert.equal(listeners.has('conversations/r3/messages'), false);
stop();
assert.equal(listeners.size, 0);
for (const file of [path, 'src/context/AppContext.js', 'src/screens/ChatScreen.js', 'src/screens/ChatScreen.ios.js']) {
  babel.parseSync(readFileSync(file, 'utf8'), { babelrc: false, configFile: false, parserOpts: { sourceType: 'module', plugins: ['jsx'] } });
}
console.log('PASS: newest messages, optimistic sends, timestamps, incremental loading, read receipts, deletion, cleanup and syntax');
