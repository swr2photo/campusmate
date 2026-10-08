import * as FileSystem from 'expo-file-system/legacy';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';

const MAX_GALLERY_IMAGE_BYTES = 5 * 1024 * 1024;

export async function uploadGalleryImage(uri, userId) {
  if (typeof uri !== 'string' || !userId) throw new Error('ไฟล์รูปภาพไม่ถูกต้อง');
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
