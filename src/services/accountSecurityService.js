import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { requireAuth } from './authService';
import { getCallable } from './callableClient';
import { RUST_BACKEND, rpc, rustClient } from './rust/backend';

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
  if (RUST_BACKEND) {
    try {
      await rpc('verifyPassword', { password });
      return true;
    } catch (error) {
      const code = String(error?.code || '');
      if (code.includes('permission-denied')) throw new Error('รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบรหัสผ่านที่คุณตั้งไว้');
      if (code.includes('resource-exhausted')) throw new Error('มีการพยายามยืนยันรหัสผ่านบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
      throw new Error(error?.message || 'ยืนยันรหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  const auth = requireAuth();
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('ไม่พบข้อมูลผู้ใช้ที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
  }

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
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
  if (RUST_BACKEND) {
    const result = await rpc('sendAccountDeletionOtp');
    if (result?.sent !== true) throw new Error('ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    return { success: true, email: maskEmail(result?.email || rustClient().user?.email || '') };
  }
  const currentUser = requireAuth().currentUser;
  if (!currentUser?.email) throw new Error('ไม่พบข้อมูลผู้ใช้ที่เข้าสู่ระบบ');
  // A local document is not proof of an email handoff. Codes are server-only.
  const result = await getCallable('sendAccountDeletionOtp')({});
  if (result?.data?.sent !== true) throw new Error('ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  return { success: true, email: maskEmail(result.data.email || currentUser.email) };
}

export async function verifyDeletionOtp(inputCode) {
  const code = String(inputCode || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
  if (RUST_BACKEND) {
    const result = await rpc('verifyAccountDeletionOtp', { code });
    if (result?.verified !== true) throw new Error('ตรวจสอบรหัสยืนยันไม่สำเร็จ กรุณาขอรหัสใหม่');
    return true;
  }
  if (!requireAuth().currentUser) throw new Error('ไม่พบข้อมูลผู้ใช้');
  const result = await getCallable('verifyAccountDeletionOtp')({ code });
  if (result?.data?.verified !== true) throw new Error('ตรวจสอบรหัสยืนยันไม่สำเร็จ กรุณาขอรหัสใหม่');
  return true;
}
