import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxId, inboxPayload, persistInbox, syncFaceInbox } from './notificationInbox.js';

test('inbox sanitizes encrypted previews and keeps only approved destinations', () => {
  const row = inboxPayload({ title: 'แชตใหม่', body: 'secret plaintext', data: { type: 'message', conversationId: 'c-a-b', messageId: 'm1', ciphertext: 'secret', arbitrary: '/bad' } }, 1000);
  assert.equal(row.body.includes('secret'), false);
  assert.deepEqual(row.target, { conversationId: 'c-a-b', messageId: 'm1' });
  assert.equal(row.expiresAt.toMillis(), 1000 + 90 * 86400000);
});
test('duplicate delivery does not reset a previously read inbox entry', async () => {
  const records = new Map();
  const db = { doc: path => ({ create: async data => { if (records.has(path)) throw { code: 6 }; records.set(path, data); } }) };
  const id = await persistInbox(db, 'event1', 'alice', { data: { type: 'like' } });
  records.get(`users/alice/notifications/${id}`).readAt = 123;
  await persistInbox(db, 'event1', 'alice', { data: { type: 'like' } });
  assert.equal(records.size, 1); assert.equal([...records.values()][0].readAt, 123);
  assert.notEqual(inboxId('event1', 'alice'), inboxId('event1', 'bob'));
});
test('face state uses current server profile when an old event arrives late', async () => {
  const records = new Map([['users/a', { isFaceVerified: true }], ['users/a/notifications/face-verification', { status: 'required', readAt: 321 }]]);
  const db = { doc: path => ({ path }), runTransaction: async fn => fn({
    get: async ref => ({ exists: records.has(ref.path), get: key => records.get(ref.path)?.[key] }),
    create: (ref, data) => records.set(ref.path, data), update: (ref, data) => records.set(ref.path, { ...records.get(ref.path), ...data }),
  }) };
  await syncFaceInbox(db, 'a', { isFaceVerified: false });
  assert.equal(records.get('users/a/notifications/face-verification').status, 'completed');
  assert.equal(records.get('users/a/notifications/face-verification').readAt, 321);
  records.delete('users/a');
  await syncFaceInbox(db, 'a', { isFaceVerified: false });
  assert.equal(records.get('users/a/notifications/face-verification').status, 'completed');
});
test('reopening an unverified account preserves its single notice and read state', async () => {
  const records = new Map([['users/a', {}]]);
  const db = { doc: path => ({ path }), runTransaction: async fn => fn({
    get: async ref => ({ exists: records.has(ref.path), get: key => records.get(ref.path)?.[key] }),
    create: (ref, data) => records.set(ref.path, data), update: (ref, data) => records.set(ref.path, { ...records.get(ref.path), ...data }),
  }) };
  await syncFaceInbox(db, 'a', {});
  const row = records.get('users/a/notifications/face-verification'); row.readAt = 321;
  await syncFaceInbox(db, 'a', {});
  assert.equal(records.size, 2); assert.equal(row.readAt, 321); assert.equal(row.expiresAt, null);
});
