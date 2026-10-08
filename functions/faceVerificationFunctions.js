import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import {
  createFaceVerificationSession,
  getAwsSecretNames,
  getRekognitionClient,
  isAwsConfigured,
  verifyFaceMatch,
} from './faceVerification.js';

const REGION = 'asia-southeast1';
const AWS_FUNCTION_SECRETS = getAwsSecretNames().map((name) => defineSecret(name));

function requireAuthUid(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนทำการยืนยันใบหน้า');
  }
  return request.auth.uid;
}

/**
 * Callable: Create a face verification session for the authenticated user.
 */
export const startFaceVerificationSession = onCall(
  { region: REGION, maxInstances: 20, secrets: AWS_FUNCTION_SECRETS },
  async (request) => {
    const uid = requireAuthUid(request);
    const db = getFirestore();
    const rekognitionClient = getRekognitionClient();

    try {
      const result = await createFaceVerificationSession({
        db,
        uid,
        rekognitionClient,
      });
      return result;
    } catch (err) {
      logger.error(`[FaceVerification] Session creation failed for user ${uid}:`, err);
      throw new HttpsError('invalid-argument', err.message || 'ไม่สามารถเริ่มเซสชันการยืนยันใบหน้าได้');
    }
  }
);

/**
 * Callable: Complete face verification by comparing live capture / liveness result against primary avatar.
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
    const uid = requireAuthUid(request);
    const db = getFirestore();
    const rekognitionClient = getRekognitionClient();

    const { sessionId, liveSelfieBase64 } = request.data || {};
    if (!sessionId || typeof sessionId !== 'string') {
      throw new HttpsError('invalid-argument', 'กรุณาระบุรหัสเซสชัน (sessionId)');
    }

    try {
      const result = await verifyFaceMatch({
        db,
        uid,
        sessionId,
        liveSelfieBase64,
        rekognitionClient,
      });

      if (result.success) {
        logger.info(`[FaceVerification] User ${uid} verified successfully with score ${result.similarity}%`);
      } else {
        logger.warn(`[FaceVerification] Verification rejected for user ${uid}: ${result.reason} (${result.similarity || 0}%)`);
      }

      return result;
    } catch (err) {
      logger.error(`[FaceVerification] Verification process failed for user ${uid}:`, err);
      throw new HttpsError('internal', err.message || 'เกิดข้อผิดพลาดในการประมวลผลการยืนยันใบหน้า');
    }
  }
);
