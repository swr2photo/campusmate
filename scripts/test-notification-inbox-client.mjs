import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function service() {
  let authCallback, stopped = 0, authStopped = false;
  const auth = { currentUser: null }, subscriptions = [];
  const context = vm.createContext({ console, Date, Promise,
    requireFirebase: () => ({ app: {}, db: {} }), getAuth: () => auth,
    onAuthStateChanged: (_auth, callback) => { authCallback = callback; return () => { authStopped = true; }; },
    onSnapshot: (...args) => { subscriptions.push(args); return () => { stopped++; }; },
    doc: (...args) => ({ path: args.slice(1).join('/') }), collection: (...args) => ({ path: args.slice(1).join('/') }),
    query: (...args) => args, orderBy: (...args) => args, limit: value => ({ limit: value }), where: (...args) => args, or: (...args) => args,
    Timestamp: { now: () => 123 }, waitForAuthReady: async () => auth.currentUser,
    getFunctions: () => ({}), httpsCallable: () => async () => ({ data: { ok: true } }),
    getCountFromServer: async () => ({ data: () => ({ count: 3 }) }),
  });
  const source = fs.readFileSync('src/services/notificationInboxService.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
  vm.runInContext(source + '\nglobalThis.api = { watchInbox, visibleNotification, inboxCall };', context);
  return { api: context.api, subscriptions, auth, emit: user => { auth.currentUser = user; authCallback(user); }, stats: () => ({ stopped, authStopped }) };
}
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
