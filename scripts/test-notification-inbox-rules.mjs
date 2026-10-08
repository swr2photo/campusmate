import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocs, getDoc, limit, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc, where } from 'firebase/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
const env = await initializeTestEnvironment({ projectId: 'demo-campusmate', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (let i = 0; i < 65; i++) await setDoc(doc(db, 'users/alice/notifications', `n${i}`), { type: 'message', title: 'ข้อความใหม่', body: 'มีข้อความใหม่', target: { conversationId: 'c-a-b' }, createdAt: new Date(1700000000000 + i * 1000), expiresAt: new Date(Date.now() + 86400000), readAt: null });
    await setDoc(doc(db, 'users/alice/notifications/face-verification'), { type: 'face_verification', title: 'ยืนยันใบหน้า', status: 'required', readAt: null, expiresAt: null, createdAt: new Date() });
  });
  const alice = env.authenticatedContext('alice').firestore(), second = env.authenticatedContext('alice').firestore(), bob = env.authenticatedContext('bob').firestore(), guest = env.unauthenticatedContext().firestore();
  const ref = doc(alice, 'users/alice/notifications/n1');
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(bob, 'users/alice/notifications/n1')));
  await assertFails(getDoc(doc(guest, 'users/alice/notifications/n1')));
  await assertFails(setDoc(doc(alice, 'users/alice/notifications/forged'), { title: 'fake' }));
  await assertFails(updateDoc(ref, { title: 'changed', readAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { readAt: new Date(0) }));
  await assertFails(updateDoc(doc(alice, 'users/alice/notifications/face-verification'), { status: 'completed' }));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(updateDoc(ref, { readAt: serverTimestamp() }));
  assert.ok((await getDoc(doc(second, 'users/alice/notifications/n1'))).data().readAt);
  for (const name of ['users', 'profiles']) {
    const legacy = doc(bob, name, 'bob');
    await assertFails(setDoc(legacy, { id: 'bob', name: 'Bob', isDiscoverable: true, updatedAt: serverTimestamp(), isFaceVerified: true }));
    await assertSucceeds(setDoc(legacy, { id: 'bob', name: 'Bob', isDiscoverable: true, updatedAt: serverTimestamp(), isFaceVerified: false, faceVerificationStatus: 'unverified', faceVerifiedAt: null, faceMatchScore: null }));
    await assertFails(updateDoc(legacy, { isFaceVerified: true, faceVerificationStatus: 'verified', updatedAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), name, 'alice'), { id: 'alice', name: 'Alice', isDiscoverable: true, updatedAt: new Date(), isFaceVerified: true, faceVerificationStatus: 'verified' });
    });
    const profile = doc(alice, name, 'alice');
    await assertFails(updateDoc(profile, { isFaceVerified: false, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(profile, { faceVerificationStatus: 'required', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(profile, { name: 'New name', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(profile, { id: 'alice', name: 'forged', updatedAt: serverTimestamp(), isDiscoverable: true, isFaceVerified: true }));
  }
  const source = collection(alice, 'users/alice/notifications');
  const page1 = await assertSucceeds(getDocs(query(source, orderBy('createdAt', 'desc'), limit(30))));
  const page2 = await assertSucceeds(getDocs(query(source, orderBy('createdAt', 'desc'), startAfter(page1.docs.at(-1)), limit(30))));
  assert.equal(page1.size, 30); assert.equal(page2.size, 30);
  assert.equal(new Set([...page1.docs, ...page2.docs].map(d => d.id)).size, 60);
  const unread = await assertSucceeds(getDocs(query(source, where('readAt', '==', null))));
  assert.equal(unread.size, 65);
  console.log('PASS: owner access, forged content/status denied, cross-device read, pagination and unread query');
} finally { await env.cleanup(); }
