import crypto from 'node:crypto';
import {
  RekognitionClient,
  CompareFacesCommand,
  DetectFacesCommand,
} from '@aws-sdk/client-rekognition';

// Legacy selfie + CompareFaces policy. These values predate calibration and are
// kept only so behavior does not silently change; see
// docs/face-verification/README.md before tuning. Env overrides allow a
// reviewed policy change without a code release.
export const FACE_POLICY_VERSION = 'selfie-compare-v1-uncalibrated';
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

// Rekognition accepts at most 5 MB of image bytes per input.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 10_000;

// AWS recommends at most 5 failed attempts per 3 minutes, then a 30–60 minute
// cooldown. Session creation is capped as well so retries cannot amplify cost.
export const FAILURE_WINDOW_MS = 3 * 60 * 1000;
export const MAX_FAILURES_PER_WINDOW = 5;
export const COOLDOWN_MS = 30 * 60 * 1000;
export const SESSION_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SESSIONS_PER_WINDOW = 20;

export const AUTO_VERIFIED_EMAILS = ['6710210317@psu.ac.th'];

// The app's own profile photo hosts (R2 custom domain and its public r2.dev
// address) plus the storage and Google hosts used by older profiles.
const DEFAULT_AVATAR_HOSTS = [
  'images.getcampusmate.app',
  'pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'lh3.googleusercontent.com',
];

export class FaceVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Only an email the auth provider has verified may unlock the admin shortcut.
 * Profile documents are client-writable and must never be trusted for this.
 */
export function isAutoVerifiedEmail(email, emailVerified = false) {
  return emailVerified === true
    && typeof email === 'string'
    && AUTO_VERIFIED_EMAILS.includes(email.trim().toLowerCase());
}

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

/** JPEG and PNG are the only formats Rekognition accepts as image bytes. */
export function imageKind(bytes) {
  if (!bytes || bytes.length < 8) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

/**
 * Hosts the server may fetch a profile photo from. Anything else (internal
 * addresses, arbitrary sites, plain HTTP) is refused before any request.
 */
export function allowedAvatarHosts(env = process.env) {
  const configured = [
    env.FACE_AVATAR_ALLOWED_HOSTS,
    env.CLOUDFLARE_R2_CDN_DOMAIN, env.R2_CDN_DOMAIN, env.CLOUDFLARE_R2_PUBLIC_DOMAIN, env.R2_PUBLIC_DOMAIN,
  ].filter(Boolean).join(',');
  const hosts = configured.split(',')
    .map((value) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  return [...new Set([...hosts, ...DEFAULT_AVATAR_HOSTS])];
}

export function isAllowedAvatarUrl(value, hosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && !url.username && !url.password
    && (url.port === '' || url.port === '443')
    && hosts.includes(url.hostname.toLowerCase());
}

async function loadAvatarBytes(url, { fetchImpl, hosts }) {
  if (!isAllowedAvatarUrl(url, hosts)) return { error: 'avatar_untrusted_host' };
  let response;
  try {
    response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS) });
  } catch {
    return { error: 'avatar_fetch_failed' };
  }
  if (!response?.ok) return { error: 'avatar_fetch_failed' };
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return { error: 'avatar_unusable' };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return { error: 'avatar_unusable' };
  if (!imageKind(bytes)) return { error: 'avatar_unusable' };
  return { bytes };
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

function primaryAvatar(data = {}) {
  const candidates = [data.avatarUri, data.photoURL, Array.isArray(data.photos) ? data.photos[0] : null];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || null;
}

/**
 * A verification proves the person resembles the main photo that existed at
 * verification time. Replacing that photo voids the badge until re-verified.
 * Accounts verified manually by an admin (`autoVerifyFace`, server-only) are
 * managed through the admin console instead.
 */
export function shouldRevokeFaceVerification(before, after) {
  if (!before || !after || after.isFaceVerified !== true || after.autoVerifyFace === true) return false;
  return primaryAvatar(before) !== primaryAvatar(after)
    || (before.avatarRevision ?? null) !== (after.avatarRevision ?? null);
}

export const FACE_REVOCATION_PATCH = Object.freeze({
  isFaceVerified: false,
  faceVerifiedAt: null,
  faceMatchScore: null,
  faceVerificationStatus: 'unverified',
});

function throttleRef(db, uid) {
  return db.collection('faceVerificationThrottle').doc(uid);
}

function recent(list, now, windowMs) {
  return (Array.isArray(list) ? list : []).filter((at) => Number.isFinite(at) && now - at < windowMs);
}

async function recordFailure(db, uid, now) {
  const ref = throttleRef(db, uid);
  const current = (await ref.get()).data() || {};
  const failures = [...recent(current.failures, now, FAILURE_WINDOW_MS), now];
  const blocked = failures.length >= MAX_FAILURES_PER_WINDOW;
  await ref.set({
    ...current,
    failures: blocked ? [] : failures,
    blockedUntil: blocked ? now + COOLDOWN_MS : (current.blockedUntil || 0),
  });
}

/**
 * Create a single-use verification session for an authenticated user.
 * The session pins the main photo URL the selfie will be compared against.
 */
export async function createFaceVerificationSession({
  db,
  uid,
  authEmail = null,
  authEmailVerified = false,
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

  const throttle = throttleRef(db, uid);
  const limits = (await throttle.get()).data() || {};
  if ((limits.blockedUntil || 0) > now) {
    throw new FaceVerificationError('rate_limited', 'ลองยืนยันหลายครั้งเกินไป กรุณารอประมาณ 30 นาทีแล้วลองใหม่');
  }
  const sessions = recent(limits.sessions, now, SESSION_WINDOW_MS);
  if (sessions.length >= MAX_SESSIONS_PER_WINDOW) {
    throw new FaceVerificationError('rate_limited', 'เริ่มการยืนยันบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  }

  const userData = userDoc.data() || {};
  const isAutoUser = isAutoVerifiedEmail(authEmail, authEmailVerified) || userData.autoVerifyFace === true;
  const avatarUri = primaryAvatar(userData);
  if (!avatarUri && !isAutoUser) {
    throw new Error('ต้องตั้งรูปโปรไฟล์หลักก่อนทำการยืนยันใบหน้า');
  }

  const sessionId = `session_${crypto.randomBytes(16).toString('hex')}`;
  await db.collection('faceVerificationSessions').doc(sessionId).set({
    sessionId,
    uid,
    avatarUri: avatarUri || null,
    policyVersion: FACE_POLICY_VERSION,
    status: 'PENDING',
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  await throttle.set({ ...limits, sessions: [...sessions, now] });

  return { sessionId };
}

/**
 * Atomically moves a PENDING session owned by `uid` to PROCESSING so exactly
 * one request evaluates it. Every later call sees `session_already_used`.
 */
async function claimSession(db, sessionRef, uid, now) {
  const evaluate = (snapshot) => {
    if (!snapshot.exists) return { error: { reason: 'invalid_session', message: 'เซสชันการยืนยันไม่ถูกต้อง' } };
    const session = snapshot.data() || {};
    if (session.uid !== uid) return { error: { reason: 'session_forbidden', message: 'ไม่มีสิทธิ์เข้าถึงเซสชันนี้' } };
    if (session.status !== 'PENDING') return { error: { reason: 'session_already_used', message: 'เซสชันนี้ถูกใช้งานไปแล้ว กรุณาเริ่มใหม่อีกครั้ง' } };
    if (!session.expiresAt || session.expiresAt <= now) return { error: { reason: 'session_expired', message: 'เซสชันหมดอายุ กรุณาเริ่มใหม่อีกครั้ง' } };
    return { session };
  };
  return db.runTransaction(async (transaction) => {
    const result = evaluate(await transaction.get(sessionRef));
    if (result.session) transaction.update(sessionRef, { status: 'PROCESSING', claimedAt: now });
    return result;
  });
}

function failure(reason, message) {
  return { success: false, status: 'failed', reason, message };
}

const AVATAR_MESSAGES = {
  avatar_untrusted_host: 'รูปโปรไฟล์หลักต้องอัปโหลดผ่านแอป CampusMate ก่อนยืนยันใบหน้า',
  avatar_fetch_failed: 'ไม่สามารถโหลดรูปโปรไฟล์หลักเพื่อเปรียบเทียบได้ กรุณาตรวจสอบรูปโปรไฟล์',
  avatar_unusable: 'รูปโปรไฟล์หลักใช้เปรียบเทียบไม่ได้ กรุณาอัปโหลดรูป JPEG หรือ PNG ใหม่',
};

/**
 * Compare a live selfie with the pinned main photo and decide on the server.
 * Responses never carry similarity scores; the badge is the only outcome.
 */
export async function verifyFaceMatch({
  db,
  uid,
  sessionId,
  liveSelfieBase64,
  rekognitionClient,
  fetchImpl = fetch,
  comparator,
  authEmail = null,
  authEmailVerified = false,
  avatarHosts = allowedAvatarHosts(),
  minSimilarity = MIN_FACE_SIMILARITY,
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
  const claim = await claimSession(db, sessionRef, uid, now);
  if (claim.error) return failure(claim.error.reason, claim.error.message);
  const { session } = claim;

  const userRef = db.collection('users').doc(uid);
  const finish = async (status, reason) => {
    await sessionRef.update({ status, ...(reason ? { reason } : {}), finishedAt: now });
  };
  const markVerified = async (method) => {
    await userRef.update({
      isFaceVerified: true,
      faceVerifiedAt: now,
      faceMatchScore: null,
      faceVerificationStatus: 'verified',
    });
    await db.collection('faceVerifications').doc(uid).set({
      avatarUri: session.avatarUri || null,
      sessionId,
      method,
      policyVersion: session.policyVersion || FACE_POLICY_VERSION,
      verifiedAt: now,
    });
    await finish('COMPLETED');
  };

  // Admin shortcut: only an auth-provider-verified email or a server-only
  // admin flag. Neither can be set from the client profile document.
  const userData = (await userRef.get()).data() || {};
  if (isAutoVerifiedEmail(authEmail, authEmailVerified) || userData.autoVerifyFace === true) {
    await markVerified('admin');
    return { success: true, status: 'verified', message: 'ยืนยันใบหน้าเรียบร้อยแล้ว' };
  }

  const rejectInput = async (reason, message) => {
    await finish('FAILED', reason);
    return failure(reason, message);
  };

  if (!liveSelfieBase64 || typeof liveSelfieBase64 !== 'string') {
    return rejectInput('invalid_selfie', 'ไม่พบภาพใบหน้าสำหรับการตรวจสอบ กรุณาถ่ายใหม่');
  }
  const cleanBase64 = liveSelfieBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '').replace(/\s/g, '');
  const selfieBytes = cleanBase64.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ? Buffer.from(cleanBase64, 'base64') : null;
  if (!selfieBytes?.length || selfieBytes.length > MAX_IMAGE_BYTES || !imageKind(selfieBytes)) {
    return rejectInput('invalid_selfie', 'รูปที่ถ่ายใช้ตรวจสอบไม่ได้ กรุณาถ่ายใหม่ให้เห็นใบหน้าชัดในที่สว่าง');
  }

  const hasClient = rekognitionClient && typeof rekognitionClient.send === 'function';
  if (hasClient) {
    try {
      const detected = await rekognitionClient.send(new DetectFacesCommand({
        Image: { Bytes: selfieBytes },
        Attributes: ['ALL'],
      }));
      const assessment = assessSelfieFaces(detected?.FaceDetails || []);
      if (!assessment.ok) return rejectInput(assessment.reason, assessment.message);
    } catch (detectErr) {
      if (isInvalidSelfieError(detectErr)) {
        return rejectInput('invalid_selfie', 'ใช้รูปนี้ตรวจสอบไม่ได้ กรุณาถ่ายใหม่ให้เห็นใบหน้าชัดในที่สว่าง');
      }
      await finish('FAILED', 'service_error');
      throw detectErr;
    }
  } else if (typeof comparator !== 'function') {
    return rejectInput('service_unavailable', 'ระบบเปรียบเทียบใบหน้ายังไม่พร้อมใช้งานในขณะนี้');
  }

  const avatar = await loadAvatarBytes(session.avatarUri, { fetchImpl, hosts: avatarHosts });
  if (avatar.error) return rejectInput(avatar.error, AVATAR_MESSAGES[avatar.error]);

  let matched = false;
  try {
    if (typeof comparator === 'function') {
      const result = await comparator(selfieBytes, avatar.bytes);
      matched = Boolean(result?.matched) && Number(result?.similarity) >= minSimilarity;
    } else {
      const compared = await rekognitionClient.send(new CompareFacesCommand({
        SourceImage: { Bytes: selfieBytes },
        TargetImage: { Bytes: avatar.bytes },
        SimilarityThreshold: minSimilarity,
        QualityFilter: 'AUTO',
      }));
      const best = Math.max(0, ...(compared?.FaceMatches || []).map((match) => Number(match?.Similarity) || 0));
      matched = best >= minSimilarity;
    }
  } catch (compareErr) {
    if (compareErr?.name === 'InvalidParameterException' || /no faces/i.test(compareErr?.message || '')) {
      return rejectInput(
        'avatar_no_face_detected',
        'ไม่พบใบหน้าที่ชัดเจนในรูปโปรไฟล์หลัก กรุณาเปลี่ยนรูปโปรไฟล์หลักเป็นรูปที่เห็นใบหน้าตนเองชัดเจนก่อนยืนยัน',
      );
    }
    await finish('FAILED', 'service_error');
    throw compareErr;
  }

  if (matched) {
    await markVerified('selfie_compare');
    return { success: true, status: 'verified', message: 'ยืนยันใบหน้าสำเร็จ' };
  }

  await finish('FAILED', 'face_mismatch');
  await recordFailure(db, uid, now);
  return failure('face_mismatch', 'ใบหน้าไม่ตรงกับรูปโปรไฟล์หลัก กรุณาถ่ายใหม่ในที่สว่างและหันหน้าตรง');
}
