import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createMatchingActionApi } from './matchingActions.js';
import { createProfileAccessApi } from './secureProfileAccess.js';
import { createDiscoveryApi } from './secureDiscovery.js';
import { migrateLegacyUser } from './matchingMigration.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This suite requires the Firestore emulator; never run against production.');
const app = initializeApp({ projectId: 'demo-campusmate' }, 'secure-api-qa');
const db = getFirestore(app), prefix = `secure-${randomUUID().slice(0, 8)}`, instant = Date.now();
let clock = instant;
const now = () => clock, actions = createMatchingActionApi({ db, now, serverTimestamp: FieldValue.serverTimestamp });
const access = createProfileAccessApi({ db, now, serverTimestamp: FieldValue.serverTimestamp });
const discover = createDiscoveryApi({ db, now });
const uid = (suffix) => `${prefix}-${suffix}`;
const request = (user, data = {}) => ({ auth: { uid: user }, data });
const record = (user, target, kind, actionId = randomUUID()) => actions.recordDiscoveryAction(request(user, { targetUserId: target, kind, actionId }));
const rewind = (user, actionId = randomUUID()) => actions.rewindDiscoveryAction(request(user, { actionId }));
async function user(id, plus = false) {
  const profile = { id, name: id, age: 22, faculty: 'engineering', year: '2', gender: 'male', activity: 'running', pace: '5:00',
    availabilitySlots: [{ date: '2026-10-05', start: '00:00', end: '05:00' }], latitude: 7.008453, longitude: 100.497914,
    isDiscoverable: true, isFaceVerified: true, updatedAt: Timestamp.fromMillis(instant) };
  await Promise.all([db.doc(`users/${id}`).set(profile), db.doc(`discoveryProfiles/${id}`).set(profile)]);
  if (plus) await db.doc(`entitlements/${id}`).set({ source: 'revenuecat', entitlementId: 'campusmate_plus', verifiedAt: instant, activeUntil: instant + 10000 });
}

try {
  const legacy = uid('legacy'), oldOne = uid('legacy-one'), oldTwo = uid('legacy-two');
  await Promise.all([user(legacy, true), user(oldOne), user(oldTwo)]);
  for (const [target, type, at] of [[oldOne, 'skip', instant - 2000], [oldTwo, 'like', instant - 1000]]) {
    await db.doc(`decisions/${legacy}_${target}`).set({ fromUserId: legacy, toUserId: target, type, status: 'pending', createdAt: Timestamp.fromMillis(at) });
  }
  const migrationOptions = { serverTimestamp: FieldValue.serverTimestamp };
  assert.equal((await migrateLegacyUser(db, legacy, migrationOptions)).planned, 2);
  assert.equal((await db.doc(`discoveryState/${legacy}`).get()).exists, false);
  assert.equal((await migrateLegacyUser(db, legacy, { ...migrationOptions, apply: true })).written, 2);
  assert.equal((await migrateLegacyUser(db, legacy, { ...migrationOptions, apply: true })).written, 0);
  assert.equal((await rewind(legacy)).profile.id, oldTwo);
  assert.equal((await rewind(legacy)).profile.id, oldOne);
  console.log('PASS migration is dry-run by default, idempotent and preserves the known legacy action order');

  const me = uid('owner'), one = uid('one'), two = uid('two');
  await Promise.all([user(me, true), user(one), user(two)]);
  const first = randomUUID();
  assert.equal((await record(me, one, 'skip', first)).sequence, 1);
  assert.equal((await record(me, one, 'skip', first)).sequence, 1); // retry does not append history
  assert.equal((await record(me, two, 'like')).sequence, 2);
  const receipt = randomUUID();
  assert.equal((await rewind(me, receipt)).profile.id, two);
  assert.equal((await rewind(me, receipt)).profile.id, two); // retry does not undo the next action
  assert.equal((await rewind(me)).profile.id, one);
  assert.equal((await rewind(me)).profile, null);
  assert.equal((await db.doc(`decisions/${me}_${one}`).get()).exists, false);
  await assert.rejects(rewind(one), { code: 'permission-denied' });
  await assert.rejects(actions.rewindDiscoveryAction({ auth: { uid: one }, data: { actionId: randomUUID(), plus: true, uid: me } }), { code: 'permission-denied' });
  console.log('PASS ordered rewind, retry receipts and forged Plus payload');

  await record(me, one, 'skip'); await record(me, two, 'like');
  await db.doc(`users/${two}/blockedUsers/${me}`).set({});
  assert.equal((await rewind(me)).profile.id, one);
  assert.equal((await db.doc(`decisions/${me}_${two}`).get()).data().status, 'pending');
  await db.doc(`users/${two}/blockedUsers/${me}`).delete();
  await record(me, one, 'skip'); await record(me, two, 'skip');
  await db.doc(`users/${two}`).delete();
  assert.equal((await rewind(me)).profile.id, one);
  console.log('PASS blocked or deleted subjects are never returned');

  for (let index = 0; index < 3; index++) {
    const from = uid(`race${index}a`), to = uid(`race${index}b`);
    await Promise.all([user(from, true), user(to)]); await record(from, to, 'like');
    const results = await Promise.allSettled([rewind(from), actions.respondToIncomingLike(request(to, { targetUserId: from, response: 'accept' }))]);
    const outgoing = await db.doc(`decisions/${from}_${to}`).get(), incoming = await db.doc(`decisions/${to}_${from}`).get();
    if (results[1].status === 'fulfilled') {
      assert.equal(outgoing.data().status, 'accepted'); assert.equal(incoming.data().status, 'accepted');
      assert.equal(results[0].status, 'fulfilled'); assert.equal(results[0].value.profile, null);
    } else {
      assert.equal(results[1].reason.code, 'not-found'); assert.equal(outgoing.exists, false); assert.equal(incoming.exists, false);
    }
  }
  console.log('PASS actual Firestore transaction races between acceptance and rewind');

  const former = uid('former'), partner = uid('partner');
  await Promise.all([user(former, true), user(partner, true)]);
  await record(former, partner, 'like');
  await actions.cancelPendingOutgoingLike(request(former, { targetUserId: partner }));
  assert.equal((await db.doc(`decisions/${former}_${partner}`).get()).exists, false);
  await record(former, partner, 'like');
  await actions.respondToIncomingLike(request(partner, { targetUserId: former, response: 'accept' }));
  await assert.rejects(actions.cancelPendingOutgoingLike(request(former, { targetUserId: partner })), { code: 'failed-precondition' });
  const roomId = `c-${[former, partner].sort().join('-')}`;
  await db.doc(`conversations/${roomId}`).set({ participants: [former, partner].sort() });
  await access.setProfileVisibility(request(partner, { mode: 'incognito' }));
  assert.equal((await access.getVisibleProfiles(request(former, { userIds: [partner] }))).profiles.length, 1);
  await actions.unmatchProfile(request(former, { targetUserId: partner }));
  assert.equal((await access.getVisibleProfiles(request(former, { userIds: [partner] }))).profiles.length, 0);
  const hidden = (await db.doc(`conversations/${roomId}`).get()).data();
  assert.equal(hidden.participantSettings[former].isHidden, true);
  assert.equal(hidden.participantSettings[partner].isHidden, true);
  assert.equal((await rewind(former)).profile, null);
  console.log('PASS cancel pending only; unmatch hides both sides and old room cannot expose an incognito profile');

  const partyId = `${prefix}-party`, requester = uid('requester'), outsider = uid('outsider');
  await Promise.all([user(requester), user(outsider)]);
  await db.doc(`parties/${partyId}`).set({ hostId: former, memberIds: [former, partner], status: 'open' });
  await db.doc(`parties/${partyId}/requests/${requester}`).set({ requesterId: requester, status: 'pending' });
  const keys = await access.getPartyEncryptionProfiles(request(former, { partyId, userIds: [partner, requester] }));
  assert.equal(keys.profiles.length, 2);
  assert.ok(keys.profiles.every((profile) => Object.keys(profile).every((key) => ['id', 'encryptionDevices'].includes(key))));
  await assert.rejects(access.getPartyEncryptionProfiles(request(partner, { partyId, userIds: [requester] })), { code: 'permission-denied' });
  await assert.rejects(access.getPartyEncryptionProfiles(request(outsider, { partyId, userIds: [partner] })), { code: 'permission-denied' });
  console.log('PASS group key API authorizes members/host pending approvals without returning private names/photos');

  const sender = uid('private-sender'), viewer = uid('private-viewer');
  await Promise.all([user(sender, true), user(viewer)]);
  await record(sender, viewer, 'like');
  await access.setProfileVisibility(request(sender, { mode: 'incognito' }));
  const countOnly = await access.getIncomingLikeSummary(request(viewer, { uid: me, plus: true }));
  assert.equal(countOnly.pendingCount, 1); assert.deepEqual(countOnly.pendingLikes, []);
  assert.equal((await access.getVisibleProfiles(request(one, { userIds: [sender] }))).profiles.length, 0);
  assert.equal((await access.getVisibleProfiles(request(viewer, { userIds: [sender] }))).profiles.length, 1);
  clock = instant + 10000;
  assert.equal((await access.getVisibleProfiles(request(viewer, { userIds: [sender] }))).profiles.length, 0);
  await access.setProfileVisibility(request(sender, { mode: 'public' }));
  assert.equal((await access.getVisibleProfiles(request(viewer, { userIds: [sender] }))).profiles.length, 1);
  clock = instant;
  console.log('PASS free count API, incognito visibility and expiry remaining private');

  await assert.rejects(discover(request(viewer, { filters: { faculties: ['engineering'] }, plus: true })), { code: 'permission-denied' });
  const filtered = await discover(request(me, { filters: { faculties: ['engineering'], availabilityPeriods: ['night'], availabilityWeekdays: ['1'], paces: ['5:00'] } }));
  assert.ok(filtered.profiles.some((profile) => profile.id === sender));
  assert.ok(filtered.profiles.every((profile) => !('latitude' in profile) && !('longitude' in profile)));
  const freeState = await access.getMyDecisionState(request(viewer));
  assert.equal(freeState.pendingCount, 1); assert.equal(freeState.incomingDecisions.some((value) => value.status === 'pending'), false);
  console.log('PASS advanced filters enforced server-side and free decision state hides pending IDs');
} finally { await db.terminate(); await deleteApp(app); }
