import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { createAccountDeletionOtp } from '../functions/accountDeletionOtp.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run only in the disposable Firestore emulator');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const projectId = 'demo-campusmate-deletion';
const environment = await initializeTestEnvironment({ projectId, firestore: {
  rules: readFileSync(process.env.DELETION_RULES_FILE || 'firestore.rules', 'utf8'),
} });
const app = initializeApp({ projectId });
const db = getFirestore(app);
let code, now = Date.now();
const api = createAccountDeletionOtp({ db, auth: { getUser: async () => ({ email: 'fixture@example.test' }) }, now: () => now,
  sendEmail: async message => { code = message.code; },
});
const request = (uid = 'fixture', input = code) => ({ auth: { uid, token: { auth_time: Math.floor(now / 1000) } }, data: { code: input } });
try {
  // A client cannot forge the new server-owned authorization collection.
  for (const uid of ['fixture', 'other']) {
    const client = environment.authenticatedContext(uid).firestore();
    await assertFails(client.doc('accountDeletionChallenges/fixture').set({ state: 'verified' }));
    await assertFails(client.doc('accountDeletionChallenges/fixture').get());
  }
  await assert.rejects(api.authorize(request()), { code: 'failed-precondition' });
  await api.send(request());
  assert.equal((await db.doc('accountDeletionChallenges/fixture').get()).get('code'), undefined);
  await api.verify(request());
  const authorization = await api.authorize(request());
  assert.equal(authorization.uid, 'fixture');
  await api.complete(authorization);
  assert.equal((await db.doc('accountDeletionChallenges/fixture').get()).exists, false);
  await api.send(request('guesses'));
  await Promise.allSettled(Array.from({ length: 8 }, () => api.verify(request('guesses', '000000'))));
  assert.equal((await db.doc('accountDeletionChallenges/guesses').get()).get('attempts'), 5);
  await assert.rejects(api.verify(request('guesses')), { code: 'resource-exhausted' });
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    const auth = getAuth(app);
    await auth.createUser({ uid: 'fixture', email: 'fixture@example.test' });
    await db.doc('users/fixture').set({ email: 'fixture@example.test' });
    await db.doc('profiles/fixture').set({ nickname: 'disposable fixture' });
    await db.doc('profiles/peer').set({ nickname: 'preserve peer' });
    await db.doc('conversations/fixture-room').set({ participants: ['fixture', 'peer'] });
    await db.doc('conversations/fixture-room/messages/one').set({ text: 'fixture only' });
    await db.doc('decisions/outgoing').set({ fromUserId: 'fixture', toUserId: 'peer' });
    await db.doc('decisions/incoming').set({ fromUserId: 'peer', toUserId: 'fixture' });
    const image = getStorage(app).bucket('campusmate-7f1ab.firebasestorage.app').file('profile_gallery/fixture/test.jpg');
    await image.save(Buffer.from('emulator fixture only'), { resumable: false });
    const { deleteUserData } = await import('../functions/accountDeletionFunctions.js');
    const originalFetch = globalThis.fetch;
    let avatarDeletes = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://campusmate-upload.comcamp.workers.dev/avatar/fixture');
      assert.equal(options.method, 'DELETE'); avatarDeletes++;
      return { ok: false, status: 404 };
    };
    try {
      await assert.rejects(deleteUserData.run(request()), { code: 'failed-precondition' });
      assert.equal(avatarDeletes, 0);
      assert.equal((await db.doc('users/fixture').get()).exists, true);
      now += 60_001;
      await api.send(request()); await api.verify(request());
      const authorized = request(); authorized.rawRequest = { headers: { authorization: 'Bearer emulator-only' } };
      const result = await deleteUserData.run(authorized);
      assert.equal(result.deleted, true);
      assert.equal(avatarDeletes, 1);
      for (const path of ['users/fixture', 'profiles/fixture', 'conversations/fixture-room', 'conversations/fixture-room/messages/one', 'decisions/outgoing', 'decisions/incoming']) {
        assert.equal((await db.doc(path).get()).exists, false, path);
      }
      assert.equal((await db.doc('profiles/peer').get()).exists, true);
      assert.equal((await image.exists())[0], false);
      await assert.rejects(auth.getUser('fixture'), { code: 'auth/user-not-found' });
    } finally { globalThis.fetch = originalFetch; }
    console.log('Deletion cascade passed against Auth, Firestore and Storage emulators; peer data preserved.');
  }
  console.log('Deletion emulator passed: server-only rules, verified authorization, cleanup, concurrent attempt limit. No cloud writes or real email.');
} finally {
  await environment.cleanup();
  await db.terminate();
  await deleteApp(app);
}
