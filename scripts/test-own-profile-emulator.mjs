import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run only against the disposable Firestore emulator');
const environment = await initializeTestEnvironment({ projectId: 'demo-campusmate-profile-sync', firestore: {
  rules: readFileSync('firestore.rules', 'utf8'),
} });
const uid = 'profile-sync-fixture';
const photo = 'https://example.test/users/profile-sync-fixture/avatar.jpg';
const stops = [];
function clientSync(db, onProfile) {
  const service = readFileSync('src/services/firestoreService.js', 'utf8');
  const listener = service.slice(service.indexOf('export function subscribeToFaceVerification('), service.indexOf('export async function getUserProfile('))
    .replace(/^export /gm, '').replace("import('firebase/auth')", 'Promise.resolve({getAuth})');
  const sync = readFileSync('src/services/ownProfileSync.js', 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const verification = readFileSync('src/utils/faceVerificationState.js', 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({ RUST_BACKEND: false, requireFirebase: () => ({ db, app: {} }),
    getAuth: () => ({}), waitForAuthReady: async () => ({ uid }), doc, onSnapshot,
    normalizeProfileRecord: (id, record) => ({ ...record, id }), getOfflineQueue: async () => [],
  });
  vm.runInContext(`${verification}\n${listener}\n${sync}\nglobalThis.subscribe = subscribeToOwnProfileUpdates;`, context);
  const stop = context.subscribe(uid, onProfile, error => { throw error; }); stops.push(stop); return stop;
}
async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the other client profile');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
try {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', uid), { id: uid, nickname: 'Before', avatarUri: photo,
      avatarRevision: 1, updatedAt: serverTimestamp(), isFaceVerified: false });
  });
  // Separate SDK clients, both authenticated as the same owner. No production data.
  const first = environment.authenticatedContext(uid).firestore();
  const second = environment.authenticatedContext(uid).firestore();
  let a, b;
  clientSync(first, value => { a = value; });
  const stopSecond = clientSync(second, value => { b = value; });
  await waitFor(() => a?.avatarRevision === 1 && b?.avatarRevision === 1);
  await updateDoc(doc(first, 'users', uid), { nickname: 'Changed on A', avatarRevision: 2, updatedAt: serverTimestamp() });
  await waitFor(() => b?.avatarRevision === 2 && b.nickname === 'Changed on A');
  assert.equal(b.avatarUri, photo);
  await updateDoc(doc(second, 'users', uid), { nickname: 'Changed on B', avatarRevision: 3, updatedAt: serverTimestamp() });
  await waitFor(() => a?.avatarRevision === 3 && b?.avatarRevision === 3 && a.nickname === 'Changed on B');
  stopSecond();
  await updateDoc(doc(first, 'users', uid), { avatarRevision: 4, updatedAt: serverTimestamp() });
  await waitFor(() => a?.avatarRevision === 4);
  assert.equal(b.avatarRevision, 3);
  clientSync(second, value => { b = value; });
  await waitFor(() => b?.avatarRevision === 4);
  console.log('PASS: two authenticated Firestore clients receive name and same-URL avatar revision edits in both directions; reconnect catches missed edits; owner rules remain active.');
} finally {
  stops.forEach(stop => stop());
  await environment.cleanup();
}
