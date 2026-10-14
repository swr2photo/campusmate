import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchIdentityStatus,
  identityOrigin,
  LIVENESS_METHOD,
  PhotoSyncError,
  syncPhotoVerification,
} from './photoVerificationSync.js';

const PHOTO = 'https://images.getcampusmate.app/users/u1/avatar.jpg?v=3';

function fakeDb(docs) {
  const store = new Map(Object.entries(docs));
  const ref = (path) => ({ path });
  const snapshot = (path) => ({
    exists: store.has(path),
    data: () => (store.has(path) ? { ...store.get(path) } : undefined),
  });
  return {
    store,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(work) {
      const writes = [];
      const result = await work({
        get: async (r) => snapshot(r.path),
        update: (r, patch) => writes.push(() => store.set(r.path, { ...store.get(r.path), ...patch })),
        set: (r, value) => writes.push(() => store.set(r.path, { ...value })),
        delete: (r) => writes.push(() => store.delete(r.path)),
      });
      writes.forEach((write) => write());
      return result;
    },
  };
}

const ownToken = async () => ({ uid: 'u1' });
const verifiedStatus = async () => ({ status: 'VERIFIED', badge: 'PHOTO_VERIFIED', photo: PHOTO });

test('a server decision on the current photo becomes the Firestore badge', async () => {
  const db = fakeDb({ 'users/u1': { avatarUri: PHOTO, isFaceVerified: false } });
  const result = await syncPhotoVerification({
    db, uid: 'u1', idToken: 't', verifyIdToken: ownToken, readStatus: verifiedStatus, now: new Date(0),
  });
  assert.deepEqual(result, { status: 'VERIFIED', badge: 'PHOTO_VERIFIED', changed: true });
  assert.equal(db.store.get('users/u1').isFaceVerified, true);
  assert.equal(db.store.get('users/u1').faceVerificationStatus, 'verified');
  assert.equal(db.store.get('users/u1').faceMatchScore, null);
  assert.equal(db.store.get('faceVerifications/u1').method, LIVENESS_METHOD);
  assert.equal(db.store.get('faceVerifications/u1').avatarUri, PHOTO);
  // Running again changes nothing.
  const again = await syncPhotoVerification({ db, uid: 'u1', idToken: 't', verifyIdToken: ownToken, readStatus: verifiedStatus });
  assert.equal(again.changed, false);
});

test('a verified decision for another photo never badges the current one', async () => {
  const db = fakeDb({ 'users/u1': { avatarUri: 'https://images.getcampusmate.app/users/u1/avatar.jpg?v=4' } });
  const result = await syncPhotoVerification({ db, uid: 'u1', idToken: 't', verifyIdToken: ownToken, readStatus: verifiedStatus });
  assert.equal(result.status, 'PHOTO_CHANGED');
  assert.equal(result.badge, null);
  assert.equal(db.store.get('users/u1').isFaceVerified, undefined);
  assert.equal(db.store.has('faceVerifications/u1'), false);
});

test('a liveness badge is withdrawn when the server revokes it', async () => {
  const db = fakeDb({
    'users/u1': { avatarUri: PHOTO, isFaceVerified: true, faceVerificationStatus: 'verified' },
    'faceVerifications/u1': { avatarUri: PHOTO, method: LIVENESS_METHOD },
  });
  const result = await syncPhotoVerification({
    db, uid: 'u1', idToken: 't', verifyIdToken: ownToken, readStatus: async () => ({ status: 'REVOKED', badge: null }),
  });
  assert.deepEqual(result, { status: 'REVOKED', badge: null, changed: true });
  assert.equal(db.store.get('users/u1').isFaceVerified, false);
  assert.equal(db.store.has('faceVerifications/u1'), false);
});

test('a badge from the earlier selfie flow is left alone', async () => {
  const db = fakeDb({
    'users/u1': { avatarUri: PHOTO, isFaceVerified: true, faceVerificationStatus: 'verified' },
    'faceVerifications/u1': { avatarUri: PHOTO, method: 'rekognition' },
  });
  const result = await syncPhotoVerification({
    db, uid: 'u1', idToken: 't', verifyIdToken: ownToken, readStatus: async () => ({ status: 'UNVERIFIED', badge: null }),
  });
  assert.equal(result.badge, 'PHOTO_VERIFIED');
  assert.equal(result.changed, false);
  assert.equal(db.store.get('users/u1').isFaceVerified, true);
  assert.equal(db.store.get('faceVerifications/u1').method, 'rekognition');
});

test('only the caller own, unrevoked token is forwarded', async () => {
  const db = fakeDb({ 'users/u1': { avatarUri: PHOTO } });
  let reads = 0;
  const readStatus = async () => { reads += 1; return verifiedStatus(); };
  await assert.rejects(
    syncPhotoVerification({ db, uid: 'u1', idToken: 't', verifyIdToken: async () => ({ uid: 'mallory' }), readStatus }),
    (error) => error instanceof PhotoSyncError && error.code === 'permission-denied',
  );
  await assert.rejects(
    syncPhotoVerification({ db, uid: 'u1', idToken: 't', verifyIdToken: async () => { throw new Error('revoked'); }, readStatus }),
    (error) => error.code === 'unauthenticated',
  );
  for (const idToken of ['', null, 'x'.repeat(9000)]) {
    await assert.rejects(
      syncPhotoVerification({ db, uid: 'u1', idToken, verifyIdToken: ownToken, readStatus }),
      (error) => error.code === 'invalid-argument',
    );
  }
  assert.equal(reads, 0);
});

test('a forged status without the verified photo grants nothing', async () => {
  const db = fakeDb({ 'users/u1': { avatarUri: PHOTO } });
  for (const status of [
    { status: 'VERIFIED', badge: 'PHOTO_VERIFIED' },
    { status: 'VERIFIED', badge: null, photo: PHOTO },
    { status: 'LEGACY', badge: 'PHOTO_VERIFIED', photo: PHOTO },
  ]) {
    const result = await syncPhotoVerification({ db, uid: 'u1', idToken: 't', verifyIdToken: ownToken, readStatus: async () => status });
    assert.equal(result.badge, null);
  }
  assert.equal(db.store.get('users/u1').isFaceVerified, undefined);
});

test('the identity origin must be a bare https origin', () => {
  assert.equal(identityOrigin('https://campusmate-backend-502731779521.fly.dev'), 'https://campusmate-backend-502731779521.fly.dev');
  for (const raw of ['', 'http://x.test', 'https://x.test/path', 'https://u:p@x.test', 'https://x.test/?a=1', 'javascript:alert(1)']) {
    assert.equal(identityOrigin(raw), null, raw);
  }
});

test('status reads refuse redirects, oversized bodies and failures', async () => {
  let options;
  const ok = await fetchIdentityStatus({
    origin: 'https://id.test',
    idToken: 'tok',
    fetchImpl: async (url, init) => { options = { url, ...init }; return { ok: true, status: 200, text: async () => '{"status":"VERIFIED"}' }; },
  });
  assert.equal(ok.status, 'VERIFIED');
  assert.equal(options.url, 'https://id.test/v1/identity/photo-verification');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer tok');
  const reply = (status, body) => async () => ({ ok: status < 400, status, text: async () => body });
  await assert.rejects(fetchIdentityStatus({ origin: 'https://id.test', idToken: 't', fetchImpl: reply(401, '{}') }), (e) => e.code === 'unauthenticated');
  await assert.rejects(fetchIdentityStatus({ origin: 'https://id.test', idToken: 't', fetchImpl: reply(503, '{}') }), (e) => e.code === 'unavailable');
  await assert.rejects(fetchIdentityStatus({ origin: 'https://id.test', idToken: 't', fetchImpl: reply(200, 'x'.repeat(20000)) }), (e) => e.code === 'unavailable');
  await assert.rejects(fetchIdentityStatus({ origin: 'https://id.test', idToken: 't', fetchImpl: async () => { throw new TypeError('redirect'); } }), (e) => e.code === 'unavailable');
});
