import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mergeGroupMessages, receiveGroupWindow } from '../src/utils/groupChatTimeline.js';
import { newerGroupMessage } from '../functions/groupMessageMetadata.js';
import { startMillis, nextPartyRefreshDelay } from '../src/utils/partyClock.js';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');
const read = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
function moduleWithMocks(file, mocks, names) {
  const source = read(file).replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '').replace(/export\s*\{[^}]*\};?/g, '').replace(/export\s+(?=(?:async\s+)?function|const)/g, '');
  const ctx = vm.createContext({ console, ...mocks });
  vm.runInContext(source + `\n;globalThis.api = {${names.join(',')}};`, ctx);
  return ctx.api;
}
const encode = (bytes) => Buffer.from(bytes).toString('base64');

test('warm plaintext cache rejects wrong, absent, malformed keys and altered nonces', () => {
  const api = moduleWithMocks('src/services/chatEncryptionService.js', {
    nacl, Uint8Array, TextEncoder, TextDecoder,
  }, ['encryptMessageRecord', 'decryptMessageRecord', 'clearConversationKeyCache']);
  const key = nacl.randomBytes(32), wrong = nacl.randomBytes(32);
  // Use the actual encryption/decryption implementation and real secretbox.
  const nonce = nacl.randomBytes(24);
  const message = { id: 'm', encrypted: true, nonce: encode(nonce), ciphertext: encode(nacl.secretbox(Buffer.from('{"text":"private"}'), nonce, key)) };
  assert.equal(api.decryptMessageRecord(message, key).text, 'private');
  for (const candidate of [wrong, null, new Uint8Array(31), [...key]]) assert.equal(api.decryptMessageRecord(message, candidate).decryptionFailed, true);
  assert.equal(api.decryptMessageRecord({ ...message, nonce: encode(nacl.randomBytes(24)) }, key).decryptionFailed, true);
  api.clearConversationKeyCache();
  assert.equal(api.decryptMessageRecord(message, wrong).decryptionFailed, true);
});

test('group history survives repeated moving windows, overlapping pages and timestamp ties', () => {
  const messages = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => ({ id: String(first + index), createdAt: first + index })).reverse();
  let state = { recent: messages(101, 200), older: messages(1, 100), cursor: 'oldest', hasMore: true, loadedOlder: true };
  for (let newest = 201; newest <= 250; newest++) state = receiveGroupWindow(state, messages(newest - 99, newest), 'moving', true);
  const merged = mergeGroupMessages(state.older, messages(50, 120), state.recent);
  assert.equal(merged.length, 250);
  assert.deepEqual(merged.map((entry) => Number(entry.id)), Array.from({ length: 250 }, (_, index) => index + 1));
  assert.equal(state.cursor, 'oldest');
  assert.deepEqual(mergeGroupMessages([{ id: 'b', clientSentAt: 10 }, { id: 'a', createdAt: 10 }]).map((item) => item.id), ['a', 'b']);
});

test('live Auth null/user wins over a late boot cache', async () => {
  const source = read('src/context/AuthContext.js');
  const start = source.indexOf('    let active = true;');
  const end = source.indexOf('\n  }, []);', start);
  for (const authUser of [null, { id: 'new-user' }]) {
    let resolveCache, callback, currentUser = null;
    const mocks = { authRevision: { current: 0 }, sessionUserId: { current: null }, AUTH_READY_TIMEOUT_MS: 6000,
      getFastBootData: () => new Promise((resolve) => { resolveCache = resolve; }), setUser: (next) => { currentUser = next; },
      setIsReady: () => {}, setAuthError: () => {}, setTimeout: () => 1, clearTimeout: () => {},
      subscribeToAuthChanges: (next) => { callback = next; }, saveAccount: () => {}, saveFastBootData: () => {}, clearFastBootData: () => {},
      clearConversationKeyCache: () => {}, clearGroupKeyCache: () => {}, console };
    new Function(...Object.keys(mocks), source.slice(start, end))(...Object.values(mocks));
    callback({ user: authUser }); resolveCache({ user: { id: 'stale-user' } }); await Promise.resolve();
    assert.equal(currentUser?.id, authUser?.id);
  }
});

test('fast boot invalidates pending reads, serializes clear after save and discards another account feed', async () => {
  let resolveRead, disk = null;
  const writes = [];
  const api = moduleWithMocks('src/services/fastBootService.js', { AsyncStorage: {
    getItem: () => new Promise((resolve) => { resolveRead = resolve; }),
    setItem: async (_key, value) => { writes.push('set'); disk = value; },
    removeItem: async () => { writes.push('clear'); disk = null; },
  } }, ['getFastBootData', 'getFastBootMemory', 'saveFastBootData', 'clearFastBootData']);
  const readPending = api.getFastBootData();
  await api.clearFastBootData(); resolveRead('{"user":{"id":"stale"}}');
  assert.equal(await readPending, null);
  await api.saveFastBootData({ user: { id: 'a' }, profile: { id: 'a' }, availableProfiles: [{ id: 'peer' }] });
  await api.saveFastBootData({ user: { id: 'b' } });
  assert.equal(api.getFastBootMemory().profile, null);
  assert.equal(api.getFastBootMemory().availableProfiles.length, 0);
  await api.saveFastBootData({ userId: 'a', availableProfiles: [{ id: 'wrong-account-peer' }] });
  assert.equal(api.getFastBootMemory().availableProfiles.length, 0);
  const saving = api.saveFastBootData({ user: { id: 'b' } });
  const clearing = api.clearFastBootData(); await Promise.all([saving, clearing]);
  assert.equal(disk, null); assert.equal(writes.at(-1), 'clear');
});

test('pair message remains pending after enqueue and only queue acknowledgement clears it', async () => {
  const source = read('src/context/AppContext.js');
  const start = source.indexOf('  const sendMessage = async (');
  const end = source.indexOf('\n  const retryFailedMessage', start);
  let rooms = [{ id: 'room', participants: ['me', 'other'], messages: [] }];
  const ctx = vm.createContext({ user: { id: 'me' }, activeUserIdRef: { current: 'me' }, conversations: rooms,
    setConversations: (update) => { rooms = update(rooms); }, createClientMessageId: () => 'outbox', runOrQueue: async () => ({ queued: true }), console });
  vm.runInContext(source.slice(start, end) + ';globalThis.send = sendMessage;', ctx);
  assert.equal(await ctx.send('room', 'offline message'), true);
  assert.equal(rooms[0].messages[0].pendingSync, true);
  assert.equal(rooms[0].messages[0].sendStatus, 'queued');
  const syncStart = source.indexOf('  const syncNow = useCallback(');
  const syncEnd = source.indexOf('\n  useEffect(', syncStart);
  Object.assign(ctx, { useCallback: (fn) => fn, isOnline: true, flushingQueueRef: { current: false },
    getOfflineQueueCount: async () => 1, setPendingSyncCount: () => {}, setLastSyncError: () => {}, setIsSyncing: () => {},
    setLastSyncedAt: () => {}, setRetryKey: () => {}, refreshQueueCount: () => {}, executeQueuedOperation: async () => {},
    flushOfflineQueue: async (_uid, execute) => { await execute({ type: 'sendMessage', payload: { conversationId: 'room', options: { clientMessageId: 'outbox' } } }); return { pendingCount: 0, syncedCount: 1, failed: [] }; },
  });
  vm.runInContext(source.slice(syncStart, syncEnd) + ';globalThis.sync = syncNow;', ctx);
  await ctx.sync();
  assert.equal(rooms[0].messages[0].pendingSync, false);
  assert.equal(rooms[0].messages[0].sendStatus, 'sent');
});

test('offline encrypted group queue retries without duplicate message IDs, archives failures and supports retry', async () => {
  const storage = new Map();
  const api = moduleWithMocks('src/services/offlineStorage.js', {
    getEncryptedItem: async (key) => storage.get(key), setEncryptedItem: async (key, value) => storage.set(key, value), multiRemoveEncryptedItems: async (keys) => keys.forEach((key) => storage.delete(key)),
  }, ['enqueueOfflineOperation', 'getOfflineQueue', 'flushOfflineQueue', 'getFailedOfflineOperations', 'retryFailedOfflineOperation']);
  const payload = { partyId: 'party', id: 'same-id', record: { encrypted: true, ciphertext: 'ciphertext' } };
  await api.enqueueOfflineOperation('me', 'sendGroupMessage', payload, { dedupeKey: 'same-id' });
  const offline = await api.flushOfflineQueue('me', async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); });
  assert.equal(offline.pendingCount, 1); assert.equal((await api.getOfflineQueue('me'))[0].payload.id, 'same-id');
  await api.flushOfflineQueue('me', async () => { throw Object.assign(new Error('no access'), { code: 'permission-denied' }); });
  const failed = await api.getFailedOfflineOperations('me'); assert.equal(failed.length, 1);
  await api.retryFailedOfflineOperation('me', failed[0].id);
  assert.equal((await api.getOfflineQueue('me'))[0].payload.id, 'same-id');
  assert.equal((await api.getFailedOfflineOperations('me')).length, 0);
  await api.flushOfflineQueue('me', async () => {}); assert.equal((await api.getOfflineQueue('me')).length, 0);
});

test('epoch snapshot hydration performs no second Firestore read and reuses unchanged keys', async () => {
  let reads = 0, unwraps = 0;
  const api = moduleWithMocks('src/services/groupChatEncryption.js', {
    ensureEncryptionIdentity: async () => ({ deviceId: 'device' }), getConversationKey: () => { unwraps++; return new Uint8Array(32); },
    getDocs: async () => { reads++; return { docs: [] }; },
  }, ['getGroupKeys', 'clearGroupKeyCache']);
  const epochs = [{ id: '0', keyEnvelopes: { me: { device: 'wrapped-key' } } }];
  const first = await api.getGroupKeys('party', 'me', epochs);
  const second = await api.getGroupKeys('party', 'me', epochs);
  assert.equal(reads, 0); assert.equal(unwraps, 1); assert.equal(first[0], second[0]);
  api.clearGroupKeyCache(); await api.getGroupKeys('party', 'me', epochs); assert.equal(unwraps, 2);
});

test('out of order and duplicate group notification events cannot regress inbox activity', () => {
  const timestamp = (ms) => ({ toMillis: () => ms });
  const chat = { lastMessageAt: timestamp(200), lastMessageId: 'b' };
  assert.equal(newerGroupMessage(chat, { createdAt: timestamp(100) }, 'c'), null);
  assert.equal(newerGroupMessage(chat, { createdAt: timestamp(200) }, 'b'), null);
  assert.equal(newerGroupMessage(chat, { createdAt: timestamp(300), senderId: 'me' }, 'c').lastMessageSenderId, 'me');
});

test('feeds start bounded, expand explicitly and ignore obsolete subscription callbacks', () => {
  const listeners = [], output = [];
  const constraint = (type) => (...values) => ({ type, values });
  const api = moduleWithMocks('src/services/partyService.js', {
    requireFirebase: () => ({ db: {} }), Timestamp: { fromMillis: (ms) => ms },
    collection: (_db, ...path) => path.join('/'), collectionGroup: (_db, path) => path,
    where: constraint('where'), orderBy: constraint('orderBy'), limit: constraint('limit'), query: constraint('query'),
    onSnapshot: (query, callback) => { const listener = { query, callback, stopped: false }; listeners.push(listener); return () => { listener.stopped = true; }; },
  }, ['subscribeParties', 'subscribeOwnParties', 'subscribeGroupChats', 'subscribeMyPartyRequests', 'subscribeHostedPartyRequests']);
  for (const [method, args, expected] of [
    ['subscribeParties', [], 30], ['subscribeOwnParties', ['me'], 30], ['subscribeGroupChats', ['me'], 20],
    ['subscribeMyPartyRequests', ['me'], 30], ['subscribeHostedPartyRequests', ['party', 'me'], 30],
  ]) {
    const stop = api[method](...args, (...values) => output.push(values), assert.fail);
    const first = listeners.at(-1);
    assert.equal(first.query.values.at(-1).type, 'limit'); assert.equal(first.query.values.at(-1).values[0], expected);
    stop.loadMore(); const second = listeners.at(-1);
    assert.equal(first.stopped, true); assert.equal(second.query.values.at(-1).values[0], expected * 2);
    const count = output.length; first.callback({ docs: [], size: 0 }); assert.equal(output.length, count);
    second.callback({ docs: [], size: 0 }); assert.equal(output.length, count + 1);
    stop(); second.callback({ docs: [], size: 0 }); assert.equal(output.length, count + 1);
  }
});

test('party deadline triggers recomputation at the boundary and when returning to foreground', () => {
  const party = { schedule: { startsAt: { toMillis: () => 1500 } } };
  assert.equal(nextPartyRefreshDelay([party], 1000), 500);
  assert.equal(nextPartyRefreshDelay([], 1000), 30000);
  let now = 1000, state = now, timer, foreground;
  const source = read('src/hooks/usePartyFeed.js');
  const start = source.indexOf('    const timer = setTimeout(() => setClock(Date.now()),');
  const end = source.indexOf('\n    return () =>', start);
  new Function('setTimeout', 'setClock', 'Date', 'allParties', 'nextPartyRefreshDelay', 'AppState', source.slice(start, end))(
    (callback, delay) => { timer = { callback, delay }; }, (value) => { state = value; }, { now: () => now }, [party], nextPartyRefreshDelay,
    { addEventListener: (_event, callback) => { foreground = callback; } },
  );
  assert.equal(startMillis(party) <= state, false);
  now = 1500; timer.callback(); assert.equal(startMillis(party) <= state, true);
  now = 100000; foreground('active'); assert.equal(state, now);
});

test('group transaction retry acknowledges an existing identical commit and refuses ID conflicts', async () => {
  let stored = null, writes = 0;
  const api = moduleWithMocks('src/services/partyService.js', {
    requireFirebase: () => ({ db: {} }), doc: (_db, ...path) => path.join('/'), serverTimestamp: () => 'server-time',
    runTransaction: async (_db, callback) => callback({
      get: async () => ({ exists: () => Boolean(stored), get: (field) => stored?.[field] }),
      set: (_ref, data) => { writes++; stored = data; },
    }),
  }, ['writeQueuedGroupMessage']);
  const payload = { partyId: 'party', id: 'same-id', record: { epoch: 0, encrypted: true, ciphertext: 'original' } };
  await api.writeQueuedGroupMessage(payload, 'me'); await api.writeQueuedGroupMessage(payload, 'me');
  assert.equal(writes, 1);
  await api.writeQueuedGroupMessage({ ...payload, previousCiphertext: 'original', record: { ...payload.record, epoch: 1, ciphertext: 'rotated' } }, 'me');
  assert.equal(writes, 1);
  await assert.rejects(api.writeQueuedGroupMessage({ ...payload, record: { ciphertext: 'different' } }, 'me'), /conflict/);
});

test('failed group message re-encrypts on the device after rotation and preserves its original ID', async () => {
  let retryPayload, encrypted = 0;
  const operation = { id: 'failed-op', type: 'sendGroupMessage', payload: { partyId: 'party', id: 'message-id', record: { epoch: 0, ciphertext: 'old', nonce: 'old' } } };
  const api = moduleWithMocks('src/services/partyService.js', {
    getFailedOfflineOperations: async () => [operation],
    encryptMessageRecord: (message, key) => { assert.equal(message.text, 'private'); assert.equal(key.length, 32); encrypted++; return { nonce: 'new', ciphertext: 'new' }; },
    retryFailedOfflineOperation: async (_uid, _id, payload) => { retryPayload = payload; },
  }, ['retryGroupMessage']);
  await api.retryGroupMessage('party', 'me', 1, { operationId: 'failed-op', text: 'private' }, new Uint8Array(32));
  assert.equal(encrypted, 1); assert.equal(retryPayload.id, 'message-id'); assert.equal(retryPayload.record.epoch, 1);
  assert.equal(retryPayload.record.ciphertext, 'new'); assert.equal(retryPayload.previousCiphertext, 'old');
  await assert.rejects(api.retryGroupMessage('party', 'me', 1, { operationId: 'failed-op', decryptionFailed: true }, new Uint8Array(32)));
});
