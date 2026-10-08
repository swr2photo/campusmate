import { initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { buildDiscoveryProfile, buildPublicProfile } from '../functions/discoveryProfile.js';

initializeApp();

const db = getFirestore();
const args = new Set(process.argv.slice(2));
const commit = args.has('--commit');
const PAGE_SIZE = 400;

// functions/discoveryProfile.js resolves its own copy of firebase-admin from
// functions/node_modules, so the Timestamps it produces are a different class
// than the one this script's Firestore client expects. Re-create them here.
function normalizeTimestamps(value) {
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function' && typeof value.seconds === 'number') {
      return Timestamp.fromMillis(value.toMillis());
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeTimestamps(entry)]));
  }
  return value;
}

async function backfill() {
  let lastDocument = null;
  let processed = 0;
  let publicWritten = 0;
  let discoveryWritten = 0;
  let removed = 0;
  const userIds = new Set();

  while (true) {
    let profileQuery = db.collection('users')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDocument) profileQuery = profileQuery.startAfter(lastDocument);
    const snapshot = await profileQuery.get();
    if (snapshot.empty) break;

    if (commit) {
      const batch = db.batch();
      snapshot.docs.forEach((profileDocument) => {
        userIds.add(profileDocument.id);
        const publicProfile = normalizeTimestamps(buildPublicProfile(profileDocument.id, profileDocument.data()));
        const discoveryProfile = normalizeTimestamps(buildDiscoveryProfile(profileDocument.id, publicProfile));
        const publicRef = db.collection('profiles').doc(profileDocument.id);
        const discoveryRef = db.collection('discoveryProfiles').doc(profileDocument.id);
        batch.set(publicRef, publicProfile);
        publicWritten += 1;
        if (discoveryProfile) {
          batch.set(discoveryRef, discoveryProfile);
          discoveryWritten += 1;
        } else {
          batch.delete(discoveryRef);
          removed += 1;
        }
      });
      await batch.commit();
    } else {
      snapshot.docs.forEach((profileDocument) => {
        userIds.add(profileDocument.id);
        const publicProfile = buildPublicProfile(profileDocument.id, profileDocument.data());
        if (publicProfile) publicWritten += 1;
        if (buildDiscoveryProfile(profileDocument.id, publicProfile)) discoveryWritten += 1;
        else removed += 1;
      });
    }

    processed += snapshot.size;
    lastDocument = snapshot.docs[snapshot.docs.length - 1];
    console.log(`[discovery backfill] scanned ${processed} profiles`);
  }

  // Discovery is server-owned. Remove projections for accounts that no
  // longer have an owner document, including records left by old test data.
  let lastDiscoveryDocument = null;
  while (commit) {
    let discoveryQuery = db.collection('discoveryProfiles')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDiscoveryDocument) discoveryQuery = discoveryQuery.startAfter(lastDiscoveryDocument);
    const snapshot = await discoveryQuery.get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((discoveryDocument) => {
      if (discoveryDocument.id === '_meta' || userIds.has(discoveryDocument.id)) return;
      batch.delete(discoveryDocument.ref);
      removed += 1;
    });
    await batch.commit();
    lastDiscoveryDocument = snapshot.docs[snapshot.docs.length - 1];
  }

  if (commit) {
    await db.collection('discoveryProfiles').doc('_meta').set({
      backfillComplete: true,
      projectionVersion: 1,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log(JSON.stringify({
    mode: commit ? 'commit' : 'dry-run',
    processed,
    publicWritten,
    discoveryWritten,
    removed,
    nextStep: commit ? 'discoveryProfiles is now active for paginated clients' : 'rerun with --commit to write projections',
  }, null, 2));
}

backfill().catch((error) => {
  console.error('[discovery backfill] failed:', error?.message || error);
  process.exitCode = 1;
});
