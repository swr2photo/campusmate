import * as FileSystem from 'expo-file-system/legacy';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { RUST_BACKEND } from './rust/backend';
import { uploadRawImage } from './rust/media';

const MAX_GALLERY_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STARTED_UPLOADS = 24;
// Uploads started as soon as a photo is chosen, by owner and local file, so
// saving or verifying reuses the finished upload instead of sending it again.
const startedUploads = new Map();

/**
 * Start uploading a local photo now; resolves its moderated URL. Returns null
 * for photos that are already remote. Transient failures are forgotten so
 * the next attempt retries; a moderation block is kept, as it will not change.
 */
export function prefetchGalleryImage(uri, userId) {
  if (typeof uri !== 'string' || !userId || /^https:\/\//i.test(uri)) return null;
  const key = `${userId}\n${uri}`;
  let upload = startedUploads.get(key);
  if (!upload) {
    upload = uploadNow(uri, userId);
    startedUploads.set(key, upload);
    upload.catch((error) => {
      if (!error?.isModerationViolation && startedUploads.get(key) === upload) startedUploads.delete(key);
    });
    if (startedUploads.size > MAX_STARTED_UPLOADS) startedUploads.delete(startedUploads.keys().next().value);
  }
  return upload;
}

export function uploadGalleryImage(uri, userId) {
  return prefetchGalleryImage(uri, userId) ?? uploadNow(uri, userId);
}

async function uploadNow(uri, userId) {
  if (typeof uri !== 'string' || !userId) throw new Error('ไฟล์รูปภาพไม่ถูกต้อง');
  if (RUST_BACKEND) {
    const data = await uploadRawImage('gallery', uri);
    if (data?.userId !== userId || typeof data?.url !== 'string' || !data.url.startsWith('https://')) {
      throw new Error('เซิร์ฟเวอร์ส่งข้อมูลรูปภาพที่ไม่ตรงกับบัญชีปัจจุบัน');
    }
    return data.url;
  }
  const imageBase64 = uri.startsWith('data:image/jpeg;base64,')
    ? uri.slice('data:image/jpeg;base64,'.length)
    : await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  if (!imageBase64 || imageBase64.length > 4 * Math.ceil(MAX_GALLERY_IMAGE_BYTES / 3)) {
    throw new Error('รูปภาพมีขนาดใหญ่เกินไป (ต้องไม่เกิน 5 MB หลังการประมวลผล)');
  }
  const { app } = requireFirebase();
  const upload = httpsCallable(getFunctions(app, 'asia-southeast1'), 'uploadProfileGalleryImage', { timeout: 60000 });
  try {
    const { data } = await upload({ imageBase64 });
    if (data?.userId !== userId || typeof data?.url !== 'string' || !data.url.startsWith('https://')) {
      throw new Error('เซิร์ฟเวอร์ส่งข้อมูลรูปภาพที่ไม่ตรงกับบัญชีปัจจุบัน');
    }
    return data.url;
  } catch (error) {
    if (error?.details?.moderationStatus === 'blocked') {
      error.isModerationViolation = true;
      error.reason = error.details.reason;
    } else if (error?.details?.moderationStatus === 'unavailable') {
      error.isModerationUnavailable = true;
    }
    throw error;
  }
}
