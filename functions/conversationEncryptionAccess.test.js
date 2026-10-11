import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProfileAccessApi } from './secureProfileAccess.js';

const publicKey = Buffer.alloc(32, 7).toString('base64');
const request = (data = {}, uid = 'alice') => ({ auth: { uid }, data });
function fixture() {
  const rows = new Map([
    ['conversations/old-room', { participants: ['alice', 'bob'] }],
    ['users/alice', { id: 'alice', name: 'Private Alice', isFaceVerified: true, encryptionDevices: { phone: { publicKey } } }],
    ['users/bob', { id: 'bob', name: 'Private Bob', email: 'private@example.test', avatarUri: 'private-photo', isFaceVerified: false,
      encryptionDevices: { newPhone: { publicKey, secret: 'must not leave server' } } }],
  ]);
  const reads = [];
  const snap = path => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => rows.get(path) });
  const db = { doc: path => ({ path, get: async () => { reads.push(path); return snap(path); } }),
    getAll: async (...refs) => { reads.push(...refs.map(ref => ref.path)); return refs.map(ref => snap(ref.path)); } };
  return { rows, reads, api: createProfileAccessApi({ db }) };
}
const data = { conversationId: 'old-room', userIds: ['alice', 'bob'] };

test('existing unverified chat member keys are available without profile identity or status', async () => {
  const { api } = fixture();
  const expected = { profiles: [{ id: 'alice', encryptionDevices: { phone: { publicKey } } },
    { id: 'bob', encryptionDevices: { newPhone: { publicKey } } }] };
  assert.deepEqual(await api.getConversationEncryptionProfiles(request(data)), expected);
  assert.deepEqual(await api.getConversationEncryptionProfiles(request(data, 'bob')), expected);
});

test('guests and outsiders cannot read any participant keys', async () => {
  const { api, reads } = fixture();
  await assert.rejects(api.getConversationEncryptionProfiles({ data }), { code: 'unauthenticated' });
  assert.deepEqual(reads, []);
  await assert.rejects(api.getConversationEncryptionProfiles(request(data, 'mallory')), { code: 'permission-denied' });
  assert.deepEqual(reads, ['conversations/old-room']);
});

test('a chat participant cannot enumerate keys for users outside the room', async () => {
  const { api, reads } = fixture();
  await assert.rejects(api.getConversationEncryptionProfiles(request({ ...data, userIds: ['mallory'] })), { code: 'permission-denied' });
  assert.deepEqual(reads, ['conversations/old-room']);
});

test('suspended chat members cannot bypass the room read restriction through the keys API', async () => {
  const { api, rows, reads } = fixture();
  rows.set('accountRestrictions/alice', { suspended: true });
  await assert.rejects(api.getConversationEncryptionProfiles(request(data)), { code: 'permission-denied' });
  assert.deepEqual(reads, ['conversations/old-room', 'accountRestrictions/alice']);
  rows.set('accountRestrictions/alice', { suspended: false });
  assert.equal((await api.getConversationEncryptionProfiles(request(data))).profiles.length, 2);
});

test('missing and malformed room memberships fail closed', async () => {
  for (const participants of [undefined, 'alice', ['alice'], ['alice', 'alice'], ['alice', 'bob', 'mallory'], ['alice', '../bob']]) {
    const { api, rows } = fixture();
    rows.set('conversations/old-room', { participants });
    await assert.rejects(api.getConversationEncryptionProfiles(request(data)), { code: 'permission-denied' });
  }
  const { api } = fixture();
  await assert.rejects(api.getConversationEncryptionProfiles(request({ ...data, conversationId: 'missing' })), { code: 'permission-denied' });
});

test('malformed paths and IDs are rejected before reading the database', async () => {
  const { api, reads } = fixture();
  for (const conversationId of [undefined, '', '../old-room', 'room/child', 42, 'a'.repeat(260)]) {
    await assert.rejects(api.getConversationEncryptionProfiles(request({ ...data, conversationId })), { code: 'invalid-argument' });
  }
  for (const userIds of [null, {}, ['../bob'], [''], Array(51).fill('bob')]) {
    await assert.rejects(api.getConversationEncryptionProfiles(request({ ...data, userIds })), { code: 'invalid-argument' });
  }
  assert.deepEqual(reads, []);
});

test('deleted owners return no identity and legacy owners without verification still return keys', async () => {
  const { api, rows } = fixture();
  rows.delete('users/alice');
  const bob = rows.get('users/bob'); delete bob.isFaceVerified;
  assert.deepEqual(await api.getConversationEncryptionProfiles(request({ ...data, userIds: ['bob', 'bob', 'alice'] })),
    { profiles: [{ id: 'bob', encryptionDevices: { newPhone: { publicKey } } }] });
});
