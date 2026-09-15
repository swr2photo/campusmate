import { createReplySnapshot } from '../utils/messageReply';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { collection, doc, getDoc, getDocFromServer, getDocs, limit, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import nacl from 'tweetnacl';
import { requireFirebase } from './dbService';

export const E2EE_VERSION = 1;
export const E2EE_ALGORITHM = 'x25519-xsalsa20-poly1305.v1';
export const ENCRYPTED_PREVIEW = 'ข้อความที่เข้ารหัส';
export const E2EE_PENDING_PREVIEW = 'กำลังเตรียมการเข้ารหัส';

const IDENTITY_STORAGE_PREFIX = 'campusmate_e2ee_identity_v1_';
const DECRYPTION_FAILED_TEXT = 'ไม่สามารถถอดรหัสข้อความนี้ได้';
const identityLocks = new Map();
const publishLocks = new Map();
const conversationLocks = new Map();
const MAX_ENCRYPTION_DEVICES = 5;
const MAX_DEVICE_ID_LENGTH = 128;
const WRAPPED_KEY_CIPHERTEXT_BYTES = nacl.secretbox.keyLength + 16;

function createE2EEError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bytesToBase64(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  const chunks = [];
  for (let index = 0; index < input.length; index += 3) {
    if (output.length >= 16384) { chunks.push(output); output = ''; }
    const first = input[index];
    const second = index + 1 < input.length ? input[index + 1] : 0;
    const third = index + 2 < input.length ? input[index + 2] : 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += index + 1 < input.length ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    output += index + 2 < input.length ? alphabet[third & 63] : '=';
  }
  chunks.push(output);
  return chunks.join('');
}

function base64Value(code) {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43 || code === 45) return 62;
  if (code === 47 || code === 95) return 63;
  return -1;
}

function base64ToBytes(value) {
  if (typeof value !== 'string') throw new Error('Invalid base64 value');
  const normalized = value.replace(/\s/g, '').replace(/=+$/, '');
  if (!normalized || normalized.length % 4 === 1) throw new Error('Invalid base64 length');
  const bytes = new Uint8Array(Math.floor(normalized.length * 3 / 4));
  let offset = 0;
  for (let index = 0; index < normalized.length; index += 4) {
    const a = base64Value(normalized.charCodeAt(index));
    const b = base64Value(normalized.charCodeAt(index + 1));
    const c = index + 2 < normalized.length ? base64Value(normalized.charCodeAt(index + 2)) : 0;
    const d = index + 3 < normalized.length ? base64Value(normalized.charCodeAt(index + 3)) : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid base64 value');
    bytes[offset++] = (a << 2) | (b >> 4);
    if (index + 2 < normalized.length) bytes[offset++] = ((b & 15) << 4) | (c >> 2);
    if (index + 3 < normalized.length) bytes[offset++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

function utf8ToBytes(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value));
  const encoded = unescape(encodeURIComponent(String(value)));
  return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
}

function bytesToUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return decodeURIComponent(escape(binary));
}

function randomDeviceId() {
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  return bytesToBase64(Crypto.getRandomBytes(16)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 22);
}

function identityStorageKey(userId) {
  return `${IDENTITY_STORAGE_PREFIX}${String(userId).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

async function readIdentityValue(key) {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    throw createE2EEError(
      'E2EE_SECURE_STORAGE_UNAVAILABLE',
      'ไม่สามารถเปิดพื้นที่ปลอดภัยสำหรับกุญแจแชตได้',
      { cause: error }
    );
  }
}

async function writeIdentityValue(key, value) {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    throw createE2EEError(
      'E2EE_SECURE_STORAGE_UNAVAILABLE',
      'ไม่สามารถเก็บกุญแจแชตในพื้นที่ปลอดภัยได้',
      { cause: error }
    );
  }
}

function isValidPublicKey(value) {
  try {
    return base64ToBytes(value).length === nacl.box.publicKeyLength;
  } catch {
    return false;
  }
}

function isValidSecretKey(value) {
  try {
    return base64ToBytes(value).length === nacl.box.secretKeyLength;
  } catch {
    return false;
  }
}

function parseIdentity(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.deviceId || !isValidPublicKey(parsed.publicKey) || !isValidSecretKey(parsed.secretKey)) {
      return null;
    }
    return {
      deviceId: String(parsed.deviceId),
      publicKey: base64ToBytes(parsed.publicKey),
      secretKey: base64ToBytes(parsed.secretKey),
    };
  } catch {
    return null;
  }
}

function serializeIdentity(identity) {
  return JSON.stringify({
    deviceId: identity.deviceId,
    publicKey: bytesToBase64(identity.publicKey),
    secretKey: bytesToBase64(identity.secretKey),
  });
}

export async function getOrCreateEncryptionIdentity(userId) {
  if (!userId) throw createE2EEError('E2EE_USER_REQUIRED', 'ไม่พบผู้ใช้สำหรับสร้างกุญแจแชต');
  const lockKey = String(userId);
  if (identityLocks.has(lockKey)) return identityLocks.get(lockKey);

  const promise = (async () => {
    const storageKey = identityStorageKey(userId);
    const existing = parseIdentity(await readIdentityValue(storageKey));
    if (existing) return existing;

    const secretKey = Crypto.getRandomBytes(nacl.box.secretKeyLength);
    const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
    const identity = {
      deviceId: randomDeviceId(),
      publicKey: keyPair.publicKey,
      secretKey,
    };
    await writeIdentityValue(storageKey, serializeIdentity(identity));
    return identity;
  })();

  identityLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    if (identityLocks.get(lockKey) === promise) identityLocks.delete(lockKey);
  }
}

export async function clearEncryptionIdentity(userId) {
  if (!userId) return;
  const storageKey = identityStorageKey(userId);
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(storageKey);
  } else {
    await SecureStore.deleteItemAsync(storageKey);
  }
  identityLocks.delete(String(userId));
  publishLocks.delete(String(userId));
}

export function sanitizeEncryptionDevices(rawDevices, legacyPublicKey) {
  const devices = {};
  if (isObject(rawDevices)) {
    Object.entries(rawDevices).forEach(([deviceId, entry]) => {
      if (Object.keys(devices).length >= MAX_ENCRYPTION_DEVICES) return;
      const normalizedDeviceId = String(deviceId);
      if (!normalizedDeviceId || normalizedDeviceId.length > MAX_DEVICE_ID_LENGTH) return;
      if (!/^[A-Za-z0-9._:-]+$/.test(normalizedDeviceId)) return;
      const publicKey = typeof entry === 'string' ? entry : entry?.publicKey;
      if (publicKey && isValidPublicKey(publicKey)) {
        devices[normalizedDeviceId] = { publicKey: String(publicKey) };
      }
    });
  }
  if (legacyPublicKey && isValidPublicKey(legacyPublicKey) && !Object.keys(devices).length) {
    devices.legacy = { publicKey: String(legacyPublicKey) };
  }
  return devices;
}

export function getEncryptionDevices(profile = {}) {
  return sanitizeEncryptionDevices(profile?.encryptionDevices, profile?.encryptionPublicKey);
}

export function pruneEncryptionDevices(rawDevices, prioritizedDeviceId = null, maxCount = MAX_ENCRYPTION_DEVICES) {
  if (!rawDevices || typeof rawDevices !== 'object') return {};
  const entries = Object.entries(rawDevices);
  if (entries.length <= maxCount) {
    return { ...rawDevices };
  }
  const result = {};
  if (prioritizedDeviceId && rawDevices[prioritizedDeviceId]) {
    result[prioritizedDeviceId] = rawDevices[prioritizedDeviceId];
  }
  for (let i = entries.length - 1; i >= 0 && Object.keys(result).length < maxCount; i--) {
    const [id, val] = entries[i];
    if (!result[id]) {
      result[id] = val;
    }
  }
  return result;
}

export function withIdentityDevice(profile, identity) {
  const rawDevices = {
    ...getEncryptionDevices(profile),
    [identity.deviceId]: { publicKey: bytesToBase64(identity.publicKey) },
  };
  const devices = pruneEncryptionDevices(rawDevices, identity.deviceId, MAX_ENCRYPTION_DEVICES);
  return { ...(profile || {}), encryptionDevices: devices };
}

export async function ensureEncryptionIdentity(userId) {
  const identity = await getOrCreateEncryptionIdentity(userId);
  const lockKey = String(userId);
  if (publishLocks.has(lockKey)) return publishLocks.get(lockKey).then(() => identity);

  const promise = (async () => {
    const { db } = requireFirebase();
    const privateRef = doc(db, 'users', userId);
    const publicRef = doc(db, 'profiles', userId);
    // Read latest document snapshots directly from server if available (fallback to cache)
    const [privateSnapshot, publicSnapshot] = await Promise.all([
      getDocFromServer(privateRef).catch(() => getDoc(privateRef)),
      getDocFromServer(publicRef).catch(() => getDoc(publicRef)),
    ]);

    const privateData = privateSnapshot.exists() ? privateSnapshot.data() : {};
    const publicData = publicSnapshot.exists() ? publicSnapshot.data() : {};
    const privateDevices = getEncryptionDevices(privateData);
    const publicDevices = getEncryptionDevices(publicData);
    const currentPublicKeyB64 = bytesToBase64(identity.publicKey);
    const rawDevices = {
      ...privateDevices,
      ...publicDevices,
      [identity.deviceId]: { publicKey: currentPublicKeyB64 },
    };
    const devices = pruneEncryptionDevices(rawDevices, identity.deviceId, MAX_ENCRYPTION_DEVICES);

    const privateUpToDate = privateSnapshot.exists()
      && privateDevices[identity.deviceId]?.publicKey === currentPublicKeyB64
      && JSON.stringify(privateDevices) === JSON.stringify(devices);

    const publicUpToDate = publicSnapshot.exists()
      && publicDevices[identity.deviceId]?.publicKey === currentPublicKeyB64
      && JSON.stringify(publicDevices) === JSON.stringify(devices);

    if (privateUpToDate && publicUpToDate) {
      return identity;
    }

    const updates = [];
    if (!privateUpToDate) {
      if (privateSnapshot.exists()) {
        updates.push(
          updateDoc(privateRef, { id: userId, encryptionDevices: devices, updatedAt: serverTimestamp() })
            .catch(() => setDoc(privateRef, { id: userId, encryptionDevices: devices, updatedAt: serverTimestamp() }, { merge: true }))
        );
      } else {
        updates.push(
          setDoc(privateRef, { id: userId, encryptionDevices: devices, updatedAt: serverTimestamp() }, { merge: true })
        );
      }
    }
    if (!publicUpToDate) {
      if (publicSnapshot.exists()) {
        updates.push(
          updateDoc(publicRef, { id: userId, encryptionDevices: devices, updatedAt: serverTimestamp() })
            .catch(() => setDoc(publicRef, { id: userId, encryptionDevices: devices, isDiscoverable: true, updatedAt: serverTimestamp() }, { merge: true }))
        );
      } else {
        updates.push(
          setDoc(publicRef, {
            id: userId,
            encryptionDevices: devices,
            isDiscoverable: true,
            updatedAt: serverTimestamp(),
          }, { merge: true })
        );
      }
    }

    await Promise.all(updates);
    return identity;
  })();

  publishLocks.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    if (publishLocks.get(lockKey) === promise) publishLocks.delete(lockKey);
  }
}

function wrapConversationKey(conversationKey, recipientPublicKey, senderIdentity) {
  const sharedKey = nacl.box.before(recipientPublicKey, senderIdentity.secretKey);
  const nonce = Crypto.getRandomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(conversationKey, nonce, sharedKey);
  return {
    senderDeviceId: senderIdentity.deviceId,
    senderPublicKey: bytesToBase64(senderIdentity.publicKey),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export function createConversationEncryption(participantIds, participantProfiles, currentUserId, identity) {
  if (!identity || !Array.isArray(participantIds) || participantIds.length !== 2) {
    throw createE2EEError('E2EE_INVALID_CONVERSATION', 'ข้อมูลห้องแชตไม่ถูกต้องสำหรับการเข้ารหัส');
  }
  const conversationKey = Crypto.getRandomBytes(nacl.secretbox.keyLength);
  const keyEnvelopes = {};
  const missingUserIds = [];

  participantIds.forEach((userId) => {
    const profile = userId === currentUserId
      ? withIdentityDevice(participantProfiles?.[userId], identity)
      : participantProfiles?.[userId];
    const devices = getEncryptionDevices(profile);
    if (!Object.keys(devices).length) {
      missingUserIds.push(userId);
      return;
    }
    keyEnvelopes[userId] = {};
    Object.entries(devices).forEach(([deviceId, device]) => {
      keyEnvelopes[userId][deviceId] = wrapConversationKey(
        conversationKey,
        base64ToBytes(device.publicKey),
        identity
      );
    });
  });

  // Ensure current user has at least one device envelope so the conversationKey is preserved.
  // If the other user has not yet published an encryption key, we still allow room creation;
  // their envelope will be added when they become active.
  if (!keyEnvelopes[currentUserId] || !Object.keys(keyEnvelopes[currentUserId]).length) {
    throw createE2EEError(
      'E2EE_KEY_MISSING',
      'ไม่พบกุญแจเข้ารหัสของอุปกรณ์คุณ',
      { missingUserIds: [currentUserId] }
    );
  }

  return {
    conversationKey,
    encryption: {
      version: E2EE_VERSION,
      algorithm: E2EE_ALGORITHM,
      keyEnvelopes,
    },
  };
}

export function isValidConversationEncryption(encryption) {
  if (!isObject(encryption)
    || encryption.version !== E2EE_VERSION
    || encryption.algorithm !== E2EE_ALGORITHM
    || !isObject(encryption.keyEnvelopes)) {
    return false;
  }

  const participantEntries = Object.entries(encryption.keyEnvelopes);
  if (participantEntries.length < 1 || participantEntries.length > 2) return false;
  return participantEntries.every(([userId, deviceEnvelopes]) => {
    if (!userId || userId.length > MAX_DEVICE_ID_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(userId)) {
      return false;
    }
    if (!isObject(deviceEnvelopes)) return false;
    const deviceEntries = Object.entries(deviceEnvelopes);
    if (deviceEntries.length < 1 || deviceEntries.length > MAX_ENCRYPTION_DEVICES) return false;
    return deviceEntries.every(([deviceId, envelope]) => (
      deviceId.length > 0
      && deviceId.length <= MAX_DEVICE_ID_LENGTH
      && /^[A-Za-z0-9._:-]+$/.test(deviceId)
      && isValidKeyEnvelope(envelope)
    ));
  });
}

function isValidKeyEnvelope(envelope) {
  if (!isObject(envelope) || !Object.keys(envelope).every((key) => (
    ['senderDeviceId', 'senderPublicKey', 'nonce', 'ciphertext'].includes(key)
  )) || Object.keys(envelope).length !== 4) {
    return false;
  }
  if (typeof envelope.senderDeviceId !== 'string'
    || envelope.senderDeviceId.length === 0
    || envelope.senderDeviceId.length > MAX_DEVICE_ID_LENGTH
    || !/^[A-Za-z0-9._:-]+$/.test(envelope.senderDeviceId)
    || !isValidPublicKey(envelope.senderPublicKey)) {
    return false;
  }
  try {
    return base64ToBytes(envelope.nonce).length === nacl.secretbox.nonceLength
      && base64ToBytes(envelope.ciphertext).length === WRAPPED_KEY_CIPHERTEXT_BYTES;
  } catch {
    return false;
  }
}

export function hasCurrentDeviceEnvelope(encryption, userId, identity) {
  return Boolean(
    isValidConversationEncryption(encryption)
    && isValidKeyEnvelope(encryption.keyEnvelopes?.[userId]?.[identity?.deviceId])
  );
}

export function getConversationKey(encryption, userId, identity) {
  const envelope = encryption?.keyEnvelopes?.[userId]?.[identity?.deviceId];
  if (!isValidKeyEnvelope(envelope)) {
    throw createE2EEError(
      'E2EE_KEY_UNAVAILABLE',
      'ไม่พบกุญแจของอุปกรณ์นี้สำหรับห้องแชต'
    );
  }
  try {
    const senderPublicKey = base64ToBytes(envelope.senderPublicKey);
    const nonce = base64ToBytes(envelope.nonce);
    const wrappedKey = base64ToBytes(envelope.ciphertext);
    const sharedKey = nacl.box.before(senderPublicKey, identity.secretKey);
    const conversationKey = nacl.secretbox.open(wrappedKey, nonce, sharedKey);
    if (!conversationKey || conversationKey.length !== nacl.secretbox.keyLength) throw new Error('Invalid key');
    return conversationKey;
  } catch (error) {
    throw createE2EEError(
      'E2EE_KEY_UNAVAILABLE',
      'ไม่สามารถเปิดกุญแจของห้องแชตบนอุปกรณ์นี้ได้',
      { cause: error }
    );
  }
}

function messageContent(message) {
  const content = {
    text: String(message?.text || ''),
  };
  if (message?.mediaType) {
    content.mediaType = String(message.mediaType);
  }
  if (message?.mediaType === 'video') {
    content.videoMode = message.videoMode;
    content.videoDuration = message.videoDuration;
    if (Number.isFinite(message.videoStartMs)) content.videoStartMs = message.videoStartMs;
    if (Number.isFinite(message.videoEndMs)) content.videoEndMs = message.videoEndMs;
  }
  if (message?.mediaType === 'image' && message?.viewMode) content.viewMode = message.viewMode;
  if (message?.mediaUrl) {
    content.mediaUrl = String(message.mediaUrl);
  }
  if (Array.isArray(message?.mediaUrls)) {
    content.mediaUrls = message.mediaUrls.map(String);
  }
  if (typeof message?.audioDuration === 'number') {
    content.audioDuration = message.audioDuration;
  }
  if (message?.replyTo?.id) {
    content.replyTo = createReplySnapshot(message.replyTo);
  }
  return content;
}

export function encryptMessageRecord(message, conversationKey) {
  if (!conversationKey || conversationKey.length !== nacl.secretbox.keyLength) {
    throw createE2EEError('E2EE_KEY_UNAVAILABLE', 'ไม่พบกุญแจสำหรับเข้ารหัสข้อความ');
  }
  const nonce = Crypto.getRandomBytes(nacl.secretbox.nonceLength);
  const payload = utf8ToBytes(JSON.stringify(messageContent(message)));
  const ciphertext = nacl.secretbox(payload, nonce, conversationKey);
  const encryptedMessage = {
    id: message.id,
    senderId: message.senderId,
    createdAt: message.createdAt,
    time: message.time || message.createdAt,
    encrypted: true,
    encryptionVersion: E2EE_VERSION,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  };
  if (message.mediaType === 'video') {
    encryptedMessage.videoMode = message.videoMode;
    encryptedMessage.videoDuration = message.videoDuration;
    if (Number.isFinite(message.videoStartMs)) encryptedMessage.videoStartMs = message.videoStartMs;
    if (Number.isFinite(message.videoEndMs)) encryptedMessage.videoEndMs = message.videoEndMs;
  }
  if (message.mediaType === 'image' && message.viewMode) encryptedMessage.viewMode = message.viewMode;
  // These fields are routing/UI metadata and contain no message body.
  if (message.isSystem) encryptedMessage.isSystem = true;
  if (message.forwarded) encryptedMessage.forwarded = true;
  if (message.forwardedFrom) encryptedMessage.forwardedFrom = message.forwardedFrom;
  if (message.hiddenFor) encryptedMessage.hiddenFor = message.hiddenFor;
  if (message.reactions) encryptedMessage.reactions = message.reactions;
  if (message.reactionTimes) encryptedMessage.reactionTimes = message.reactionTimes;
  return encryptedMessage;
}

const decryptedRecordCache = new Map();
const MAX_DECRYPT_CACHE_SIZE = 1000;

export function decryptMessageRecord(message, conversationKey) {
  if (!message?.encrypted) {
    // Legacy plaintext must never be surfaced by the E2EE client. The
    // migration path encrypts it inside ensureConversationEncryption; if a
    // stale client writes plaintext concurrently, show only a safe marker.
    const { text: _legacyText, replyTo: _legacyReplyTo, ...metadata } = message || {};
    return {
      ...metadata,
      text: 'ข้อความนี้ยังไม่ได้เข้ารหัส',
      decryptionFailed: true,
    };
  }

  const cacheKey = message.id && message.ciphertext ? `${message.id}:${message.ciphertext}` : null;
  if (cacheKey && decryptedRecordCache.has(cacheKey)) {
    const cached = decryptedRecordCache.get(cacheKey);
    return {
      ...message,
      ...cached,
      text: cached.text,
      decryptionFailed: false,
    };
  }

  try {
    const nonce = base64ToBytes(message.nonce);
    const ciphertext = base64ToBytes(message.ciphertext);
    const plaintext = nacl.secretbox.open(ciphertext, nonce, conversationKey);
    if (!plaintext) throw new Error('Invalid ciphertext');
    const content = JSON.parse(bytesToUtf8(plaintext));
    const result = {
      ...message,
      ...content,
      text: typeof content.text === 'string' ? content.text : '',
      decryptionFailed: false,
    };

    if (cacheKey) {
      if (decryptedRecordCache.size > MAX_DECRYPT_CACHE_SIZE) {
        const firstKey = decryptedRecordCache.keys().next().value;
        if (firstKey) decryptedRecordCache.delete(firstKey);
      }
      decryptedRecordCache.set(cacheKey, {
        ...content,
        text: typeof content.text === 'string' ? content.text : '',
      });
    }

    return result;
  } catch (error) {
    return {
      ...message,
      text: DECRYPTION_FAILED_TEXT,
      decryptionFailed: true,
      decryptionError: String(error?.message || 'decrypt failed'),
    };
  }
}

function toMillis(value) {
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  if (typeof value?._seconds === 'number') return value._seconds * 1000;
  return 0;
}

function storedMessageId(conversationId, message, index) {
  return message?.id
    || `${conversationId}-m-${toMillis(message?.createdAt || message?.time)}-${message?.senderId || message?.sender || 'unknown'}-${index}`;
}

function addMissingDeviceEnvelopes(encryption, participantIds, participantProfiles, identity, currentUserId, conversationKey) {
  const keyEnvelopes = {};
  let changed = false;
  participantIds.forEach((userId) => {
    const existingEntries = isObject(encryption.keyEnvelopes?.[userId])
      ? Object.entries(encryption.keyEnvelopes[userId])
        .filter(([deviceId, envelope]) => (
          deviceId.length > 0
          && deviceId.length <= MAX_DEVICE_ID_LENGTH
          && /^[A-Za-z0-9._:-]+$/.test(deviceId)
          && isValidKeyEnvelope(envelope)
        ))
        .slice(0, MAX_ENCRYPTION_DEVICES)
      : [];
    keyEnvelopes[userId] = Object.fromEntries(existingEntries);
    const profile = userId === currentUserId
      ? withIdentityDevice(participantProfiles?.[userId], identity)
      : participantProfiles?.[userId];
    Object.entries(getEncryptionDevices(profile)).forEach(([deviceId, device]) => {
      if (keyEnvelopes[userId][deviceId]) return;
      if (Object.keys(keyEnvelopes[userId]).length >= MAX_ENCRYPTION_DEVICES) {
        const removableDeviceId = Object.keys(keyEnvelopes[userId]).find(
          (existingDeviceId) => existingDeviceId !== identity.deviceId
        );
        if (!removableDeviceId) return;
        delete keyEnvelopes[userId][removableDeviceId];
      }
      keyEnvelopes[userId][deviceId] = wrapConversationKey(
        conversationKey,
        base64ToBytes(device.publicKey),
        identity
      );
      changed = true;
    });
  });
  return changed ? { ...encryption, keyEnvelopes } : encryption;
}

async function resolveParticipantProfiles(db, participantIds, embeddedProfiles, currentUserId, identity) {
  const snapshots = await Promise.all(participantIds.map(async (userId) => {
    try {
      const [publicSnap, privateSnap] = await Promise.all([
        getDoc(doc(db, 'profiles', userId)).catch(() => null),
        getDoc(doc(db, 'users', userId)).catch(() => null),
      ]);
      return {
        publicData: publicSnap?.exists() ? publicSnap.data() : {},
        privateData: privateSnap?.exists() ? privateSnap.data() : {},
      };
    } catch {
      return { publicData: {}, privateData: {} };
    }
  }));
  const profiles = {};
  participantIds.forEach((userId, index) => {
    const embedded = embeddedProfiles?.[userId] || {};
    const remotePublic = snapshots[index]?.publicData || {};
    const remotePrivate = snapshots[index]?.privateData || {};
    const devices = {
      ...getEncryptionDevices(embedded),
      ...getEncryptionDevices(remotePublic),
      ...getEncryptionDevices(remotePrivate),
    };
    profiles[userId] = {
      ...embedded,
      ...remotePublic,
      ...remotePrivate,
      encryptionDevices: devices,
    };
    if (userId === currentUserId) profiles[userId] = withIdentityDevice(profiles[userId], identity);
  });
  return profiles;
}

async function prepareConversationEncryption(conversationId, currentUserId, participantProfiles = {}) {
  const { db } = requireFirebase();
  const identity = await ensureEncryptionIdentity(currentUserId);
  const conversationRef = doc(db, 'conversations', conversationId);
  let initialSnapshot = await getDoc(conversationRef);
  if (!initialSnapshot.exists()) {
    const parts = conversationId.split('-');
    if (parts.length === 3 && parts[0] === 'c' && (parts[1] === currentUserId || parts[2] === currentUserId)) {
      const otherUserId = parts[1] === currentUserId ? parts[2] : parts[1];
      try {
        const [otherProfileSnap, myProfileSnap] = await Promise.all([
          getDoc(doc(db, 'profiles', otherUserId)),
          getDoc(doc(db, 'profiles', currentUserId)),
        ]);
        const otherProfile = otherProfileSnap.exists() ? otherProfileSnap.data() : { id: otherUserId };
        const myProfile = myProfileSnap.exists() ? myProfileSnap.data() : { id: currentUserId };
        const participantIds = [parts[1], parts[2]];
        const conversationProfiles = {
          [currentUserId]: {
            id: currentUserId,
            isDiscoverable: myProfile.isDiscoverable === true,
            encryptionDevices: getEncryptionDevices(myProfile),
            ...(myProfile.updatedAt !== undefined ? { updatedAt: myProfile.updatedAt } : {}),
          },
          [otherUserId]: {
            id: otherUserId,
            isDiscoverable: otherProfile.isDiscoverable === true,
            encryptionDevices: getEncryptionDevices(otherProfile),
            ...(otherProfile.updatedAt !== undefined ? { updatedAt: otherProfile.updatedAt } : {}),
          },
        };
        const encryptionSetup = createConversationEncryption(
          participantIds,
          conversationProfiles,
          currentUserId,
          identity
        );
        await setDoc(conversationRef, {
          participants: participantIds,
          participantProfiles: conversationProfiles,
          unreadCounts: { [parts[1]]: 0, [parts[2]]: 0 },
          lastMessage: ENCRYPTED_PREVIEW,
          lastMessageSenderId: null,
          lastMessageAt: null,
          lastMessageId: null,
          messages: [],
          encryption: encryptionSetup.encryption,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        initialSnapshot = await getDoc(conversationRef);
      } catch (initErr) {
        console.warn('[prepareConversationEncryption] Auto-initialization failed:', initErr?.message || initErr);
      }
    }
    if (!initialSnapshot.exists()) {
      throw createE2EEError('not-found', 'ไม่พบห้องสนทนา');
    }
  }
  const initialData = initialSnapshot.data();
  const participantIds = Array.isArray(initialData.participants) ? initialData.participants : [];
  if (!participantIds.includes(currentUserId) || participantIds.length !== 2) {
    throw createE2EEError('permission-denied', 'คุณไม่มีสิทธิ์ใช้ห้องสนทนานี้');
  }
  const resolvedProfiles = await resolveParticipantProfiles(
    db,
    participantIds,
    { ...(initialData.participantProfiles || {}), ...participantProfiles },
    currentUserId,
    identity
  );

  const missingUserIds = participantIds.filter((userId) => (
    !Object.keys(getEncryptionDevices(resolvedProfiles[userId])).length
  ));
  if (missingUserIds.includes(currentUserId)) {
    throw createE2EEError(
      'E2EE_KEY_MISSING',
      'ไม่พบกุญแจเข้ารหัสของอุปกรณ์คุณ',
      { missingUserIds: [currentUserId] }
    );
  }

  let hasAnyMessages = Boolean(
    initialData.lastMessageId
    || (Array.isArray(initialData.messages) && initialData.messages.length > 0)
  );
  if (!hasAnyMessages) {
    try {
      const messagesSnap = await getDocs(query(collection(conversationRef, 'messages'), limit(1)));
      if (!messagesSnap.empty) {
        hasAnyMessages = true;
      }
    } catch {
      // Ignore subcollection read error
    }
  }

  let result = null;
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(conversationRef);
    if (!snapshot.exists()) throw createE2EEError('not-found', 'ไม่พบห้องสนทนา');
    const data = snapshot.data();
    const participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.includes(currentUserId)) {
      throw createE2EEError('permission-denied', 'คุณไม่มีสิทธิ์ใช้ห้องสนทนานี้');
    }

    let conversationKey = null;
    let encryption;
    let encryptionChanged = false;
    if (isValidConversationEncryption(data.encryption)) {
      try {
        conversationKey = getConversationKey(data.encryption, currentUserId, identity);
      } catch {
        conversationKey = null;
      }

      if (conversationKey) {
        encryption = addMissingDeviceEnvelopes(
          data.encryption,
          participants,
          resolvedProfiles,
          identity,
          currentUserId,
          conversationKey
        );
        encryptionChanged = encryption !== data.encryption;
      } else if (!hasAnyMessages && !data.lastMessageId && (!Array.isArray(data.messages) || data.messages.length === 0)) {
        // Conversation has no messages yet - safely regenerate key envelopes for active participant devices
        const created = createConversationEncryption(participants, resolvedProfiles, currentUserId, identity);
        conversationKey = created.conversationKey;
        encryption = created.encryption;
        encryptionChanged = true;
      } else {
        throw createE2EEError(
          'E2EE_KEY_UNAVAILABLE',
          'ไม่พบกุญแจของอุปกรณ์นี้สำหรับห้องแชต'
        );
      }
    } else {
      const created = createConversationEncryption(participants, resolvedProfiles, currentUserId, identity);
      conversationKey = created.conversationKey;
      encryption = created.encryption;
      encryptionChanged = true;
    }

    const updates = {};
    if (encryptionChanged) updates.encryption = encryption;
    if (data.lastMessage !== ENCRYPTED_PREVIEW) updates.lastMessage = ENCRYPTED_PREVIEW;
    if (Object.keys(updates).length) {
      updates.updatedAt = serverTimestamp();
      transaction.update(conversationRef, updates);
    }
    result = {
      conversationKey,
      encryption,
      // The root `messages` array is legacy data. New messages are stored in
      // a protected subcollection, so this helper must never rewrite the
      // legacy array and accidentally grant a participant an array-wide
      // mutation primitive.
      messages: Array.isArray(data.messages) ? data.messages : [],
      data: { ...data, ...updates },
    };
  });
  return result;
}

const conversationKeyCache = new Map();

export function clearConversationKeyCache(conversationId, currentUserId) {
  if (conversationId && currentUserId) {
    conversationKeyCache.delete(`${currentUserId}:${conversationId}`);
  } else {
    conversationKeyCache.clear();
  }
}

export async function ensureConversationEncryption(
  conversationId,
  currentUserId,
  participantProfiles = {},
  forceRefresh = false
) {
  const lockKey = `${currentUserId}:${conversationId}`;
  if (!forceRefresh && conversationKeyCache.has(lockKey)) {
    return conversationKeyCache.get(lockKey);
  }
  if (conversationLocks.has(lockKey)) return conversationLocks.get(lockKey);
  const promise = prepareConversationEncryption(conversationId, currentUserId, participantProfiles);
  conversationLocks.set(lockKey, promise);
  try {
    const res = await promise;
    if (res?.conversationKey) {
      conversationKeyCache.set(lockKey, res);
    }
    return res;
  } catch (err) {
    conversationKeyCache.delete(lockKey);
    throw err;
  } finally {
    if (conversationLocks.get(lockKey) === promise) conversationLocks.delete(lockKey);
  }
}

export async function hydrateConversationMessages(conversationId, currentUserId, data, participantProfiles = {}) {
  const identity = await getOrCreateEncryptionIdentity(currentUserId);
  let preparedData = data || {};
  let conversationKey = null;
  const lockKey = `${currentUserId}:${conversationId}`;
  if (conversationKeyCache.has(lockKey)) {
    conversationKey = conversationKeyCache.get(lockKey)?.conversationKey;
  }
  try {
    if (!conversationKey && isValidConversationEncryption(preparedData.encryption)) {
      conversationKey = getConversationKey(preparedData.encryption, currentUserId, identity);
      if (conversationKey) {
        conversationKeyCache.set(lockKey, {
          conversationKey,
          encryption: preparedData.encryption,
          data: preparedData,
        });
      }
    }
  } catch {
    conversationKey = null;
  }
  if (!conversationKey) {
    const prepared = await ensureConversationEncryption(conversationId, currentUserId, participantProfiles);
    conversationKey = prepared.conversationKey;
    preparedData = {
      ...preparedData,
      ...prepared.data,
      encryption: prepared.encryption,
      messages: prepared.messages,
    };
  }
  const messages = (Array.isArray(preparedData.messages) ? preparedData.messages : [])
    .map((message, index) => decryptMessageRecord({
      ...message,
      id: storedMessageId(conversationId, message, index),
    }, conversationKey));
  return { data: preparedData, messages, encryptionPending: false };
}

export function isE2EEUnavailableError(error) {
  const code = error?.code;
  const message = typeof error?.message === 'string' ? error.message : '';
  return ['E2EE_KEY_MISSING', 'E2EE_KEY_UNAVAILABLE', 'unavailable'].includes(code)
    || message.includes('client is offline')
    || message.includes('offline');
}

/**
 * Encrypt raw media bytes using the conversation key.
 * Prepends the 24-byte nonce to the ciphertext for self-contained packaging.
 *
 * @param {Uint8Array} binaryBytes - Raw media bytes (JPEG, M4A, etc.)
 * @param {Uint8Array} conversationKey - 32-byte conversation symmetric key
 * @returns {Uint8Array} - Nonce (24 bytes) + ciphertext
 */
export function encryptMediaBytes(binaryBytes, conversationKey) {
  if (!conversationKey || conversationKey.length !== nacl.secretbox.keyLength) {
    throw createE2EEError('E2EE_KEY_UNAVAILABLE', 'ไม่พบกุญแจสำหรับเข้ารหัสไฟล์สื่อ');
  }
  const input = binaryBytes instanceof Uint8Array ? binaryBytes : new Uint8Array(binaryBytes || []);
  const nonce = Crypto.getRandomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(input, nonce, conversationKey);
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return packed;
}

/**
 * Decrypt media bytes using the conversation key.
 *
 * @param {Uint8Array} encryptedBytes - Packed nonce (24 bytes) + ciphertext
 * @param {Uint8Array} conversationKey - 32-byte conversation symmetric key
 * @returns {Uint8Array} - Decrypted raw bytes
 */
export function decryptMediaBytes(encryptedBytes, conversationKey) {
  if (!conversationKey || conversationKey.length !== nacl.secretbox.keyLength) {
    throw createE2EEError('E2EE_KEY_UNAVAILABLE', 'ไม่พบกุญแจสำหรับถอดรหัสไฟล์สื่อ');
  }
  const input = encryptedBytes instanceof Uint8Array ? encryptedBytes : new Uint8Array(encryptedBytes || []);
  if (input.length <= nacl.secretbox.nonceLength) {
    throw createE2EEError('E2EE_INVALID_MEDIA', 'ข้อมูลไฟล์สื่อที่เข้ารหัสไม่สมบูรณ์');
  }
  const nonce = input.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = input.slice(nacl.secretbox.nonceLength);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, conversationKey);
  if (!decrypted) {
    throw createE2EEError('E2EE_DECRYPT_FAILED', 'ไม่สามารถถอดรหัสไฟล์สื่อได้ด้วยกุญแจปัจจุบัน');
  }
  return decrypted;
}

/**
 * Retrieve the active conversation key for media operations.
 */
export async function getOrFetchConversationKey(conversationId, currentUserId) {
  if (!conversationId || !currentUserId) return null;
  try {
    const setup = await ensureConversationEncryption(conversationId, currentUserId);
    return setup?.conversationKey || null;
  } catch (err) {
    if (!isE2EEUnavailableError(err)) {
      console.warn('[chatEncryptionService] Failed to retrieve conversationKey:', err?.message || err);
    }
    return null;
  }
}

export { bytesToBase64, base64ToBytes };
