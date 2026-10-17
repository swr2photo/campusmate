import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({ Array, Number, Boolean, Date, Math });
vm.runInContext(fs.readFileSync('src/utils/notificationInboxCache.js', 'utf8').replaceAll('export ', '') + '\nglobalThis.api = {restoreInboxCache,mergeInboxSnapshot,overlayInboxReadReceipts,overlayInboxMarkedAll,inboxMarkedAllTimestamp,hasUnconfirmedMarkedAllRows};', context);
const { restoreInboxCache, mergeInboxSnapshot, overlayInboxReadReceipts, overlayInboxMarkedAll, inboxMarkedAllTimestamp, hasUnconfirmedMarkedAllRows } = context.api;
const initial = () => ({ uid: 'alice', rows: [], count: 0, loading: true });
const cached = { rows: [{ id: 'n1', readAt: null }], count: 1 };

test('persisted read intent survives an empty offline snapshot without altering stored history', () => {
  const restored = restoreInboxCache(initial(), 'alice', cached);
  const offline = mergeInboxSnapshot(restored, 'alice', [], false, true);
  const rows = overlayInboxReadReceipts(offline.rows, [{ id: 'n1', readAt: 1800000000123 }]);
  assert.equal(rows[0].readAt.seconds, 1800000000);
  assert.equal(cached.rows[0].readAt, null);
});

test('authoritative read timestamp wins over pending local receipts', () => {
  const row = { id: 'n1', readAt: { seconds: 400 }, status: 'required' };
  assert.equal(overlayInboxReadReceipts([row], [{ id: 'n1', readAt: 200000 }])[0], row);
});

test('read receipts cannot create notifications or change required face status', () => {
  const rows = overlayInboxReadReceipts([{ id: 'face-verification', status: 'required', readAt: null }],
    [{ id: 'missing', readAt: 200000 }, { id: 'face-verification', readAt: 200000 }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'required'); assert.ok(rows[0].readAt);
});
test('cold offline empty snapshot preserves restored disk history', () => {
  const restored = restoreInboxCache(initial(), 'alice', cached);
  const next = mergeInboxSnapshot(restored, 'alice', [], false, true);
  assert.equal(next.rows[0].id, 'n1'); assert.equal(next.count, 1);
});
test('disk history can restore after an empty local snapshot', () => {
  const local = mergeInboxSnapshot(initial(), 'alice', [], false, true);
  assert.equal(restoreInboxCache(local, 'alice', cached).rows[0].id, 'n1');
});
test('authoritative empty server history clears disk rows and does not resurrect them', () => {
  const next = mergeInboxSnapshot(restoreInboxCache(initial(), 'alice', cached), 'alice', [], false, false);
  assert.equal(next.rows.length, 0); assert.equal(restoreInboxCache(next, 'alice', cached).rows.length, 0);
});
test('account changes never retain another account rows or unread count', () => {
  const previous = restoreInboxCache(initial(), 'alice', cached);
  const next = mergeInboxSnapshot(previous, 'bob', [], false, true);
  assert.equal(next.rows.length, 0); assert.equal(next.count, 0);
  assert.equal(restoreInboxCache(next, 'alice', cached).rows.length, 0);
});
test('malformed disk rows cannot crash the inbox renderer', () => {
  assert.equal(restoreInboxCache(initial(), 'alice', { rows: 'bad' }).rows.length, 0);
});
test('missing cache retains the initial loader until Firestore responds', () => {
  assert.equal(restoreInboxCache(initial(), 'alice', null).loading, true);
});
test('invalid cached unread count cannot produce a negative badge', () => {
  assert.equal(restoreInboxCache(initial(), 'alice', { rows: [], count: -2 }).count, 0);
});

test('mark-all shows rows created up to the tap as read and leaves later arrivals unread', () => {
  const rows = [
    { id: 'old', createdAt: { seconds: 100 }, readAt: null },
    { id: 'read', createdAt: { seconds: 90 }, readAt: { seconds: 95 } },
    { id: 'new', createdAt: { toMillis: () => 300_000 }, readAt: null },
  ];
  const marked = overlayInboxMarkedAll(rows, 200_000);
  assert.deepEqual(JSON.parse(JSON.stringify(marked.map(row => [row.id, row.readAt]))),
    [['old', { seconds: 200 }], ['read', { seconds: 95 }], ['new', null]]);
  assert.equal(overlayInboxMarkedAll(rows, 0), rows);
  assert.equal(inboxMarkedAllTimestamp(rows, 150_000), 300_000);
  assert.equal(hasUnconfirmedMarkedAllRows(rows, 200_000), true);
  assert.equal(hasUnconfirmedMarkedAllRows(marked, 200_000), false);
});
