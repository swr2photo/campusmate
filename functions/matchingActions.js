import { HttpsError } from 'firebase-functions/v2/https';
import { canViewProfile } from './profileVisibilityPolicy.js';
import { requireFeature } from './plusEntitlements.js';
import { buildPublicProfile } from './discoveryProfile.js';
import { toWire } from './secureProfileAccess.js';
import { establishedMatch } from './profileRelationships.js';

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const ACTION = /^[a-zA-Z0-9_-]{16,100}$/;
const isLike = (value, from, to) => value?.fromUserId === from && value?.toUserId === to
  && value.type === 'like' && ['pending', 'accepted'].includes(value.status);
function ids(request) {
  const uid = request.auth?.uid, target = request.data?.targetUserId;
  if (!uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  if (!UID.test(uid) || typeof target !== 'string' || !UID.test(target) || uid === target) throw new HttpsError('invalid-argument', 'ผู้ใช้ไม่ถูกต้อง');
  return { uid, target };
}
function actionId(request) {
  const id = request.data?.actionId;
  if (typeof id !== 'string' || !ACTION.test(id)) throw new HttpsError('invalid-argument', 'รหัสการกระทำไม่ถูกต้อง');
  return id;
}
function references(db, uid, target) {
  return [`users/${target}`, `entitlements/${target}`, `profileVisibility/${target}`,
    `users/${uid}/blockedUsers/${target}`, `users/${target}/blockedUsers/${uid}`,
    `decisions/${uid}_${target}`, `decisions/${target}_${uid}`, `conversations/c-${[uid, target].sort().join('-')}`].map((path) => db.doc(path));
}
async function pair(tx, db, uid, target, now) {
  const refs = references(db, uid, target), snapshots = await tx.getAll(...refs);
  const [owner, entitlement, visibility, viewerBlock, ownerBlock, outgoing, incoming, room] = snapshots;
  for (const [snap, from, to] of [[outgoing, uid, target], [incoming, target, uid]]) {
    if (snap.exists && (snap.data().fromUserId !== from || snap.data().toUserId !== to)) throw new HttpsError('failed-precondition', 'ข้อมูลการจับคู่ไม่ตรงกัน');
  }
  const participants = room.data()?.participants;
  const matched = establishedMatch(uid, target, outgoing.data(), incoming.data(), participants);
  const visible = canViewProfile({ viewerId: uid, ownerId: target, ownerExists: owner.exists,
    ownerDiscoverable: owner.data()?.isDiscoverable !== false, ownerIsNew: owner.data()?.isNewUser === true,
    ownerFaceVerified: owner.data()?.isFaceVerified === true,
    blocked: viewerBlock.exists || ownerBlock.exists, matched, ownerLikedViewer: isLike(incoming.data(), target, uid),
    visibilityMode: visibility.exists ? (visibility.data()?.mode || 'invalid') : 'public', ownerEntitlement: entitlement.data(), now: now() });
  return { refs, owner, outgoing, incoming, matched, visible };
}
// All operations read the same pair documents in a transaction. An acceptance
// racing rewind either commits first (rewind skips the match) or retries on the
// deleted pending decision. It can never delete an accepted relationship.
export function createMatchingActionApi({ db, now = Date.now, serverTimestamp }) {
  return {
    recordDiscoveryAction: async (request) => {
      const { uid, target } = ids(request), id = actionId(request), kind = request.data?.kind;
      if (!['skip', 'like'].includes(kind)) throw new HttpsError('invalid-argument', 'การกระทำไม่ถูกต้อง');
      const message = request.data?.likeMessage || '';
      if (typeof message !== 'string' || message.length > 1000) throw new HttpsError('invalid-argument', 'ข้อความยาวเกินไป');
      return db.runTransaction(async (tx) => {
        const entryRef = db.doc(`discoveryActions/${uid}/entries/${id}`), stateRef = db.doc(`discoveryState/${uid}`);
        const [entry, state, me] = await tx.getAll(entryRef, stateRef, db.doc(`users/${uid}`));
        if (!me.exists) throw new HttpsError('failed-precondition', 'บัญชีไม่พร้อมใช้งาน');
        if (entry.exists) {
          if (entry.data().target !== target || entry.data().kind !== kind) throw new HttpsError('invalid-argument', 'รหัสการกระทำถูกใช้แล้ว');
          return entry.data().result;
        }
        const current = await pair(tx, db, uid, target, now);
        if (!current.visible) throw new HttpsError('not-found', 'ไม่พบโปรไฟล์นี้');
        if (current.matched) return { status: 'accepted', conversationId: current.refs[7].id };
        const accepted = kind === 'like' && isLike(current.incoming.data(), target, uid);
        const sequence = (state.data()?.nextSequence || 0) + 1;
        if (!Number.isSafeInteger(sequence)) throw new HttpsError('resource-exhausted', 'ประวัติการกระทำเต็ม');
        const result = { status: accepted ? 'accepted' : 'pending', conversationId: accepted ? current.refs[7].id : null, sequence };
        const decision = { fromUserId: uid, toUserId: target, type: kind, status: result.status,
          likeMessage: message, lastActionId: id, createdAt: current.outgoing.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
        tx.set(current.refs[5], decision);
        if (accepted) tx.update(current.refs[6], { status: 'accepted', updatedAt: serverTimestamp() });
        tx.set(entryRef, { target, kind, sequence, previous: current.outgoing.exists ? current.outgoing.data() : null,
          undoable: !accepted, createdAt: serverTimestamp(), result });
        tx.set(stateRef, { nextSequence: sequence, secureActionsStarted: true, updatedAt: serverTimestamp() }, { merge: true });
        return result;
      });
    },
    respondToIncomingLike: async (request) => {
      const { uid, target } = ids(request), response = request.data?.response;
      if (!['accept', 'reject'].includes(response)) throw new HttpsError('invalid-argument', 'คำตอบไม่ถูกต้อง');
      return db.runTransaction(async (tx) => {
        const current = await pair(tx, db, uid, target, now), decision = current.incoming.data();
        if (!current.visible || !isLike(decision, target, uid)) throw new HttpsError('not-found', 'คำขอเปลี่ยนแปลงแล้ว');
        if (response === 'accept') {
          tx.update(current.refs[6], { status: 'accepted', updatedAt: serverTimestamp() });
          tx.set(current.refs[5], { fromUserId: uid, toUserId: target, type: 'like', status: 'accepted', likeMessage: '',
            createdAt: current.outgoing.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
          return { status: 'accepted', conversationId: current.refs[7].id };
        }
        if (current.matched) throw new HttpsError('failed-precondition', 'ใช้การยกเลิกจับคู่สำหรับคู่ที่ยอมรับแล้ว');
        tx.update(current.refs[6], { status: 'rejected', updatedAt: serverTimestamp() });
        tx.set(current.refs[5], { fromUserId: uid, toUserId: target, type: 'skip', status: 'pending', likeMessage: '',
          createdAt: current.outgoing.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        return { status: 'rejected', conversationId: null };
      });
    },
    cancelPendingOutgoingLike: async (request) => {
      const { uid, target } = ids(request);
      return db.runTransaction(async (tx) => {
        const current = await pair(tx, db, uid, target, now);
        if (current.matched) throw new HttpsError('failed-precondition', 'ย้อนคู่ที่ยอมรับแล้วไม่ได้');
        if (isLike(current.outgoing.data(), uid, target) && current.outgoing.data().status === 'pending') tx.delete(current.refs[5]);
        return { cancelled: true };
      });
    },
    unmatchProfile: async (request) => {
      const { uid, target } = ids(request);
      return db.runTransaction(async (tx) => {
        const current = await pair(tx, db, uid, target, now), room = await tx.get(current.refs[7]);
        for (const [ref, snap] of [[current.refs[5], current.outgoing], [current.refs[6], current.incoming]]) {
          if (snap.exists) tx.update(ref, { status: 'removed', updatedAt: serverTimestamp() });
        }
        const participants = room.data()?.participants;
        if (room.exists && Array.isArray(participants) && participants.length === 2 && participants.includes(uid) && participants.includes(target)) {
          tx.update(current.refs[7], {
            [`participantSettings.${uid}.isHidden`]: true, [`participantSettings.${target}.isHidden`]: true,
            [`participantSettings.${uid}.historyClearedAt`]: serverTimestamp(), [`participantSettings.${target}.historyClearedAt`]: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        }
        return { removed: true };
      });
    },
    rewindDiscoveryAction: async (request) => {
      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
      const id = actionId(request);
      return db.runTransaction(async (tx) => {
        const receiptRef = db.doc(`rewindReceipts/${uid}/entries/${id}`);
        const [entitlement, receipt] = await tx.getAll(db.doc(`entitlements/${uid}`), receiptRef);
        requireFeature(entitlement.data(), 'unlimitedRewind', now());
        if (receipt.exists) return receipt.data().result;
        const history = await tx.get(db.collection(`discoveryActions/${uid}/entries`).where('undoable', '==', true).orderBy('sequence', 'desc').limit(20));
        const evaluated = [];
        for (const entry of history.docs) {
          const target = entry.data().target;
          if (typeof target !== 'string' || !UID.test(target)) { evaluated.push({ entry, eligible: false }); continue; }
          const current = await pair(tx, db, uid, target, now), decision = current.outgoing.data();
          const eligible = current.visible && !current.matched && decision?.lastActionId === entry.id && decision.status === 'pending'
            && ['skip', 'like'].includes(decision.type);
          evaluated.push({ entry, current, eligible });
          if (eligible) break;
        }
        // Entitlement is a transaction read; a concurrent revocation retries.
        requireFeature(entitlement.data(), 'unlimitedRewind', now());
        let result = { profile: null, hasMore: history.size === 20 };
        for (const item of evaluated) {
          tx.update(item.entry.ref, { undoable: false, undoneAt: serverTimestamp(), undoReason: item.eligible ? 'rewind' : 'unavailable' });
          if (!item.eligible) continue;
          const previous = item.entry.data().previous;
          if (previous) tx.set(item.current.refs[5], previous); else tx.delete(item.current.refs[5]);
          result = { profile: toWire(buildPublicProfile(item.entry.data().target, item.current.owner.data())), hasMore: false };
        }
        tx.set(receiptRef, { result, createdAt: serverTimestamp() });
        return result;
      });
    },
  };
}
