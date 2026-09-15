import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Expo } from 'expo-server-sdk';
import { buildDiscoveryProfile, buildPublicProfile } from './discoveryProfile.js';
import {
  isNewPendingLike,
  likeNotification,
  matchNotification,
  messageNotification,
  callNotification,
} from './notificationLogic.js';
import { buildExpoPushMessage } from './pushMessage.js';
import {
  isR2Configured,
  getR2Config,
  generateR2ObjectKey,
  createR2S3Client,
  generateR2UploadPresignedUrl,
  buildR2DownloadUrl,
} from './r2Service.js';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { detectSafeSearch } from './imageModeration.js';
import { AccessToken } from 'livekit-server-sdk';

export { ANDROID_MESSAGING_NOTIFICATION_MODE, buildExpoPushMessage } from './pushMessage.js';

initializeApp();

const db = getFirestore();
const auth = getAuth();
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
const REGION = 'asia-southeast1';
const EVENT_OPTIONS = { region: REGION, retry: true };
const EXPO_PROJECT_ID = '5ca64c3a-3182-460f-87f6-2342aaba4e2f';
const MAX_PUSH_TOKENS_PER_USER = 10;

export const syncDiscoveryProfile = onDocumentWritten(
  { ...EVENT_OPTIONS, document: 'profiles/{userId}' },
  async (event) => {
    const userId = event.params.userId;
    const discoveryRef = db.collection('discoveryProfiles').doc(userId);
    const after = event.data?.after;

    if (!after?.exists) {
      await discoveryRef.delete();
      return;
    }

    const projection = buildDiscoveryProfile(userId, after.data());
    if (!projection) {
      await discoveryRef.delete();
      return;
    }
    await discoveryRef.set(projection);
  }
);

// Older app versions could finish the private `users/{uid}` write while the
// public projection write was interrupted. Keep `profiles` authoritative for
// every device by rebuilding it from the owner document on the server. The
// helper applies the privacy allowlist before this write, so private fields
// such as email, GPS and matching preferences never enter the public record.
export const syncPublicProfile = onDocumentWritten(
  { ...EVENT_OPTIONS, document: 'users/{userId}' },
  async (event) => {
    const userId = event.params.userId;
    const profileRef = db.collection('profiles').doc(userId);
    const after = event.data?.after;

    if (!after?.exists) {
      await profileRef.delete();
      return;
    }

    const projection = buildPublicProfile(userId, after.data());
    if (!projection) return;
    await profileRef.set(projection);
  }
);

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function requireSignedIn(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  }
  return request.auth.uid;
}

function requireVerifiedUser(request) {
  const userId = requireSignedIn(request);
  if (request.auth.token?.email_verified !== true) {
    throw new HttpsError('permission-denied', 'กรุณายืนยันอีเมลก่อนใช้งาน');
  }
  return userId;
}

export const registerPushToken = onCall({ region: REGION }, async (request) => {
  const userId = requireVerifiedUser(request);
  const expoPushToken = cleanString(request.data?.expoPushToken, 300);
  const projectId = cleanString(request.data?.projectId, 100);
  const platform = cleanString(request.data?.platform, 20);
  const notificationMode = cleanString(request.data?.notificationMode, 80);
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new HttpsError('invalid-argument', 'Expo push token ไม่ถูกต้อง');
  }
  if (projectId !== EXPO_PROJECT_ID || !['android', 'ios'].includes(platform)) {
    throw new HttpsError('invalid-argument', 'Push notification project หรือ platform ไม่ถูกต้อง');
  }

  const tokenId = hash(expoPushToken);
  const existingToken = await db.collection('pushTokens').doc(tokenId).get();
  if (existingToken.exists && existingToken.data().userId !== userId) {
    // A leaked Expo token must not be transferable to another account. The
    // previous account's authenticated logout path must release it first.
    throw new HttpsError('permission-denied', 'Push token is already registered');
  }
  if (!existingToken.exists) {
    const activeTokens = await db.collection('pushTokens')
      .where('userId', '==', userId)
      .limit(MAX_PUSH_TOKENS_PER_USER + 1)
      .get();
    const enabledTokenCount = activeTokens.docs.filter((tokenDoc) => tokenDoc.data().enabled !== false).length;
    if (enabledTokenCount >= MAX_PUSH_TOKENS_PER_USER) {
      throw new HttpsError('resource-exhausted', 'อุปกรณ์สำหรับการแจ้งเตือนมีจำนวนสูงสุดแล้ว');
    }
  }
  await db.collection('pushTokens').doc(tokenId).set({
    userId,
    expoPushToken,
    platform,
    projectId,
    appVersion: cleanString(request.data?.appVersion, 50),
    notificationMode,
    enabled: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { registered: true };
});

export const unregisterPushToken = onCall({ region: REGION }, async (request) => {
  // Logout cleanup must still work for an account that has not completed
  // email verification; otherwise its old device token could remain active.
  const userId = requireSignedIn(request);
  const expoPushToken = cleanString(request.data?.expoPushToken, 300);
  if (!Expo.isExpoPushToken(expoPushToken)) return { unregistered: false };

  const tokenRef = db.collection('pushTokens').doc(hash(expoPushToken));
  const tokenSnapshot = await tokenRef.get();
  if (tokenSnapshot.exists && tokenSnapshot.data().userId === userId) {
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

async function storePushTicket(ticket, registration) {
  if (ticket.status === 'error') {
    if (ticket.details?.error === 'DeviceNotRegistered') {
      await disableRegistration(registration.id, ticket.details.error);
    }
    logger.error('Expo rejected push notification', { ticket });
    return;
  }
  if (!ticket.id) return;
  await db.collection('pushReceipts').doc(ticket.id).set({
    ticketId: ticket.id,
    tokenDocId: registration.id,
    userId: registration.userId,
    attempts: 0,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function sendNotificationToUser(userId, notification) {
  const [userSnapshot, tokenSnapshot] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('pushTokens').where('userId', '==', userId).limit(MAX_PUSH_TOKENS_PER_USER).get(),
  ]);
  if (userSnapshot.exists && userSnapshot.data().notificationsEnabled === false) return 0;

  const registrations = tokenSnapshot.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .filter((registration) => registration.enabled !== false && Expo.isExpoPushToken(registration.expoPushToken));
  if (!registrations.length) return 0;

  const registrationByToken = new Map(registrations.map((registration) => [registration.expoPushToken, registration]));
  const messages = registrations.map((registration) => buildExpoPushMessage(registration, notification));

  for (const chunk of expo.chunkPushNotifications(messages)) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    await Promise.all(tickets.map((ticket, index) => (
      storePushTicket(ticket, registrationByToken.get(chunk[index].to))
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

export const notifyOnLikeCreated = onDocumentWritten(
  { ...EVENT_OPTIONS, document: 'decisions/{decisionId}' },
  async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const decision = event.data?.after.exists ? event.data.after.data() : null;
    if (!isNewPendingLike(before, decision)) return;
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

export const notifyOnMessageCreated = onDocumentCreated(
  { ...EVENT_OPTIONS, document: 'conversations/{conversationId}/messages/{messageId}' },
  async (event) => {
    const message = event.data?.data();
    if (!message?.senderId || message.isSystem === true) return;

    const conversationSnapshot = await db.collection('conversations').doc(event.params.conversationId).get();
    if (!conversationSnapshot.exists) return;
    const conversation = conversationSnapshot.data() || {};
    const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
    if (participants.length !== 2 || !participants.includes(message.senderId)) return;

    const senderProfile = conversation.participantProfiles?.[message.senderId] || {};
    let effectiveSenderProfile = senderProfile;
    try {
      const senderDoc = await db.collection('profiles').doc(message.senderId).get();
      if (senderDoc.exists) {
        effectiveSenderProfile = { ...senderProfile, ...senderDoc.data() };
      }
    } catch (_) {}

    const messagePreview = message.preview || message.text || '';
    const sends = participants
      .filter((recipientId) => recipientId !== message.senderId)
      .filter((recipientId) => conversation.participantSettings?.[recipientId]?.isMuted !== true)
      .map(async (recipientId) => {
        let recipientBadge = (conversation.unreadCounts?.[recipientId] || 0) + 1;
        try {
          const convDocs = await db.collection('conversations')
            .where('participants', 'array-contains', recipientId)
            .get();
          let count = 0;
          convDocs.forEach((doc) => {
            const data = doc.data();
            count += (data.unreadCounts?.[recipientId] || 0);
          });
          if (count > 0) recipientBadge = count;
        } catch (_) {}

        const notif = messageNotification(
          effectiveSenderProfile,
          event.params.conversationId,
          {
            id: event.params.messageId,
            senderId: message.senderId,
            text: messagePreview,
            preview: messagePreview,
            mediaType: message.mediaType,
            mediaUrl: message.mediaUrl,
          }
        );
        notif.badge = recipientBadge;

        return sendOnce(
          `${event.id}:${event.params.conversationId}:${event.params.messageId}`,
          recipientId,
          notif
        );
      });
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

async function deleteConversationTree(conversationRef) {
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
export const deleteUserData = onCall({ region: REGION }, async (request) => {
  const userId = requireSignedIn(request);
  logger.info('[deleteUserData] Starting account deletion');

  const deletions = [];

  // 1. Delete private and public profiles
  deletions.push(db.collection('users').doc(userId).delete());
  deletions.push(db.collection('profiles').doc(userId).delete());
  deletions.push(db.collection('discoveryProfiles').doc(userId).delete());

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

  logger.info(`[deleteUserData] Account deletion complete. `
    + `Deleted: ${decisionDocs.length} decisions, ${convSnapshot.size} conversations, `
    + `${appointmentSnapshot.size} appointments, ${tokenSnapshot.size} push tokens, `
    + `${deliverySnapshot.size} deliveries`);

  return { deleted: true, userId };
});

/**
 * reportAppVersion — Legacy endpoint retained for older clients.
 *
 * Release targets must be written by the release operator after Google Play
 * has published the bundle. A client opening a local APK/AAB can never change
 * the production update target.
 */
export const reportAppVersion = onCall({ region: REGION }, async () => {
  return {
    success: false,
    updated: false,
    reason: 'manual_release_required',
  };
});

/**
 * uploadChatMedia — Upload media (images/voice recordings) securely for a chat room.
 */
export const uploadChatMedia = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนอัปโหลดสื่อ');
  }
  const { conversationId, base64Data, contentType, extension } = request.data || {};
  if (!conversationId || !base64Data || !contentType) {
    throw new HttpsError('invalid-argument', 'ข้อมูลสื่อไม่ครบถ้วน');
  }

  const convDoc = await db.collection('conversations').doc(conversationId).get();
  if (!convDoc.exists) {
    throw new HttpsError('not-found', 'ไม่พบห้องสนทนานี้');
  }
  const participants = convDoc.data()?.participants || [];
  if (!participants.includes(request.auth.uid)) {
    throw new HttpsError('permission-denied', 'คุณไม่ได้เป็นผู้ร่วมสนทนาในห้องนี้');
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 25 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'ไฟล์มีขนาดใหญ่เกิน 25MB');
  }

  const bucket = getStorage().bucket('campusmate-7f1ab.firebasestorage.app');
  const fileExt = extension || (contentType.includes('image') ? 'jpg' : 'm4a');
  const token = crypto.randomUUID();
  const filePath = `chat_media/${conversationId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${fileExt}`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedBy: request.auth.uid,
        conversationId,
      },
    },
  });

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  return { success: true, url: downloadUrl };
});

/**
 * getR2ChatUploadUrl — Generates a presigned PUT URL for direct-to-R2 upload.
 * Strictly verifies authentication and conversation participant access.
 */
export const getR2ChatUploadUrl = onCall({ region: REGION, maxInstances: 30 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนอัปโหลดสื่อ');
  }

  const { conversationId, mediaType, extension, contentType } = request.data || {};
  if (!conversationId) {
    throw new HttpsError('invalid-argument', 'ข้อมูล conversationId ไม่ถูกต้อง');
  }

  const convDoc = await db.collection('conversations').doc(conversationId).get();
  if (!convDoc.exists) {
    throw new HttpsError('not-found', 'ไม่พบห้องสนทนานี้');
  }
  const participants = convDoc.data()?.participants || [];
  if (!participants.includes(request.auth.uid)) {
    throw new HttpsError('permission-denied', 'คุณไม่ได้เป็นผู้ร่วมสนทนาในห้องนี้');
  }

  if (!isR2Configured(process.env)) {
    logger.warn('[getR2ChatUploadUrl] Cloudflare R2 credentials missing on server');
    return {
      success: false,
      provider: 'firebase',
      message: 'Cloudflare R2 is not configured on server. Falling back to Firebase Storage.',
    };
  }

  const r2Config = getR2Config(process.env);
  const objectKey = generateR2ObjectKey({ conversationId, mediaType, extension });
  const mimeType = contentType || (extension === 'enc' ? 'application/octet-stream' : (mediaType === 'audio' ? 'audio/m4a' : 'image/jpeg'));
  logger.info('[getR2ChatUploadUrl] Generating R2 presigned upload URL', {
    objectKey,
    mimeType,
    bucket: r2Config.bucketName,
  });

  try {
    const s3 = createR2S3Client(r2Config);
    const uploadUrl = await generateR2UploadPresignedUrl(s3, {
      bucket: r2Config.bucketName,
      key: objectKey,
      contentType: mimeType,
      metadata: {
        uploadedby: request.auth.uid,
        conversationid: conversationId,
      },
      expiresIn: 300, // 5 minutes
    });

    const downloadUrl = buildR2DownloadUrl({
      publicDomain: r2Config.publicDomain,
      bucketName: r2Config.bucketName,
      accountId: r2Config.accountId,
      objectKey,
    });

    return {
      success: true,
      provider: 'r2',
      uploadUrl,
      downloadUrl,
      objectKey,
      contentType: mimeType,
    };
  } catch (err) {
    logger.error('Failed to generate R2 presigned URL:', err);
    return {
      success: false,
      provider: 'firebase',
      message: 'Failed to generate R2 upload URL',
    };
  }
});

let visionClientInstance = null;
function getVisionClient() {
  if (!visionClientInstance) {
    try {
      visionClientInstance = new ImageAnnotatorClient();
    } catch (err) {
      logger.warn('Could not initialize Google Cloud Vision Client with ADC, using fallback:', err);
    }
  }
  return visionClientInstance;
}

/**
 * checkImageSafety — Checks an image for nudity/adult/racy/violence content
 * using Google Cloud Vision SafeSearch Detection before allowing upload.
 */
export const checkImageSafety = onCall({ region: REGION, maxInstances: 30 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนตรวจสอบรูปภาพ');
  }

  const { imageBase64 } = request.data || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new HttpsError('invalid-argument', 'ข้อมูลรูปภาพไม่ถูกต้อง');
  }

  try {
    const visionClient = getVisionClient();
    const result = await detectSafeSearch(imageBase64, {
      visionClient,
      apiKey: process.env.GOOGLE_VISION_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    });

    if (result.status === 'blocked') {
      logger.warn(`[ContentModeration] Blocked unsafe image for user ${request.auth.uid}: reason=${result.reason}`, result.scores);
    }

    return result;
  } catch (err) {
    logger.error('[ContentModeration] Failed to scan image with Vision API:', err);
    // A failed scan must not be represented as a safe image.
    return {
      isSafe: null,
      status: 'unavailable',
      policyVersion: 2,
      moderationSkipped: true,
      warning: 'ไม่สามารถเชื่อมต่อระบบสแกนรูปภาพได้ในขณะนี้',
    };
  }
});

export const notifyIncomingCall = onDocumentCreated(
  { region: REGION, retry: false, document: 'calls/{callId}' },
  async (event) => {
    const callData = event.data?.data();
    if (!callData) return;

    const receiverId = callData.receiverId;
    const callerId = callData.callerId;
    if (!receiverId || !callerId) return;

    try {
      // Use callerProfile packaged in call document if available to save DB latency
      let callerProfile = callData.callerProfile;
      if (!callerProfile || !callerProfile.name) {
        const callerProfileDoc = await db.collection('profiles').doc(callerId).get();
        callerProfile = callerProfileDoc.exists ? callerProfileDoc.data() : (callerProfile || {});
      }

      const notification = callNotification(callerProfile, { id: event.params.callId, ...callData });
      await sendNotificationToUser(receiverId, notification);
      logger.info(`[notifyIncomingCall] Sent incoming call notification to ${receiverId} for call ${event.params.callId}`);
    } catch (err) {
      logger.error(`[notifyIncomingCall] Failed to send call notification:`, err);
    }
  }
);

/**
 * getLiveKitToken - Generates a secure LiveKit room access token for video/voice call.
 */
export const getLiveKitToken = onCall({ region: REGION, maxInstances: 30 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนเข้าร่วมการโทร');
  }

  const { callId, participantName } = request.data || {};
  if (!callId || typeof callId !== 'string') {
    throw new HttpsError('invalid-argument', 'ต้องระบุ callId');
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret) {
    logger.error('[LiveKit] Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET in environment');
    throw new HttpsError('internal', 'ระบบโทรยังไม่ได้ตั้งค่า LiveKit API Keys');
  }

  const userId = request.auth.uid;

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: participantName || userId,
      ttl: '2h',
    });

    at.addGrant({
      roomJoin: true,
      room: callId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return {
      token,
      url: livekitUrl || 'wss://campusmate-jmt5sy3c.livekit.cloud',
      room: callId,
    };
  } catch (err) {
    logger.error('[LiveKit] Failed to generate access token:', err);
    throw new HttpsError('internal', 'ไม่สามารถสร้างโทเค็นสำหรับเข้าสายได้');
  }
});
