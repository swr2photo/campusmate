import * as Crypto from 'expo-crypto';
import { Timestamp, collection, collectionGroup, doc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, where, writeBatch } from 'firebase/firestore';
import { enqueueOfflineOperation, getFailedOfflineOperations, retryFailedOfflineOperation } from './offlineStorage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { encryptGroupText } from './groupChatEncryption';
import { encryptMessageRecord } from './chatEncryptionService';
import { getCallable } from './callableClient';
import { RUST_BACKEND } from './rust/backend';
import * as rustParties from './rust/parties';
import { notifyBackendChange } from './rust/events';

const REGION = 'asia-southeast1';

// Only expand a live query when the user explicitly asks for another page.
// Keeping the loaded window live also removes rooms immediately after leaving.
function subscribePagedQuery(baseQuery, onData, onError, pageSize = 30) {
  let windowSize = pageSize;
  let off;
  let stopped = false;
  let generation = 0;
  const listen = () => {
    const version = ++generation;
    off?.();
    off = onSnapshot(query(baseQuery, limit(windowSize)), (snapshot) => {
      if (!stopped && version === generation) onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
        { hasMore: snapshot.size === windowSize, loadingMore: false });
    }, (error) => { if (!stopped && version === generation) onError?.(error); });
  };
  listen();
  const stop = () => { stopped = true; off?.(); };
  stop.loadMore = () => { if (!stopped) { windowSize += pageSize; listen(); } };
  return stop;
}

function callable(name) {
  return getCallable(name, { timeout: 30000 });
}

async function invoke(name, payload) {
  const result = await callable(name)(payload);
  if (RUST_BACKEND && !['searchCampusPlaces', 'resolveCampusPlace'].includes(name)) {
    notifyBackendChange('parties');
    notifyBackendChange('group-messages');
  }
  return result.data;
}

export const createParty = (payload) => invoke('createParty', payload);
export const requestJoinParty = (partyId) => invoke('requestJoinParty', { partyId });
export const withdrawPartyRequest = (partyId) => invoke('withdrawPartyRequest', { partyId });
export const rejectPartyRequest = (partyId, requesterId) => invoke('rejectPartyRequest', { partyId, requesterId });
export const cancelParty = (partyId) => invoke('cancelParty', { partyId });
export const leaveParty = (partyId) => invoke('leaveParty', { partyId });
export const updateGroupProfile = (partyId, { title, avatarUri = '' } = {}) => invoke('updateGroupProfile', { partyId, title, avatarUri });
export const rotatePartyKey = (partyId, grants) => invoke('rotatePartyKey', { partyId, grants });
export const approvePartyRequest = (partyId, requesterId, grants) => invoke('approvePartyRequest', {
  partyId, requesterId, ...grants,
});
export const activateLegacyPartyChat = (partyId, initialGrants) => invoke('activateLegacyPartyChat', { partyId, initialGrants });
export const searchCampusPlaces = async (search) => {
  const result = await invoke('searchCampusPlaces', { query: search });
  return result?.places || [];
};
export const resolveCampusPlace = async (placeId) => {
  const result = await invoke('resolveCampusPlace', { placeId });
  return result?.place;
};

export async function writeQueuedGroupMessage(payload, userId) {
  if (RUST_BACKEND) return rustParties.writeQueuedGroupMessage(payload, userId);
  const { db } = requireFirebase();
  const ref = doc(db, 'groupChats', payload.partyId, 'messages', payload.id);
  // Retrying a commit with an unknown acknowledgement must not duplicate it.
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      if (existing.get('senderId') !== userId || ![payload.record.ciphertext, payload.previousCiphertext].includes(existing.get('ciphertext'))) throw new Error('Message ID conflict');
      return;
    }
    tx.set(ref, { ...payload.record, senderId: userId, createdAt: serverTimestamp() });
  });
}

export async function retryGroupMessage(partyId, userId, epoch, message, key) {
  const failed = await getFailedOfflineOperations(userId);
  const operation = failed.find((item) => item.type === 'sendGroupMessage' && item.id === message.operationId && item.payload.partyId === partyId);
  if (!operation) return;
  let payload = operation.payload;
  if (payload.record.epoch !== epoch) {
    if (message.decryptionFailed || message.keyPending) throw new Error('ไม่พบกุญแจเก่าสำหรับส่งข้อความนี้ใหม่');
    const encrypted = encryptMessageRecord(message, key);
    payload = { ...payload, previousCiphertext: payload.previousCiphertext || payload.record.ciphertext,
      record: { ...payload.record, epoch, nonce: encrypted.nonce, ciphertext: encrypted.ciphertext } };
  }
  await retryFailedOfflineOperation(userId, operation.id, payload);
}

function newMessageId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = Crypto.getRandomBytes(20);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function queueGroupRecord(partyId, userId, epoch, type, encrypted, options = {}) {
  const id = options.clientMessageId || (RUST_BACKEND ? newMessageId() : doc(collection(requireFirebase().db, 'groupChats', partyId, 'messages')).id);
  const record = { senderId: userId, epoch, type, encrypted: true, nonce: encrypted.nonce, ciphertext: encrypted.ciphertext };
  const clientSentAt = options.clientSentAt || Date.now();
  await enqueueOfflineOperation(userId, 'sendGroupMessage', { partyId, id, record, clientSentAt }, { dedupeKey: `group-message:${id}` });
  return { id, ...record, clientSentAt, pendingSync: true, sendStatus: 'queued' };
}

export async function sendGroupText(partyId, userId, epoch, text, key) {
  const body = String(text || '').trim();
  if (!body) return;
  if (body.length > 4000) throw new Error('ข้อความยาวเกินไป');
  const encrypted = encryptGroupText(body, key);
  return queueGroupRecord(partyId, userId, epoch, 'text', encrypted);
}

export async function sendGroupImage(partyId, userId, epoch, mediaUrl, key, { caption = '', viewMode = 'chat', clientMessageId, clientSentAt, encryptedRecord } = {}) {
  if (!key || key.length !== 32 || !mediaUrl) throw new Error('ไม่พบรูปภาพหรือกุญแจกลุ่ม');
  const text = String(caption || '').trim().slice(0, 500);
  const mode = viewMode === 'once' || viewMode === 'replay' ? viewMode : 'chat';
  const encrypted = encryptedRecord || encryptMessageRecord({
    text: text || '[รูปภาพ]',
    mediaType: 'image',
    mediaUrl,
    ...(mode !== 'chat' ? { viewMode: mode } : {}),
  }, key);
  return queueGroupRecord(partyId, userId, epoch, 'image', encrypted, { clientMessageId, clientSentAt });
}

export async function sendGroupGif(partyId, userId, epoch, gif, key) {
  const mediaUrl = String(gif?.url || '').trim();
  if (!key || key.length !== 32 || !/^https:\/\//i.test(mediaUrl) || mediaUrl.length > 2000) {
    throw new Error('ส่ง GIF ไม่สำเร็จ');
  }
  const encrypted = encryptMessageRecord({ text: '[GIF]', mediaType: 'image', mediaUrl }, key);
  return queueGroupRecord(partyId, userId, epoch, 'gif', encrypted);
}

export async function sendGroupAudio(partyId, userId, epoch, { mediaUrl, audioDuration }, key) {
  const duration = Math.round(Number(audioDuration) || 0);
  if (!key || key.length !== 32 || !mediaUrl || duration < 1 || duration > 900) {
    throw new Error('ส่งข้อความเสียงไม่สำเร็จ');
  }
  const encrypted = encryptMessageRecord({
    text: '[ข้อความเสียง]', mediaType: 'audio', mediaUrl, audioDuration: duration,
  }, key);
  return queueGroupRecord(partyId, userId, epoch, 'audio', encrypted);
}

export async function sendGroupTrack(partyId, userId, epoch, track, key) {
  if (!key || key.length !== 32 || !track?.id) throw new Error('ส่งเพลงไม่สำเร็จ');
  const trackName = String(track.name || 'เพลง').slice(0, 200);
  const encrypted = encryptMessageRecord({
    text: `🎵 ${trackName}`.slice(0, 1000),
    mediaType: 'track',
    trackId: String(track.id).slice(0, 64),
    trackName,
    artists: String(track.artists || '').slice(0, 200),
    albumArt: typeof track.albumArt === 'string' ? track.albumArt.slice(0, 2000) : '',
    ...(typeof track.previewUrl === 'string' && track.previewUrl ? { previewUrl: track.previewUrl.slice(0, 2000) } : {}),
    externalUrl: typeof track.externalUrl === 'string' && track.externalUrl
      ? track.externalUrl.slice(0, 500)
      : `https://open.spotify.com/track/${String(track.id).slice(0, 64)}`,
  }, key);
  return queueGroupRecord(partyId, userId, epoch, 'track', encrypted);
}

export function subscribeParties(onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeParties(onData, onError);
  const { db } = requireFirebase();
  const recentCutoff = Timestamp.fromMillis(Date.now());
  return subscribePagedQuery(query(collection(db, 'parties'),
    where('status', '==', 'open'), where('schedule.startsAt', '>=', recentCutoff), orderBy('schedule.startsAt', 'asc')), onData, onError);
}

export function subscribeOwnParties(userId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeOwnParties(userId, onData, onError);
  const { db } = requireFirebase();
  return subscribePagedQuery(query(collection(db, 'parties'), where('memberIds', 'array-contains', userId),
    where('schedule.startsAt', '>=', Timestamp.fromMillis(Date.now() - 86400000)), orderBy('schedule.startsAt', 'asc')), onData, onError);
}

export function subscribePartyById(partyId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribePartyById(partyId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(doc(db, 'parties', partyId), (snapshot) => onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null), onError);
}

export function subscribeMyPartyRequest(partyId, userId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeMyPartyRequest(partyId, userId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(doc(db, 'parties', partyId, 'requests', userId),
    (snapshot) => onData(snapshot.exists() ? snapshot.data() : null), onError);
}

export function subscribeLegacyPartiesToActivate(hostId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeLegacyPartiesToActivate(hostId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(query(collection(db, 'parties'),
    where('hostId', '==', hostId), where('chatActivationRequired', '==', true), limit(30)),
  (snapshot) => onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).filter((party) => party.legacy === true)),
  onError);
}

export function subscribeMyPartyRequests(userId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeMyPartyRequests(userId, onData, onError);
  const { db } = requireFirebase();
  return subscribePagedQuery(query(collectionGroup(db, 'requests'), where('requesterId', '==', userId),
    where('status', '==', 'pending'), orderBy('updatedAt', 'desc')), onData, onError);
}

export function subscribeHostedPartyRequests(partyId, hostId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeHostedPartyRequests(partyId, hostId, onData, onError);
  const { db } = requireFirebase();
  return subscribePagedQuery(query(collection(db, 'parties', partyId, 'requests'), where('hostId', '==', hostId),
    where('status', '==', 'pending'), orderBy('updatedAt', 'asc')), onData, onError);
}

export function subscribeGroupChats(userId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeGroupChats(userId, onData, onError);
  const { db } = requireFirebase();
  return subscribePagedQuery(query(collection(db, 'groupChats'), where('memberIds', 'array-contains', userId),
    orderBy('updatedAt', 'desc')), onData, onError, 20);
}

export function subscribeGroupChat(partyId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeGroupChat(partyId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(doc(db, 'groupChats', partyId),
    (snapshot) => onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError);
}

export function subscribeGroupReads(userId, onData, onError, partyIds = []) {
  if (RUST_BACKEND) return rustParties.subscribeGroupReads(userId, onData, onError, partyIds);
  const { db } = requireFirebase();
  const pages = {};
  if (!partyIds.length) onData({});
  const off = [];
  for (let offset = 0; offset < partyIds.length; offset += 30) {
    const page = offset / 30;
    off.push(onSnapshot(query(collection(db, 'users', userId, 'groupChatReads'), where('partyId', 'in', partyIds.slice(offset, offset + 30))),
      (snapshot) => {
        pages[page] = Object.fromEntries(snapshot.docs.map((entry) => [entry.id, entry.data()]));
        onData(Object.assign({}, ...Object.values(pages)));
      }, onError));
  }
  return () => off.forEach((stop) => stop());
}

export function subscribeGroupReadReceipts(partyId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeGroupReadReceipts(partyId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(collection(db, 'groupChats', partyId, 'readReceipts'),
    (snapshot) => onData(Object.fromEntries(snapshot.docs.map((entry) => [entry.id, entry.data()]))), onError);
}

export async function markGroupRead(partyId, userId, message) {
  if (RUST_BACKEND) return rustParties.markGroupRead(partyId, userId, message);
  if (!message?.createdAt?.toMillis || message.pendingSync || message.decryptionFailed) return;
  const { db } = requireFirebase();
  const data = { partyId, messageId: message.id, lastReadMessageAt: message.createdAt, updatedAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.set(doc(db, 'groupChats', partyId, 'readReceipts', userId), data);
  batch.set(doc(db, 'users', userId, 'groupChatReads', partyId), data);
  await batch.commit();
}

export function subscribeGroupEpochs(partyId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeGroupEpochs(partyId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(collection(db, 'groupChats', partyId, 'epochs'),
    (snapshot) => onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
    onError);
}

export function subscribeGroupMessages(partyId, onData, onError) {
  if (RUST_BACKEND) return rustParties.subscribeGroupMessages(partyId, onData, onError);
  const { db } = requireFirebase();
  return onSnapshot(query(collection(db, 'groupChats', partyId, 'messages'), orderBy('createdAt', 'desc'), limit(100)), { includeMetadataChanges: true },
    (snapshot) => onData(
      snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data({ serverTimestamps: 'estimate' }), pendingSync: entry.metadata.hasPendingWrites,
        sendStatus: entry.metadata.hasPendingWrites ? 'sending' : 'sent' })),
      snapshot.docs.at(-1) || null,
      snapshot.docs.length === 100,
    ),
    onError);
}

export async function loadOlderGroupMessages(partyId, cursor) {
  if (RUST_BACKEND) return rustParties.loadOlderGroupMessages(partyId, cursor);
  if (!cursor) return { messages: [], cursor: null, hasMore: false };
  const { db } = requireFirebase();
  const snapshot = await getDocs(query(
    collection(db, 'groupChats', partyId, 'messages'),
    orderBy('createdAt', 'desc'), startAfter(cursor), limit(100),
  ));
  return {
    messages: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.docs.length === 100,
  };
}
