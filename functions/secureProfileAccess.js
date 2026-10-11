import { HttpsError } from 'firebase-functions/v2/https';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { buildPublicProfile } from './discoveryProfile.js';
import { canViewProfile, validateVisibilityChange } from './profileVisibilityPolicy.js';
import { hasPlanFeature } from './plusEntitlements.js';
import { establishedMatch } from './profileRelationships.js';

const UID = /^[A-Za-z0-9_-]{1,128}$/;
export function assertUserIds(ids) {
  if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !UID.test(id))) {
    throw new HttpsError('invalid-argument', 'รายการผู้ใช้ไม่ถูกต้อง');
  }
  return [...new Set(ids)];
}
function likeBetween(record, from, to) {
  return record?.fromUserId === from && record?.toUserId === to && record.type === 'like'
    && ['pending', 'accepted'].includes(record.status);
}
export function toWire(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toWire(entry)]));
  return value;
}

// Read access is evaluated from private server records for every result. The
// public projection alone is never sufficient to authorize a detail fetch.
export async function loadVisibleProfiles(db, viewerId, userIds, now = Date.now) {
  const refs = [], plans = [];
  for (const ownerId of assertUserIds(userIds)) {
    const paths = [ `users/${ownerId}`, `entitlements/${ownerId}`, `profileVisibility/${ownerId}`,
      `users/${viewerId}/blockedUsers/${ownerId}`, `users/${ownerId}/blockedUsers/${viewerId}`,
      `decisions/${ownerId}_${viewerId}`, `decisions/${viewerId}_${ownerId}`,
      `conversations/c-${[ownerId, viewerId].sort().join('-')}` ];
    plans.push({ ownerId, offset: refs.length }); refs.push(...paths.map((path) => db.doc(path)));
  }
  if (!refs.length) return [];
  const snapshots = await db.getAll(...refs);
  const result = [];
  for (const { ownerId, offset } of plans) {
    const [owner, entitlement, visibility, viewerBlock, ownerBlock, ownerLike, viewerLike, conversation] = snapshots.slice(offset, offset + 8);
    const source = owner.data();
    const ownerDecision = ownerLike.data(), viewerDecision = viewerLike.data();
    const participants = conversation.data()?.participants;
    const matched = establishedMatch(viewerId, ownerId, viewerDecision, ownerDecision, participants);
    if (!canViewProfile({ viewerId, ownerId, ownerExists: owner.exists,
      ownerDiscoverable: source?.isDiscoverable !== false, ownerIsNew: source?.isNewUser === true,
      ownerFaceVerified: source?.isFaceVerified === true,
      blocked: viewerBlock.exists || ownerBlock.exists, matched,
      ownerLikedViewer: likeBetween(ownerDecision, ownerId, viewerId),
      visibilityMode: visibility.exists ? (visibility.data()?.mode || 'invalid') : 'public', ownerEntitlement: entitlement.data(), now: now() })) continue;
    result.push(toWire(buildPublicProfile(ownerId, source)));
  }
  return result;
}

export function createProfileAccessApi({ db, now = Date.now, serverTimestamp, makeCursor = randomUUID }) {
  const signedIn = (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
    return request.auth.uid;
  };
  const api = {
    getVisibleProfiles: async (request) => {
      const uid = signedIn(request);
      return { profiles: await loadVisibleProfiles(db, uid, request.data?.userIds || [], now) };
    },
    getConversationEncryptionProfiles: async (request) => {
      const uid = signedIn(request), conversationId = request.data?.conversationId;
      // Conversation IDs contain two UIDs and separators; never accept paths.
      if (typeof conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,259}$/.test(conversationId)) {
        throw new HttpsError('invalid-argument', 'ห้องสนทนาไม่ถูกต้อง');
      }
      const ids = assertUserIds(request.data?.userIds === undefined ? [] : request.data.userIds);
      const conversation = (await db.doc(`conversations/${conversationId}`).get()).data();
      const participants = conversation?.participants;
      // Existing chat membership remains independent of public visibility and
      // face verification. Corrupt room membership cannot authorize key reads.
      if (!Array.isArray(participants) || participants.length !== 2
        || participants.some((id) => typeof id !== 'string' || !UID.test(id))
        || new Set(participants).size !== 2 || !participants.includes(uid)
        || ids.some((id) => !participants.includes(id))) {
        throw new HttpsError('permission-denied', 'ไม่พบสิทธิ์ในห้องสนทนานี้');
      }
      // Match Firestore's signedIn() restriction for room reads.
      if ((await db.doc(`accountRestrictions/${uid}`).get()).data()?.suspended === true) {
        throw new HttpsError('permission-denied', 'บัญชีนี้ถูกระงับการใช้งาน');
      }
      const profiles = ids.length ? await db.getAll(...ids.map((id) => db.doc(`users/${id}`))) : [];
      // Return only allowlisted public device keys, never profile metadata.
      return { profiles: profiles.filter((profile) => profile.exists).map((profile) => ({
        id: profile.id,
        encryptionDevices: buildPublicProfile(profile.id, profile.data()).encryptionDevices || {},
      })) };
    },
    getPartyEncryptionProfiles: async (request) => {
      const uid = signedIn(request), partyId = request.data?.partyId;
      if (typeof partyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(partyId)) throw new HttpsError('invalid-argument', 'กิจกรรมไม่ถูกต้อง');
      const ids = assertUserIds(request.data?.userIds || []), party = (await db.doc(`parties/${partyId}`).get()).data();
      if (!party || !(party.memberIds || []).includes(uid)) throw new HttpsError('permission-denied', 'ไม่พบสิทธิ์ในกิจกรรมนี้');
      for (const id of ids) {
        if ((party.memberIds || []).includes(id)) continue;
        const join = (await db.doc(`parties/${partyId}/requests/${id}`).get()).data();
        if (party.hostId !== uid || party.status !== 'open' || join?.requesterId !== id || join?.status !== 'pending') throw new HttpsError('permission-denied', 'สมาชิกไม่อยู่ในกิจกรรม');
      }
      const profiles = ids.length ? await db.getAll(...ids.map((id) => db.doc(`users/${id}`))) : [];
      // Device keys are deliberately separated from names/photos/visibility.
      return { profiles: profiles.filter((profile) => profile.exists).map((profile) => {
        const publicProfile = buildPublicProfile(profile.id, profile.data());
        return { id: profile.id, encryptionDevices: publicProfile.encryptionDevices || {} };
      }) };
    },
    setProfileVisibility: async (request) => {
      const uid = signedIn(request);
      const mode = request.data?.mode;
      // Entitlement and visibility write share a transaction with revocation.
      return db.runTransaction(async (tx) => {
        const entitlement = await tx.get(db.doc(`entitlements/${uid}`));
        validateVisibilityChange(mode, entitlement.data(), now());
        tx.set(db.doc(`profileVisibility/${uid}`), { mode, updatedAt: serverTimestamp() }, { merge: true });
        return { mode };
      });
    },
    getIncomingLikeSummary: async (request) => {
      const uid = signedIn(request);
      const entitlement = await db.doc(`entitlements/${uid}`).get();
      const pending = db.collection('decisions').where('toUserId', '==', uid).where('type', '==', 'like').where('status', '==', 'pending');
      const pendingCount = (await pending.count().get()).data().count;
      // Free callers receive no IDs, decision documents, names, photos or text.
      if (!hasPlanFeature(entitlement.data(), 'incomingLikeProfiles', now())) return { pendingCount, pendingLikes: [], identitiesAvailable: false, hasMore: false, nextCursor: null };
      let page = pending.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
      const cursor = request.data?.cursor;
      if (cursor) {
        if (typeof cursor !== 'string' || !/^[a-f0-9-]{36}$/.test(cursor)) throw new HttpsError('invalid-argument', 'หน้ารายการไม่ถูกต้อง');
        const saved = (await db.doc(`likePageCursors/${uid}/tokens/${cursor}`).get()).data();
        const expiresAt = saved?.expiresAt?.toMillis?.();
        if (!Number.isFinite(expiresAt) || expiresAt <= now() || typeof saved?.decisionId !== 'string'
          || !/^[A-Za-z0-9_-]{1,257}$/.test(saved.decisionId)) {
          throw new HttpsError('invalid-argument', 'หน้ารายการหมดอายุ กรุณาโหลดใหม่');
        }
        const document = await db.doc(`decisions/${saved.decisionId}`).get();
        if (!document.exists || document.data().toUserId !== uid || document.data().type !== 'like' || document.data().status !== 'pending') {
          throw new HttpsError('invalid-argument', 'รายการเปลี่ยนแล้ว กรุณาโหลดใหม่');
        }
        page = page.startAfter(document);
      }
      const snapshot = await page.limit(20).get();
      const profiles = await loadVisibleProfiles(db, uid, snapshot.docs.map((doc) => doc.data().fromUserId), now);
      const byId = new Map(profiles.map((profile) => [profile.id, profile]));
      // Check again after the network work so expiry/revocation cannot return a
      // paid identity list from an entitlement read at the start of this request.
      const latest = (await db.doc(`entitlements/${uid}`).get()).data();
      if (!hasPlanFeature(latest, 'incomingLikeProfiles', now())) return { pendingCount, pendingLikes: [], identitiesAvailable: false, hasMore: false, nextCursor: null };
      let nextCursor = null;
      if (snapshot.size === 20) {
        nextCursor = makeCursor();
        await db.doc(`likePageCursors/${uid}/tokens/${nextCursor}`).set({ decisionId: snapshot.docs.at(-1).id,
          expiresAt: Timestamp.fromMillis(now() + 15 * 60 * 1000) });
      }
      return { pendingCount, identitiesAvailable: true, pendingLikes: snapshot.docs.flatMap((doc) => {
        const record = doc.data(), profile = byId.get(record.fromUserId);
        return profile ? [{ decisionId: doc.id, profile, likeMessage: record.likeMessage || '', createdAt: toWire(record.createdAt) }] : [];
      }), hasMore: snapshot.size === 20, nextCursor };
    },
    getMyDecisionState: async (request) => {
      const uid = signedIn(request);
      const [outgoing, accepted, summary, state] = await Promise.all([
        db.collection('decisions').where('fromUserId', '==', uid).limit(300).get(),
        db.collection('decisions').where('toUserId', '==', uid).where('type', '==', 'like').where('status', '==', 'accepted').limit(300).get(),
        api.getIncomingLikeSummary(request),
        db.doc(`discoveryState/${uid}`).get(),
      ]);
      const incomingDecisions = accepted.docs.map((doc) => ({ id: doc.id, decisionId: doc.id, ...toWire(doc.data()) }));
      const plusStillActive = hasPlanFeature((await db.doc(`entitlements/${uid}`).get()).data(), 'incomingLikeProfiles', now());
      incomingDecisions.push(...(plusStillActive ? summary.pendingLikes : []).map((like) => ({ id: like.decisionId, decisionId: like.decisionId,
        fromUserId: like.profile.id, toUserId: uid, type: 'like', status: 'pending', likeMessage: like.likeMessage, createdAt: like.createdAt })));
      return { incomingDecisions, outgoingDecisions: outgoing.docs.map((doc) => ({ id: doc.id, decisionId: doc.id, ...toWire(doc.data()) })),
        pendingCount: summary.pendingCount, discoveryActionCount: state.data()?.nextSequence || 0,
        hasMorePending: plusStillActive && summary.hasMore, nextPendingCursor: plusStillActive ? summary.nextCursor : null };
    },
  };
  return api;
}
