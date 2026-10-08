import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { Timestamp, collection, collectionGroup, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-campusmate',
  firestore: {
    host: '127.0.0.1', port: 8080,
    rules: readFileSync('firestore.rules', 'utf8'),
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'parties', 'party-test'), {
      hostId: 'host', memberIds: ['host', 'member'], memberCount: 2,
      maxPeople: 4, status: 'open', legacy: true, chatActivationRequired: true,
      schedule: { date: '2099-01-01', startTime: '14:00', startsAt: Timestamp.fromDate(new Date('2099-01-01T07:00:00Z')) },
    });
    await setDoc(doc(db, 'parties', 'party-test', 'requests', 'guest'), {
      hostId: 'host', requesterId: 'guest', partyId: 'party-test', status: 'pending',
    });
    await setDoc(doc(db, 'groupChats', 'party-test'), {
      hostId: 'host', memberIds: ['host', 'member'], memberCount: 2,
      currentEpoch: 0, epochCount: 1, rekeyRequired: false,
    });
    await setDoc(doc(db, 'groupChats', 'party-test', 'epochs', '0'), {
      epoch: 0, keyEnvelopes: { host: {}, member: {} },
    });
  });

  const host = testEnv.authenticatedContext('host').firestore();
  const guest = testEnv.authenticatedContext('guest').firestore();
  const member = testEnv.authenticatedContext('member').firestore();
  const outsider = testEnv.authenticatedContext('outsider').firestore();
  await assertSucceeds(getDoc(doc(guest, 'parties', 'party-test')));
  await assertSucceeds(getDocs(query(collection(guest, 'parties'),
    where('status', 'in', ['open', 'expired', 'cancelled']),
    where('schedule.startsAt', '>=', Timestamp.fromMillis(Date.now() - 86400000)))));
  await assertSucceeds(getDocs(query(collection(host, 'parties'),
    where('hostId', '==', 'host'), where('chatActivationRequired', '==', true))));
  await assertFails(setDoc(doc(host, 'parties', 'new-party'), { hostId: 'host' }));
  await assertSucceeds(getDoc(doc(host, 'parties', 'party-test', 'requests', 'guest')));
  await assertSucceeds(getDoc(doc(guest, 'parties', 'party-test', 'requests', 'guest')));
  await assertFails(getDoc(doc(outsider, 'parties', 'party-test', 'requests', 'guest')));
  await assertSucceeds(getDocs(query(collection(host, 'parties', 'party-test', 'requests'), where('hostId', '==', 'host'))));
  await assertSucceeds(getDocs(query(collectionGroup(guest, 'requests'), where('requesterId', '==', 'guest'))));
  await assertFails(getDocs(query(collectionGroup(outsider, 'requests'), where('requesterId', '==', 'guest'))));
  await assertFails(setDoc(doc(guest, 'parties', 'party-test', 'requests', 'guest'), { status: 'approved' }));
  await assertSucceeds(getDoc(doc(member, 'groupChats', 'party-test')));
  await assertFails(getDoc(doc(outsider, 'groupChats', 'party-test')));
  await assertSucceeds(getDoc(doc(member, 'groupChats', 'party-test', 'epochs', '0')));
  await assertFails(getDoc(doc(outsider, 'groupChats', 'party-test', 'epochs', '0')));
  await assertSucceeds(getDocs(query(collection(member, 'groupChats'), where('memberIds', 'array-contains', 'member'))));
  await assertFails(setDoc(doc(member, 'groupChats', 'party-test', 'messages', 'plain'), {
    senderId: 'member', epoch: 0, type: 'text', text: 'plaintext', createdAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(member, 'groupChats', 'party-test', 'messages', 'encrypted'), {
    senderId: 'member', epoch: 0, type: 'text', encrypted: true,
    nonce: 'a'.repeat(32), ciphertext: 'ciphertext', createdAt: serverTimestamp(),
  }));
  const encryptedMessage = await getDoc(doc(member, 'groupChats', 'party-test', 'messages', 'encrypted'));
  const receipt = { partyId: 'party-test', messageId: 'encrypted', lastReadMessageAt: encryptedMessage.get('createdAt'), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(member, 'groupChats', 'party-test', 'readReceipts', 'member'), receipt));
  await assertSucceeds(setDoc(doc(member, 'users', 'member', 'groupChatReads', 'party-test'), receipt));
  await assertSucceeds(getDoc(doc(host, 'groupChats', 'party-test', 'readReceipts', 'member')));
  await assertFails(getDoc(doc(outsider, 'groupChats', 'party-test', 'readReceipts', 'member')));
  await assertFails(getDoc(doc(host, 'users', 'member', 'groupChatReads', 'party-test')));
  await assertFails(setDoc(doc(member, 'groupChats', 'party-test', 'readReceipts', 'host'), receipt));
  await assertFails(setDoc(doc(member, 'users', 'member', 'groupChatReads', 'party-test'), { ...receipt, lastReadMessageAt: Timestamp.fromMillis(Date.now() + 60000) }));
  await assertFails(setDoc(doc(member, 'users', 'member', 'groupChatReads', 'party-test'), { ...receipt, messageId: 'nonexistent' }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'groupChats', 'party-test'), { rekeyRequired: true }, { merge: true });
  });
  await assertFails(setDoc(doc(member, 'groupChats', 'party-test', 'messages', 'after-leave'), {
    senderId: 'member', epoch: 0, type: 'text', encrypted: true,
    nonce: 'a'.repeat(32), ciphertext: 'ciphertext', createdAt: serverTimestamp(),
  }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'groupChats', 'party-test'), {
      memberIds: ['host'], memberCount: 1, rekeyRequired: false, currentEpoch: 1,
    }, { merge: true });
    await setDoc(doc(adminDb, 'groupChats', 'party-test', 'messages', 'new-epoch'), {
      senderId: 'host', epoch: 1, type: 'text', encrypted: true,
      nonce: 'b'.repeat(32), ciphertext: 'new ciphertext', createdAt: serverTimestamp(),
    });
  });
  await assertFails(getDoc(doc(member, 'groupChats', 'party-test', 'messages', 'new-epoch')));
  await assertFails(getDoc(doc(member, 'groupChats', 'party-test', 'epochs', '0')));
  await assertFails(getDoc(doc(member, 'groupChats', 'party-test', 'readReceipts', 'host')));
  await assertFails(setDoc(doc(member, 'users', 'member', 'groupChatReads', 'party-test'), receipt));
  await assertFails(setDoc(doc(member, 'groupChats', 'party-test', 'messages', 'former-member'), {
    senderId: 'member', epoch: 1, type: 'text', encrypted: true,
    nonce: 'a'.repeat(32), ciphertext: 'ciphertext', createdAt: serverTimestamp(),
  }));
  assert.ok(true);
  console.log('Party Firestore rules passed');
} finally {
  await testEnv.cleanup();
}
