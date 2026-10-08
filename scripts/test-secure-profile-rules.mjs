import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run only against the Firestore emulator.');
const environment = await initializeTestEnvironment({ projectId: 'demo-campusmate',
  firestore: { rules: readFileSync(new URL('../firestore.secure.rules', import.meta.url), 'utf8') } });
try {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const id of ['secure-reader', 'secure-sender', 'secure-match']) {
      await setDoc(doc(db, 'profiles', id), { id, name: id, isDiscoverable: true });
      await setDoc(doc(db, 'discoveryProfiles', id), { id, name: id, isDiscoverable: true });
    }
    for (const [from, to, status] of [['secure-sender', 'secure-reader', 'pending'], ['secure-match', 'secure-reader', 'accepted'], ['secure-reader', 'secure-sender', 'pending']]) {
      await setDoc(doc(db, 'decisions', `${from}_${to}`), { fromUserId: from, toUserId: to, status, type: 'like', likeMessage: 'private identity' });
    }
  });
  for (const claims of [{}, { plus: true, admin: true }]) {
    const db = environment.authenticatedContext('secure-reader', claims).firestore();
    await assertSucceeds(getDoc(doc(db, 'profiles', 'secure-reader')));
    await assertFails(getDoc(doc(db, 'profiles', 'secure-sender')));
    await assertFails(getDocs(collection(db, 'profiles')));
    await assertFails(getDoc(doc(db, 'discoveryProfiles', 'secure-sender')));
    await assertFails(getDocs(collection(db, 'discoveryProfiles')));
    await assertFails(getDoc(doc(db, 'decisions', 'secure-sender_secure-reader')));
    await assertFails(getDocs(query(collection(db, 'decisions'), where('toUserId', '==', 'secure-reader'))));
    await assertSucceeds(getDocs(query(collection(db, 'decisions'), where('fromUserId', '==', 'secure-reader'))));
    const accepted = await assertSucceeds(getDocs(query(collection(db, 'decisions'), where('toUserId', '==', 'secure-reader'), where('type', '==', 'like'), where('status', '==', 'accepted'))));
    assert.equal(accepted.size, 1);
    await assertFails(setDoc(doc(db, 'decisions', 'secure-reader_secure-sender'), { fromUserId: 'secure-reader', toUserId: 'secure-sender', status: 'accepted', type: 'like' }));
    await assertFails(setDoc(doc(db, 'entitlements', 'secure-reader'), { source: 'revenuecat', activeUntil: Date.now() + 86400000 }));
    await assertFails(setDoc(doc(db, 'profileVisibility', 'secure-reader'), { mode: 'incognito' }));
    const owner = doc(db, 'users', 'secure-reader');
    await assertFails(setDoc(owner, { id: 'secure-reader', updatedAt: serverTimestamp(), isFaceVerified: true }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'secure-reader'), {
        id: 'secure-reader', name: 'Before', updatedAt: serverTimestamp(),
        isFaceVerified: true, faceVerificationStatus: 'verified', faceVerifiedAt: 123, faceMatchScore: 98,
      });
    });
    await assertSucceeds(updateDoc(owner, { name: 'After', updatedAt: serverTimestamp() }));
    for (const field of ['isFaceVerified', 'faceVerificationStatus', 'faceVerifiedAt', 'faceMatchScore']) {
      await assertFails(updateDoc(owner, { [field]: deleteField(), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(owner, { [field]: field === 'isFaceVerified' ? false : 'forged', updatedAt: serverTimestamp() }));
    }
  }
  console.log('PASS staged rules reject direct identities, broad incoming queries and forged privilege; self/outgoing/accepted reads remain available.');
} finally { await environment.cleanup(); }
