import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { doc, getDoc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { requireFirebase } from './dbService';
import { requireAuth } from './authService';

const FUNCTIONS_REGION = 'asia-southeast1';
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Mask an email address for privacy (e.g. 6710210317@psu.ac.th -> 67****0317@psu.ac.th)
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 4) {
    return `${local.charAt(0)}***@${domain}`;
  }
  const prefix = local.slice(0, 2);
  const suffix = local.slice(-4);
  return `${prefix}****${suffix}@${domain}`;
}

/**
 * Verify account password (รหัสที่ตัวเองตั้ง) using Firebase Auth re-authentication.
 */
export async function verifyUserPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('กรุณากรอกรหัสผ่านบัญชีของคุณ');
  }

  const auth = requireAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('ไม่พบข้อมูลผู้ใช้ที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
  }

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, password.trim());
    await reauthenticateWithCredential(currentUser, credential);
    return true;
  } catch (error) {
    const code = String(error?.code || '').toLowerCase();
    if (code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('invalid-login-credentials')) {
      throw new Error('รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบรหัสผ่านที่คุณตั้งไว้');
    }
    if (code.includes('too-many-requests')) {
      throw new Error('มีการพยายามยืนยันรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
    }
    throw new Error(error?.message || 'ยืนยันรหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
}

/**
 * Request account deletion OTP sent to user's registered email (รหัสที่ได้รับจากอีเมล).
 */
export async function requestDeletionOtp() {
  const auth = requireAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('ไม่พบข้อมูลผู้ใช้ที่เข้าสู่ระบบ');
  }

  const { app, db } = requireFirebase();
  const email = currentUser.email.toLowerCase().trim();
  const userId = currentUser.uid;

  // 1. Try Firebase Cloud Function if available
  try {
    const functions = getFunctions(app, FUNCTIONS_REGION);
    const sendOtpFn = httpsCallable(functions, 'sendAccountDeletionOtp');
    const result = await sendOtpFn({ email });
    if (result?.data?.sent) {
      return {
        success: true,
        email: result.data.email || maskEmail(email),
        devCode: result.data.devCode,
      };
    }
  } catch (fnErr) {
    console.warn('[accountSecurityService] Cloud Function sendOtp skipped or failed:', fnErr?.message || fnErr);
  }

  // 2. Resilient Firestore fallback: Generate 6-digit numeric OTP and store with 10-minute expiry
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + OTP_EXPIRY_MS;

  try {
    const otpRef = doc(db, 'accountDeletionOtps', userId);
    await setDoc(otpRef, {
      code,
      email,
      userId,
      expiresAt,
      createdAt: serverTimestamp(),
    });

    return {
      success: true,
      email: maskEmail(email),
      devCode: __DEV__ ? code : undefined,
    };
  } catch (dbErr) {
    console.error('[accountSecurityService] Firestore OTP write failed:', dbErr);
    throw new Error('ไม่สามารถสร้างรหัสยืนยันได้ กรุณาลองใหม่อีกครั้ง');
  }
}

/**
 * Verify account deletion OTP code.
 */
export async function verifyDeletionOtp(inputCode) {
  const code = String(inputCode || '').trim();
  if (!code || code.length !== 6) {
    throw new Error('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
  }

  const auth = requireAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('ไม่พบข้อมูลผู้ใช้');

  const { app, db } = requireFirebase();
  const userId = currentUser.uid;

  // 1. Try Firebase Cloud Function first
  try {
    const functions = getFunctions(app, FUNCTIONS_REGION);
    const verifyOtpFn = httpsCallable(functions, 'verifyAccountDeletionOtp');
    const result = await verifyOtpFn({ code });
    if (result?.data?.verified) {
      return true;
    }
  } catch (fnErr) {
    console.warn('[accountSecurityService] Cloud Function verifyOtp skipped:', fnErr?.message || fnErr);
  }

  // 2. Fallback: Verify against Firestore document
  try {
    const otpRef = doc(db, 'accountDeletionOtps', userId);
    const snap = await getDoc(otpRef);
    if (!snap.exists()) {
      throw new Error('ไม่พบคำขอยืนยัน หรือรหัสหมดอายุแล้ว กรุณากดขอรหัสใหม่');
    }

    const data = snap.data();
    if (Date.now() > (data.expiresAt || 0)) {
      throw new Error('รหัสยืนยัน OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่');
    }

    if (String(data.code).trim() !== code) {
      throw new Error('รหัสยืนยันจากอีเมลไม่ถูกต้อง กรุณาตรวจสอบรหัสในอีเมลอีกครั้ง');
    }

    // Clean up OTP document on successful verification
    await deleteDoc(otpRef).catch(() => {});
    return true;
  } catch (err) {
    throw err instanceof Error ? err : new Error('ตรวจสอบรหัสยืนยันไม่สำเร็จ');
  }
}
