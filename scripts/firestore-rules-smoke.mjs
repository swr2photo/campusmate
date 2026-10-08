import { initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'demo-campusmate';
const emulator = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = emulator;
const [host, portText] = emulator.split(':');
const port = Number(portText);

initializeAdminApp({ projectId });
const adminDb = getAdminFirestore();

function client(uid) {
  const app = initializeApp({ projectId, apiKey: 'demo-key' }, `rules-${uid || 'guest'}-${Math.random()}`);
    const db = initializeFirestore(app, { experimentalForceLongPolling: true });
  connectFirestoreEmulator(db, host, port, uid ? { mockUserToken: { sub: uid } } : undefined);
  return db;
}

async function succeeds(label, operation) {
  try {
    await operation();
    console.log(`PASS allow: ${label}`);
  } catch (error) {
    throw new Error(`Expected allow for ${label}, got ${error?.code || error}: ${error?.message || ''}`);
  }
}

async function fails(label, operation) {
  try {
    await operation();
  } catch (error) {
    if (String(error?.code || '').includes('permission-denied')) {
      console.log(`PASS deny: ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`Expected permission denial for ${label}`);
}

const alice = 'aliceUid';
const bob = 'bobUid';
const mallory = 'malloryUid';
const aliceDb = client(alice);
const bobDb = client(bob);
const malloryDb = client(mallory);
const guestDb = client(null);

const minimalPrivate = {
  id: alice,
  email: 'alice@example.test',
  isNewUser: false,
  isDiscoverable: true,
  name: 'Alice',
  updatedAt: serverTimestamp(),
};

await fails('guest cannot read public profiles', () => getDoc(doc(guestDb, 'profiles', alice)));
await succeeds('owner creates a valid private profile', () => setDoc(doc(aliceDb, 'users', alice), minimalPrivate));
await fails('another user cannot read a private profile', () => getDoc(doc(bobDb, 'users', alice)));
await fails('another user cannot update private matching preferences', () => setDoc(doc(bobDb, 'users', alice), {
  id: alice,
  matchingPreferences: { faculty: 'all' },
  updatedAt: serverTimestamp(),
}, { merge: true }));
await adminDb.doc(`users/${alice}`).update({ legacyField: 'kept for migration coverage' });
await succeeds('owner updates matching preferences on a legacy profile', () => setDoc(doc(aliceDb, 'users', alice), {
  id: alice,
  matchingPreferences: {
    faculty: 'all',
    sameFacultyOnly: false,
    maxDistance: 25,
    genders: [],
    years: [],
    activities: [],
  },
  updatedAt: serverTimestamp(),
}, { merge: true }));
await succeeds('owner creates a bounded public profile', () => setDoc(doc(aliceDb, 'profiles', alice), {
  id: alice,
  isDiscoverable: true,
  name: 'Alice',
  updatedAt: serverTimestamp(),
}));
await succeeds('signed-in user reads a public profile', () => getDoc(doc(bobDb, 'profiles', alice)));
await fails('public profile cannot contain email', () => setDoc(doc(aliceDb, 'profiles', alice), {
  id: alice,
  isDiscoverable: true,
  name: 'Alice',
  email: 'leak@example.test',
  updatedAt: serverTimestamp(),
}));

const profileEditor = 'profileEditorUid';
const profileEditorDb = client(profileEditor);
const completePrivateProfile = {
  id: profileEditor,
  email: 'editor@example.test',
  isNewUser: false,
  isDiscoverable: true,
  name: 'Profile editor',
  nickname: 'Editor',
  age: 20,
  faculty: 'engineering',
  year: '2',
  activity: 'study',
  activities: ['study', 'running'],
  activityLabel: 'Study, Running',
  skill: 'Photography',
  pace: 'Pace 6:00 - 7:00',
  availability: 'weekday afternoons',
  availabilitySlots: [{ day: 'mon', startTime: '14:00', endTime: '16:00' }],
  bio: 'A short profile bio.',
  avatarUri: 'https://cdn.example.test/users/profileEditorUid/avatar.jpg',
  gender: 'unspecified',
  notificationsEnabled: true,
  privacy: {
    showAge: true,
    showGender: true,
    showFaculty: true,
    showActivity: true,
    showAvailability: true,
    showLocation: true,
  },
  matchingPreferences: {
    ageMin: 18,
    ageMax: 35,
    genders: [],
    years: [],
    activities: [],
    paces: [],
    availabilityPeriods: [],
    faculty: 'all',
    sameFacultyOnly: false,
    maxDistance: 25,
  },
  latitude: 13.7563,
  longitude: 100.5018,
  updatedAt: serverTimestamp(),
};
const completePublicProfile = {
  id: profileEditor,
  name: 'Profile editor',
  nickname: 'Editor',
  age: 20,
  faculty: 'engineering',
  year: '2',
  activity: 'study',
  activities: ['study', 'running'],
  activityLabel: 'Study, Running',
  skill: 'Photography',
  pace: 'Pace 6:00 - 7:00',
  availability: 'weekday afternoons',
  availabilitySlots: [{ day: 'mon', startTime: '14:00', endTime: '16:00' }],
  bio: 'A short profile bio.',
  avatarUri: 'https://cdn.example.test/users/profileEditorUid/avatar.jpg',
  gender: 'unspecified',
  isDiscoverable: true,
  updatedAt: serverTimestamp(),
};
await succeeds('owner saves a complete private profile projection', () => (
  setDoc(doc(profileEditorDb, 'users', profileEditor), completePrivateProfile)
));
await succeeds('owner saves a complete public profile projection', () => (
  setDoc(doc(profileEditorDb, 'profiles', profileEditor), completePublicProfile)
));
const updatedPrivateProfile = {
  ...completePrivateProfile,
  name: 'Updated profile editor',
  updatedAt: serverTimestamp(),
};
const updatedPublicProfile = {
  ...completePublicProfile,
  name: 'Updated profile editor',
  updatedAt: serverTimestamp(),
};
await succeeds('owner updates a complete private profile projection', () => (
  setDoc(doc(profileEditorDb, 'users', profileEditor), updatedPrivateProfile)
));
await succeeds('owner updates a complete public profile projection', () => (
  setDoc(doc(profileEditorDb, 'profiles', profileEditor), updatedPublicProfile)
));

const scheduleOwner = 'scheduleOwnerUid';
const scheduleDb = client(scheduleOwner);
const scheduleDate = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000));
const scheduleDateValue = [
  scheduleDate.getFullYear(),
  String(scheduleDate.getMonth() + 1).padStart(2, '0'),
  String(scheduleDate.getDate()).padStart(2, '0'),
].join('-');
const scheduledMeetup = {
  id: 'spot-schedule-test',
  name: 'Scheduled test spot',
  latitude: 13.7563,
  longitude: 100.5018,
  schedule: {
    date: scheduleDateValue,
    startTime: '14:00',
    endTime: '16:00',
    maxPeople: 2,
    message: 'Bring a notebook',
    scheduledFor: scheduleDate,
  },
  scheduledAt: `${scheduleDateValue} · 14:00–16:00`,
};
await succeeds('owner saves a scheduled meetup profile projection', () => {
  const batch = writeBatch(scheduleDb);
  batch.set(doc(scheduleDb, 'users', scheduleOwner), {
    id: scheduleOwner,
    email: 'schedule@example.test',
    isNewUser: false,
    isDiscoverable: true,
    name: 'Scheduled owner',
    location: 'legacy private location',
    meetup: scheduledMeetup,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(scheduleDb, 'profiles', scheduleOwner), {
    id: scheduleOwner,
    isDiscoverable: true,
    name: 'Scheduled owner',
    meetup: scheduledMeetup,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
});

const meetupBootstrapOwner = 'meetupBootstrapUid';
const meetupBootstrapDb = client(meetupBootstrapOwner);
await succeeds('owner creates a meetup patch before profile bootstrap finishes', () => {
  const batch = writeBatch(meetupBootstrapDb);
  batch.set(doc(meetupBootstrapDb, 'users', meetupBootstrapOwner), {
    id: meetupBootstrapOwner,
    meetup: scheduledMeetup,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(meetupBootstrapDb, 'profiles', meetupBootstrapOwner), {
    id: meetupBootstrapOwner,
    meetup: scheduledMeetup,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
});

await adminDb.doc(`users/${scheduleOwner}`).update({ legacyField: 'keep this legacy field' });
await adminDb.doc(`profiles/${scheduleOwner}`).update({ legacyField: 'keep this legacy field' });
const rescheduledMeetup = {
  ...scheduledMeetup,
  schedule: {
    ...scheduledMeetup.schedule,
    message: 'Updated meetup message',
  },
  scheduledAt: `${scheduleDateValue} - 14:00-16:00`,
};
await succeeds('owner updates meetup on a legacy profile', () => {
  const batch = writeBatch(scheduleDb);
  batch.set(doc(scheduleDb, 'users', scheduleOwner), {
    id: scheduleOwner,
    meetup: rescheduledMeetup,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(scheduleDb, 'profiles', scheduleOwner), {
    id: scheduleOwner,
    meetup: rescheduledMeetup,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return batch.commit();
});

const carol = 'carolUid';
await adminDb.doc(`decisions/${alice}_${carol}`).set({
  fromUserId: alice,
  toUserId: carol,
  type: 'skip',
  status: 'pending',
  likeMessage: '',
});
await adminDb.doc(`decisions/${carol}_${alice}`).set({
  fromUserId: carol,
  toUserId: alice,
  type: 'like',
  status: 'accepted',
  likeMessage: '',
});
await succeeds('sender can finalize a reciprocal like after a previous skip', () => updateDoc(
  doc(aliceDb, 'decisions', `${alice}_${carol}`),
  { type: 'like', status: 'accepted', likeMessage: '', updatedAt: serverTimestamp() },
));

await adminDb.doc(`decisions/${alice}_${bob}`).set({
  fromUserId: alice,
  toUserId: bob,
  type: 'like',
  status: 'accepted',
  likeMessage: '',
});
await adminDb.doc(`decisions/${bob}_${alice}`).set({
  fromUserId: bob,
  toUserId: alice,
  type: 'like',
  status: 'accepted',
  likeMessage: '',
});

const conversationId = `c-${alice}-${bob}`;
const conversationRef = doc(aliceDb, 'conversations', conversationId);
await succeeds('matched participant creates encrypted conversation metadata', () => setDoc(conversationRef, {
  participants: [alice, bob],
  participantProfiles: {
    [alice]: { id: alice, isDiscoverable: true, name: 'Alice' },
    [bob]: { id: bob, isDiscoverable: true, name: 'Bob', updatedAt: 1788401862171 },
  },
  unreadCounts: { [alice]: 0, [bob]: 0 },
  lastMessage: 'ข้อความที่เข้ารหัส',
  lastMessageSenderId: null,
  lastMessageAt: null,
  lastMessageId: null,
  messages: [],
  encryption: {
    version: 1,
    algorithm: 'x25519-xsalsa20-poly1305.v1',
    keyEnvelopes: { [alice]: {}, [bob]: {} },
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}));
await succeeds('participant reads scoped conversation list', () => getDocs(query(
  collection(bobDb, 'conversations'),
  where('participants', 'array-contains', bob),
)));
await fails('outsider cannot read conversation', () => getDoc(doc(malloryDb, 'conversations', conversationId)));
await fails('participant cannot replace the other embedded profile', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  { [`participantProfiles.${alice}.name`]: 'Impostor', updatedAt: serverTimestamp() },
));
await succeeds('participant updates own chat settings', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  { [`participantSettings.${bob}.isMuted`]: true },
));
await succeeds('participant clears own chat history', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  {
    [`participantSettings.${bob}.isHidden`]: true,
    [`participantSettings.${bob}.hiddenAt`]: serverTimestamp(),
    [`participantSettings.${bob}.historyClearedAt`]: serverTimestamp(),
  },
));
await fails('participant cannot clear the other participant history', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  { [`participantSettings.${alice}.historyClearedAt`]: serverTimestamp() },
));
await succeeds('participant updates own embedded profile', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  { [`participantProfiles.${bob}.name`]: 'Bob Updated', updatedAt: serverTimestamp() },
));
await succeeds('participant publishes bounded E2EE envelope metadata', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  {
    encryption: {
      version: 1,
      algorithm: 'x25519-xsalsa20-poly1305.v1',
      keyEnvelopes: { [alice]: {}, [bob]: { smokeDevice: {} } },
    },
    lastMessage: 'ข้อความที่เข้ารหัส',
    updatedAt: serverTimestamp(),
  },
));

const messageId = 'm-smoke-1';
await succeeds('sender atomically writes encrypted message and metadata', async () => {
  const batch = writeBatch(aliceDb);
  batch.set(doc(aliceDb, 'conversations', conversationId, 'messages', messageId), {
    id: messageId,
    senderId: alice,
    createdAt: serverTimestamp(),
    time: serverTimestamp(),
    encrypted: true,
    encryptionVersion: 1,
    nonce: '12345678901234567890123456789012',
    ciphertext: 'ciphertext',
  });
  batch.update(conversationRef, {
    lastMessage: 'ข้อความที่เข้ารหัส',
    lastMessageSenderId: alice,
    lastMessageAt: serverTimestamp(),
    lastMessageId: messageId,
    unreadCounts: { [alice]: 0, [bob]: 1 },
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
});
await succeeds('participant reads encrypted message subcollection', () => getDocs(
  collection(bobDb, 'conversations', conversationId, 'messages'),
));
await succeeds('participant clears own unread count and writes own receipt', () => updateDoc(
  doc(bobDb, 'conversations', conversationId),
  {
    [`unreadCounts.${bob}`]: 0,
    [`readReceipts.${bob}`]: serverTimestamp(),
  },
));

const meetupMessageId = 'm-smoke-meetup';
await succeeds('participant updates own meetup state with encrypted event', async () => {
  const batch = writeBatch(bobDb);
  batch.set(doc(bobDb, 'conversations', conversationId, 'messages', meetupMessageId), {
    id: meetupMessageId,
    senderId: bob,
    createdAt: serverTimestamp(),
    time: serverTimestamp(),
    encrypted: true,
    encryptionVersion: 1,
    nonce: '12345678901234567890123456789012',
    ciphertext: 'meetup-ciphertext',
    isSystem: true,
  });
  batch.update(doc(bobDb, 'conversations', conversationId), {
    meetupAcceptedUsers: [bob],
    lastMessage: 'ข้อความที่เข้ารหัส',
    lastMessageSenderId: bob,
    lastMessageAt: serverTimestamp(),
    lastMessageId: meetupMessageId,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
});

const appointmentStart = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000));
appointmentStart.setHours(14, 0, 0, 0);
const appointmentDate = [
  appointmentStart.getFullYear(),
  String(appointmentStart.getMonth() + 1).padStart(2, '0'),
  String(appointmentStart.getDate()).padStart(2, '0'),
].join('-');
const appointmentMeetup = {
  id: 'spot-smoke',
  name: 'Smoke test library',
  category: 'study',
  categoryLabel: 'อ่านหนังสือ',
  latitude: 7.01,
  longitude: 100.5,
  schedule: {
    date: appointmentDate,
    startTime: '14:00',
    endTime: '16:00',
    scheduledFor: appointmentStart,
    maxPeople: 2,
  },
};
await adminDb.doc(`profiles/${alice}`).update({ meetup: appointmentMeetup });
const appointmentId = `a-${conversationId}-${alice}`;
const appointmentRef = doc(bobDb, 'appointments', appointmentId);
await succeeds('guest creates a scoped appointment after acceptance', () => setDoc(appointmentRef, {
    id: appointmentId,
    conversationId,
    participants: [alice, bob],
    hostId: alice,
    guestId: bob,
    meetup: appointmentMeetup,
    scheduledFor: appointmentStart,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
await succeeds('participant reads their appointment history', () => getDoc(appointmentRef));
await fails('outsider cannot read an appointment', () => getDoc(doc(malloryDb, 'appointments', appointmentId)));
await succeeds('participant cancels an appointment before the cutoff', () => updateDoc(appointmentRef, {
  status: 'cancelled',
  cancelledBy: bob,
  cancelledAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}));
await succeeds('guest can restore a cancelled appointment before the cutoff', () => updateDoc(appointmentRef, {
  status: 'active',
  cancelledBy: null,
  cancelledAt: null,
  updatedAt: serverTimestamp(),
}));
await fails('outsider cannot change appointment status', () => updateDoc(doc(malloryDb, 'appointments', appointmentId), {
  status: 'cancelled',
  cancelledBy: mallory,
  cancelledAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}));

const lateScheduledFor = new Date(Date.now() + (12 * 60 * 60 * 1000));
const lateAppointment = {
  id: appointmentId,
  conversationId,
  participants: [alice, bob],
  hostId: alice,
  guestId: bob,
  meetup: {
    ...appointmentMeetup,
    schedule: {
      ...appointmentMeetup.schedule,
      scheduledFor: lateScheduledFor,
    },
  },
  scheduledFor: lateScheduledFor,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};
await adminDb.doc(`appointments/${appointmentId}`).set(lateAppointment);
await fails('participant cannot cancel on the appointment day', () => updateDoc(appointmentRef, {
  status: 'cancelled',
  cancelledBy: bob,
  cancelledAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}));
await succeeds('participant performs metadata-only timestamp refresh', () => updateDoc(
  doc(aliceDb, 'conversations', conversationId),
  { updatedAt: serverTimestamp() },
));
await fails('plaintext message fields are rejected', () => setDoc(
  doc(aliceDb, 'conversations', conversationId, 'messages', 'm-plaintext'),
  {
    id: 'm-plaintext',
    senderId: alice,
    text: 'must not be stored',
    createdAt: serverTimestamp(),
    time: serverTimestamp(),
  },
));
await fails('outsider cannot list encrypted messages', () => getDocs(
  collection(malloryDb, 'conversations', conversationId, 'messages'),
));

console.log('Firestore rules smoke test completed successfully.');
process.exit(0);
