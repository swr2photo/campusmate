import { randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export const MAX_GALLERY_IMAGE_BYTES = 5 * 1024 * 1024;

export function profileGalleryPrefix(userId) {
  return `profile_gallery/${encodeURIComponent(userId)}/`;
}

// Dependencies are injected so authentication, moderation and storage writes
// can be tested without making live requests.
export function createProfileGalleryUploader({ getBucket, moderate, makeId = randomUUID }) {
  return async (request) => {
    const userId = request.auth?.uid;
    if (!userId) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อนอัปโหลดรูปภาพ');
    const base64 = request.data?.imageBase64;
    if (typeof base64 !== 'string' || !base64.length
      || base64.length > 4 * Math.ceil(MAX_GALLERY_IMAGE_BYTES / 3)
      || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new HttpsError('invalid-argument', 'ข้อมูลรูปภาพไม่ถูกต้องหรือมีขนาดเกิน 5 MB');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_GALLERY_IMAGE_BYTES || bytes.length < 3
      || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new HttpsError('invalid-argument', 'รองรับเฉพาะรูป JPEG ขนาดไม่เกิน 5 MB');
    }

    let result;
    try {
      result = await moderate(base64);
    } catch {
      throw new HttpsError('unavailable', 'ยังตรวจสอบภาพไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง', { moderationStatus: 'unavailable' });
    }
    if (result?.status === 'blocked' && result.isSafe === false) {
      throw new HttpsError('failed-precondition', result.message || 'ภาพนี้ยังไม่ผ่านเกณฑ์การใช้งาน', {
        moderationStatus: 'blocked', reason: result.reason,
      });
    }
    if (result?.status !== 'allowed' || result.isSafe !== true || result.policyVersion !== 2) {
      throw new HttpsError('unavailable', 'ยังตรวจสอบภาพไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง', { moderationStatus: 'unavailable' });
    }

    const bucket = getBucket();
    const key = `${profileGalleryPrefix(userId)}${makeId()}.jpg`;
    const token = randomUUID();
    await bucket.file(key).save(bytes, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public,max-age=31536000,immutable',
        metadata: { firebaseStorageDownloadTokens: token, uploadedBy: userId },
      },
    });
    return {
      userId,
      url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(key)}?alt=media&token=${token}`,
    };
  };
}
