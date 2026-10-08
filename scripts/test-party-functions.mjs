import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import nacl from 'tweetnacl';
import {
  activateLegacyPartyChat, approvePartyRequest, cancelParty, createParty, leaveParty, requestJoinParty, rotatePartyKey,
} from '../functions/partyFunctions.js';

const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = requireFunctions('firebase-admin/app');
const { getFirestore, Timestamp } = requireFunctions('firebase-admin/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This test requires the Firestore emulator');
initializeApp({ projectId: 'demo-campusmate' });
const db = getFirestore();

const pair = nacl.box.keyPair();
const groupKey = nacl.randomBytes(32);
const nonce = nacl.randomBytes(24);
const sharedKey = nacl.box.before(pair.publicKey, pair.secretKey);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const device = { phone: { publicKey: b64(pair.publicKey) } };
const envelope = {
  senderDeviceId: 'phone', senderPublicKey: b64(pair.publicKey),
  nonce: b64(nonce), ciphertext: b64(nacl.secretbox(groupKey, nonce, sharedKey)),
};
const call = (fn, uid, data) => fn.run({ auth: { uid }, data });
const future = { date: '2099-01-01', startTime: '14:00', endTime: '16:00' };

await Promise.all(['host', 'alice', 'bob', 'outsider'].map((uid) => db.doc(`profiles/${uid}`).set({ name: uid, encryptionDevices: device })));
const created = await call(createParty, 'host', {
  location: { kind: 'pin', latitude: 7.008453, longitude: 100.497914, name: 'สนามหน้า ม.อ.' },
  schedule: future, maxPeople: 2,
});
const partyId = created.partyId;
assert.ok(partyId);
assert.deepEqual(await call(requestJoinParty, 'alice', { partyId }), { status: 'pending' });
assert.deepEqual(await call(requestJoinParty, 'alice', { partyId }), { status: 'pending' });
await call(requestJoinParty, 'bob', { partyId });
await assert.rejects(call(approvePartyRequest, 'host', {
  partyId, requesterId: 'alice', initialGrants: { host: { phone: { ...envelope, nonce: '' } }, alice: { phone: envelope } },
}), /กุญแจ/);
await assert.rejects(call(approvePartyRequest, 'outsider', {
  partyId, requesterId: 'alice', initialGrants: { host: { phone: envelope }, alice: { phone: envelope } },
}), /เจ้าของตี้/);

const decisions = await Promise.allSettled([
  call(approvePartyRequest, 'host', {
    partyId, requesterId: 'alice', initialGrants: { host: { phone: envelope }, alice: { phone: envelope } },
  }),
  call(approvePartyRequest, 'host', {
    partyId, requesterId: 'bob', initialGrants: { host: { phone: envelope }, bob: { phone: envelope } },
  }),
]);
assert.equal(decisions.filter((item) => item.status === 'fulfilled').length, 1);
assert.equal(decisions.filter((item) => item.status === 'rejected').length, 1);
const party = await db.doc(`parties/${partyId}`).get();
assert.equal(party.get('memberCount'), 2);
assert.equal(party.get('memberIds').length, 2);
assert.equal((await db.doc(`groupChats/${partyId}`).get()).get('epochCount'), 1);
assert.equal((await db.doc(`groupChats/${partyId}/epochs/0`).get()).exists, true);
const stored = (await db.doc(`groupChats/${partyId}/epochs/0`).get()).get('keyEnvelopes.host.phone');
assert.deepEqual(
  nacl.secretbox.open(Buffer.from(stored.ciphertext, 'base64'), Buffer.from(stored.nonce, 'base64'), sharedKey),
  groupKey,
);

const expiredId = 'expired-party';
await db.doc(`parties/${expiredId}`).set({
  hostId: 'host', status: 'open', memberIds: ['host'], memberCount: 1, maxPeople: 3,
  schedule: { startsAt: Timestamp.fromMillis(Date.now() - 1000) },
});
await assert.rejects(call(requestJoinParty, 'alice', { partyId: expiredId }), /เวลานัดหมายผ่านไปแล้ว/);

const joinedUser = party.get('memberIds').find((uid) => uid !== 'host');
await call(leaveParty, joinedUser, { partyId });
const chatAfterLeave = await db.doc(`groupChats/${partyId}`).get();
assert.equal(chatAfterLeave.get('rekeyRequired'), true);
assert.deepEqual(chatAfterLeave.get('memberIds'), ['host']);
const waitingUser = joinedUser === 'alice' ? 'bob' : 'alice';
await assert.rejects(call(approvePartyRequest, 'host', {
  partyId, requesterId: waitingUser, epochGrants: { '0': { phone: envelope } },
}), /กำลังเปลี่ยนกุญแจกลุ่ม/);
assert.equal((await call(rotatePartyKey, 'host', { partyId, grants: { host: { phone: envelope } } })).epoch, 1);
await assert.rejects(call(approvePartyRequest, 'host', {
  partyId, requesterId: waitingUser, epochGrants: { '1': { phone: envelope } },
}), /กุญแจประวัติแชตทุกช่วงไม่ครบ/);
await call(approvePartyRequest, 'host', {
  partyId, requesterId: waitingUser,
  epochGrants: { '0': { phone: envelope }, '1': { phone: envelope } },
});
assert.equal((await db.doc(`groupChats/${partyId}`).get()).get('epochCount'), 2);
assert.ok((await db.doc(`groupChats/${partyId}/epochs/0`).get()).get(`keyEnvelopes.${waitingUser}`));
assert.ok((await db.doc(`groupChats/${partyId}/epochs/1`).get()).get(`keyEnvelopes.${waitingUser}`));
const cancelled = await call(createParty, 'host', {
  location: { kind: 'pin', latitude: 7.008453, longitude: 100.497914, name: 'สนามหน้า ม.อ.' },
  schedule: future, maxPeople: 3,
});
await assert.rejects(call(cancelParty, 'outsider', { partyId: cancelled.partyId }), /เจ้าของตี้/);
assert.deepEqual(await call(cancelParty, 'host', { partyId: cancelled.partyId }), { status: 'cancelled' });
await assert.rejects(call(requestJoinParty, 'alice', { partyId: cancelled.partyId }), /ไม่ได้เปิดรับ/);
await db.doc('parties/old-legacy').set({
  hostId: 'host', host: { name: 'host' }, legacy: true, chatActivationRequired: true,
  status: 'expired', memberIds: ['host', 'alice'], memberCount: 2, maxPeople: 3,
  location: { kind: 'pin', name: 'ลานกิจกรรม', latitude: 7.008453, longitude: 100.497914 },
  schedule: { date: '2020-01-01', startTime: '14:00', startsAt: Timestamp.fromMillis(Date.now() - 1000) },
});
assert.deepEqual(await call(activateLegacyPartyChat, 'host', {
  partyId: 'old-legacy', initialGrants: { host: { phone: envelope }, alice: { phone: envelope } },
}), { groupChatId: 'old-legacy', activated: true });
await assert.rejects(call(activateLegacyPartyChat, 'outsider', { partyId: 'old-legacy' }), /เปิดแชต/);
console.log('Party callable transactions passed');
