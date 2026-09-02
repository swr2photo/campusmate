import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Expo } from 'expo-server-sdk';
import {
  findNewMessages,
  likeNotification,
  matchNotification,
  messageNotification,
} from './notificationLogic.js';

initializeApp();

const db = getFirestore();
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
const REGION = 'asia-southeast1';
const EVENT_OPTIONS = { region: REGION, retry: true };
const EXPO_PROJECT_ID = '5ca64c3a-3182-460f-87f6-2342aaba4e2f';

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export const registerPushToken = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  const expoPushToken = cleanString(request.data?.expoPushToken, 300);
  const projectId = cleanString(request.data?.projectId, 100);
  const platform = cleanString(request.data?.platform, 20);
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new HttpsError('invalid-argument', 'Expo push token ไม่ถูกต้อง');
  }
  if (projectId !== EXPO_PROJECT_ID || !['android', 'ios'].includes(platform)) {
    throw new HttpsError('invalid-argument', 'Push notification project หรือ platform ไม่ถูกต้อง');
  }

  const tokenId = hash(expoPushToken);
  await db.collection('pushTokens').doc(tokenId).set({
    userId: request.auth.uid,
    expoPushToken,
    nativePushToken: cleanString(request.data?.nativePushToken, 2000),
    nativeTokenType: cleanString(request.data?.nativeTokenType, 30),
    platform,
    projectId,
    appVersion: cleanString(request.data?.appVersion, 50),
    enabled: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { registered: true };
});

export const unregisterPushToken = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  const expoPushToken = cleanString(request.data?.expoPushToken, 300);
  if (!Expo.isExpoPushToken(expoPushToken)) return { unregistered: false };

  const tokenRef = db.collection('pushTokens').doc(hash(expoPushToken));
  const tokenSnapshot = await tokenRef.get();
  if (tokenSnapshot.exists && tokenSnapshot.data().userId === request.auth.uid) {
    await tokenRef.delete();
    return { unregistered: true };
  }
  return { unregistered: false };
});

async function claimDelivery(key, userId, type) {
  const ref = db.collection('notificationDeliveries').doc(hash(`${key}:${userId}:${type}`));
  let claimed = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return;
    transaction.create(ref, {
      key,
      userId,
      type,
      status: 'processing',
      createdAt: FieldValue.serverTimestamp(),
    });
    claimed = true;
  });
  return { claimed, ref };
}

async function disableRegistration(tokenDocId, error) {
  await db.collection('pushTokens').doc(tokenDocId).set({
    enabled: false,
    lastError: String(error || 'DeviceNotRegistered').slice(0, 200),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function storePushTicket(ticket, registration, userId) {
  if (ticket.status === 'error') {
    if (ticket.details?.error === 'DeviceNotRegistered') {
      await disableRegistration(registration.id, ticket.details.error);
    }
    logger.error('Expo rejected push notification', { userId, ticket });
    return;
  }
  if (!ticket.id) return;
  await db.collection('pushReceipts').doc(ticket.id).set({
    ticketId: ticket.id,
    tokenDocId: registration.id,
    userId,
    attempts: 0,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function sendNotificationToUser(userId, notification) {
  const [userSnapshot, tokenSnapshot] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('pushTokens').where('userId', '==', userId).get(),
  ]);
  if (userSnapshot.exists && userSnapshot.data().notificationsEnabled === false) return 0;

  const registrations = tokenSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((registration) => registration.enabled !== false && Expo.isExpoPushToken(registration.expoPushToken));
  if (!registrations.length) return 0;

  const registrationByToken = new Map(registrations.map((registration) => [registration.expoPushToken, registration]));
  const messages = registrations.map((registration) => ({
    to: registration.expoPushToken,
    sound: 'default',
    priority: 'high',
    badge: 1,
    title: notification.title,
    body: notification.body,
    channelId: notification.channelId,
    threadId: notification.threadId,
    data: notification.data,
  }));

  for (const chunk of expo.chunkPushNotifications(messages)) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    await Promise.all(tickets.map((ticket, index) => (
      storePushTicket(ticket, registrationByToken.get(chunk[index].to), userId)
    )));
  }
  return registrations.length;
}

async function sendOnce(key, userId, notification) {
  const { claimed, ref } = await claimDelivery(key, userId, notification.data.type);
  if (!claimed) return;
  try {
    const sentCount = await sendNotificationToUser(userId, notification);
    await ref.set({
      status: sentCount > 0 ? 'sent' : 'skipped',
      sentCount,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    await ref.delete().catch(() => undefined);
    throw error;
  }
}

export const notifyOnLikeCreated = onDocumentCreated(
  { ...EVENT_OPTIONS, document: 'decisions/{decisionId}' },
  async (event) => {
    const decision = event.data?.data();
    if (!decision || decision.type !== 'like' || decision.status !== 'pending') return;
    const senderSnapshot = await db.collection('profiles').doc(decision.fromUserId).get();
    await sendOnce(
      `${event.id}:${event.params.decisionId}`,
      decision.toUserId,
      likeNotification(senderSnapshot.data(), decision.fromUserId)
    );
  }
);

export const notifyOnMatchCreated = onDocumentCreated(
  { ...EVENT_OPTIONS, document: 'conversations/{conversationId}' },
  async (event) => {
    const conversation = event.data?.data();
    const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
    if (participants.length !== 2) return;
    await Promise.all(participants.map((recipientId) => {
      const otherUserId = participants.find((userId) => userId !== recipientId);
      return sendOnce(
        `${event.id}:${event.params.conversationId}`,
        recipientId,
        matchNotification(conversation.participantProfiles?.[otherUserId], event.params.conversationId)
      );
    }));
  }
);

export const notifyOnConversationUpdated = onDocumentUpdated(
  { ...EVENT_OPTIONS, document: 'conversations/{conversationId}' },
  async (event) => {
    const before = event.data?.before.data() || {};
    const after = event.data?.after.data() || {};
    const participants = Array.isArray(after.participants) ? after.participants : [];
    const newMessages = findNewMessages(before.messages, after.messages)
      .filter((message) => message?.senderId && !message.isSystem);
    if (!newMessages.length) return;

    const sends = [];
    for (const message of newMessages) {
      const recipients = participants.filter((userId) => userId !== message.senderId);
      for (const recipientId of recipients) {
        if (after.participantSettings?.[recipientId]?.isMuted === true) continue;
        sends.push(sendOnce(
          `${event.id}:${event.params.conversationId}:${message.id || ''}`,
          recipientId,
          messageNotification(
            after.participantProfiles?.[message.senderId],
            event.params.conversationId,
            message
          )
        ));
      }
    }
    await Promise.all(sends);
  }
);

export const checkPushReceipts = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', retryCount: 3 },
  async () => {
    const snapshot = await db.collection('pushReceipts').where('status', '==', 'pending').limit(500).get();
    if (snapshot.empty) return;
    const records = new Map(snapshot.docs.map((document) => [document.id, document]));

    for (let index = 0; index < snapshot.docs.length; index += 300) {
      const receiptIds = snapshot.docs.slice(index, index + 300).map((document) => document.id);
      const receipts = await expo.getPushNotificationReceiptsAsync(receiptIds);
      const writes = [];
      for (const receiptId of receiptIds) {
        const document = records.get(receiptId);
        const receipt = receipts[receiptId];
        if (!receipt) {
          const attempts = Number(document.data().attempts || 0) + 1;
          writes.push(attempts >= 8
            ? document.ref.delete()
            : document.ref.set({ attempts, checkedAt: FieldValue.serverTimestamp() }, { merge: true }));
          continue;
        }
        if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
          writes.push(disableRegistration(document.data().tokenDocId, receipt.details.error));
        }
        writes.push(document.ref.delete());
      }
      await Promise.all(writes);
    }

    const cutoff = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deliveries = await db.collection('notificationDeliveries').where('createdAt', '<', cutoff).limit(300).get();
    if (!deliveries.empty) {
      const batch = db.batch();
      deliveries.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }
);

/**
 * deleteUserData — PDPA-compliant account deletion.
 *
 * Deletes ALL data associated with the authenticated user:
 * - users/{uid} (private profile)
 * - profiles/{uid} (public profile)
 * - decisions where user is sender OR receiver
 * - conversations where user is a participant
 * - pushTokens for the user
 * - notificationDeliveries for the user
 *
 * Only the authenticated user can delete their own data.
 */
export const deleteUserData = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อนลบบัญชี');
  }

  const userId = request.auth.uid;
  logger.info(`[deleteUserData] Starting account deletion for user: ${userId}`);

  const deletions = [];

  // 1. Delete private and public profiles
  deletions.push(db.collection('users').doc(userId).delete());
  deletions.push(db.collection('profiles').doc(userId).delete());

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
  convSnapshot.docs.forEach((convDoc) => deletions.push(convDoc.ref.delete()));

  // 4. Delete push tokens
  const tokenSnapshot = await db.collection('pushTokens')
    .where('userId', '==', userId).get();
  tokenSnapshot.docs.forEach((tokenDoc) => deletions.push(tokenDoc.ref.delete()));

  // 5. Delete notification deliveries
  const deliverySnapshot = await db.collection('notificationDeliveries')
    .where('userId', '==', userId).get();
  deliverySnapshot.docs.forEach((deliveryDoc) => deletions.push(deliveryDoc.ref.delete()));

  await Promise.all(deletions);

  logger.info(`[deleteUserData] Account deletion complete for user: ${userId}. `
    + `Deleted: ${decisionDocs.length} decisions, ${convSnapshot.size} conversations, `
    + `${tokenSnapshot.size} push tokens, ${deliverySnapshot.size} deliveries`);

  return { deleted: true, userId };
});

