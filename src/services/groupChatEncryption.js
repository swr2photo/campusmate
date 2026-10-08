import * as Crypto from 'expo-crypto';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  base64ToBytes, decryptMessageRecord, encryptMessageRecord,
  ensureEncryptionIdentity, getConversationKey, getEncryptionDevices,
  withIdentityDevice, wrapConversationKey,
} from './chatEncryptionService';
import { requireFirebase } from './dbService';
import { secureDiscoveryCall, secureDiscoveryConfigured } from './secureDiscoveryService';
const groupKeyCache = new Map();
let keyCacheRevision = 0;
export function clearGroupKeyCache() { keyCacheRevision += 1; groupKeyCache.clear(); }

async function profilesFor(userIds, currentUserId, identity, partyId) {
  if (secureDiscoveryConfigured()) {
    const result = await secureDiscoveryCall('getPartyEncryptionProfiles', { partyId, userIds });
    const profiles = Object.fromEntries(result.profiles.map((profile) => [profile.id, profile]));
    for (const userId of userIds) {
      if (userId === currentUserId) profiles[userId] = withIdentityDevice(profiles[userId], identity);
      if (!Object.keys(getEncryptionDevices(profiles[userId])).length) throw new Error('สมาชิกยังไม่มีกุญแจสำหรับแชต');
    }
    return profiles;
  }
  const { db } = requireFirebase();
  const entries = await Promise.all(userIds.map(async (userId) => {
    const snapshot = await getDoc(doc(db, 'profiles', userId));
    if (!snapshot.exists()) throw new Error(`ไม่พบโปรไฟล์ของสมาชิก ${userId}`);
    const profile = userId === currentUserId
      ? withIdentityDevice(snapshot.data(), identity) : snapshot.data();
    if (!Object.keys(getEncryptionDevices(profile)).length) {
      throw new Error(`สมาชิก ${userId} ยังไม่มีกุญแจสำหรับแชต`);
    }
    return [userId, profile];
  }));
  return Object.fromEntries(entries);
}

function grantsForKey(key, userIds, profiles, identity) {
  const grants = {};
  userIds.forEach((userId) => {
    grants[userId] = {};
    Object.entries(getEncryptionDevices(profiles[userId])).forEach(([deviceId, device]) => {
      grants[userId][deviceId] = wrapConversationKey(key, base64ToBytes(device.publicKey), identity);
    });
  });
  return grants;
}

async function readEpochs(partyId) {
  const { db } = requireFirebase();
  const snapshots = await getDocs(collection(db, 'groupChats', partyId, 'epochs'));
  return snapshots.docs.map((entry) => ({ epoch: Number(entry.id), ...entry.data() }))
    .sort((a, b) => a.epoch - b.epoch);
}

export async function preparePartyApproval(party, requesterId) {
  const hostId = party.hostId;
  const identity = await ensureEncryptionIdentity(hostId);
  const { db } = requireFirebase();
  const members = [...new Set([...(party.memberIds || []), requesterId])];
  const profiles = await profilesFor(members, hostId, identity, party.id);
  const chatSnap = await getDoc(doc(db, 'groupChats', party.id));
  if (!chatSnap.exists()) {
    const key = Crypto.getRandomBytes(32);
    return { initialGrants: grantsForKey(key, members, profiles, identity) };
  }
  const epochs = await readEpochs(party.id);
  const count = Number(chatSnap.get('epochCount'));
  if (!count || epochs.length !== count || epochs.some((item, index) => item.epoch !== index)) {
    throw new Error('ประวัติกุญแจกลุ่มไม่ครบ ไม่สามารถอนุมัติสมาชิกได้');
  }
  const grants = {};
  epochs.forEach((item) => {
    // A missing or corrupt historic key must stop approval. Otherwise the
    // newcomer would join a room with unreadable history.
    const key = getConversationKey(item, hostId, identity);
    grants[String(item.epoch)] = grantsForKey(key, [requesterId], profiles, identity)[requesterId];
  });
  return { epochGrants: grants };
}

export async function preparePartyActivation(party) {
  const identity = await ensureEncryptionIdentity(party.hostId);
  const profiles = await profilesFor(party.memberIds, party.hostId, identity, party.id);
  return grantsForKey(Crypto.getRandomBytes(32), party.memberIds, profiles, identity);
}

export async function preparePartyRotation(partyId, memberIds, userId) {
  const identity = await ensureEncryptionIdentity(userId);
  const profiles = await profilesFor(memberIds, userId, identity, partyId);
  const key = Crypto.getRandomBytes(32);
  return grantsForKey(key, memberIds, profiles, identity);
}

export async function getGroupKeys(partyId, userId, epochSnapshots) {
  const revision = keyCacheRevision;
  const identity = await ensureEncryptionIdentity(userId);
  const epochs = epochSnapshots
    ? epochSnapshots.map((item) => ({ ...item, epoch: Number(item.id ?? item.epoch) }))
    : await readEpochs(partyId);
  const keys = {};
  epochs.forEach((item) => {
    const cacheId = `${userId}:${partyId}:${item.epoch}`;
    const signature = JSON.stringify([identity.deviceId, item.keyEnvelopes?.[userId]]);
    const cached = groupKeyCache.get(cacheId);
    const key = cached?.signature === signature ? cached.key : getConversationKey(item, userId, identity);
    if (revision === keyCacheRevision) groupKeyCache.set(cacheId, { signature, key });
    keys[item.epoch] = key;
  });
  return keys;
}

export function encryptGroupText(text, key) {
  const record = encryptMessageRecord({ text, senderId: '', id: '' }, key);
  return { nonce: record.nonce, ciphertext: record.ciphertext };
}

export function decryptGroupMessage(message, keys) {
  const key = keys[message.epoch];
  if (!key) return { ...message, text: 'ไม่พบกุญแจสำหรับข้อความนี้', decryptionFailed: true };
  return decryptMessageRecord(message, key);
}
