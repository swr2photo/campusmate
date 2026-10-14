import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { createAccountDeletionOtp } from './accountDeletionOtp.js';
import { deleteLegacyAvatar } from './accountDeletionMedia.js';
import { profileGalleryPrefix } from './profileGallery.js';
import { getEmailSendingConfig, sendCampusEmail } from './campusEmailMailer.js';

const REGION = 'asia-southeast1';
const smtpSecret = defineSecret('CAMPUSMATE_ADMIN_SMTP_CONFIG');
let deletionOtp;
function getDeletionOtp() {
  if (!deletionOtp) deletionOtp = createAccountDeletionOtp({
    db: getFirestore(), auth: getAuth(),
    sendEmail: async ({ email, code }) => {
      const config = getEmailSendingConfig(JSON.parse(smtpSecret.value()));
      if (!config.resendApiKey && (!config.smtpUser || !config.smtpPass)) throw new HttpsError('unavailable', 'ยังไม่พร้อมส่งอีเมล');
      const handoff = await sendCampusEmail(config, {
        to: email,
        subject: '[CampusMate] ยืนยันการลบบัญชีถาวร',
        text: `รหัสยืนยันการลบบัญชี CampusMate คือ ${code} (อายุ 10 นาที) หากไม่ได้ขอลบบัญชี อย่าเปิดเผยรหัสนี้`,
        html: `<h2>ยืนยันการลบบัญชี CampusMate</h2><p>รหัสยืนยัน: <strong>${code}</strong></p><p>รหัสมีอายุ 10 นาที หากไม่ได้ขอลบบัญชี อย่าเปิดเผยรหัสนี้</p>`,
      });
      if (config.provider !== 'resend' && !handoff.accepted.some(address => String(address).toLowerCase() === email)) {
        throw new HttpsError('unavailable', 'ระบบอีเมลยังไม่รับข้อความ');
      }
    },
  });
  return deletionOtp;
}
export const sendAccountDeletionOtp = onCall({ region: REGION, maxInstances: 10, secrets: [smtpSecret] }, request => getDeletionOtp().send(request));
export const verifyAccountDeletionOtp = onCall({ region: REGION, maxInstances: 10 }, request => getDeletionOtp().verify(request));

export async function deleteConversationTree(conversationRef) {
  const db = getFirestore();
  const messageSnapshot = await conversationRef.collection('messages').get();
  const refs = [...messageSnapshot.docs.map((messageDoc) => messageDoc.ref), conversationRef];
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    refs.slice(index, index + 400).forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
  return messageSnapshot.size;
}

/**
 * deleteUserData — PDPA-compliant account deletion.
 *
 * Deletes ALL data associated with the authenticated user:
 * - users/{uid} (private profile)
 * - profiles/{uid} (public profile)
 * - discoveryProfiles/{uid} (server-owned discovery projection)
 * - decisions where user is sender OR receiver
 * - conversations where user is a participant
 * - appointments where user is a participant
 * - pushTokens for the user
 * - notificationDeliveries for the user
 *
 * Only the authenticated user can delete their own data.
 */
export const deleteUserData = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
  const db = getFirestore(), auth = getAuth(), deletionOtp = getDeletionOtp();
  const authorization = await deletionOtp.authorize(request);
  const userId = authorization.uid;
  await deleteLegacyAvatar(request);
  logger.info('[deleteUserData] Starting account deletion');

  await getStorage().bucket('campusmate-7f1ab.firebasestorage.app')
    .deleteFiles({ prefix: profileGalleryPrefix(userId) });

  const ownedParties = await db.collection('parties').where('hostId', '==', userId).get();
  const ownedIds = new Set(ownedParties.docs.map((entry) => entry.id));
  for (const party of ownedParties.docs) {
    await Promise.all([
      db.recursiveDelete(party.ref),
      db.recursiveDelete(db.doc(`groupChats/${party.id}`)),
    ]);
  }
  const joinedParties = await db.collection('parties').where('memberIds', 'array-contains', userId).get();
  for (const party of joinedParties.docs) {
    if (ownedIds.has(party.id)) continue;
    const chatRef = db.doc(`groupChats/${party.id}`);
    await db.runTransaction(async (tx) => {
      const [partySnap, chatSnap] = await Promise.all([tx.get(party.ref), tx.get(chatRef)]);
      const members = (partySnap.get('memberIds') || []).filter((id) => id !== userId);
      tx.update(party.ref, { memberIds: members, memberCount: members.length, updatedAt: FieldValue.serverTimestamp() });
      if (chatSnap.exists) tx.update(chatRef, {
        memberIds: members, memberCount: members.length, rekeyRequired: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  const partyRequests = await db.collectionGroup('requests').where('requesterId', '==', userId).get();
  await Promise.all(partyRequests.docs.map((entry) => entry.ref.delete()));

  const deletions = [];

  // 1. Delete private and public profiles
  deletions.push(db.recursiveDelete(db.collection('users').doc(userId)));
  deletions.push(db.collection('profiles').doc(userId).delete());
  deletions.push(db.collection('discoveryProfiles').doc(userId).delete());
  for (const name of ['entitlements', 'profileVisibility', 'discoveryState', 'matchingSignals']) {
    deletions.push(db.doc(`${name}/${userId}`).delete());
  }
  for (const name of ['discoveryActions', 'rewindReceipts', 'likePageCursors', 'discoveryPageCursors']) {
    deletions.push(db.recursiveDelete(db.doc(`${name}/${userId}`)));
  }

  // 2. Delete all decisions (both outgoing and incoming)
  const [outgoing, incoming] = await Promise.all([
    db.collection('decisions').where('fromUserId', '==', userId).get(),
    db.collection('decisions').where('toUserId', '==', userId).get(),
  ]);

  const decisionDocs = [...outgoing.docs, ...incoming.docs];
  const seenIds = new Set();
  for (const decisionDoc of decisionDocs) {
    if (seenIds.has(decisionDoc.id)) continue;
    seenIds.add(decisionDoc.id);
    deletions.push(decisionDoc.ref.delete());
  }

  // 3. Delete conversations
  const convSnapshot = await db.collection('conversations')
    .where('participants', 'array-contains', userId).get();
  convSnapshot.docs.forEach((convDoc) => deletions.push(deleteConversationTree(convDoc.ref)));

  // 4. Delete appointments
  const appointmentSnapshot = await db.collection('appointments')
    .where('participants', 'array-contains', userId).get();
  appointmentSnapshot.docs.forEach((appointmentDoc) => deletions.push(appointmentDoc.ref.delete()));

  // 5. Delete push tokens
  const tokenSnapshot = await db.collection('pushTokens')
    .where('userId', '==', userId).get();
  tokenSnapshot.docs.forEach((tokenDoc) => deletions.push(tokenDoc.ref.delete()));

  // 6. Delete notification deliveries
  const deliverySnapshot = await db.collection('notificationDeliveries')
    .where('userId', '==', userId).get();
  deliverySnapshot.docs.forEach((deliveryDoc) => deletions.push(deliveryDoc.ref.delete()));

  await Promise.all(deletions);

  // Remove the Firebase Auth identity as the final server-side step. Without
  // this, a "deleted" account could be signed in again with the same user id.
  try {
    await auth.deleteUser(userId);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }

  await Promise.all([deletionOtp.complete(authorization), db.doc(`accountDeletionOtps/${userId}`).delete()])
    .catch(() => logger.warn('[deleteUserData] Deleted identity; expired OTP records need cleanup.'));

  logger.info(`[deleteUserData] Account deletion complete. `
    + `Deleted: ${decisionDocs.length} decisions, ${convSnapshot.size} conversations, `
    + `${appointmentSnapshot.size} appointments, ${tokenSnapshot.size} push tokens, `
    + `${deliverySnapshot.size} deliveries`);

  return { deleted: true, userId };
});

