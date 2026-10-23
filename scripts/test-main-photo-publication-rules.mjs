import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Firestore emulator required');
const env = await initializeTestEnvironment({ projectId: 'demo-campusmate', firestore: {
  rules: readFileSync('firestore.rules', 'utf8'),
} });
try {
  const owner = env.authenticatedContext('publication-owner').firestore();
  const old = 'https://example.test/old.jpg', candidate = 'https://example.test/candidate.jpg';
  const base = { id: 'publication-owner', name: 'Owner', avatarUri: old, avatarRevision: 1, updatedAt: serverTimestamp() };
  for (const collection of ['users', 'profiles']) {
    await assertSucceeds(setDoc(doc(owner, collection, base.id), collection === 'profiles' ? { ...base, isDiscoverable: true } : base));
  }
  for (const collection of ['users', 'profiles']) {
    const ref = doc(owner, collection, base.id);
    await assertFails(updateDoc(ref, { avatarUri: candidate, avatarRevision: 2, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { avatarUri: candidate, isFaceVerified: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { gallery: [candidate], updatedAt: serverTimestamp() }));
  }
  // Simulate the server's successful transaction. Normal edits still work
  // after the server publishes the new photo and its verification fields.
  await env.withSecurityRulesDisabled(async ctx => {
    for (const collection of ['users', 'profiles']) await updateDoc(doc(ctx.firestore(), collection, base.id), {
      avatarUri: candidate, avatarRevision: 2, isFaceVerified: true,
    });
  });
  for (const collection of ['users', 'profiles']) {
    await assertSucceeds(updateDoc(doc(owner, collection, base.id), { gallery: [], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(owner, collection, base.id), { avatarUri: old, updatedAt: serverTimestamp() }));
  }
  console.log('PASS main photo cannot be replaced or forged by client writes; gallery edits survive server publication');
} finally { await env.cleanup(); }
