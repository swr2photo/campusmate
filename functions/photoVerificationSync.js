// Mirrors the Rust liveness decision into the Firestore badge that the app,
// profile and discovery projections read. The Rust identity API decides; this
// only copies its owner-visible status, and only onto the exact photo it
// verified. Badges from the earlier selfie flow are never cleared here.
import { FACE_REVOCATION_PATCH } from './faceVerification.js';

const PHOTO_BADGE = 'PHOTO_VERIFIED';
export const LIVENESS_METHOD = 'liveness';
const MAX_TOKEN = 8192;
const MAX_STATUS_BYTES = 16384;

export class PhotoSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** `https://host` only: no credentials, path, query or fragment. */
export function identityOrigin(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** The caller's status from the identity API, read with their own token. */
export async function fetchIdentityStatus({ origin, idToken, fetchImpl = fetch, timeoutMs = 10000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/v1/identity/photo-verification`, {
      headers: { Authorization: `Bearer ${idToken}` },
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new PhotoSyncError('unauthenticated', 'กรุณาเข้าสู่ระบบใหม่');
    }
    if (!response.ok) throw new PhotoSyncError('unavailable', 'ระบบยืนยันใบหน้าไม่พร้อม');
    const text = await response.text();
    if (text.length > MAX_STATUS_BYTES) throw new PhotoSyncError('unavailable', 'ระบบยืนยันใบหน้าไม่พร้อม');
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof PhotoSyncError) throw error;
    throw new PhotoSyncError('unavailable', 'ระบบยืนยันใบหน้าไม่พร้อม');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param verifyIdToken  `(token, checkRevoked) => decoded` (firebase-admin)
 * @param readStatus     `(token) => status JSON` from the identity API
 */
export async function syncPhotoVerification({ db, uid, idToken, verifyIdToken, readStatus, now = new Date() }) {
  if (typeof idToken !== 'string' || !idToken || idToken.length > MAX_TOKEN) {
    throw new PhotoSyncError('invalid-argument', 'คำขอไม่ถูกต้อง');
  }
  // The token passed on to the identity API must be the caller's own and live.
  let decoded;
  try {
    decoded = await verifyIdToken(idToken, true);
  } catch {
    throw new PhotoSyncError('unauthenticated', 'กรุณาเข้าสู่ระบบใหม่');
  }
  if (decoded?.uid !== uid) throw new PhotoSyncError('permission-denied', 'ไม่มีสิทธิ์');

  const status = await readStatus(idToken);
  const photo = typeof status?.photo === 'string' && status.photo ? status.photo : null;
  const verified = status?.status === 'VERIFIED' && status?.badge === PHOTO_BADGE && photo !== null;
  const userRef = db.collection('users').doc(uid);
  const recordRef = db.collection('faceVerifications').doc(uid);

  return db.runTransaction(async (tx) => {
    const [user, record] = await Promise.all([tx.get(userRef), tx.get(recordRef)]);
    if (!user.exists) throw new PhotoSyncError('not-found', 'ไม่พบโปรไฟล์');
    const data = user.data() || {};
    const fromLiveness = record.exists && record.data()?.method === LIVENESS_METHOD;

    if (verified && data.avatarUri === photo) {
      if (data.isFaceVerified === true && fromLiveness && record.data()?.avatarUri === photo) {
        return { status: 'VERIFIED', badge: PHOTO_BADGE, changed: false };
      }
      tx.update(userRef, {
        isFaceVerified: true,
        faceVerifiedAt: now,
        faceMatchScore: null,
        faceVerificationStatus: 'verified',
      });
      tx.set(recordRef, { avatarUri: photo, method: LIVENESS_METHOD, verifiedAt: now });
      return { status: 'VERIFIED', badge: PHOTO_BADGE, changed: true };
    }

    // The server no longer vouches for this photo: withdraw a liveness badge.
    const reported = verified ? 'PHOTO_CHANGED' : (typeof status?.status === 'string' ? status.status : 'UNVERIFIED');
    if (fromLiveness) {
      if (data.isFaceVerified === true) tx.update(userRef, FACE_REVOCATION_PATCH);
      tx.delete(recordRef);
      return { status: reported, badge: null, changed: data.isFaceVerified === true };
    }
    // A badge from the earlier selfie flow is left to that flow.
    return { status: reported, badge: data.isFaceVerified === true ? PHOTO_BADGE : null, changed: false };
  });
}
