import * as ImageManipulator from 'expo-image-manipulator';
import { callFunction } from './callableClient';

const MAX_SELFIE_CHARS = 1_400_000;

async function renderSelfie(uri, width, compress) {
  return ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width } }],
    {
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    },
  );
}

/**
 * Prepares a captured selfie for Rekognition.
 * The first pass keeps enough detail for a face match. A second pass only
 * runs when the JPEG would make the callable payload slow or fragile.
 */
export async function prepareSelfieForVerification(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('ไม่พบรูปภาพใบหน้าที่ถ่ายสด');
  }

  let image = await renderSelfie(uri, 960, 0.84);
  if (image?.base64 && image.base64.length > MAX_SELFIE_CHARS && image.uri) {
    image = await renderSelfie(image.uri, 720, 0.62);
  }

  if (!image?.base64) {
    throw new Error('ไม่สามารถประมวลผลข้อมูลภาพถ่ายได้');
  }

  return image.base64;
}

/**
 * Initiates a face verification session on the backend.
 * Retried once because creating a session has no side effect until a selfie is submitted.
 */
export async function startFaceVerificationSession() {
  const data = await callFunction('startFaceVerificationSession', {}, {
    timeout: 25000,
    retries: 1,
    fallback: 'ไม่สามารถสร้างเซสชันการยืนยันใบหน้าได้',
  });
  const sessionId = data?.sessionId;

  if (!sessionId) {
    throw new Error('ไม่สามารถสร้างเซสชันการยืนยันใบหน้าได้');
  }

  return sessionId;
}

/**
 * Submits a live selfie and session for quality checks and a profile-photo match.
 * Not retried: the server may already have finished after a slow response.
 */
export async function submitFaceVerification({ sessionId, selfieUri }) {
  if (!sessionId) {
    throw new Error('กรุณาระบุรหัสเซสชัน');
  }

  const selfieBase64 = await prepareSelfieForVerification(selfieUri);
  try {
    const data = await callFunction('completeFaceVerification', {
      sessionId,
      liveSelfieBase64: selfieBase64,
    }, {
      timeout: 70000,
      retries: 0,
      fallback: 'เกิดข้อผิดพลาดในการตรวจสอบ กรุณาลองใหม่อีกครั้ง',
    });
    return data || { success: false, message: 'ไม่ได้รับข้อมูลผลการตรวจสอบ' };
  } catch (error) {
    if (String(error?.code || '').includes('deadline-exceeded')) {
      throw new Error('ระบบใช้เวลานานกว่าปกติ หากโปรไฟล์ขึ้นว่ายืนยันแล้ว ไม่ต้องถ่ายซ้ำ');
    }
    throw error;
  }
}
