import { persistInbox, syncFaceInbox } from './notificationInbox.js';
import { newerGroupMessage } from './groupMessageMetadata.js';
import { isSuperAdminEmail } from './adminPolicy.js';
export { adminConsole } from './adminFunctions.js';
import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { buildDiscoveryProfile, buildPublicProfile } from './discoveryProfile.js';
import { sanitizePeerUserIds, visibleDistanceKm } from './peerDistance.js';
import { loadVisibleProfiles } from './secureProfileAccess.js';
import {
  isNewPendingLike,
  likeNotification,
  privateLikeNotification,
  matchNotification,
  messageNotification,
  callNotification,
} from './notificationLogic.js';
import { buildExpoPushMessage } from './pushMessage.js';
import { getExpoSdk } from './expoSdk.js';
import {
  isR2Configured,
  getR2Config,
  generateR2ObjectKey,
  getR2S3Client,
  generateR2UploadPresignedUrl,
  buildR2DownloadUrl,
  getChatMediaCacheControl,
  getR2SecretNames,
} from './r2Service.js';
import { detectSafeSearch } from './imageModeration.js';
import { getRekognitionClient } from './faceVerification.js';
import { detectModerationWithRekognition } from './imageModerationRekognition.js';
import { createProfileGalleryUploader, profileGalleryPrefix } from './profileGallery.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createPlacePhotoImporter, getPlaceR2Config } from './placePhotos.js';
import { createR2WorkerUpload } from './r2UploadTicket.js';
import {
  buildActionCodeSettings,
  buildCampusVerifyEmail,
  buildSignupVerifyEmail,
  buildHostedEmailActionUrl,
  buildHostedPasswordResetUrl,
  buildPasswordResetActionCodeSettings,
  buildGoogleSignInNoticeEmail,
  buildPasswordResetEmail,
  canSendCampusEmailChange,
  canSendPasswordResetEmail,
  getEmailSendingConfig,
  getPasswordResetAccountAction,
  isCampusEmail,
  isCampusStudentEmail,
  isEmailSendingConfigured,
  isSupportedLoginEmail,
  normalizeCampusEmail,
  sendCampusEmail,
} from './campusEmailMailer.js';
import { lookupWorkspaceUser } from './workspaceDirectory.js';
import {
  isExpiredUnverifiedCampusUser,
  UNVERIFIED_ACCOUNT_TTL_MS,
} from './unverifiedAccountCleanup.js';

export { ANDROID_MESSAGING_NOTIFICATION_MODE, buildExpoPushMessage } from './pushMessage.js';
export { getMusicLyrics } from './musicLyrics.js';
export { getMembershipState, syncMembership, revenueCatWebhook } from './plusFunctions.js';
export { getVisibleProfiles, setProfileVisibility, getIncomingLikeSummary, getDiscoveryPage, getMyDecisionState, getPartyEncryptionProfiles, getConversationEncryptionProfiles } from './secureProfileFunctions.js';
export { recordDiscoveryAction, respondToIncomingLike, rewindDiscoveryAction, cancelPendingOutgoingLike, unmatchProfile } from './matchingActionFunctions.js';
export {
  searchCampusPlaces, resolveCampusPlace, createParty, requestJoinParty,
  withdrawPartyRequest, rejectPartyRequest, cancelParty, approvePartyRequest,
  leaveParty, rotatePartyKey, activateLegacyPartyChat,
} from './partyFunctions.js';
export { startFaceVerificationSession, completeFaceVerification } from './faceVerificationFunctions.js';

initializeApp();

const db = getFirestore();
const auth = getAuth();
const REGION = 'asia-southeast1';
// Bind the established Worker secret explicitly. Firebase discovers endpoints
// before applying .env deployment variables, so an env-only conditional can
// silently omit its secret binding while enabling the route at runtime.
const R2_FUNCTION_SECRETS = [...new Set(['R2_UPLOAD_SIGNING_KEY', ...getR2SecretNames()])]
  .map((name) => defineSecret(name));
const EVENT_OPTIONS = { region: REGION, retry: true };
const importPlacePhoto = createPlacePhotoImporter({
  db,
  getConfig: getPlaceR2Config,
  putObject: (config, object) => getR2S3Client(config).send(new PutObjectCommand({
    Bucket: config.bucketName, Key: object.key, Body: object.bytes,
    ContentType: object.contentType, CacheControl: object.cacheControl,
  })),
  serverTimestamp: FieldValue.serverTimestamp,
});
export const uploadPlacePhoto = onCall({ region: REGION, maxInstances: 5, memory: '1GiB', timeoutSeconds: 60,
  secrets: process.env.CAMPUSMATE_PLACE_PHOTOS_ENABLED === 'true'
    ? ['CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'].map((name) => defineSecret(name)) : [],
}, importPlacePhoto);
const EXPO_PROJECT_ID = '5ca64c3a-3182-460f-87f6-2342aaba4e2f';
const MAX_PUSH_TOKENS_PER_USER = 10;
const PASSWORD_RESET_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

function elapsedMs(startedAt) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function measureStage(timings, name, operation) {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    timings[name] = elapsedMs(startedAt);
  }
}

async function measureAsyncStage(timings, name, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    timings[name] = elapsedMs(startedAt);
  }
}

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

async function lookupWorkspaceUserSafely(email, operation) {
  try {
    return await lookupWorkspaceUser(email);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[${operation}] Google Workspace lookup failed`, error?.code || error?.message || error);
    throw new HttpsError('failed-precondition', 'ตรวจสอบอีเมลใน Google Workspace ไม่สำเร็จ');
  }
}

async function requireWorkspaceUserIfConfigured(email, operation) {
  const result = await lookupWorkspaceUserSafely(email, operation);
  // A Workspace admin credential is optional. Without it, the verification
  // email remains the source of truth and the account is kept pending until
  // the recipient proves ownership by clicking the link.
  if (!result.configured) return null;
  if (!result.exists) {
    throw new HttpsError('not-found', 'ไม่พบอีเมลนี้ในระบบ Google Workspace ของ @psu.ac.th');
  }
  return result;
}

// The client uses this before signup and before sending a campus-email
// migration link. Keep the lookup on Admin Auth so the answer is authoritative
// and does not depend on the timing of the eventual write/send operation.
export const checkCampusEmailAvailability = onCall({
  region: REGION,
  maxInstances: 10,
  invoker: 'public',
}, async (request) => {
  const campusEmail = normalizeCampusEmail(request.data?.email);
  if (!isCampusStudentEmail(campusEmail)) {
    throw new HttpsError('invalid-argument', 'อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th');
  }

  const workspaceUser = await lookupWorkspaceUserSafely(
    campusEmail,
    'checkCampusEmailAvailability'
  );
  if (workspaceUser.configured && !workspaceUser.exists) {
    return {
      email: campusEmail,
      exists: false,
      ownedByCurrentUser: false,
      workspaceExists: false,
      workspaceCheckConfigured: workspaceUser.configured,
    };
  }

  try {
    const existing = await auth.getUserByEmail(campusEmail);
    return {
      email: campusEmail,
      exists: true,
      ownedByCurrentUser: Boolean(request.auth?.uid && existing.uid === request.auth.uid),
      workspaceExists: workspaceUser.configured && workspaceUser.exists,
      workspaceCheckConfigured: workspaceUser.configured,
    };
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      return {
        email: campusEmail,
        exists: false,
        ownedByCurrentUser: false,
        workspaceExists: workspaceUser.configured && workspaceUser.exists,
        workspaceCheckConfigured: workspaceUser.configured,
      };
    }
    logger.error('[checkCampusEmailAvailability] lookup failed', error);
    throw new HttpsError('internal', 'ตรวจสอบอีเมลไม่สำเร็จ');
  }
});

export const sendCampusEmailChange = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const userId = requireSignedIn(request);
  const campusEmail = normalizeCampusEmail(request.data?.email);
  if (!isCampusStudentEmail(campusEmail)) {
    throw new HttpsError('invalid-argument', 'อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th');
  }

  const userRecord = await auth.getUser(userId);
  const currentEmail = normalizeCampusEmail(userRecord.email);
  if (!currentEmail) {
    throw new HttpsError('failed-precondition', 'ไม่พบบัญชีอีเมลปัจจุบัน');
  }
  if (isCampusEmail(currentEmail) || currentEmail === campusEmail) {
    return { alreadyCampus: true, email: currentEmail };
  }

  await requireWorkspaceUserIfConfigured(campusEmail, 'sendCampusEmailChange');

  try {
    const existing = await auth.getUserByEmail(campusEmail);
    if (existing.uid !== userId) {
      throw new HttpsError('already-exists', 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมล @psu.ac.th ของคุณ');
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error?.code !== 'auth/user-not-found') {
      logger.error('[sendCampusEmailChange] lookup failed', error);
      throw new HttpsError('internal', 'ตรวจสอบอีเมลไม่สำเร็จ');
    }
  }

  if (!isEmailSendingConfigured()) {
    throw new HttpsError('failed-precondition', 'ยังไม่ได้ตั้งค่าการส่งอีเมลจากโดเมน getcampusmate.app');
  }

  const lockRef = db.collection('campusEmailChangeLocks').doc(userId);
  const lockSnap = await lockRef.get();
  const lastSent = lockSnap.data()?.sentAt;
  const lastMs = lastSent?.toMillis?.() || 0;
  if (!canSendCampusEmailChange(lastMs)) {
    throw new HttpsError('resource-exhausted', 'ส่งอีเมลยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  }

  let verifyUrl;
  try {
    const firebaseUrl = await auth.generateVerifyAndChangeEmailLink(
      currentEmail,
      campusEmail,
      buildActionCodeSettings()
    );
    verifyUrl = buildHostedEmailActionUrl(firebaseUrl);
  } catch (error) {
    if (error?.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมล @psu.ac.th ของคุณ');
    }
    logger.error('[sendCampusEmailChange] link failed', error);
    throw new HttpsError('internal', 'สร้างลิงก์ยืนยันไม่สำเร็จ');
  }

  const message = buildCampusVerifyEmail({ verifyUrl });
  const config = getEmailSendingConfig();
  try {
    await sendCampusEmail(config, {
      to: campusEmail,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (error) {
    logger.error('[sendCampusEmailChange] send failed', error);
    throw new HttpsError('unavailable', 'ส่งอีเมลจากโดเมน getcampusmate.app ไม่สำเร็จ');
  }

  await Promise.all([
    lockRef.set({
      email: campusEmail,
      sentAt: FieldValue.serverTimestamp(),
    }),
    db.collection('users').doc(userId).set({
      campusEmail,
      campusEmailVerified: false,
    }, { merge: true }),
  ]);

  return { sent: true, email: campusEmail, sender: config.fromAddress };
});

export const sendBrandedEmailVerification = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const userId = requireSignedIn(request);
  if (!isEmailSendingConfigured()) {
    throw new HttpsError('failed-precondition', 'ยังไม่ได้ตั้งค่าการส่งอีเมลจากโดเมน getcampusmate.app');
  }

  const userRecord = await auth.getUser(userId);
  const email = normalizeCampusEmail(userRecord.email);
  if (!email) {
    throw new HttpsError('failed-precondition', 'ไม่พบบัญชีอีเมลปัจจุบัน');
  }
  if (isCampusEmail(email)) {
    if (!isCampusStudentEmail(email)) {
      throw new HttpsError('invalid-argument', 'อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th');
    }
    await requireWorkspaceUserIfConfigured(email, 'sendBrandedEmailVerification');
  }
  if (userRecord.emailVerified) {
    return { alreadyVerified: true, email };
  }

  const lockRef = db.collection('emailVerificationLocks').doc(userId);
  const lockSnap = await lockRef.get();
  const lastSent = lockSnap.data()?.sentAt;
  const lastMs = lastSent?.toMillis?.() || 0;
  if (!canSendCampusEmailChange(lastMs)) {
    throw new HttpsError('resource-exhausted', 'ส่งอีเมลยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  }

  let verifyUrl;
  try {
    const firebaseUrl = await auth.generateEmailVerificationLink(email, buildActionCodeSettings());
    verifyUrl = buildHostedEmailActionUrl(firebaseUrl);
  } catch (error) {
    logger.error('[sendBrandedEmailVerification] link failed', error);
    throw new HttpsError('internal', 'สร้างลิงก์ยืนยันไม่สำเร็จ');
  }

  const message = buildSignupVerifyEmail({ verifyUrl });
  const config = getEmailSendingConfig();
  try {
    await sendCampusEmail(config, {
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (error) {
    logger.error('[sendBrandedEmailVerification] send failed', error);
    throw new HttpsError('unavailable', 'ส่งอีเมลจากโดเมน getcampusmate.app ไม่สำเร็จ');
  }

  await lockRef.set({
    email,
    sentAt: FieldValue.serverTimestamp(),
  });

  return { sent: true, email, sender: config.fromAddress };
});

export const sendBrandedPasswordReset = onCall({
  region: REGION,
  maxInstances: 10,
  invoker: 'public',
}, async (request) => {
  const email = normalizeCampusEmail(request.data?.email);
  if (!isSupportedLoginEmail(email)) {
    throw new HttpsError('invalid-argument', 'รูปแบบอีเมลไม่ถูกต้อง');
  }
  if (!isEmailSendingConfigured()) {
    throw new HttpsError('failed-precondition', 'ยังไม่ได้ตั้งค่าการส่งอีเมลจากโดเมน getcampusmate.app');
  }

  const nowMs = Date.now();
  const lockRef = db.collection('passwordResetEmailLocks').doc(hash(email));
  const shouldSend = await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    const previousMs = lockSnap.data()?.sentAt?.toMillis?.() || 0;
    if (!canSendPasswordResetEmail(previousMs, nowMs)) return false;
    transaction.set(lockRef, {
      sentAt: Timestamp.fromMillis(nowMs),
      expiresAt: Timestamp.fromMillis(nowMs + PASSWORD_RESET_LOCK_TTL_MS),
    }, { merge: true });
    return true;
  });
  if (!shouldSend) return { sent: true };

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return { sent: true };
    logger.error('[sendBrandedPasswordReset] lookup failed', error);
    throw new HttpsError('internal', 'ตรวจสอบบัญชีไม่สำเร็จ');
  }

  const action = getPasswordResetAccountAction(userRecord);
  if (action === 'ignore') return { sent: true };

  const config = getEmailSendingConfig();
  let message;
  if (action === 'send-google-notice') {
    message = buildGoogleSignInNoticeEmail();
  } else {
    let resetUrl;
    try {
      const firebaseUrl = await auth.generatePasswordResetLink(
        email,
        buildPasswordResetActionCodeSettings()
      );
      resetUrl = buildHostedPasswordResetUrl(firebaseUrl);
    } catch (error) {
      logger.error('[sendBrandedPasswordReset] link failed', error);
      throw new HttpsError('internal', 'สร้างลิงก์ตั้งรหัสผ่านใหม่ไม่สำเร็จ');
    }
    message = buildPasswordResetEmail({ resetUrl });
  }

  try {
    await sendCampusEmail(config, {
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (error) {
    logger.error('[sendBrandedPasswordReset] send failed', error);
    throw new HttpsError('unavailable', 'ส่งอีเมลตั้งรหัสผ่านใหม่ไม่สำเร็จ');
  }

  return { sent: true, sender: config.fromAddress };
});

export const registerPushToken = onCall({ region: REGION }, async (request) => {
  const userId = requireVerifiedUser(request);
  const expoPushToken = cleanString(request.data?.expoPushToken, 300);
  const projectId = cleanString(request.data?.projectId, 100);
  const platform = cleanString(request.data?.platform, 20);
  const notificationMode = cleanString(request.data?.notificationMode, 80);
  const { Expo } = await getExpoSdk();
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
  const { Expo } = await getExpoSdk();
  if (!Expo.isExpoPushToken(expoPushToken)) return { unregistered: false };

  const tokenRef = db.collection('pushTokens').doc(hash(expoPushToken));
  const tokenSnapshot = await tokenRef.get();
  if (tokenSnapshot.exists && tokenSnapshot.data().userId === userId) {
    await tokenRef.delete();
    return { unregistered: true };
  }
  return { unregistered: false };
});

export const getPeerDistances = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  const userId = requireSignedIn(request);
  let peerIds = sanitizePeerUserIds(request.data?.userIds, userId);
  if (process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === 'true') {
    peerIds = (await loadVisibleProfiles(db, userId, peerIds)).map((profile) => profile.id);
  }
  if (peerIds.length === 0) return { distances: {} };

  const callerSnapshot = await db.collection('users').doc(userId).get();
  const callerProfile = callerSnapshot.data() || {};
  const distances = {};
  const peerSnapshots = await db.getAll(
    ...peerIds.map((peerId) => db.collection('users').doc(peerId)),
  );
  peerSnapshots.forEach((snapshot) => {
    if (!snapshot.exists) return;
    const distanceKm = visibleDistanceKm(callerProfile, snapshot.data() || {});
    if (distanceKm == null) return;
    distances[snapshot.id] = distanceKm;
  });
  return { distances };
});

// Clients observe a revision only, never another owner's private visibility
// or entitlement record. Each refresh is authorized again by the APIs.
const signalDiscovery = async () => {
  if (process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === 'true') {
    await db.doc('app_config/discoveryRevision').set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
};
export const refreshDiscoveryOnVisibility = onDocumentWritten({ ...EVENT_OPTIONS, document: 'profileVisibility/{userId}' }, signalDiscovery);
export const refreshDiscoveryOnMembership = onDocumentWritten({ ...EVENT_OPTIONS, document: 'entitlements/{userId}' }, signalDiscovery);
export const refreshDiscoveryOnProfile = onDocumentWritten({ ...EVENT_OPTIONS, document: 'users/{userId}' }, async (event) => {
  if (process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED !== 'true') return;
  const fingerprint = (snapshot) => {
    if (!snapshot?.exists) return null;
    const data = snapshot.data(), projected = buildPublicProfile(snapshot.id, data);
    delete projected.updatedAt;
    return JSON.stringify({ profile: projected, filters: Object.fromEntries(
      ['age', 'faculty', 'year', 'gender', 'activity', 'activities', 'activityDetails', 'availability', 'availabilitySlots', 'pace', 'isNewUser']
        .map((key) => [key, data[key] ?? null])) });
  };
  // GPS/last-seen writes do not force every user's feed to reload. Owner
  // foreground refresh and the bounded polling interval update distances.
  if (fingerprint(event.data?.before) !== fingerprint(event.data?.after)) await signalDiscovery();
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
  const { Expo, client: expo } = await getExpoSdk();

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
  const notificationId = await persistInbox(db, key, userId, notification);
  notification = { ...notification, data: { ...notification.data, notificationId } };
  const { claimed, ref } = await claimDelivery(key, userId, notification.data.type);
  if (!claimed) return;
  try {
    const sentCount = notification.inboxOnly ? 0 : await sendNotificationToUser(userId, notification);
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
    const secure = process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === 'true';
    if (secure) {
      const recipients = [...new Set([decision?.fromUserId || before?.fromUserId, decision?.toUserId || before?.toUserId])]
        .filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id));
      await Promise.all(recipients.map((id) => db.doc(`matchingSignals/${id}`).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true })));
    }
    if (!isNewPendingLike(before, decision)) return;
    const senderSnapshot = secure ? null : await db.collection('profiles').doc(decision.fromUserId).get();
    await sendOnce(
      `${event.id}:${event.params.decisionId}`,
      decision.toUserId,
      secure ? privateLikeNotification() : likeNotification(senderSnapshot.data(), decision.fromUserId)
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
        notif.inboxOnly = conversation.participantSettings?.[recipientId]?.isMuted === true;
        notif.badge = recipientBadge;
        notif.data = { ...notif.data, messageId: event.params.messageId };

        return sendOnce(
          `${event.id}:${event.params.conversationId}:${event.params.messageId}`,
          recipientId,
          notif
        );
      });
    await Promise.all(sends);
  }
);

export const notifyOnGroupMessageCreated = onDocumentCreated(
  { ...EVENT_OPTIONS, document: 'groupChats/{partyId}/messages/{messageId}' },
  async (event) => {
    const message = event.data?.data();
    if (!message?.encrypted || !message?.senderId) return;
    const chatRef = db.doc(`groupChats/${event.params.partyId}`);
    const members = await db.runTransaction(async (tx) => {
      const chat = await tx.get(chatRef);
      const currentMembers = chat.get('memberIds') || [];
      if (!currentMembers.includes(message.senderId)) return [];
      const metadata = newerGroupMessage(chat.data(), message, event.params.messageId);
      if (metadata) tx.update(chatRef, metadata);
      return currentMembers;
    });
    await Promise.all(members.filter((uid) => uid !== message.senderId).map((uid) => sendOnce(
      `${event.id}:${event.params.partyId}:${event.params.messageId}`,
      uid,
      {
        title: 'ข้อความใหม่ในแชตกลุ่ม',
        body: message.type === 'image' ? 'มีรูปภาพใหม่' : 'มีข้อความใหม่',
        channelId: 'messages',
        threadId: `group-${event.params.partyId}`,
        data: { type: 'group_message', partyId: event.params.partyId, messageId: event.params.messageId },
      },
    )));
  },
);

export const expirePastParties = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', retryCount: 2 },
  async () => {
    let expired = 0;
    while (true) {
      const page = await db.collection('parties')
        .where('status', '==', 'open')
        .where('schedule.startsAt', '<=', Timestamp.now())
        .limit(200).get();
      if (page.empty) break;
      await Promise.all(page.docs.map((entry) => db.runTransaction(async (tx) => {
        const current = await tx.get(entry.ref);
        if (current.get('status') === 'open' && current.get('schedule.startsAt')?.toMillis?.() <= Date.now()) {
          tx.update(entry.ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
          expired += 1;
        }
      })));
      if (page.size < 200) break;
    }
    if (expired) logger.info('parties_expired', { count: expired });
  },
);

export const checkPushReceipts = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', retryCount: 3 },
  async () => {
    const snapshot = await db.collection('pushReceipts').where('status', '==', 'pending').limit(500).get();
    if (snapshot.empty) return;
    const records = new Map(snapshot.docs.map((document) => [document.id, document]));
    const { client: expo } = await getExpoSdk();

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

export const cleanupUnverifiedFirebaseUsers = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', retryCount: 3 },
  async () => {
    let pageToken;
    let scanned = 0;
    let deleted = 0;
    const nowMs = Date.now();

    do {
      const page = await auth.listUsers(1000, pageToken);
      scanned += page.users.length;

      for (const user of page.users) {
        if (!isExpiredUnverifiedCampusUser(user, nowMs)) continue;

        const [outgoing, incoming, convSnapshot] = await Promise.all([
          db.collection('decisions').where('fromUserId', '==', user.uid).get(),
          db.collection('decisions').where('toUserId', '==', user.uid).get(),
          db.collection('conversations').where('participants', 'array-contains', user.uid).get(),
        ]);

        const decisionDeletions = [];
        const seenDocIds = new Set();
        [...outgoing.docs, ...incoming.docs].forEach((doc) => {
          if (!seenDocIds.has(doc.id)) {
            seenDocIds.add(doc.id);
            decisionDeletions.push(doc.ref.delete());
          }
        });
        const convDeletions = convSnapshot.docs.map((c) => deleteConversationTree(c.ref));

        await Promise.all([
          db.collection('users').doc(user.uid).delete(),
          db.collection('profiles').doc(user.uid).delete(),
          db.collection('discoveryProfiles').doc(user.uid).delete(),
          db.collection('emailVerificationLocks').doc(user.uid).delete(),
          db.collection('campusEmailChangeLocks').doc(user.uid).delete(),
          ...decisionDeletions,
          ...convDeletions,
        ]);

        try {
          await auth.deleteUser(user.uid);
          deleted += 1;
        } catch (error) {
          if (error?.code !== 'auth/user-not-found') throw error;
        }
      }

      pageToken = page.pageToken;
    } while (pageToken);

    logger.info('[cleanupUnverifiedFirebaseUsers] Completed cleanup', {
      ageHours: UNVERIFIED_ACCOUNT_TTL_MS / (60 * 60 * 1000),
      deleted,
      scanned,
    });
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
  const { conversationId, groupChatId, base64Data, contentType, extension } = request.data || {};
  if (!(conversationId || groupChatId) || !base64Data || !contentType) {
    throw new HttpsError('invalid-argument', 'ข้อมูลสื่อไม่ครบถ้วน');
  }

  if (groupChatId && (contentType !== 'application/octet-stream' || extension !== 'enc')) {
    throw new HttpsError('invalid-argument', 'รูปภาพกลุ่มต้องเข้ารหัสก่อนอัปโหลด');
  }
  const roomId = groupChatId || conversationId;
  const convDoc = groupChatId
    ? await db.collection('groupChats').doc(groupChatId).get()
    : await db.collection('conversations').doc(conversationId).get();
  if (!convDoc.exists) {
    throw new HttpsError('not-found', 'ไม่พบห้องสนทนานี้');
  }
  const participants = groupChatId ? convDoc.data()?.memberIds || [] : convDoc.data()?.participants || [];
  if (!participants.includes(request.auth.uid) || (groupChatId && convDoc.get('rekeyRequired'))) {
    throw new HttpsError('permission-denied', 'คุณไม่ได้เป็นผู้ร่วมสนทนาในห้องนี้');
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 25 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'ไฟล์มีขนาดใหญ่เกิน 25MB');
  }

  const bucket = getStorage().bucket('campusmate-7f1ab.firebasestorage.app');
  const fileExt = extension || (contentType.includes('image') ? 'jpg' : 'm4a');
  const token = crypto.randomUUID();
  const filePath = `chat_media/${groupChatId ? 'group-' : ''}${roomId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${fileExt}`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: getChatMediaCacheControl({ contentType, extension: fileExt }),
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedBy: request.auth.uid,
        conversationId: roomId,
      },
    },
  });

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  return { success: true, url: downloadUrl };
});

/**
 * getR2ChatUploadUrl — Generates a presigned PUT URL for direct-to-R2 upload.
 * Strictly verifies authentication and conversation participant access.
 * Keep one warm instance — cold starts were ~3s while signing itself is <200ms.
 */
export const getR2ChatUploadUrl = onCall({
  region: REGION,
  maxInstances: 30,
  minInstances: 1,
  timeoutSeconds: 15,
  memory: '256MiB',
  secrets: R2_FUNCTION_SECRETS,
}, async (request) => {
  const startedAt = Date.now();
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนอัปโหลดสื่อ');
  }

  const { conversationId, groupChatId, mediaType, extension, contentType, uploadProtocolVersion } = request.data || {};
  if (!(conversationId || groupChatId)) {
    throw new HttpsError('invalid-argument', 'ข้อมูล conversationId ไม่ถูกต้อง');
  }
  if (groupChatId && (mediaType !== 'image' || extension !== 'enc' || contentType !== 'application/octet-stream')) {
    throw new HttpsError('invalid-argument', 'รูปภาพกลุ่มต้องเข้ารหัสก่อนอัปโหลด');
  }

  const authStartedAt = Date.now();
  const convDoc = groupChatId
    ? await db.collection('groupChats').doc(groupChatId).get()
    : await db.collection('conversations').doc(conversationId).get();
  if (!convDoc.exists) {
    throw new HttpsError('not-found', 'ไม่พบห้องสนทนานี้');
  }
  const participants = groupChatId ? convDoc.data()?.memberIds || [] : convDoc.data()?.participants || [];
  if (!participants.includes(request.auth.uid) || (groupChatId && convDoc.get('rekeyRequired'))) {
    throw new HttpsError('permission-denied', 'คุณไม่ได้เป็นผู้ร่วมสนทนาในห้องนี้');
  }
  const authMs = Date.now() - authStartedAt;

  // The Worker uses an R2 binding, with no persistent S3 key. Only v2 clients
  // forward the Authorization ticket. Existing v1 clients keep their fallback.
  if (process.env.CAMPUSMATE_R2_WORKER_ENABLED === 'true' && uploadProtocolVersion === 2
    && contentType === 'application/octet-stream' && extension === 'enc') {
    const objectKey = generateR2ObjectKey({ conversationId: groupChatId ? `group-${groupChatId}` : conversationId, mediaType, extension });
    try {
      return createR2WorkerUpload({ domain: process.env.CAMPUSMATE_R2_WORKER_DOMAIN,
        secret: process.env.R2_UPLOAD_SIGNING_KEY, objectKey });
    } catch {
      logger.error('r2_worker_signing_failed');
      return { success: false, provider: 'firebase', message: 'Media delivery unavailable' };
    }
  }

  if (!isR2Configured(process.env)) {
    logger.warn('[getR2ChatUploadUrl] Cloudflare R2 credentials missing on server');
    return {
      success: false,
      provider: 'firebase',
      message: 'Cloudflare R2 is not configured on server. Falling back to Firebase Storage.',
    };
  }

  const objectKey = generateR2ObjectKey({ conversationId: groupChatId ? `group-${groupChatId}` : conversationId, mediaType, extension });
  const mimeType = contentType || (extension === 'enc' ? 'application/octet-stream' : (mediaType === 'audio' ? 'audio/m4a' : 'image/jpeg'));
  const cacheControl = uploadProtocolVersion === 2
    ? getChatMediaCacheControl({ contentType: mimeType, extension })
    : undefined;

  try {
    const r2Config = getR2Config(process.env);
    const signStartedAt = Date.now();
    // Reuse the S3 client across warm invocations of this instance.
    const s3 = getR2S3Client(r2Config);
    const uploadUrl = await generateR2UploadPresignedUrl(s3, {
      bucket: r2Config.bucketName,
      key: objectKey,
      contentType: mimeType,
      cacheControl,
      expiresIn: 300,
    });

    const downloadUrl = buildR2DownloadUrl({
      publicDomain: r2Config.publicDomain,
      bucketName: r2Config.bucketName,
      accountId: r2Config.accountId,
      objectKey,
    });

    logger.info('[getR2ChatUploadUrl] Generated R2 presigned upload URL', {
      objectKey,
      mimeType,
      bucket: r2Config.bucketName,
      authMs,
      signMs: Date.now() - signStartedAt,
      totalMs: Date.now() - startedAt,
      deliveryMode: r2Config.deliveryMode,
      uploadProtocolVersion: cacheControl ? 2 : 1,
    });

    return {
      success: true,
      provider: 'r2',
      uploadUrl,
      downloadUrl,
      objectKey,
      contentType: mimeType,
      uploadHeaders: {
        'Content-Type': mimeType,
        ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
      },
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

let rekognitionClientInstance = null;
function getRekognitionClientInstance() {
  if (!rekognitionClientInstance) {
    try {
      rekognitionClientInstance = getRekognitionClient({ env: process.env });
    } catch (err) {
      logger.warn('[ContentModeration] Could not initialize Amazon Rekognition client:', err);
    }
  }
  return rekognitionClientInstance;
}

export { uploadProfileGalleryImage } from './profileGalleryFunctions.js';

/**
 * checkImageSafety — Checks an image for nudity/adult/violence content
 * using Amazon Rekognition (Primary) with Google Cloud Vision (Fallback).
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
    // 1. Primary engine: Amazon Rekognition (College moderation policy)
    const rekognition = getRekognitionClientInstance();
    if (rekognition) {
      try {
        const rekResult = await detectModerationWithRekognition(imageBase64, {
          rekognitionClient: rekognition,
        });

        if (rekResult.status === 'blocked') {
          logger.warn(
            `[ContentModeration/AWS] Blocked unsafe image for user ${request.auth.uid}: reason=${rekResult.reason}`,
            rekResult.detectedLabel
          );
        } else {
          logger.info(`[ContentModeration/AWS] Image allowed for user ${request.auth.uid}`);
        }

        return rekResult;
      } catch (awsErr) {
        logger.warn('[ContentModeration/AWS] Rekognition call failed, falling back to Google Vision:', awsErr?.message || awsErr);
      }
    }

    // 2. Fallback engine: Google Cloud Vision SafeSearch
    const visionClient = getVisionClient();
    const result = await detectSafeSearch(imageBase64, {
      visionClient,
      apiKey: process.env.GOOGLE_VISION_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    });

    if (result.status === 'blocked') {
      logger.warn(`[ContentModeration/Vision] Blocked unsafe image for user ${request.auth.uid}: reason=${result.reason}`, result.scores);
    }

    return result;
  } catch (err) {
    logger.error('[ContentModeration] Failed to scan image with both Rekognition and Vision API:', err);
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

/** In-memory Spotify Client Credentials token cache (per instance). */
let spotifyTokenCache = { accessToken: null, expiresAtMs: 0 };

async function getSpotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpsError(
      'failed-precondition',
      'ระบบค้นหา Spotify ยังไม่ได้ตั้งค่า Client ID/Secret',
    );
  }

  const now = Date.now();
  if (spotifyTokenCache.accessToken && spotifyTokenCache.expiresAtMs > now + 60_000) {
    return spotifyTokenCache.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('[Spotify] token request failed', { status: response.status, body: body.slice(0, 300) });
    throw new HttpsError('internal', 'ไม่สามารถเชื่อมต่อ Spotify ได้');
  }

  const data = await response.json();
  const accessToken = typeof data.access_token === 'string' ? data.access_token : null;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  if (!accessToken) {
    throw new HttpsError('internal', 'ไม่สามารถเชื่อมต่อ Spotify ได้');
  }

  spotifyTokenCache = {
    accessToken,
    expiresAtMs: now + expiresIn * 1000,
  };
  return accessToken;
}

function compactSpotifyTrack(item) {
  if (!item || typeof item !== 'object') return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!id || !name) return null;

  const artists = Array.isArray(item.artists)
    ? item.artists
      .map((artist) => (typeof artist?.name === 'string' ? artist.name.trim() : ''))
      .filter(Boolean)
      .join(', ')
      .slice(0, 200)
    : '';

  const images = item.album?.images;
  let albumArt = '';
  if (Array.isArray(images) && images.length) {
    const preferred = images.find((img) => typeof img?.url === 'string' && img.url)
      || images[images.length - 1];
    if (typeof preferred?.url === 'string') albumArt = preferred.url.trim().slice(0, 2000);
  }

  const previewUrl = typeof item.preview_url === 'string' && item.preview_url.trim()
    ? item.preview_url.trim().slice(0, 2000)
    : undefined;
  const albumName = compactTrackAlbumName(item.album?.name);
  const durationMs = compactTrackDurationMs(item.duration_ms);
  const externalUrl = typeof item.external_urls?.spotify === 'string' && item.external_urls.spotify.trim()
    ? item.external_urls.spotify.trim().slice(0, 500)
    : `https://open.spotify.com/track/${id}`;

  return {
    id: id.slice(0, 64),
    name: name.slice(0, 200),
    artists: artists || 'Unknown',
    albumArt,
    ...(albumName ? { albumName } : {}),
    ...(durationMs ? { durationMs } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    externalUrl,
  };
}

function spotifySearchUrl(name, artists) {
  const query = [name, artists].filter(Boolean).join(' ').trim();
  return `https://open.spotify.com/search/${encodeURIComponent(query)}`.slice(0, 500);
}

function compactTrackAlbumName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function compactTrackDurationMs(value) {
  const durationMs = Number(value);
  return Number.isFinite(durationMs) && durationMs >= 1000 && durationMs <= 86_400_000
    ? Math.round(durationMs)
    : undefined;
}

function compactItunesTrack(item) {
  if (!item || typeof item !== 'object') return null;
  const trackId = item.trackId != null ? String(item.trackId) : '';
  const name = typeof item.trackName === 'string' ? item.trackName.trim() : '';
  if (!trackId || !name) return null;
  const artists = typeof item.artistName === 'string' ? item.artistName.trim().slice(0, 200) : 'Unknown';
  const albumArt = typeof item.artworkUrl100 === 'string'
    ? item.artworkUrl100.replace('100x100bb', '300x300bb').slice(0, 2000)
    : (typeof item.artworkUrl60 === 'string' ? item.artworkUrl60.slice(0, 2000) : '');
  const previewUrl = typeof item.previewUrl === 'string' && item.previewUrl.trim()
    ? item.previewUrl.trim().slice(0, 2000)
    : undefined;
  const albumName = compactTrackAlbumName(item.collectionName || item.collectionCensoredName);
  const durationMs = compactTrackDurationMs(item.trackTimeMillis);
  const appleUrl = typeof item.trackViewUrl === 'string' && item.trackViewUrl.trim()
    ? item.trackViewUrl.trim().slice(0, 500)
    : '';
  return {
    id: `it-${trackId}`.slice(0, 64),
    name: name.slice(0, 200),
    artists: artists || 'Unknown',
    albumArt,
    ...(albumName ? { albumName } : {}),
    ...(durationMs ? { durationMs } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    // Full song plays in Apple Music / Spotify — in-app audio is preview-only.
    externalUrl: appleUrl || spotifySearchUrl(name, artists),
  };
}

async function searchItunesTracks(q, limit, offset = 0) {
  // iTunes Search has a 200-result limit but no offset parameter. Fetch one
  // extra result so the client knows whether another page can be requested.
  if (offset >= 200) return { tracks: [], hasMore: false };
  const resultLimit = Math.min(200, offset + limit + 1);
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', q);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', String(resultLimit));
  // CampusMate is Thailand-first; without country, iTunes defaults to US and
  // Thai artists (e.g. "PUN") disappear under Western results.
  url.searchParams.set('country', 'TH');
  url.searchParams.set('lang', 'en_us');
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('[iTunes] search failed', { status: response.status, body: body.slice(0, 300) });
    throw new HttpsError('internal', 'ค้นหาเพลงไม่สำเร็จ');
  }
  const data = await response.json();
  const items = Array.isArray(data?.results) ? data.results : [];
  return {
    tracks: items.slice(offset, offset + limit).map(compactItunesTrack).filter(Boolean),
    hasMore: items.length > offset + limit,
  };
}

function isSpotifyPremiumBlocked(status, body) {
  if (status !== 403) return false;
  const text = String(body || '').toLowerCase();
  return text.includes('premium subscription') || text.includes('premium');
}

/**
 * searchSpotifyTracks - Search tracks for profile/chat.
 * Prefers Spotify Web API; falls back to iTunes Search when Spotify blocks
 * Development Mode apps without Premium (common since Feb 2026).
 */
export const searchSpotifyTracks = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนค้นหาเพลง');
  }

  const rawQuery = request.data?.q;
  const q = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 100) : '';
  if (!q) {
    throw new HttpsError('invalid-argument', 'ต้องระบุคำค้นหา');
  }

  let limit = Number(request.data?.limit);
  if (!Number.isFinite(limit)) limit = 10;
  // Spotify development-mode search allows at most 10 results per request.
  limit = Math.min(10, Math.max(1, Math.floor(limit)));
  let offset = Number(request.data?.offset);
  if (!Number.isFinite(offset)) offset = 0;
  offset = Math.min(1000, Math.max(0, Math.floor(offset)));
  const preferredSource = request.data?.source === 'itunes' || request.data?.source === 'spotify'
    ? request.data.source
    : null;

  try {
    // Prefer Spotify when credentials exist and the owner account is allowed.
    if (preferredSource !== 'itunes' && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      try {
        const accessToken = await getSpotifyAccessToken();
        const url = new URL('https://api.spotify.com/v1/search');
        url.searchParams.set('q', q);
        url.searchParams.set('type', 'track');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('market', 'TH');

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.ok) {
          const data = await response.json();
          const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
          return {
            tracks: items.map(compactSpotifyTrack).filter(Boolean),
            source: 'spotify',
            hasMore: Boolean(data?.tracks?.next) && items.length > 0,
            nextOffset: offset + items.length,
          };
        }

        const body = await response.text().catch(() => '');
        logger.error('[Spotify] search failed', { status: response.status, body: body.slice(0, 300) });

        if (!isSpotifyPremiumBlocked(response.status, body) && response.status !== 401 && response.status !== 429) {
          // Unexpected Spotify failure — still try iTunes so UX keeps working.
          logger.warn('[Spotify] falling back to iTunes after non-premium error');
        } else {
          logger.warn('[Spotify] Premium/dev restriction — falling back to iTunes search');
        }
      } catch (spotifyErr) {
        if (spotifyErr instanceof HttpsError && spotifyErr.code === 'failed-precondition') {
          // Missing credentials — fall through to iTunes.
        } else {
          logger.error('[Spotify] unexpected error, falling back to iTunes:', spotifyErr);
        }
      }
    }

    const { tracks, hasMore } = await searchItunesTracks(q, limit, offset);
    return { tracks, source: 'itunes', hasMore, nextOffset: offset + limit };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('[Spotify] searchSpotifyTracks error:', err);
    throw new HttpsError('internal', 'ค้นหาเพลงไม่สำเร็จ');
  }
});

function compactAppleChartSong(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id != null ? String(item.id).trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!id || !name) return null;
  const artists = typeof item.artistName === 'string' ? item.artistName.trim().slice(0, 200) : 'Unknown';
  const albumName = compactTrackAlbumName(item.albumName);
  const durationMs = compactTrackDurationMs(item.trackTimeMillis);
  const albumArt = typeof item.artworkUrl100 === 'string'
    ? item.artworkUrl100.replace('100x100bb', '300x300bb').slice(0, 2000)
    : '';
  const appleUrl = typeof item.url === 'string' && item.url.trim()
    ? item.url.trim().slice(0, 500)
    : '';
  return {
    id: `it-${id}`.slice(0, 64),
    name: name.slice(0, 200),
    artists: artists || 'Unknown',
    albumArt,
    ...(albumName ? { albumName } : {}),
    ...(durationMs ? { durationMs } : {}),
    externalUrl: appleUrl || spotifySearchUrl(name, artists),
    itunesId: id,
  };
}

function compactItunesRssEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const rawId = entry?.id?.attributes?.['im:id'];
  const id = rawId != null ? String(rawId).trim() : '';
  const name = entry?.['im:name']?.label?.trim?.() || '';
  if (!id || !name) return null;
  const artists = entry?.['im:artist']?.label?.trim?.()?.slice(0, 200) || 'Unknown';
  const albumName = compactTrackAlbumName(entry?.['im:collection']?.['im:name']?.label);
  const images = Array.isArray(entry?.['im:image']) ? entry['im:image'] : [];
  const albumArt = images.length
    ? String(images[images.length - 1]?.label || '').replace(/\d+x\d+bb/, '300x300bb').slice(0, 2000)
    : '';
  let previewUrl;
  let appleUrl = typeof entry?.id?.label === 'string' && entry.id.label.startsWith('http')
    ? entry.id.label.trim().slice(0, 500)
    : '';
  const links = Array.isArray(entry?.link) ? entry.link : (entry?.link ? [entry.link] : []);
  for (const link of links) {
    const href = link?.attributes?.href;
    const type = link?.attributes?.type || '';
    const rel = link?.attributes?.rel || '';
    if (typeof href === 'string' && type.startsWith('audio')) {
      previewUrl = href.slice(0, 2000);
    } else if (!appleUrl && typeof href === 'string' && (rel === 'alternate' || href.includes('music.apple.com') || href.includes('itunes.apple.com'))) {
      appleUrl = href.slice(0, 500);
    }
  }
  return {
    id: `it-${id}`.slice(0, 64),
    name: name.slice(0, 200),
    artists,
    albumArt,
    ...(albumName ? { albumName } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    externalUrl: appleUrl || spotifySearchUrl(name, artists),
    itunesId: id,
  };
}

async function enrichItunesPreviews(tracks) {
  const needIds = tracks
    .filter((t) => t && t.itunesId && (!t.previewUrl || !t.externalUrl || t.externalUrl.includes('open.spotify.com/search') || !t.albumName || !t.durationMs))
    .map((t) => t.itunesId)
    .slice(0, 25);
  if (!needIds.length) return tracks;

  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', needIds.join(','));
  url.searchParams.set('country', 'TH');
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) return tracks;
  const data = await response.json();
  const byId = new Map();
  (Array.isArray(data?.results) ? data.results : []).forEach((item) => {
    if (item?.trackId == null) return;
    byId.set(String(item.trackId), {
      previewUrl: typeof item.previewUrl === 'string' && item.previewUrl
        ? item.previewUrl.slice(0, 2000)
        : undefined,
      trackViewUrl: typeof item.trackViewUrl === 'string' && item.trackViewUrl
        ? item.trackViewUrl.slice(0, 500)
        : undefined,
      albumName: compactTrackAlbumName(item.collectionName || item.collectionCensoredName),
      durationMs: compactTrackDurationMs(item.trackTimeMillis),
    });
  });
  return tracks.map((track) => {
    if (!track.itunesId) return track;
    const hit = byId.get(String(track.itunesId));
    if (!hit) return track;
    return {
      ...track,
      ...(track.previewUrl ? {} : (hit.previewUrl ? { previewUrl: hit.previewUrl } : {})),
      ...(hit.trackViewUrl ? { externalUrl: hit.trackViewUrl } : {}),
      ...(track.albumName ? {} : (hit.albumName ? { albumName: hit.albumName } : {})),
      ...(track.durationMs ? {} : (hit.durationMs ? { durationMs: hit.durationMs } : {})),
    };
  });
}

async function fetchTrendingThTracks(limit = 10) {
  const response = await fetch(
    `https://rss.applemarketingtools.com/api/v2/th/music/most-played/${Math.min(25, Math.max(limit, 8))}/songs.json`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    logger.error('[MusicBrowse] trending chart failed', { status: response.status });
    return [];
  }
  const data = await response.json();
  const items = Array.isArray(data?.feed?.results) ? data.feed.results : [];
  return items.map(compactAppleChartSong).filter(Boolean).slice(0, limit);
}

async function fetchRecommendedThTracks(limit = 10) {
  const response = await fetch(
    `https://itunes.apple.com/th/rss/topsongs/limit=${Math.min(25, Math.max(limit, 8))}/json`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    logger.error('[MusicBrowse] recommended topsongs failed', { status: response.status });
    return [];
  }
  const data = await response.json();
  const entries = Array.isArray(data?.feed?.entry) ? data.feed.entry : [];
  return entries.map(compactItunesRssEntry).filter(Boolean).slice(0, limit);
}

/**
 * browseMusicTracks - Thailand charts for empty-state browse UI.
 * Returns { recommended, trending } without requiring Spotify Premium.
 */
export const browseMusicTracks = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนดูเพลงแนะนำ');
  }

  let limit = Number(request.data?.limit);
  if (!Number.isFinite(limit)) limit = 10;
  limit = Math.min(25, Math.max(4, Math.floor(limit)));

  try {
    const [recommendedRaw, trendingRaw] = await Promise.all([
      fetchRecommendedThTracks(limit),
      fetchTrendingThTracks(limit),
    ]);

    // Prefer distinct lists: drop trending ids already in recommended.
    const recommendedIds = new Set(recommendedRaw.map((t) => t.id));
    const trendingFiltered = trendingRaw.filter((t) => !recommendedIds.has(t.id));

    const [recommended, trending] = await Promise.all([
      enrichItunesPreviews(recommendedRaw),
      enrichItunesPreviews(trendingFiltered.length ? trendingFiltered : trendingRaw),
    ]);

    // Strip helper field before returning to clients.
    const clean = (list) => list.map(({ itunesId, ...rest }) => rest);

    return {
      recommended: clean(recommended),
      trending: clean(trending),
      source: 'apple-th',
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('[MusicBrowse] browseMusicTracks error:', err);
    throw new HttpsError('internal', 'โหลดเพลงแนะนำไม่สำเร็จ');
  }
});

export const switchAdminMode = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  const uid = request.auth.uid;
  const user = await auth.getUser(uid);
  const isSuper = isSuperAdminEmail(user.email);
  const currentAdmin = user.customClaims?.admin === true;
  if (!isSuper && !currentAdmin) {
    throw new HttpsError('permission-denied', 'เฉพาะผู้ดูแลระบบหรือผู้ใช้ที่ได้รับอนุญาตเท่านั้น');
  }
  const newAdmin = typeof request.data?.isAdmin === 'boolean' ? request.data.isAdmin : !currentAdmin;
  await auth.setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    admin: newAdmin,
  });
  await db.collection('users').doc(uid).set({
    isAdmin: newAdmin,
    role: newAdmin ? 'admin' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection('profiles').doc(uid).set({
    role: newAdmin ? 'admin' : 'user',
  }, { merge: true });
  return { success: true, isAdmin: newAdmin };
});

export const ensureNotificationInbox = onCall({ region: REGION }, async (request) => {
  if (request.data?.expectedUid && request.data.expectedUid !== request.auth?.uid) throw new HttpsError('permission-denied', 'บัญชีเปลี่ยนแล้ว');
  if (!request.auth) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  const userRef = db.doc(`users/${request.auth.uid}`);
  const userSnap = await userRef.get();
  const userData = userSnap.data() || {};
  const email = request.auth.token?.email || userData.email || userData.campusEmail;
  if (isSuperAdminEmail(email)) {
    const patch = {};
    let needsUpdate = false;
    if (userData.isFaceVerified !== true || userData.faceMatchScore !== 100) {
      patch.isFaceVerified = true;
      patch.faceMatchScore = 100;
      patch.faceVerificationStatus = 'verified';
      patch.autoVerifyFace = true;
      patch.faceVerifiedAt = FieldValue.serverTimestamp();
      needsUpdate = true;
    }
    if (needsUpdate) {
      await userRef.set(patch, { merge: true });
      await db.doc(`profiles/${request.auth.uid}`).set({
        isFaceVerified: true,
        faceMatchScore: 100,
      }, { merge: true });
      const discRef = db.doc(`discoveryProfiles/${request.auth.uid}`);
      const discSnap = await discRef.get();
      if (discSnap.exists) {
        await discRef.set({ isFaceVerified: true }, { merge: true });
      }
    }
  }
  const refreshedUser = (await userRef.get()).data() || {};
  await syncFaceInbox(db, request.auth.uid, refreshedUser);
  return { ok: true };
});
export const syncFaceNotificationInbox = onDocumentWritten({ ...EVENT_OPTIONS, document: 'users/{userId}' }, async (event) => {
  await syncFaceInbox(db, event.params.userId, event.data?.after.data());
});
export const notifyPartyRequestInbox = onDocumentWritten({ ...EVENT_OPTIONS, document: 'parties/{partyId}/requests/{requestId}' }, async (event) => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!after || before?.status === after.status) return;
  const pending = after.status === 'pending';
  const recipient = pending || after.status === 'withdrawn' ? after.hostId : after.requesterId;
  if (!recipient || !['pending', 'approved', 'rejected', 'withdrawn'].includes(after.status)) return;
  await sendOnce(`${event.id}:party-request`, recipient, {
    title: pending ? 'มีคำขอเข้าร่วมตี้' : after.status === 'approved' ? 'คำขอเข้าร่วมตี้ได้รับอนุมัติ' : after.status === 'withdrawn' ? 'มีการถอนคำขอเข้าร่วมตี้' : 'คำขอเข้าร่วมตี้ไม่ได้รับอนุมัติ',
    body: 'แตะเพื่อดูรายละเอียดในหน้าหาตี้', data: { type: 'party_request', partyId: event.params.partyId }, channelId: 'social',
  });
});
export const notifyPartyStatusInbox = onDocumentWritten({ ...EVENT_OPTIONS, document: 'parties/{partyId}' }, async (event) => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !['cancelled', 'expired'].includes(after.status)) return;
  await Promise.all((after.memberIds || []).filter(uid => uid !== after.hostId).map(uid => sendOnce(`${event.id}:party-status`, uid, {
    title: after.status === 'cancelled' ? 'ตี้ถูกยกเลิกแล้ว' : 'ตี้นี้สิ้นสุดแล้ว', body: 'แตะเพื่อดูรายละเอียดกิจกรรม',
    data: { type: 'party_status', partyId: event.params.partyId }, channelId: 'social',
  })));
});
export const notifyAppointmentInbox = onDocumentWritten({ ...EVENT_OPTIONS, document: 'appointments/{appointmentId}' }, async (event) => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!after || before?.status === after.status) return;
  await Promise.all((after.participants || []).map(uid => sendOnce(`${event.id}:appointment`, uid, {
    title: after.status === 'cancelled' ? 'นัดหมายถูกยกเลิก' : 'มีนัดหมายใหม่', body: 'แตะเพื่อดูประวัติและรายละเอียดนัดหมาย',
    data: { type: 'appointment', appointmentId: event.params.appointmentId }, channelId: 'social',
  })));
});
export const cleanExpiredNotificationInbox = onSchedule({ region: REGION, schedule: 'every 24 hours', timeZone: 'Asia/Bangkok' }, async () => {
  for (let page = 0; page < 20; page++) {
    const rows = await db.collectionGroup('notifications').where('expiresAt', '<=', Timestamp.now()).limit(400).get();
    if (rows.empty) break;
    const batch = db.batch(); rows.docs.forEach(row => batch.delete(row.ref)); await batch.commit();
  }
});

export const markAllNotificationInboxRead = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  if (request.data?.expectedUid && request.data.expectedUid !== request.auth?.uid) throw new HttpsError('permission-denied', 'บัญชีเปลี่ยนแล้ว');
  if (!request.auth) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  const source = db.collection(`users/${request.auth.uid}/notifications`), cutoff = Timestamp.now();
  let count = 0;
  for (let page = 0; page < 25; page++) {
    const rows = await source.where('readAt', '==', null).where('createdAt', '<=', cutoff).limit(400).get();
    if (rows.empty) return { count };
    const batch = db.batch(); rows.docs.forEach(row => batch.update(row.ref, { readAt: FieldValue.serverTimestamp() }));
    await batch.commit(); count += rows.size;
  }
  return { count, hasMore: true };
});
