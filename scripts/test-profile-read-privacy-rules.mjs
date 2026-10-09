import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, documentId, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run only against the Firestore emulator.');
const env = await initializeTestEnvironment({ projectId: 'demo-campusmate-profile-privacy',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
try {
  const verification = { isFaceVerified: true, faceVerificationStatus: 'verified', faceVerifiedAt: new Date(1700000000000), faceMatchScore: 98 };
  const owners = ['alice', 'verified', 'unverified', 'legacy', 'matched'];
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const id of owners) {
      const metadata = id === 'verified' ? verification : id === 'legacy' ? {} : { isFaceVerified: false, faceVerificationStatus: 'unverified' };
      const profile = { id, name: id, isDiscoverable: true, updatedAt: new Date(), ...metadata };
      await setDoc(doc(db, 'users', id), profile);
      await setDoc(doc(db, 'profiles', id), profile);
      // Keep stale projections to prove that neither a true nor a missing
      // projection flag can bypass the new API-only read boundary.
      await setDoc(doc(db, 'discoveryProfiles', id), { ...profile, isFaceVerified: true });
    }
    for (const [from, to] of [['alice', 'matched'], ['matched', 'alice']]) {
      await setDoc(doc(db, 'decisions', `${from}_${to}`), { fromUserId: from, toUserId: to, type: 'like', status: 'accepted' });
    }
    await setDoc(doc(db, 'conversations', 'c-alice-matched'), {
      id: 'c-alice-matched', participants: ['alice', 'matched'], messages: [],
      participantProfiles: { alice: { id: 'alice' }, matched: { id: 'matched' } },
      lastMessage: 'ข้อความที่เข้ารหัส', updatedAt: new Date(),
    });
    await setDoc(doc(db, 'conversations', 'c-alice-matched', 'messages', 'm1'), {
      id: 'm1', senderId: 'alice', nonce: 'fixture-nonce', ciphertext: 'fixture-ciphertext', createdAt: new Date(),
    });
  });

  const alice = env.authenticatedContext('alice').firestore(), outsider = env.authenticatedContext('outsider').firestore();
  const guest = env.unauthenticatedContext().firestore();
  for (const target of ['verified', 'unverified', 'legacy', 'matched']) {
    await assertFails(getDoc(doc(alice, 'profiles', target)));
    await assertFails(getDoc(doc(guest, 'profiles', target)));
  }
  await assertFails(getDocs(collection(alice, 'profiles')));
  await assertFails(getDocs(query(collection(alice, 'profiles'), where('isFaceVerified', '==', true))));
  await assertFails(getDocs(query(collection(alice, 'profiles'), where(documentId(), 'in', ['verified', 'matched']))));
  await assertFails(getDocs(query(collection(alice, 'profiles'), where(documentId(), '==', 'alice'))));

  for (const id of owners) {
    const owner = env.authenticatedContext(id).firestore();
    await assertSucceeds(getDoc(doc(owner, 'profiles', id)));
    await assertFails(getDoc(doc(owner, 'discoveryProfiles', id)));
    await assertFails(getDoc(doc(alice, 'discoveryProfiles', id)));
  }
  await assertFails(getDocs(collection(alice, 'discoveryProfiles')));
  await assertFails(getDocs(query(collection(alice, 'discoveryProfiles'), where('isDiscoverable', '==', true), where('isFaceVerified', '==', true))));
  await assertFails(getDoc(doc(guest, 'discoveryProfiles', 'verified')));

  const verifiedOwner = env.authenticatedContext('verified').firestore(), profileRef = doc(verifiedOwner, 'profiles', 'verified');
  const before = (await getDoc(profileRef)).data();
  await assertSucceeds(updateDoc(profileRef, { name: 'Updated owner name', updatedAt: serverTimestamp() }));
  const after = (await getDoc(profileRef)).data();
  assert.equal(after.name, 'Updated owner name'); assert.equal(after.isFaceVerified, true);
  assert.equal(after.faceVerificationStatus, before.faceVerificationStatus);
  assert.equal(after.faceVerifiedAt.toMillis(), before.faceVerifiedAt.toMillis());
  assert.equal(after.faceMatchScore, before.faceMatchScore);
  for (const field of Object.keys(verification)) await assertFails(updateDoc(profileRef, { [field]: deleteField(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'profiles', 'verified'), { name: 'Forged name', updatedAt: serverTimestamp() }));

  // Existing chat authorization depends on room membership, not face state.
  for (const uid of ['alice', 'matched']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, 'conversations', 'c-alice-matched')));
    const rooms = await assertSucceeds(getDocs(query(collection(db, 'conversations'), where('participants', 'array-contains', uid))));
    assert.equal(rooms.size, 1);
    await assertSucceeds(getDoc(doc(db, 'conversations', 'c-alice-matched', 'messages', 'm1')));
    const messages = await assertSucceeds(getDocs(collection(db, 'conversations', 'c-alice-matched', 'messages')));
    assert.equal(messages.size, 1);
  }
  for (const db of [outsider, guest]) {
    await assertFails(getDoc(doc(db, 'conversations', 'c-alice-matched')));
    await assertFails(getDoc(doc(db, 'conversations', 'c-alice-matched', 'messages', 'm1')));
    await assertFails(getDocs(collection(db, 'conversations', 'c-alice-matched', 'messages')));
  }
  console.log('PASS current rules: peer profile/projection reads denied; owner edits retain verification metadata; unverified existing chat participants retain room/message reads; outsiders denied.');
} finally { await env.cleanup(); }
