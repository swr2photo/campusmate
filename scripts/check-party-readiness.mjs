// Read-only production query checks. Authentication comes from ADC; no keys
// or user documents are printed and no test data is written to production.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
initializeApp({ credential: applicationDefault(), projectId: 'campusmate-7f1ab' });
const db = getFirestore();
const uid = 'campusmate-query-readiness-probe';
const checks = [
  ['feed', db.collection('parties').where('status', '==', 'open').where('schedule.startsAt', '>=', Timestamp.now()).orderBy('schedule.startsAt').limit(1)],
  ['own', db.collection('parties').where('memberIds', 'array-contains', uid).where('schedule.startsAt', '>=', Timestamp.fromMillis(Date.now() - 86400000)).orderBy('schedule.startsAt').limit(1)],
  ['groups', db.collection('groupChats').where('memberIds', 'array-contains', uid).orderBy('updatedAt', 'desc').limit(1)],
  ['myRequests', db.collectionGroup('requests').where('requesterId', '==', uid).where('status', '==', 'pending').orderBy('updatedAt', 'desc').limit(1)],
  ['hostRequests', db.collection(`parties/${uid}/requests`).where('hostId', '==', uid).where('status', '==', 'pending').orderBy('updatedAt').limit(1)],
];
for (const [name, query] of checks) {
  try {
    const snapshot = await query.get();
    console.log(JSON.stringify({ query: name, ready: true, count: snapshot.size }));
  } catch (error) {
    console.log(JSON.stringify({ query: name, ready: false, code: error.code }));
    process.exitCode = 1;
  }
}
await db.terminate();
