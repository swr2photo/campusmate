import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import {
  createFaceVerificationSession,
  FaceVerificationError,
  getAwsSecretNames,
  getRekognitionClient,
  verifyFaceMatch,
} from './faceVerification.js';
import {
  fetchIdentityStatus,
  identityOrigin,
  PhotoSyncError,
  syncPhotoVerification as mirrorPhotoVerification,
} from './photoVerificationSync.js';

const REGION = 'asia-southeast1';
const AWS_FUNCTION_SECRETS = getAwsSecretNames().map((name) => defineSecret(name));
// Origin of the Rust identity API. Empty keeps the liveness badge sync off.
const IDENTITY_BACKEND_URL = defineString('IDENTITY_BACKEND_URL', { default: '' });
const SYNC_ERRORS = new Set(['invalid-argument', 'unauthenticated', 'permission-denied', 'not-found', 'unavailable']);

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนทำการยืนยันใบหน้า');
  }
  // Email claims come from the auth provider's signed token, never from the
  // client-writable profile document.
  return {
    uid: request.auth.uid,
    authEmail: request.auth.token?.email || null,
    authEmailVerified: request.auth.token?.email_verified === true,
  };
}

/**
 * Callable: Create a single-use face verification session for the caller.
 */
export const startFaceVerificationSession = onCall(
  { region: REGION, maxInstances: 20, secrets: AWS_FUNCTION_SECRETS },
  async (request) => {
    const { uid, authEmail, authEmailVerified } = requireAuth(request);
    try {
      return await createFaceVerificationSession({ db: getFirestore(), uid, authEmail, authEmailVerified,
        candidateAvatarUri: request.data?.candidateAvatarUri || null });
    } catch (err) {
      if (err instanceof FaceVerificationError && err.code === 'rate_limited') {
        throw new HttpsError('resource-exhausted', err.message, { reason: 'RATE_LIMITED' });
      }
      logger.warn('[FaceVerification] session not created', { code: err?.code || 'error' });
      throw new HttpsError('invalid-argument', err.message || 'ไม่สามารถเริ่มเซสชันการยืนยันใบหน้าได้');
    }
  }
);

/**
 * Callable: Compare the live capture with the pinned main photo. The server
 * alone decides; the response carries no similarity score.
 */
export const completeFaceVerification = onCall(
  {
    region: REGION,
    maxInstances: 20,
    timeoutSeconds: 60,
    memory: '512MiB',
    secrets: AWS_FUNCTION_SECRETS,
  },
  async (request) => {
    const { uid, authEmail, authEmailVerified } = requireAuth(request);
    const { sessionId, liveSelfieBase64 } = request.data || {};
    if (!sessionId || typeof sessionId !== 'string') {
      throw new HttpsError('invalid-argument', 'กรุณาระบุรหัสเซสชัน (sessionId)');
    }

    try {
      const result = await verifyFaceMatch({
        db: getFirestore(),
        uid,
        sessionId,
        liveSelfieBase64,
        rekognitionClient: getRekognitionClient(),
        authEmail,
        authEmailVerified,
      });
      // Outcome codes only: no scores, images, emails or session payloads.
      logger.info('[FaceVerification] completed', { outcome: result.success ? 'verified' : result.reason });
      return result;
    } catch (err) {
      logger.error('[FaceVerification] processing error', { name: err?.name || 'Error' });
      throw new HttpsError('internal', 'เกิดข้อผิดพลาดในการประมวลผลการยืนยันใบหน้า กรุณาเริ่มใหม่อีกครั้ง');
    }
  }
);

/**
 * Callable: mirror the Rust liveness decision into the Firestore badge. The
 * caller sends their own ID token, which is checked and forwarded to the
 * identity API; the server decision, not this request, sets the badge.
 */
export const syncPhotoVerification = onCall({ region: REGION, maxInstances: 20, timeoutSeconds: 30 }, async (request) => {
  const { uid } = requireAuth(request);
  const origin = identityOrigin(IDENTITY_BACKEND_URL.value());
  if (!origin) {
    throw new HttpsError('failed-precondition', 'ระบบยืนยันใบหน้าแบบใหม่ยังไม่เปิดใช้งาน');
  }
  try {
    return await mirrorPhotoVerification({
      db: getFirestore(),
      uid,
      idToken: request.data?.idToken,
      verifyIdToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked),
      readStatus: (token) => fetchIdentityStatus({ origin, idToken: token }),
    });
  } catch (err) {
    if (err instanceof PhotoSyncError && SYNC_ERRORS.has(err.code)) {
      logger.warn('[PhotoVerificationSync] not synced', { code: err.code });
      throw new HttpsError(err.code, err.message);
    }
    logger.error('[PhotoVerificationSync] failed', { name: err?.name || 'Error' });
    throw new HttpsError('internal', 'ซิงก์สถานะการยืนยันใบหน้าไม่สำเร็จ');
  }
});
