import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { sendNotification } from './adminNotifications.js';
import { moderateReport, moderationPush } from './adminModeration.js';
import { inboxId } from './notificationInbox.js';

function database(initial = {}) {
  const rows = new Map(Object.entries(initial)), revisions = new Map();
  let sequence = 0;
  const write = (ref, data, merge = false) => {
    rows.set(ref.path, merge ? { ...rows.get(ref.path), ...data } : data);
    revisions.set(ref.path, (revisions.get(ref.path) || 1) + 1);
  };
  const snapshot = ref => ({ ref, id: ref.id, exists: rows.has(ref.path), data: () => rows.get(ref.path),
    get: key => rows.get(ref.path)?.[key], updateTime: { seconds: revisions.get(ref.path) || 1, nanoseconds: 0 } });
  const doc = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(doc(path)),
    set: async (data, options) => write(doc(path), data, options?.merge), update: async data => write(doc(path), data, true),
    create: async data => { if (rows.has(path)) throw { code: 6 }; write(doc(path), data); },
    collection: name => collection(path + '/' + name),
  });
  const collection = path => {
    const filters = []; let max = Infinity;
    const api = { doc: id => doc(path + '/' + (id || 'generated-' + ++sequence)),
      where: (key, operation, value) => { filters.push([key, operation, value]); return api; },
      limit: value => { max = value; return api; },
      get: async () => {
        const docs = [...rows.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1)
          .filter(key => filters.every(([field, op, value]) => op === 'in' ? value.includes(rows.get(key)[field]) : rows.get(key)[field] === value))
          .slice(0, max).map(key => snapshot(doc(key)));
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
    return api;
  };
  const transaction = () => {
    const writes = [];
    return { get: async ref => snapshot(ref),
      set: (ref, data, options) => writes.push(() => write(ref, data, options?.merge)),
      update: (ref, data) => writes.push(() => write(ref, data, true)),
      create: (ref, data) => writes.push(() => { assert.equal(rows.has(ref.path), false); write(ref, data); }),
      commit: async () => writes.forEach(run => run()),
    };
  };
  return { rows, doc, collection, getAll: async (...refs) => refs.map(snapshot), batch: transaction,
    runTransaction: async fn => { const tx = transaction(); const result = await fn(tx); await tx.commit(); return result; } };
}

const announcementId = '12345678-1234-1234-1234-123456789abc';
function announcementDb(tokens = []) {
  return database({
    ['adminNotificationPreviews/' + announcementId]: { actor: 'admin', title: 'Campus announcement', body: 'Read the details', route: '/home', audience: 'selected', uids: ['alice', 'bob'], expiresAt: Timestamp.fromMillis(Date.now() + 60000) },
    'users/alice': {}, 'users/bob': {},
    ...Object.fromEntries(tokens.map((uid, index) => ['pushTokens/device-' + index, { userId: uid, platform: 'android', expoPushToken: `ExponentPushToken[${uid}1234567890123456789012]` }])),
  });
}
const auth = { getUsers: async identifiers => ({ users: identifiers.map(({ uid }) => ({ uid, disabled: false })), notFound: [] }) };

test('admin announcement push and restriction banner carry each recipient inbox ID', async () => {
  const db = announcementDb(['alice', 'bob']), sent = [];
  await sendNotification({ db, auth, actor: 'admin', id: announcementId, client: { sendPushNotificationsAsync: async messages => {
    sent.push(...messages); return messages.map((_message, index) => ({ status: 'ok', id: 'ticket-' + index }));
  } } });
  assert.equal(sent.length, 2);
  for (const [index, uid] of ['alice', 'bob'].entries()) {
    const id = inboxId('announcement:' + announcementId, uid);
    assert.equal(sent[index].data.notificationId, id);
    assert.equal(db.rows.get('accountRestrictions/' + uid).latestAnnouncement.notificationId, id);
    assert.equal(db.rows.get(`users/${uid}/notifications/${id}`).readAt, null);
  }
  assert.notEqual(sent[0].data.notificationId, sent[1].data.notificationId);
});

test('no-token admin announcement persists history and retry preserves read state', async () => {
  const db = announcementDb(), client = { sendPushNotificationsAsync: async () => { throw new Error('No token should be sent'); } };
  await sendNotification({ db, auth, actor: 'admin', id: announcementId, client });
  const path = `users/alice/notifications/${inboxId('announcement:' + announcementId, 'alice')}`;
  db.rows.get(path).readAt = 123;
  const again = await sendNotification({ db, auth, actor: 'admin', id: announcementId, client });
  assert.equal(again.duplicate, true);
  assert.equal(db.rows.get(path).readAt, 123);
  assert.equal([...db.rows.keys()].filter(key => key.includes('/notifications/')).length, 2);
});

test('moderation creates history atomically without push and leaves encrypted chat untouched', async () => {
  const encrypted = { senderId: 'bob', encrypted: true, ciphertext: 'ciphertext-fixture', nonce: 'nonce-fixture' };
  const db = database({
    'reports/report-1': { reportedUserId: 'bob', reporterId: 'alice', conversationId: 'room-1', status: 'pending' },
    'conversations/room-1': { participants: ['alice', 'bob'] },
    'conversations/room-1/messages/message-1': encrypted,
  });
  let pushId;
  const data = { id: 'report-1', revision: '1:0', note: 'Please follow the community rules', action: 'warn' };
  const result = await moderateReport({ db, actor: 'admin', data, notify: async (_db, _uid, _body, _report, notificationId) => { pushId = notificationId; return { state: 'no-device', accepted: 0 }; } });
  assert.equal(result.warningSaved, true);
  const notice = db.rows.get('accountRestrictions/bob').latestWarning;
  assert.equal(notice.notificationId, inboxId('moderation:' + notice.id, 'bob'));
  assert.equal(pushId, notice.notificationId);
  const path = 'users/bob/notifications/' + notice.notificationId, row = db.rows.get(path);
  assert.equal(row.type, 'system'); assert.equal(row.body, data.note); assert.deepEqual(row.target, {});
  assert.ok(row.expiresAt.toMillis() > Date.now() + 89 * 86400000);
  assert.deepEqual(db.rows.get('conversations/room-1/messages/message-1'), encrypted);
  row.readAt = 123;
  await assert.rejects(moderateReport({ db, actor: 'admin', data, notify: async () => { throw new Error('Stale operation must not notify'); } }), error => error.code === 'aborted');
  assert.equal(db.rows.get(path).readAt, 123);
  assert.equal([...db.rows.keys()].filter(key => key.includes('/notifications/')).length, 1);
});

test('disabled push preference does not invoke the moderation push transport', async () => {
  const db = database({ 'users/bob': { notificationsEnabled: false } });
  assert.deepEqual(await moderationPush(db, 'bob', 'Warning', 'report-1', 'notice-1'), { state: 'disabled', accepted: 0 });
});
