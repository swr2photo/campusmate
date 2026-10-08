import * as ImageManipulator from 'expo-image-manipulator';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';

async function resolveUriIfNeeded(uri) {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('ph://')) return uri;
  try {
    const FileSystem = require('expo-file-system/legacy');
    const destPath = `${FileSystem.cacheDirectory}mod_ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: destPath });
    return destPath;
  } catch (err) {
    console.warn('[ImageModeration] Failed to copy ph:// asset:', err?.message || err);
    return uri;
  }
}

/**
 * Creates a high-fidelity base64 thumbnail for Cloud Vision moderation checks.
 * Uses 480px dimension and 0.72 JPEG compression for fast transfer and high accuracy.
 */
export async function getModerationBase64(localUri) {
  if (!localUri) return null;

  try {
    const resolvedUri = await resolveUriIfNeeded(localUri);
    const manipulated = await ImageManipulator.manipulateAsync(
      resolvedUri,
      [{ resize: { width: 480 } }],
      {
        compress: 0.72,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );

    return manipulated.base64 || null;
  } catch (err) {
    console.warn('[ImageModeration] Failed to create thumbnail for moderation:', err);
    return null;
  }
}

/** Verify before uploading. Service failures are retryable, never violations. */
export async function verifyImageSafety(localUri) {
  try {
    const base64 = await getModerationBase64(localUri);
    if (!base64) throw new Error('Image preparation failed');
    const { app } = requireFirebase();
    const check = httpsCallable(getFunctions(app, 'asia-southeast1'), 'checkImageSafety', { timeout: 30000 });
    const { data } = await check({ imageBase64: base64 });
    if (data?.status === 'blocked' && data?.isSafe === false && data?.policyVersion === 2) {
      const error = new Error(data.message || 'ภาพนี้ยังไม่ผ่านเกณฑ์การใช้งาน');
      error.isModerationViolation = true;
      error.reason = data.reason;
      throw error;
    }
    if (data?.status !== 'allowed' || data?.isSafe !== true || data?.policyVersion !== 2) {
      throw new Error('Image verification unavailable');
    }
    return true;
  } catch (cause) {
    if (cause.isModerationViolation) throw cause;
    const error = new Error('ยังตรวจสอบภาพไม่ได้ในขณะนี้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง');
    error.isModerationUnavailable = true;
    throw error;
  }
}
