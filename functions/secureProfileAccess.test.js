import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { createProfileAccessApi, loadVisibleProfiles } from './secureProfileAccess.js';

const instant = 1_800_000_000_000;
const plus = { source: 'revenuecat', entitlementId: 'campusmate_plus', verifiedAt: instant, activeUntil: instant + 10000 };
const request = (data = {}, uid = 'viewer') => ({ auth: { uid }, data });
function database(seed = {}) {
  const rows = new Map(Object.entries(seed)), reads = [], queryReads = [];
  const snapshot = (path) => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => rows.get(path) });
  const doc = (path) => ({ path, get: async () => { reads.push(path); return snapshot(path); },
    set: async (value, options) => rows.set(path, options?.merge ? { ...rows.get(path), ...value } : value) });
  // Each query needs its own predicate, including its pagination boundary.
  const makeQuery = (name, filters = [], after = null, limit = Infinity) => {
    const selectRows = () => [...rows.keys()].filter((path) => path.startsWith(`${name}/`) && path.split('/').length === 2)
      .map(snapshot).filter((snap) => filters.every(([field, value]) => snap.data()[field] === value))
      .sort((a, b) => b.id.localeCompare(a.id)).filter((snap) => !after || snap.id.localeCompare(after) < 0);
    return {
      where: (field, operation, value) => { assert.equal(operation, '=='); return makeQuery(name, [...filters, [field, value]], after, limit); },
      orderBy: () => makeQuery(name, filters, after, limit), limit: (size) => makeQuery(name, filters, after, size),
      startAfter: (document) => makeQuery(name, filters, document.id, limit),
      count: () => ({ get: async () => ({ data: () => ({ count: selectRows().length }) }) }),
      get: async () => { queryReads.push(name); const docs = selectRows().slice(0, limit); return { docs, size: docs.length }; },
    };
  };
  const db = { rows, reads, queryReads, doc, collection: makeQuery,
    getAll: async (...refs) => { reads.push(...refs.map((ref) => ref.path)); db.afterProfiles?.(); return refs.map((ref) => snapshot(ref.path)); },
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, value, options) => ref.set(value, options) }),
  };
  return db;
}
const profile = (id) => ({ id, name: id, isDiscoverable: true, isFaceVerified: true, avatarUri: `https://example.test/${id}.webp`, avatarRevision: 7 });
const like = (from, to = 'viewer', status = 'pending') => ({ fromUserId: from, toUserId: to, type: 'like', status, createdAt: Timestamp.fromMillis(instant), likeMessage: 'private greeting' });
function api(db, overrides = {}) { return createProfileAccessApi({ db, now: () => instant, serverTimestamp: () => Timestamp.fromMillis(instant), ...overrides }); }

test('free API returns only aggregate count and never enumerates identity documents', async () => {
  const db = database({ 'decisions/alice_viewer': like('alice'), 'decisions/bob_other': like('bob', 'other') });
  assert.deepEqual(await api(db).getIncomingLikeSummary(request({ uid: 'other', plus: true })),
    { pendingCount: 1, pendingLikes: [], identitiesAvailable: false, hasMore: false, nextCursor: null });
  assert.deepEqual(db.queryReads, []);
  assert.deepEqual(db.reads, ['entitlements/viewer']);
  await assert.rejects(api(db).getIncomingLikeSummary({ data: { uid: 'viewer' } }), { code: 'unauthenticated' });
});

test('visibility checks both block directions, missing owners, expiry and accepted matches', async () => {
  const db = database({ 'users/alice': profile('alice'), 'profileVisibility/alice': { mode: 'incognito' }, 'entitlements/alice': plus });
  assert.deepEqual(await loadVisibleProfiles(db, 'viewer', ['alice'], () => instant), []);
  db.rows.set('decisions/alice_viewer', like('alice'));
  assert.equal((await loadVisibleProfiles(db, 'viewer', ['alice'], () => instant))[0].avatarRevision, 7);
  assert.deepEqual(await loadVisibleProfiles(db, 'viewer', ['alice'], () => instant + 10000), []);
  db.rows.set('conversations/c-alice-viewer', { participants: ['alice', 'viewer'] });
  assert.equal((await loadVisibleProfiles(db, 'viewer', ['alice'], () => instant + 10000)).length, 1);
  for (const path of ['users/alice/blockedUsers/viewer', 'users/viewer/blockedUsers/alice']) {
    db.rows.set(path, {}); assert.deepEqual(await loadVisibleProfiles(db, 'viewer', ['alice'], () => instant), []); db.rows.delete(path);
  }
  db.rows.delete('users/alice'); assert.deepEqual(await loadVisibleProfiles(db, 'viewer', ['alice'], () => instant), []);
});

test('unverified owners are hidden in profile reads even for established matches', async () => {
  const { isFaceVerified, ...legacy } = profile('bob');
  assert.equal(isFaceVerified, true);
  const db = database({ 'users/bob': legacy, 'users/carol': { ...profile('carol'), isFaceVerified: false }, 'users/alice': profile('alice') });
  assert.deepEqual((await loadVisibleProfiles(db, 'viewer', ['alice', 'bob', 'carol'], () => instant)).map((entry) => entry.id), ['alice']);
  // A pending like from the unverified owner does not reveal them either.
  db.rows.set('decisions/bob_viewer', like('bob'));
  assert.deepEqual((await loadVisibleProfiles(db, 'viewer', ['bob'], () => instant)), []);
  // A conversation cannot bypass verification when opening a public profile link.
  db.rows.set('conversations/c-bob-viewer', { participants: ['bob', 'viewer'] });
  assert.equal((await loadVisibleProfiles(db, 'viewer', ['bob'], () => instant)).length, 0);
  // The owner always sees their own profile.
  assert.equal((await loadVisibleProfiles(db, 'carol', ['carol'], () => instant)).length, 1);
});

test('free caller cannot set incognito or forge a different owner; public remains available', async () => {
  const db = database();
  await assert.rejects(api(db).setProfileVisibility(request({ mode: 'incognito', uid: 'alice', plus: true })), { code: 'permission-denied' });
  await api(db).setProfileVisibility(request({ mode: 'public', uid: 'alice' }));
  assert.equal(db.rows.get('profileVisibility/viewer').mode, 'public');
  assert.equal(db.rows.has('profileVisibility/alice'), false);
  db.rows.set('entitlements/viewer', plus);
  await api(db).setProfileVisibility(request({ mode: 'incognito' }));
  assert.equal(db.rows.get('profileVisibility/viewer').mode, 'incognito');
});

test('revoke during profile hydration suppresses all paid identities in the response', async () => {
  const db = database({ 'users/alice': profile('alice'), 'entitlements/viewer': plus, 'decisions/alice_viewer': like('alice') });
  db.afterProfiles = () => db.rows.delete('entitlements/viewer');
  assert.deepEqual(await api(db).getIncomingLikeSummary(request()), { pendingCount: 1, pendingLikes: [], identitiesAvailable: false, hasMore: false, nextCursor: null });
});

test('pagination uses opaque owner-bound cursors and rejects corrupt or expired server state', async () => {
  const db = database({ 'entitlements/viewer': plus });
  for (let i = 0; i < 21; i++) { const id = `alice${String(i).padStart(2, '0')}`; db.rows.set(`users/${id}`, profile(id)); db.rows.set(`decisions/${id}_viewer`, like(id)); }
  const cursor = '98765432-1234-4234-8234-123456789012', access = api(db, { makeCursor: () => cursor });
  const first = await access.getIncomingLikeSummary(request());
  assert.equal(first.pendingLikes.length, 20); assert.equal(first.nextCursor, cursor);
  assert.equal((await access.getIncomingLikeSummary(request({ cursor }))).pendingLikes.length, 1);
  // A free caller still sees only the count, irrespective of a guessed token.
  assert.deepEqual(await access.getIncomingLikeSummary(request({ cursor }, 'other')),
    { pendingCount: 0, pendingLikes: [], identitiesAvailable: false, hasMore: false, nextCursor: null });
  db.rows.set('entitlements/other', plus);
  await assert.rejects(access.getIncomingLikeSummary(request({ cursor }, 'other')), { code: 'invalid-argument' });
  for (const saved of [{ decisionId: 'alice00_viewer' }, { decisionId: 'alice00_viewer', expiresAt: Timestamp.fromMillis(instant) },
    { decisionId: '../alice', expiresAt: Timestamp.fromMillis(instant + 1) }]) {
    db.rows.set(`likePageCursors/viewer/tokens/${cursor}`, saved);
    await assert.rejects(access.getIncomingLikeSummary(request({ cursor })), { code: 'invalid-argument' });
  }
});
