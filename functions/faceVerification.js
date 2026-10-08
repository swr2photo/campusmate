import crypto from 'node:crypto';
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand,
  DetectFacesCommand,
} from '@aws-sdk/client-rekognition';

export const MIN_LIVENESS_CONFIDENCE = 85;
export const MIN_FACE_SIMILARITY = 85;
export const MIN_FACE_CONFIDENCE = 90;
export const MIN_FACE_BOX = 0.18;
export const MIN_FACE_SHARPNESS = 20;
export const MIN_FACE_BRIGHTNESS = 20;
export const MAX_FACE_BRIGHTNESS = 92;
export const MAX_FACE_YAW = 28;
export const MAX_FACE_PITCH = 24;
export const MAX_FACE_ROLL = 30;
export const SESSION_TTL_MS = 15 * 60 * 1000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Rejects selfies that Rekognition can see but a person would not accept:
 * too small, blurry, badly lit, turned away, wearing sunglasses, or covered.
 * Missing optional attributes are treated as unknown, not as a failure.
 */
export function assessSelfieFaces(faceDetails) {
  const faces = Array.isArray(faceDetails) ? faceDetails : [];
  if (faces.length === 0) {
    return {
      ok: false,
      reason: 'no_face_detected',
      message: 'ไม่พบใบหน้าในภาพที่ถ่าย กรุณาจัดใบหน้าให้อยู่ในกรอบวงรีและอยู่ในที่สว่าง',
    };
  }
  if (faces.length > 1) {
    return {
      ok: false,
      reason: 'multiple_faces_detected',
      message: 'ตรวจพบมากกว่า 1 ใบหน้าในภาพ กรุณาถ่ายภาพคนเดียวเพื่อยืนยันตัวตน',
    };
  }

  const face = faces[0] || {};
  const confidence = finite(face.Confidence);
  if (confidence !== null && confidence < MIN_FACE_CONFIDENCE) {
    return {
      ok: false,
      reason: 'low_face_confidence',
      message: 'ใบหน้าในภาพยังไม่ชัดพอ กรุณาถ่ายใหม่ให้เห็นใบหน้าเต็มและไม่เบลอ',
    };
  }

  const box = face.BoundingBox;
  const boxWidth = finite(box?.Width);
  const boxHeight = finite(box?.Height);
  if ((boxWidth !== null && boxWidth < MIN_FACE_BOX) || (boxHeight !== null && boxHeight < MIN_FACE_BOX)) {
    return {
      ok: false,
      reason: 'face_too_small',
      message: 'ใบหน้าอยู่ไกลจากกล้องเกินไป กรุณาขยับเข้าใกล้จนใบหน้าอยู่ในกรอบวงรี',
    };
  }

  const sharpness = finite(face.Quality?.Sharpness);
  if (sharpness !== null && sharpness < MIN_FACE_SHARPNESS) {
    return {
      ok: false,
      reason: 'face_blurry',
      message: 'ภาพเบลอ กรุณาถือโทรศัพท์นิ่งแล้วถ่ายใหม่ในที่สว่าง',
    };
  }

  const brightness = finite(face.Quality?.Brightness);
  if (brightness !== null && (brightness < MIN_FACE_BRIGHTNESS || brightness > MAX_FACE_BRIGHTNESS)) {
    return {
      ok: false,
      reason: 'face_lighting',
      message: 'แสงไม่เหมาะกับการตรวจใบหน้า กรุณาหันหน้าเข้าหาแสงและหลีกเลี่ยงแสงย้อน',
    };
  }

  const yaw = finite(face.Pose?.Yaw);
  const pitch = finite(face.Pose?.Pitch);
  const roll = finite(face.Pose?.Roll);
  if (
    (yaw !== null && Math.abs(yaw) > MAX_FACE_YAW)
    || (pitch !== null && Math.abs(pitch) > MAX_FACE_PITCH)
    || (roll !== null && Math.abs(roll) > MAX_FACE_ROLL)
  ) {
    return {
      ok: false,
      reason: 'face_pose',
      message: 'หันหน้าตรงเข้าหากล้อง อย่าก้ม เงย หรือเอียงศีรษะมาก แล้วถ่ายใหม่',
    };
  }

  if (face.Sunglasses?.Value === true && finite(face.Sunglasses?.Confidence) >= 80) {
    return {
      ok: false,
      reason: 'sunglasses',
      message: 'ถอดแว่นกันแดดออก แล้วถ่ายให้เห็นดวงตาชัดเจน',
    };
  }

  if (face.FaceOccluded?.Value === true && finite(face.FaceOccluded?.Confidence) >= 80) {
    return {
      ok: false,
      reason: 'face_occluded',
      message: 'ใบหน้าถูกบังบางส่วน กรุณาเอามือ หน้ากาก หรือผมที่ปิดหน้าออกแล้วถ่ายใหม่',
    };
  }

  return { ok: true };
}

function isInvalidSelfieError(error) {
  const name = error?.name || '';
  return name === 'InvalidParameterException'
    || name === 'InvalidImageFormatException'
    || name === 'ImageTooLargeException'
    || /invalid image|image format/i.test(error?.message || '');
}

/**
 * Checks whether required AWS credentials are present in environment.
 */
export function isAwsConfigured(env = process.env) {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const profile = env.AWS_PROFILE;
  return Boolean((accessKeyId && secretAccessKey) || profile);
}

/**
 * Retrieves secret names for Secret Manager if enabled.
 */
export function getAwsSecretNames(env = process.env) {
  return env.CAMPUSMATE_AWS_SECRETS_ENABLED === 'true'
    ? ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']
    : [];
}

/**
 * Returns summary of AWS Rekognition configuration.
 */
export function getAwsRekognitionConfig(env = process.env) {
  return {
    region: env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: env.AWS_LIVENESS_TEMP_BUCKET || '',
    profile: env.AWS_PROFILE || '',
    isConfigured: isAwsConfigured(env),
  };
}

/**
 * Initialize Rekognition client with given config or environment variables.
 */
export function getRekognitionClient(config = {}) {
  const env = config.env || process.env;
  const region = config.region || env.AWS_REGION || 'ap-southeast-2';
  const accessKeyId = config.accessKeyId || env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || env.AWS_SECRET_ACCESS_KEY;
  const profile = config.profile || env.AWS_PROFILE;

  if (accessKeyId && secretAccessKey) {
    return new RekognitionClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  if (profile) {
    return new RekognitionClient({
      region,
    });
  }

  return null;
}

/**
 * Create a new face verification session for an authenticated user.
 */
export async function createFaceVerificationSession({
  db,
  uid,
  rekognitionClient,
  bucketName = process.env.AWS_LIVENESS_TEMP_BUCKET,
  now = Date.now(),
} = {}) {
  if (!uid || typeof uid !== 'string') {
    throw new Error('กรุณาระบุรหัสผู้ใช้งานให้ถูกต้อง');
  }
  if (!db) {
    throw new Error('Database instance is required');
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new Error('ไม่พบข้อมูลผู้ใช้งาน');
  }

  const userData = userDoc.data() || {};
  const avatarUri = userData.avatarUri || userData.photoURL || userData.photos?.[0];
  if (!avatarUri || typeof avatarUri !== 'string') {
    throw new Error('ต้องตั้งรูปโปรไฟล์หลักก่อนทำการยืนยันใบหน้า');
  }

  let sessionId = null;
  if (rekognitionClient && typeof rekognitionClient.send === 'function') {
    try {
      const command = new CreateFaceLivenessSessionCommand({
        Settings: bucketName ? { OutputConfig: { S3Bucket: bucketName } } : undefined,
      });
      const response = await rekognitionClient.send(command);
      sessionId = response?.SessionId;
    } catch (err) {
      console.warn('[FaceVerification] AWS CreateFaceLivenessSessionCommand notice:', err?.message || err);
      // Fallback to cryptographic session if AWS Rekognition session creation fails or permissions differ
      sessionId = `session_${crypto.randomBytes(16).toString('hex')}`;
    }
  } else {
    sessionId = `session_${crypto.randomBytes(16).toString('hex')}`;
  }

  const sessionData = {
    sessionId,
    uid,
    avatarUri,
    status: 'PENDING',
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };

  await db.collection('faceVerificationSessions').doc(sessionId).set(sessionData);

  return { sessionId };
}

/**
 * Verify liveness & compare face with primary profile avatar.
 */
export async function verifyFaceMatch({
  db,
  uid,
  sessionId,
  liveSelfieBase64,
  rekognitionClient,
  fetchImpl = fetch,
  comparator,
  now = Date.now(),
} = {}) {
  if (!uid || typeof uid !== 'string') {
    throw new Error('กรุณาระบุรหัสผู้ใช้งานให้ถูกต้อง');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('กรุณาระบุรหัสเซสชันให้ถูกต้อง');
  }
  if (!db) {
    throw new Error('Database instance is required');
  }

  const sessionRef = db.collection('faceVerificationSessions').doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    return { success: false, reason: 'invalid_session', message: 'เซสชันการยืนยันไม่ถูกต้อง' };
  }

  const session = sessionSnap.data() || {};
  if (session.uid !== uid) {
    return { success: false, reason: 'session_forbidden', message: 'ไม่มีสิทธิ์เข้าถึงเซสชันนี้' };
  }
  if (session.status !== 'PENDING') {
    return { success: false, reason: 'session_already_used', message: 'เซสชันนี้ถูกใช้งานไปแล้ว' };
  }
  if (session.expiresAt && session.expiresAt < now) {
    return { success: false, reason: 'session_expired', message: 'เซสชันหมดอายุ กรุณาเริ่มใหม่อีกครั้ง' };
  }

  let referenceImageBytes = null;

  // Mode 1: Direct Live Selfie Base64 from guided in-app camera
  if (liveSelfieBase64 && typeof liveSelfieBase64 === 'string') {
    const cleanBase64 = liveSelfieBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '').replace(/\s/g, '');
    if (!cleanBase64 || cleanBase64.length > 8_000_000) {
      return {
        success: false,
        reason: 'invalid_selfie',
        message: 'รูปที่ถ่ายใช้ตรวจสอบไม่ได้ กรุณาถ่ายใหม่ให้เห็นใบหน้าชัดในที่สว่าง',
      };
    }
    referenceImageBytes = Buffer.from(cleanBase64, 'base64');
    if (!referenceImageBytes.length) {
      return {
        success: false,
        reason: 'invalid_selfie',
        message: 'รูปที่ถ่ายใช้ตรวจสอบไม่ได้ กรุณาถ่ายใหม่ให้เห็นใบหน้าชัดในที่สว่าง',
      };
    }

    if (rekognitionClient && typeof rekognitionClient.send === 'function') {
      try {
        const detectRes = await rekognitionClient.send(
          new DetectFacesCommand({
            Image: { Bytes: referenceImageBytes },
            Attributes: ['ALL'],
          })
        );
        const assessment = assessSelfieFaces(detectRes?.FaceDetails || []);
        if (!assessment.ok) {
          return { success: false, reason: assessment.reason, message: assessment.message };
        }
      } catch (detectErr) {
        if (isInvalidSelfieError(detectErr)) {
          return {
            success: false,
            reason: 'invalid_selfie',
            message: 'ใช้รูปนี้ตรวจสอบไม่ได้ กรุณาถ่ายใหม่ให้เห็นใบหน้าชัดในที่สว่าง',
          };
        }
        console.warn('[FaceVerification] DetectFaces skipped:', detectErr?.name || detectErr?.message || detectErr);
      }
    }
  } else if (rekognitionClient && typeof rekognitionClient.send === 'function') {
    // Mode 2: AWS Rekognition Liveness Session Result
    const livenessRes = await rekognitionClient.send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId })
    );

    const confidence = livenessRes?.Confidence ?? 0;
    const status = livenessRes?.Status;

    if (status !== 'SUCCEEDED' || confidence < MIN_LIVENESS_CONFIDENCE) {
      await sessionRef.update({
        status: 'FAILED',
        reason: 'liveness_failed',
        livenessConfidence: confidence,
        failedAt: now,
      });
      return {
        success: false,
        reason: 'liveness_failed',
        confidence,
        message: 'การตรวจจับใบหน้าจริงไม่ผ่าน กรุณาทำตามคำแนะนำในกรอบและลองใหม่อีกครั้ง',
      };
    }

    referenceImageBytes = livenessRes?.ReferenceImage?.Bytes;
  }

  if (!referenceImageBytes) {
    return {
      success: false,
      reason: 'missing_reference_image',
      message: 'ไม่พบภาพใบหน้าสำหรับการตรวจสอบ',
    };
  }

  // Fetch avatar image
  const avatarUrl = session.avatarUri;
  let avatarBytes = null;
  try {
    const avatarRes = await fetchImpl(avatarUrl);
    if (!avatarRes.ok) {
      throw new Error(`Failed to fetch avatar (${avatarRes.status})`);
    }
    avatarBytes = Buffer.from(await avatarRes.arrayBuffer());
  } catch (avatarErr) {
    return {
      success: false,
      reason: 'avatar_fetch_failed',
      message: 'ไม่สามารถโหลดรูปโปรไฟล์หลักเพื่อเปรียบเทียบได้ กรุณาตรวจสอบรูปโปรไฟล์',
    };
  }

  let similarity = 0;
  let isMatched = false;

  if (typeof comparator === 'function') {
    // Injected comparator for unit testing
    const compResult = await comparator(referenceImageBytes, avatarBytes);
    similarity = compResult.similarity ?? 0;
    isMatched = Boolean(compResult.matched);
  } else if (rekognitionClient && typeof rekognitionClient.send === 'function') {
    try {
      const compareRes = await rekognitionClient.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: referenceImageBytes },
          TargetImage: { Bytes: avatarBytes },
          SimilarityThreshold: 50,
          QualityFilter: 'AUTO',
        })
      );

      const match = compareRes?.FaceMatches?.[0];
      similarity = match?.Similarity ?? 0;
      isMatched = Boolean(match && similarity >= MIN_FACE_SIMILARITY);
    } catch (compareErr) {
      if (
        compareErr?.name === 'InvalidParameterException' ||
        compareErr?.message?.includes('no faces')
      ) {
        return {
          success: false,
          reason: 'avatar_no_face_detected',
          message: 'ไม่พบใบหน้าที่ชัดเจนในรูปโปรไฟล์หลัก กรุณาเปลี่ยนรูปโปรไฟล์หลักเป็นรูปที่เห็นใบหน้าตนเองชัดเจนก่อนยืนยัน',
        };
      }
      throw compareErr;
    }
  } else {
    return {
      success: false,
      reason: 'service_unavailable',
      message: 'ระบบเปรียบเทียบใบหน้ายังไม่พร้อมใช้งานในขณะนี้',
    };
  }

  const roundedSimilarity = Number(similarity.toFixed(2));

  if (isMatched) {
    await db.collection('users').doc(uid).update({
      isFaceVerified: true,
      faceVerifiedAt: now,
      faceMatchScore: roundedSimilarity,
      faceVerificationStatus: 'verified',
    });

    await sessionRef.update({
      status: 'COMPLETED',
      similarity: roundedSimilarity,
      completedAt: now,
    });

    return {
      success: true,
      status: 'verified',
      similarity: roundedSimilarity,
      message: `ยืนยันใบหน้าสำเร็จ ความตรงกัน ${roundedSimilarity}%`,
    };
  }

  await sessionRef.update({
    status: 'FAILED',
    reason: 'face_mismatch',
    similarity: roundedSimilarity,
    failedAt: now,
  });

  return {
    success: false,
    status: 'failed',
    reason: 'face_mismatch',
    similarity: roundedSimilarity,
    message: `ใบหน้าไม่ตรงกับรูปโปรไฟล์หลัก (คะแนนความคล้าย ${roundedSimilarity}% ต่ำกว่าเกณฑ์ที่กำหนด ${MIN_FACE_SIMILARITY}%)`,
  };
}
