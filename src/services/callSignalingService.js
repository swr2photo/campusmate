import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { requireFirebase } from './dbService.js';

export const CALL_STATUS = {
  CALLING: 'calling',
  RINGING: 'ringing',
  CONNECTED: 'connected',
  ENDED: 'ended',
  REJECTED: 'rejected',
  BUSY: 'busy',
  MISSED: 'missed',
};

export const CALL_TYPES = {
  VOICE: 'voice',
  VIDEO: 'video',
};

/**
 * Start a new outgoing call session in Firestore
 */
export async function initiateCall({
  callerId,
  receiverId,
  callerProfile,
  receiverProfile,
  callType = CALL_TYPES.VOICE,
  conversationId = null,
  offer = null,
}) {
  const { db } = requireFirebase();
  const callDocRef = doc(collection(db, 'calls'));
  const callId = callDocRef.id;

  const callData = {
    id: callId,
    callerId,
    receiverId,
    callerProfile: {
      name: callerProfile?.name || callerProfile?.nickname || 'ผู้โทร',
      avatarUri:
        callerProfile?.avatarUri ||
        callerProfile?.photoURL ||
        callerProfile?.photoUrl ||
        callerProfile?.photos?.[0] ||
        (typeof callerProfile?.avatar === 'string' &&
        (callerProfile.avatar.startsWith('http') || callerProfile.avatar.startsWith('file:') || callerProfile.avatar.startsWith('data:'))
          ? callerProfile.avatar
          : null),
      avatarColor: callerProfile?.avatarColor || null,
      avatar: callerProfile?.avatar || null,
    },
    receiverProfile: {
      name: receiverProfile?.name || receiverProfile?.nickname || 'ผู้รับสาย',
      avatarUri:
        receiverProfile?.avatarUri ||
        receiverProfile?.photoURL ||
        receiverProfile?.photoUrl ||
        receiverProfile?.photos?.[0] ||
        (typeof receiverProfile?.avatar === 'string' &&
        (receiverProfile.avatar.startsWith('http') || receiverProfile.avatar.startsWith('file:') || receiverProfile.avatar.startsWith('data:'))
          ? receiverProfile.avatar
          : null),
      avatarColor: receiverProfile?.avatarColor || null,
      avatar: receiverProfile?.avatar || null,
    },
    callType,
    conversationId,
    status: CALL_STATUS.CALLING,
    offer: offer || null,
    answer: null,
    createdAt: serverTimestamp(),
    startedAt: null,
    endedAt: null,
    durationSeconds: 0,
    endReason: null,
  };

  await setDoc(callDocRef, callData);
  return { callId, ...callData };
}

/**
 * Answer an incoming call with SDP answer
 */
export async function acceptCall(callId, answer = null) {
  const { db } = requireFirebase();
  const callDocRef = doc(db, 'calls', callId);

  const updates = {
    status: CALL_STATUS.CONNECTED,
    startedAt: serverTimestamp(),
  };
  if (answer) {
    updates.answer = answer;
  }

  await updateDoc(callDocRef, updates);
}

/**
 * Update call to ringing state (receiver app received the call notification)
 */
export async function setCallRinging(callId) {
  const { db } = requireFirebase();
  const callDocRef = doc(db, 'calls', callId);
  try {
    await updateDoc(callDocRef, {
      status: CALL_STATUS.RINGING,
    });
  } catch (err) {
    // Call may already be ended/accepted
  }
}

/**
 * Reject incoming call (busy or declined by user)
 */
export async function rejectCall(callId, reason = 'declined') {
  const { db } = requireFirebase();
  const callDocRef = doc(db, 'calls', callId);

  await updateDoc(callDocRef, {
    status: CALL_STATUS.REJECTED,
    endedAt: serverTimestamp(),
    endReason: reason,
  });
}

/**
 * Mark call as missed (timed out without answer)
 */
export async function markCallMissed(callId) {
  const { db } = requireFirebase();
  const callDocRef = doc(db, 'calls', callId);

  await updateDoc(callDocRef, {
    status: CALL_STATUS.MISSED,
    endedAt: serverTimestamp(),
    endReason: 'timeout',
  });
}

/**
 * End an ongoing or pending call
 */
export async function endCall(callId, durationSeconds = 0, reason = 'hangup') {
  const { db } = requireFirebase();
  const callDocRef = doc(db, 'calls', callId);

  try {
    await updateDoc(callDocRef, {
      status: CALL_STATUS.ENDED,
      endedAt: serverTimestamp(),
      durationSeconds: Math.max(0, Math.floor(durationSeconds)),
      endReason: reason,
    });
  } catch (err) {
    // Might already be terminated
  }
}

/**
 * Listen to real-time state changes of a specific call
 */
export function subscribeToCall(callId, onUpdate) {
  if (!callId) return () => {};
  const { db } = requireFirebase();
  const callDocRef = doc(db, 'calls', callId);

  return onSnapshot(
    callDocRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate({ id: snap.id, ...snap.data() });
      } else {
        onUpdate(null);
      }
    },
    (error) => {
      console.warn('[callSignaling] subscribeToCall error:', error);
    }
  );
}

/**
 * Listen for incoming calls for the current user (where status is 'calling' or 'ringing')
 */
export function subscribeToIncomingCalls(userId, onIncomingCall) {
  if (!userId) return () => {};
  console.log('DEBUG subscribeToIncomingCalls', { requireFirebase: typeof requireFirebase, query: typeof query, collection: typeof collection, where: typeof where });
  const { db } = requireFirebase();

  // Query calls where receiverId === userId and status is calling or ringing
  const callsQuery = query(
    collection(db, 'calls'),
    where('receiverId', '==', userId),
    where('status', 'in', [CALL_STATUS.CALLING, CALL_STATUS.RINGING])
  );

  return onSnapshot(
    callsQuery,
    (snapshot) => {
      if (!snapshot.empty) {
        const calls = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        // Sort newest call first
        calls.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
          return tB - tA;
        });

        const latestCall = calls[0];
        const createdMillis = latestCall.createdAt?.toMillis
          ? latestCall.createdAt.toMillis()
          : Date.now();
        // Check if call was created recently (within 60 seconds)
        if (Date.now() - createdMillis < 60000) {
          onIncomingCall(latestCall);
          return;
        }
      }
      onIncomingCall(null);
    },
    (error) => {
      console.warn('[callSignaling] subscribeToIncomingCalls error:', error);
    }
  );
}

/**
 * Send an ICE candidate to Firestore sub-collection
 */
export async function sendIceCandidate(callId, isCaller, candidate) {
  if (!callId || !candidate) return;
  const { db } = requireFirebase();
  const subCollectionName = isCaller ? 'callerCandidates' : 'receiverCandidates';
  const candidatesRef = collection(db, 'calls', callId, subCollectionName);

  const plainCandidate = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate;
  await setDoc(doc(candidatesRef), {
    ...plainCandidate,
    createdAt: serverTimestamp(),
  });
}

/**
 * Listen to ICE candidates from the other peer
 */
export function subscribeToRemoteIceCandidates(callId, isCaller, onCandidate) {
  if (!callId) return () => {};
  const { db } = requireFirebase();
  // If we are caller, we listen to receiverCandidates; if receiver, listen to callerCandidates
  const remoteCollectionName = isCaller ? 'receiverCandidates' : 'callerCandidates';
  const candidatesRef = collection(db, 'calls', callId, remoteCollectionName);

  return onSnapshot(
    candidatesRef,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          onCandidate(change.doc.data());
        }
      });
    },
    (error) => {
      console.warn('[callSignaling] subscribeToRemoteIceCandidates error:', error);
    }
  );
}

/**
 * Get call by id
 */
export async function getCall(callId) {
  if (!callId) return null;
  const { db } = requireFirebase();
  const callDoc = await getDoc(doc(db, 'calls', callId));
  if (!callDoc.exists()) return null;
  return { id: callDoc.id, ...callDoc.data() };
}

export { formatCallDuration } from '../utils/callDuration.js';
