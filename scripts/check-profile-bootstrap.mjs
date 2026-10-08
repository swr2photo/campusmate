// Diagnostic and guarded repair for the current test device only.
// Never print a UID, email, name, URL or key material.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { buildPublicProfile, buildDiscoveryProfile } from '../functions/discoveryProfile.js';

const device = process.argv[2];
if (!device) throw new Error('Pass the test device serial.');
const result = spawnSync('adb', ['-s', device, 'logcat', '-d', '-s', 'ReactNativeJS'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (result.status !== 0) throw new Error('Cannot read test-device logs.');
const line = result.stdout.split('\n').filter((entry) => entry.includes('[createUserProfile] writing users doc:')).at(-1);
const record = line ? JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1))
  : { id: JSON.parse(readFileSync('artifacts/private-qa/profile-bootstrap-before-repair.json', 'utf8')).accountId };
if (!/^[A-Za-z0-9_-]{1,128}$/.test(record.id || '')) throw new Error('Invalid test-account ID.');
const app = initializeApp({ projectId: 'campusmate-7f1ab' });
const db = getFirestore(app);
const describe = (data) => ({ present: !!data, isNewUser: data?.isNewUser === true,
  hasAvatar: !!(data?.avatarUri || data?.photos?.length), hasName: !!data?.name,
  hasFaculty: !!data?.faculty, hasActivity: !!data?.activity, galleryCount: data?.gallery?.length || 0 });
try {
  const snapshots = await db.getAll(db.doc(`users/${record.id}`), db.doc(`profiles/${record.id}`), db.doc(`discoveryProfiles/${record.id}`));
  const rooms = await db.collection('conversations').where('participants', 'array-contains', record.id).select('participantProfiles').get();
  const candidates = rooms.docs.map((room) => room.data().participantProfiles?.[record.id])
    .filter((data) => data?.avatarUri && data?.name && data?.activity);
  const recoverable = {}, ambiguousFields = [];
  for (const field of ['name', 'nickname', 'age', 'faculty', 'year', 'gender', 'avatarUri', 'activity', 'activities',
    'activityLabel', 'activityDetails', 'skill', 'pace', 'availability', 'availabilitySlots', 'bio', 'avatar', 'avatarColor',
    'gallery', 'tags', 'interests', 'meetup', 'favoriteTracks', 'spotifyTopArtists', 'spotifyTopGenres']) {
    const values = candidates.map((data) => data[field]);
    if (values.length >= 2 && values[0] !== undefined && values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))) recoverable[field] = values[0];
    else if (values.some((value) => value !== undefined)) ambiguousFields.push(field);
  }
  console.log(JSON.stringify({ private: describe(snapshots[0].data()), public: describe(snapshots[1].data()),
    discovery: describe(snapshots[2].data()), roomCount: rooms.size,
    agreeingHistoricalCopies: candidates.length, recoverableFields: Object.keys(recoverable), ambiguousFields }, null, 2));
  if (process.argv[3] === '--repair') {
    const current = snapshots[0].data();
    if (!current?.isNewUser || current.avatarUri || current.activity || candidates.length < 2
      || !['name', 'age', 'gender', 'avatarUri', 'activity'].every((field) => recoverable[field] !== undefined)) {
      throw new Error('Repair guard rejected this state.');
    }
    mkdirSync('artifacts/private-qa', { recursive: true });
    writeFileSync('artifacts/private-qa/profile-bootstrap-before-repair.json', JSON.stringify({
      accountId: record.id, before: snapshots.map((snapshot) => snapshot.data()), historicalCopies: candidates,
    }, null, 2), { flag: 'wx' });
    const patch = { ...recoverable, isNewUser: false, avatarRevision: Date.now() };
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snapshots[0].ref);
      if (!fresh.updateTime.isEqual(snapshots[0].updateTime)) throw new Error('Account changed; repair cancelled.');
      const restored = { ...fresh.data(), ...patch }, updatedAt = FieldValue.serverTimestamp();
      tx.set(fresh.ref, { ...patch, updatedAt }, { merge: true });
      tx.set(snapshots[1].ref, { ...buildPublicProfile(record.id, restored), updatedAt });
      tx.set(snapshots[2].ref, { ...buildDiscoveryProfile(record.id, restored), updatedAt });
    });
    console.log('Repaired only fields shared by the historical copies; existing device keys and chat rooms were preserved.');
  } else if (process.argv[3]) throw new Error('Unknown argument.');
} finally { await db.terminate(); await deleteApp(app); }
