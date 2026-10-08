import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';

export const FUNCTIONS_REGION = 'asia-southeast1';

function errorCode(error) {
  return String(error?.code || '');
}

function isRetryableCallableError(error) {
  const code = errorCode(error);
  const message = String(error?.message || '');
  if (code.includes('deadline-exceeded') || code.includes('internal') || code.includes('resource-exhausted')) {
    return false;
  }
  return code.includes('unavailable')
    || code.includes('aborted')
    || /network request failed|failed to fetch|network error/i.test(message);
}

export function callableErrorMessage(error, fallback = 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง') {
  const code = errorCode(error);
  if (code.includes('unauthenticated')) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (code.includes('resource-exhausted')) return 'มีการใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('aborted')) {
    return 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง';
  }
  const message = String(error?.message || '').trim();
  if (message && !message.startsWith('Firebase:') && !/functions\//.test(message)) return message;
  return fallback;
}

/**
 * Calls a regional Cloud Function with one shared timeout and a single retry
 * for transport failures. Mutations that may have reached the server should
 * pass retries: 0.
 */
export async function callFunction(name, data, { timeout = 30000, retries = 0, fallback } = {}) {
  const { app } = requireFirebase();
  const callable = httpsCallable(getFunctions(app, FUNCTIONS_REGION), name, { timeout });
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await callable(data);
      return response?.data;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableCallableError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  const error = new Error(callableErrorMessage(lastError, fallback));
  error.code = lastError?.code;
  error.cause = lastError;
  throw error;
}
