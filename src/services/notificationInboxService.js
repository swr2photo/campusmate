import { collection, doc, getDoc, getDocs, getCountFromServer, limit, onSnapshot, orderBy, query, serverTimestamp, startAfter, updateDoc, where, or, Timestamp } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireFirebase } from './dbService';
import { waitForAuthReady } from './secureDiscoveryService';
import { createNotificationReadOutbox } from '../utils/notificationReadOutbox';

let readOutbox;
function getReadOutbox() {
  if (!readOutbox) readOutbox = createNotificationReadOutbox({
    storage: AsyncStorage,
    currentUid: () => getAuth(requireFirebase().app).currentUser?.uid || null,
    write: async (uid, id) => {
      const { app, db } = requireFirebase();
      if (getAuth(app).currentUser?.uid !== uid) throw Object.assign(new Error('บัญชีเปลี่ยนแล้ว'), { code: 'permission-denied' });
      await updateDoc(doc(db, 'users', uid, 'notifications', id), { readAt: serverTimestamp() });
    },
  });
  return readOutbox;
}
export const watchPendingInboxReads = (uid, callback) => getReadOutbox().subscribe(uid, callback);
export const clearPendingInboxReads = uid => getReadOutbox().clear(uid);
export const retryInboxReadWrites = uid => getReadOutbox().flush(uid);

export const timestampMillis = value => value?.toMillis?.() || (value?.seconds ? value.seconds * 1000 : 0);
export const visibleNotification = row => !row.expiresAt || timestampMillis(row.expiresAt) > Date.now();
const inbox = (db, uid) => collection(db, 'users', uid, 'notifications');
export async function inboxCall(name, expectedUid) {
  const { app } = requireFirebase();
  const user = await waitForAuthReady(getAuth(app));
  if (!user || (expectedUid && user.uid !== expectedUid)) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง');
  return (await httpsCallable(getFunctions(app, 'asia-southeast1'), name)({ expectedUid: expectedUid || user.uid })).data;
}
export function watchInbox(uid, onRows, onCount, onError, onFace, pageSize = 30) {
  let alive = true, stops = [], revision = 0, offAuth = () => {};
  const disconnect = () => { revision++; stops.forEach(stop => stop()); stops = []; };
  try {
    const { app, db } = requireFirebase();
    offAuth = onAuthStateChanged(getAuth(app), current => {
      disconnect();
      if (!alive || current?.uid !== uid) return;
      void retryInboxReadWrites(uid).catch(onError);
      const source = inbox(db, uid);
      const refreshCount = async () => {
        const ticket = ++revision;
        try {
          const count = await getCountFromServer(query(source, where('readAt', '==', null), or(where('expiresAt', '==', null), where('expiresAt', '>', Timestamp.now()))));
          if (alive && ticket === revision) onCount(count.data().count);
        } catch (error) { if (alive && ticket === revision) onError(error); }
      };
      // Expiry is a clock event: Firestore does not emit a new snapshot when
      // a document merely crosses expiresAt. Refresh while the app is active,
      // and immediately when returning from the background.
      const expiryTimer = setInterval(() => {
        if (AppState.currentState === 'active') { void refreshCount(); void retryInboxReadWrites(uid).catch(onError); }
      }, 60000);
      const foreground = AppState.addEventListener('change', state => {
        if (state === 'active') { void refreshCount(); void retryInboxReadWrites(uid).catch(onError); }
      });
      stops.push(() => { clearInterval(expiryTimer); foreground.remove(); });
      stops.push(onSnapshot(doc(db, 'users', uid, 'notifications', 'face-verification'), { includeMetadataChanges: true }, snap => {
        if (!alive || (snap.metadata?.fromCache && !snap.exists())) return;
        onFace?.(snap.exists() ? { id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } : null, snap.metadata?.fromCache === true);
      }, onError));
      stops.push(onSnapshot(query(source, orderBy('createdAt', 'desc'), limit(pageSize)), { includeMetadataChanges: true }, snap => {
        if (!alive) return;
        onRows(snap.docs.map(row => ({ id: row.id, ...row.data({ serverTimestamps: 'estimate' }) })), snap.docs.at(-1), snap.size === pageSize, snap.metadata.fromCache);
        void refreshCount();
      }, onError));
      stops.push(onSnapshot(query(source, where('readAt', '==', null), orderBy('createdAt', 'desc'), limit(1)), () => void refreshCount(), onError));
      inboxCall('ensureNotificationInbox', uid).catch(error => { if (alive) onError(error); });
    }, onError);
  } catch (error) { onError(error); }
  return () => { alive = false; offAuth(); disconnect(); };
}
export async function loadInboxPage(uid, cursor) {
  const { db } = requireFirebase();
  const snap = await getDocs(query(inbox(db, uid), orderBy('createdAt', 'desc'), startAfter(cursor), limit(30)));
  return { rows: snap.docs.map(row => ({ id: row.id, ...row.data() })), cursor: snap.docs.at(-1), hasMore: snap.size === 30 };
}
export function markInboxRead(uid, id) {
  return getReadOutbox().enqueue(uid, id);
}
export async function inboxTargetAvailable(row, uid) {
  const { db } = requireFirebase(), target = row.target || {};
  if (target.conversationId) {
    const snap = await getDoc(doc(db, 'conversations', target.conversationId));
    return snap.exists() && snap.data().participants?.includes(uid);
  }
  if (row.type === 'group_message' && target.partyId) {
    const snap = await getDoc(doc(db, 'groupChats', target.partyId));
    return snap.exists() && snap.data().memberIds?.includes(uid);
  }
  if (target.partyId) return (await getDoc(doc(db, 'parties', target.partyId))).exists();
  if (target.appointmentId) return (await getDoc(doc(db, 'appointments', target.appointmentId))).exists();
  return true;
}

export async function markPushInboxRead(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return;
  const { app } = requireFirebase(), user = await waitForAuthReady(getAuth(app));
  if (user) await markInboxRead(user.uid, id);
}
