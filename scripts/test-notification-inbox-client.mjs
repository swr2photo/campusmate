import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createNotificationReadOutbox } from '../src/utils/notificationReadOutbox.js';

function service(realOutbox = false, { cachedDocs = new Map(), serverDocs = new Map() } = {}) {
  const serverReads = [];
  let authCallback, stopped = 0, authStopped = false, countReads = 0, foregroundCallback;
  const timers = new Set();
  const appState = { currentState: 'active', addEventListener: (_name, callback) => { foregroundCallback = callback; return { remove: () => { foregroundCallback = null; } }; } };
  const auth = { currentUser: null }, subscriptions = [];
  const disk = new Map(), writes = [];
  let acknowledge;
  const pendingWrite = new Promise(resolve => { acknowledge = resolve; });
  const storage = { async getItem(key) { return disk.get(key) ?? null; }, async setItem(key, value) { disk.set(key, value); }, async removeItem(key) { disk.delete(key); } };
  const context = vm.createContext({ console, Date, Promise, AppState: appState,
    AsyncStorage: storage, createNotificationReadOutbox: realOutbox ? createNotificationReadOutbox : () => ({ flush: async () => {}, enqueue: async () => {}, subscribe: () => () => {}, clear: async () => {} }),
    updateDoc: (reference, value) => { writes.push({ reference, value }); return pendingWrite; }, serverTimestamp: () => 'SERVER_TIMESTAMP',
    setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback),
    requireFirebase: () => ({ app: {}, db: {} }), getAuth: () => auth,
    onAuthStateChanged: (_auth, callback) => { authCallback = callback; return () => { authStopped = true; }; },
    onSnapshot: (...args) => { subscriptions.push(args); return () => { stopped++; }; },
    doc: (...args) => ({ path: args.slice(1).join('/') }), collection: (...args) => ({ path: args.slice(1).join('/') }),
    query: (...args) => args, orderBy: (...args) => args, limit: value => ({ limit: value }), where: (...args) => args, or: (...args) => args,
    Timestamp: { now: () => 123 }, waitForAuthReady: async () => auth.currentUser,
    getFunctions: () => ({}), httpsCallable: () => async () => ({ data: { ok: true } }),
    getCountFromServer: async () => { countReads++; return { data: () => ({ count: 3 }) }; },
    getDocFromCache: async (reference) => {
      if (!cachedDocs.has(reference.path)) throw new Error('Failed to get document from cache');
      const data = cachedDocs.get(reference.path);
      return { exists: () => data !== null, data: () => data };
    },
    getDoc: async (reference) => {
      serverReads.push(reference.path);
      const data = serverDocs.get(reference.path) ?? null;
      return { exists: () => data !== null, data: () => data };
    },
  });
  const source = fs.readFileSync('src/services/notificationInboxService.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
  vm.runInContext(source + '\nglobalThis.api = { watchInbox, visibleNotification, inboxCall, markInboxRead, watchPendingInboxReads, retryInboxReadWrites, inboxTargetAvailable };', context);
  return { api: context.api, subscriptions, auth, disk, writes, acknowledge, serverReads, emit: user => { auth.currentUser = user; authCallback(user); },
    tick: () => timers.forEach(callback => callback()),
    appState: state => { appState.currentState = state; foregroundCallback?.(state); },
    stats: () => ({ stopped, authStopped, countReads, timers: timers.size, foregroundAttached: !!foregroundCallback }) };
}

test('real service persists offline receipt and sends only an owner readAt server timestamp', async () => {
  const s = service(true); s.auth.currentUser = { uid: 'alice' };
  await s.api.markInboxRead('alice', 'notice_1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse([...s.disk.values()][0])[0].id, 'notice_1');
  assert.equal(s.writes[0].reference.path, 'users/alice/notifications/notice_1');
  assert.equal(Object.keys(s.writes[0].value).join(','), 'readAt');
  assert.equal(s.writes[0].value.readAt, 'SERVER_TIMESTAMP');
  s.acknowledge(); await s.api.retryInboxReadWrites('alice');
  assert.equal(s.disk.size, 0);
});

test('real service refuses stale-account receipts before storage or Firestore mutation', async () => {
  const s = service(true); s.auth.currentUser = { uid: 'bob' };
  await assert.rejects(s.api.markInboxRead('alice', 'notice_1'));
  assert.equal(s.disk.size, 0); assert.equal(s.writes.length, 0);
});
test('delayed auth restore starts the inbox later instead of latching an empty launch', () => {
  const s = service();
  const stop = s.api.watchInbox('alice', () => {}, () => {}, () => {}, () => {}, 60);
  s.emit(null); assert.equal(s.subscriptions.length, 0);
  s.emit({ uid: 'alice' }); assert.equal(s.subscriptions.length, 3);
  assert.ok(s.subscriptions.some(args => args[0]?.some?.(part => part?.limit === 60)));
  s.emit({ uid: 'bob' }); assert.equal(s.subscriptions.length, 3);
  assert.equal(s.stats().stopped, 3); stop(); assert.equal(s.stats().authStopped, true);
});
test('expiry hides old history while an unresolved face notice remains available', () => {
  const { api } = service();
  assert.equal(api.visibleNotification({ expiresAt: { seconds: 1 } }), false);
  assert.equal(api.visibleNotification({ expiresAt: null }), true);
  assert.equal(api.visibleNotification({ expiresAt: { seconds: Math.floor(Date.now() / 1000) + 3600 } }), true);
});
test('in-flight account changes cannot mark another account inbox as read', async () => {
  const s = service(); s.auth.currentUser = { uid: 'bob' };
  await assert.rejects(s.api.inboxCall('markAllNotificationInboxRead', 'alice'));
});
test('empty memory cache cannot erase the pinned face notice before the server responds', () => {
  const s = service(), seen = [];
  s.api.watchInbox('alice', () => {}, () => {}, () => {}, (...args) => seen.push(args));
  s.emit({ uid: 'alice' });
  const face = s.subscriptions.find(args => args[0]?.path.endsWith('/face-verification'));
  face[2]({ exists: () => false, metadata: { fromCache: true } });
  assert.equal(seen.length, 0);
  face[2]({ exists: () => false, metadata: { fromCache: false } });
  assert.equal(seen.length, 1); assert.equal(seen[0][0], null); assert.equal(seen[0][1], false);
});

test('expiry refreshes the badge while active and on return without background polling', () => {
  const s = service(), stop = s.api.watchInbox('alice', () => {}, () => {}, () => {});
  s.emit({ uid: 'alice' }); s.tick(); assert.equal(s.stats().countReads, 1);
  s.appState('background'); s.tick(); assert.equal(s.stats().countReads, 1);
  s.appState('active'); assert.equal(s.stats().countReads, 2);
  s.emit({ uid: 'bob' }); s.tick(); assert.equal(s.stats().countReads, 2);
  assert.equal(s.stats().timers, 0); assert.equal(s.stats().foregroundAttached, false); stop();
});

test('a notification for a cached chat opens without a server read; uncertain targets still ask the server', async () => {
  const chat = { type: 'message', target: { conversationId: 'room' } };
  const cached = service(false, { cachedDocs: new Map([['conversations/room', { participants: ['alice', 'bob'] }]]) });
  assert.equal(await cached.api.inboxTargetAvailable(chat, 'alice'), true);
  assert.deepEqual(cached.serverReads, []);
  const uncached = service(false, { serverDocs: new Map([['conversations/room', { participants: ['alice'] }]]) });
  assert.equal(await uncached.api.inboxTargetAvailable(chat, 'alice'), true);
  assert.deepEqual(uncached.serverReads, ['conversations/room']);
  const removed = service(false, { cachedDocs: new Map([['conversations/room', { participants: ['alice'] }]]),
    serverDocs: new Map([['conversations/room', { participants: ['bob'] }]]) });
  assert.equal(await removed.api.inboxTargetAvailable(chat, 'carol'), false);
  assert.deepEqual(removed.serverReads, ['conversations/room']);
  const party = service(false, { cachedDocs: new Map([['parties/p1', null]]) });
  assert.equal(await party.api.inboxTargetAvailable({ type: 'party', target: { partyId: 'p1' } }, 'alice'), false);
  assert.deepEqual(party.serverReads, ['parties/p1']);
});
