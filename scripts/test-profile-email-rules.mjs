// firebase emulators:exec --only firestore --project demo-campusmate "node scripts/test-profile-email-rules.mjs"
// The profile `email` field can never be set to someone else's address.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run only against the Firestore emulator.');

const ADMIN = '6710210317@psu.ac.th';
for (const file of ['firestore.rules', 'firestore.secure.rules']) {
  const environment = await initializeTestEnvironment({
    projectId: 'demo-campusmate',
    firestore: { rules: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') },
  });
  try {
    const self = environment.authenticatedContext('mallory', { email: '6912345678@psu.ac.th', email_verified: true }).firestore();
    const ref = doc(self, 'users', 'mallory');
    const base = { id: 'mallory', name: 'Mallory', updatedAt: serverTimestamp() };

    // Create: another address is refused; own address or none is fine.
    await assertFails(setDoc(ref, { ...base, email: ADMIN }));
    await assertSucceeds(setDoc(ref, { ...base, email: '6912345678@PSU.ac.th' }));
    await assertFails(updateDoc(ref, { email: ADMIN, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref, { ...base, email: ADMIN }));

    // A legacy stored address that no longer matches the token may be kept.
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'legacy'), { id: 'legacy', name: 'Legacy', email: 'old@gmail.com', updatedAt: serverTimestamp() });
    });
    const legacy = environment.authenticatedContext('legacy', { email: '6900000000@psu.ac.th', email_verified: true }).firestore();
    const legacyRef = doc(legacy, 'users', 'legacy');
    await assertSucceeds(setDoc(legacyRef, { id: 'legacy', name: 'Renamed', email: 'old@gmail.com', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(legacyRef, { id: 'legacy', name: 'Renamed', email: ADMIN, updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(legacyRef, { id: 'legacy', name: 'Renamed', email: '6900000000@psu.ac.th', updatedAt: serverTimestamp() }));

    // No email claim at all (e.g. anonymous/phone auth) cannot claim one.
    const anonymous = environment.authenticatedContext('anon').firestore();
    await assertFails(setDoc(doc(anonymous, 'users', 'anon'), { id: 'anon', name: 'Anon', email: ADMIN, updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(anonymous, 'users', 'anon'), { id: 'anon', name: 'Anon', updatedAt: serverTimestamp() }));

    // Server-only verification records stay closed to clients.
    for (const collection of ['faceVerifications', 'faceVerificationThrottle', 'faceVerificationSessions']) {
      await assertFails(setDoc(doc(self, collection, 'mallory'), { avatarUri: 'x' }));
    }
    console.log(`${file}: profile email rules OK`);
  } finally {
    await environment.cleanup();
  }
}
