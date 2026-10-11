import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test through the Firestore emulator.');
const environment = await initializeTestEnvironment({
  projectId: 'demo-campusmate',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
});

try {
  const owner = environment.authenticatedContext('gallery-owner').firestore();
  const other = environment.authenticatedContext('gallery-other').firestore();
  const urls = Array.from({ length: 5 }, (_, i) => `https://example.test/photo-${i}.jpg`);
  const base = { id: 'gallery-owner', name: 'Gallery owner', avatarRevision: 123, updatedAt: serverTimestamp() };
  for (const collection of ['users', 'profiles']) {
    const profile = collection === 'profiles' ? { ...base, isDiscoverable: true } : base;
    const reference = doc(owner, collection, 'gallery-owner');
    await assertSucceeds(setDoc(reference, { ...profile, gallery: urls }));
    await assertFails(setDoc(reference, { ...profile, gallery: [...urls, 'https://example.test/photo-6.jpg'] }));
    await assertFails(setDoc(reference, { ...profile, gallery: 'invalid' }));
    await assertFails(setDoc(reference, { ...profile, avatarRevision: -1 }));
    await assertFails(setDoc(reference, { ...profile, avatarRevision: 'invalid' }));
    await assertFails(setDoc(doc(other, collection, 'gallery-owner'), { ...profile, gallery: [] }));
    await assertSucceeds(setDoc(reference, { ...profile, gallery: [] }));
    console.log(`PASS ${collection}: owner saves/removes gallery; six photos, wrong type and other writers denied`);
  }
  await assertFails(getDoc(doc(other, 'profiles', 'gallery-owner')));
  await assertFails(getDoc(doc(other, 'users', 'gallery-owner')));
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'entitlements', 'gallery-owner'), { source: 'revenuecat', activeUntil: Date.now() + 10000 });
    await setDoc(doc(db, 'profileVisibility', 'gallery-owner'), { mode: 'incognito' });
    await setDoc(doc(db, 'matchingSignals', 'gallery-owner'), { updatedAt: serverTimestamp() });
  });
  for (const collection of ['entitlements', 'profileVisibility', 'matchingSignals']) {
    await assertSucceeds(getDoc(doc(owner, collection, 'gallery-owner')));
    await assertFails(getDoc(doc(other, collection, 'gallery-owner')));
    await assertFails(setDoc(doc(owner, collection, 'gallery-owner'), { plus: true, mode: 'public' }));
  }
  console.log('PASS avatar revisions and server-owned membership/visibility/matching signals');
} finally {
  await environment.cleanup();
}
