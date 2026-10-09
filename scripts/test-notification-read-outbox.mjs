import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationReadOutbox } from '../src/utils/notificationReadOutbox.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const time = 1800000000000;
const key = uid => '@campusmate:notification-read-outbox:v1:' + encodeURIComponent(uid);
function fixture(overrides = {}) {
  const disk = new Map(), events = []; let uid = 'alice', clock = time;
  const storage = { async getItem(k) { return disk.get(k) ?? null; }, async setItem(k, value) { events.push('persist'); disk.set(k, value); }, async removeItem(k) { events.push('remove'); disk.delete(k); } };
  const options = { storage, currentUid: () => uid, now: () => clock, write: async (_uid, id) => { events.push('write:' + id); }, ...overrides };
  return { disk, events, storage, options, make: () => createNotificationReadOutbox(options), setUid: value => { uid = value; }, setTime: value => { clock = value; } };
}

test('offline persisted receipt survives restart and acknowledged flush removes it', async () => {
  const f = fixture({ write: async () => { throw { code: 'unavailable' }; } }), first = f.make();
  await first.enqueue('alice', 'notice_1'); await first.flush('alice');
  assert.deepEqual(JSON.parse(f.disk.get(key('alice'))), [{ id: 'notice_1', readAt: time }]);
  f.options.write = async (uid, id) => { assert.equal(uid, 'alice'); assert.equal(id, 'notice_1'); };
  const restarted = f.make(), values = []; const stop = restarted.subscribe('alice', value => values.push(value));
  await settle(); assert.deepEqual(values.at(-1), [{ id: 'notice_1', readAt: time }]);
  await restarted.flush('alice'); assert.equal(f.disk.has(key('alice')), false); assert.deepEqual(values.at(-1), []); stop();
});

test('enqueue resolves after persistence without awaiting a hanging network request', async () => {
  const network = deferred(), f = fixture({ write: async () => { f.events.push('network'); await network.promise; } }), outbox = f.make();
  await outbox.enqueue('alice', 'n1'); await settle();
  assert.equal(f.events[0], 'persist'); assert.equal(f.events[1], 'network');
  assert.equal(JSON.parse(f.disk.get(key('alice')))[0].id, 'n1');
  network.resolve(); await outbox.flush('alice'); assert.equal(f.disk.has(key('alice')), false);
});

test('transient write retries while permanent missing or forbidden receipts are discarded', async () => {
  let failed = true, calls = 0;
  const f = fixture({ write: async (_uid, id) => { calls++; if (id === 'retry' && failed) throw { code: 'firestore/unavailable' }; if (id === 'gone') throw { code: 'not-found' }; if (id === 'forbidden') throw { code: 'firestore/permission-denied' }; } }), outbox = f.make();
  await outbox.enqueue('alice', 'retry'); await outbox.flush('alice');
  assert.equal(JSON.parse(f.disk.get(key('alice')))[0].id, 'retry');
  failed = false; await outbox.flush('alice'); assert.equal(f.disk.has(key('alice')), false);
  await outbox.enqueue('alice', 'gone'); await outbox.flush('alice');
  await outbox.enqueue('alice', 'forbidden'); await outbox.flush('alice');
  assert.equal(f.disk.has(key('alice')), false); assert.ok(calls >= 4);
});

test('rapid duplicate enqueues preserve oldest intent and allow only one simultaneous write per UID', async () => {
  const network = deferred(); let inFlight = 0, max = 0;
  const f = fixture({ write: async () => { max = Math.max(max, ++inFlight); await network.promise; inFlight--; } }), outbox = f.make();
  await outbox.enqueue('alice', 'same'); f.setTime(time + 500);
  await Promise.all([outbox.enqueue('alice', 'same'), outbox.enqueue('alice', 'same')]);
  assert.deepEqual(JSON.parse(f.disk.get(key('alice'))), [{ id: 'same', readAt: time }]);
  network.resolve(); await outbox.flush('alice'); assert.equal(max, 1); assert.equal(f.disk.has(key('alice')), false);
});

test('enqueue concurrent with acknowledgement never loses the new receipt', async () => {
  const firstWrite = deferred(), secondWrite = deferred(), writes = [];
  const f = fixture({ write: async (_uid, id) => { writes.push(id); await (id === 'first' ? firstWrite : secondWrite).promise; } }), outbox = f.make();
  await outbox.enqueue('alice', 'first'); await settle();
  firstWrite.resolve(); await outbox.enqueue('alice', 'second'); await settle();
  assert.deepEqual(JSON.parse(f.disk.get(key('alice'))), [{ id: 'second', readAt: time }]);
  assert.deepEqual(writes, ['first', 'second']); secondWrite.resolve(); await outbox.flush('alice');
  assert.equal(f.disk.has(key('alice')), false);
});

test('account switch blocks further writes and callbacks from the previous account', async () => {
  const network = deferred(), f = fixture({ write: async () => network.promise }), outbox = f.make(), values = [];
  const stop = outbox.subscribe('alice', value => values.push(value));
  await outbox.enqueue('alice', 'old'); await settle(); const count = values.length;
  f.setUid('bob'); network.resolve(); await outbox.flush('alice'); await settle();
  assert.equal(values.length, count); assert.equal(JSON.parse(f.disk.get(key('alice')))[0].id, 'old');
  await assert.rejects(outbox.enqueue('alice', 'wrong'), { code: 'outbox/account-changed' }); stop();
});

test('clear during a pending write cancels stale completion without resurrecting the disk queue', async () => {
  const network = deferred(), f = fixture({ write: async () => network.promise }), outbox = f.make(), values = [];
  outbox.subscribe('alice', value => values.push(value));
  await outbox.enqueue('alice', 'old'); await settle(); await outbox.clear('alice');
  const count = values.length; assert.deepEqual(values.at(-1), []);
  f.setUid('bob'); network.resolve(); await settle(); await settle();
  assert.equal(f.disk.has(key('alice')), false); assert.equal(values.length, count);
});

test('clear and account changes while disk restore is pending do not emit stale receipts', async () => {
  const restore = deferred(), f = fixture(), values = [];
  f.disk.set(key('alice'), JSON.stringify([{ id: 'old', readAt: time }]));
  f.options.storage = { ...f.storage, getItem: async () => restore.promise };
  const outbox = f.make(); outbox.subscribe('alice', value => values.push(value)); await settle();
  f.setUid('bob'); const cleared = outbox.clear('alice');
  restore.resolve(JSON.stringify([{ id: 'old', readAt: time }])); await cleared; await settle();
  assert.deepEqual(values, []); assert.equal(f.disk.has(key('alice')), false);
});

test('clear while persistence is pending serializes removal after that write', async () => {
  const persisted = deferred(), started = deferred(), f = fixture(), writes = [];
  f.options.storage = { ...f.storage, setItem: async (k, value) => { started.resolve(); await persisted.promise; f.disk.set(k, value); } };
  f.options.write = async (_uid, id) => writes.push(id);
  const outbox = f.make(), enqueue = outbox.enqueue('alice', 'old'); await started.promise;
  const cleared = outbox.clear('alice'); f.setUid('bob'); persisted.resolve();
  await assert.rejects(enqueue, { code: 'outbox/account-changed' }); await cleared;
  assert.equal(f.disk.has(key('alice')), false); assert.deepEqual(writes, []);
});

test('an account change during persistence cannot publish or start the old account write', async () => {
  const persisted = deferred(), started = deferred(), f = fixture(), values = [], writes = [];
  f.options.storage = { ...f.storage, setItem: async (k, value) => { started.resolve(); await persisted.promise; f.disk.set(k, value); } };
  f.options.write = async (_uid, id) => writes.push(id);
  const outbox = f.make(); outbox.subscribe('alice', value => values.push(value)); await settle();
  const count = values.length, enqueue = outbox.enqueue('alice', 'old'); await started.promise;
  f.setUid('bob'); persisted.resolve(); await assert.rejects(enqueue, { code: 'outbox/account-changed' });
  assert.equal(values.length, count); assert.deepEqual(writes, []);
  assert.equal(JSON.parse(f.disk.get(key('alice')))[0].id, 'old'); assert.equal(f.disk.has(key('bob')), false);
});

test('a stale completion after clear cannot acknowledge a new receipt generation', async () => {
  const oldWrite = deferred(), freshWrite = deferred(), writes = [], f = fixture({ write: async (_uid, id) => {
    writes.push(id); await (id === 'old' ? oldWrite : freshWrite).promise;
  } }), outbox = f.make();
  await outbox.enqueue('alice', 'old'); await settle(); await outbox.clear('alice');
  await outbox.enqueue('alice', 'fresh'); oldWrite.resolve(); await settle(); await settle();
  assert.deepEqual(writes, ['old', 'fresh']);
  assert.deepEqual(JSON.parse(f.disk.get(key('alice'))), [{ id: 'fresh', readAt: time }]);
  freshWrite.resolve(); await outbox.flush('alice'); assert.equal(f.disk.has(key('alice')), false);
});

test('persistence failure rejects without sending a network receipt', async () => {
  const f = fixture(), writes = [];
  f.options.storage = { ...f.storage, setItem: async () => { throw new Error('disk unavailable'); } };
  f.options.write = async (_uid, id) => writes.push(id);
  const outbox = f.make(); await assert.rejects(outbox.enqueue('alice', 'n1'), /disk unavailable/);
  await settle(); assert.deepEqual(writes, []); assert.equal(f.disk.has(key('alice')), false);
});

test('unsubscribing before async restore completes suppresses its callback', async () => {
  const restore = deferred(), f = fixture(), values = [];
  f.options.storage = { ...f.storage, getItem: async () => restore.promise };
  const outbox = f.make(), stop = outbox.subscribe('alice', value => values.push(value)); await settle(); stop();
  restore.resolve(JSON.stringify([{ id: 'n1', readAt: time }])); await settle(); assert.deepEqual(values, []);
});

test('a subscription made before auth restores receives durable receipts when flush loads them', async () => {
  const network = deferred(), f = fixture({ write: async () => network.promise }), outbox = f.make(), values = [];
  f.disk.set(key('alice'), JSON.stringify([{ id: 'pending', readAt: time }])); f.setUid(null);
  const stop = outbox.subscribe('alice', value => values.push(value)); await settle(); assert.deepEqual(values, []);
  f.setUid('alice'); const flushed = outbox.flush('alice'); await settle();
  assert.deepEqual(values.at(-1), [{ id: 'pending', readAt: time }]);
  assert.equal(f.disk.has(key('alice')), true); network.resolve(); await flushed; stop();
});

test('invalid IDs reject and restored data strips message content and expired receipts', async () => {
  const f = fixture({ write: async () => { throw { code: 'unavailable' }; } }), outbox = f.make(), values = [];
  for (const id of ['', 'a/b', '../other', 'with space', 'x'.repeat(129), null, { id: 'n1', body: 'secret' }]) await assert.rejects(outbox.enqueue('alice', id), { code: 'outbox/invalid-id' });
  f.disk.set(key('alice'), JSON.stringify([{ id: 'valid', readAt: time, body: 'secret', target: 'private' }, { id: 'expired', readAt: time - 91 * 86400000 }, { id: 'bad/id', readAt: time }, { id: 'future', readAt: time + 1 }]));
  const stop = outbox.subscribe('alice', value => values.push(value)); await settle();
  assert.deepEqual(values.at(-1), [{ id: 'valid', readAt: time }]); assert.equal(f.disk.get(key('alice')).includes('secret'), false);
  values.at(-1)[0].id = 'mutated'; const again = []; const stopAgain = outbox.subscribe('alice', value => again.push(value)); await settle();
  assert.equal(again.at(-1)[0].id, 'valid'); stop(); stopAgain();
});
