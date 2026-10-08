export const CAMPUS_EMAIL_DOMAIN = 'psu.ac.th';
export const LEGACY_GMAIL_DOMAIN = 'gmail.com';
export const CAMPUS_EMAIL_PLACEHOLDER = 'name@psu.ac.th';
export const CAMPUS_LOGIN_HINT =
  'สมัครใหม่ใช้ @psu.ac.th เท่านั้น บัญชี Gmail เดิมยังเข้าได้ แต่ต้องยืนยันอีเมลมหาวิทยาลัยก่อนใช้งาน';
export const CAMPUS_SIGNUP_HINT = 'ใช้ได้เฉพาะอีเมล @psu.ac.th ของมหาวิทยาลัยสงขลานครินทร์';
export const CAMPUS_SIGNUP_REQUIRED_MESSAGE = 'CampusMate รับสมัครเฉพาะอีเมล @psu.ac.th';
export const CAMPUS_EMAIL_ALREADY_USED_MESSAGE =
  'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมล @psu.ac.th ของคุณ';
export const CAMPUS_STUDENT_ID_REQUIRED_MESSAGE =
  'อีเมลมหาวิทยาลัยต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th';
export const CAMPUS_EMAIL_NOT_IN_WORKSPACE_MESSAGE =
  'ไม่พบอีเมลนี้ในระบบ Google Workspace ของมหาวิทยาลัย กรุณาตรวจสอบอีเมลอีกครั้ง';
export const CAMPUS_EMAIL_CHECK_UNAVAILABLE_MESSAGE =
  'ระบบตรวจสอบอีเมลมหาวิทยาลัยยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง';
export const CAMPUS_LOGIN_ALLOWED_MESSAGE =
  'เข้าสู่ระบบได้เฉพาะอีเมล @psu.ac.th หรือบัญชี Gmail เดิมที่สมัครไว้แล้ว';
export const CAMPUS_EMAIL_SENDER = 'noreply@getcampusmate.app';
export const CAMPUS_EMAIL_INBOX_HINT =
  'ระบบส่งจากโดเมน getcampusmate.app ในชื่อ CampusMate หากไม่เห็นใน Inbox '
  + 'ให้เปิด Junk ของ Outlook แล้วกด Not junk / รายงานว่าไม่ใช่สแปม '
  + 'เพื่อให้เมลถัดไปเข้ากล่องเข้า';

const CAMPUS_EMAIL_PATTERN = /^[a-z0-9._%+\-]+@psu\.ac\.th$/i;
const CAMPUS_STUDENT_EMAIL_PATTERN = /^\d{10}@psu\.ac\.th$/i;
const GMAIL_EMAIL_PATTERN = /^[a-z0-9._%+\-]+@(gmail\.com|googlemail\.com)$/i;
const NEW_USER_WINDOW_MS = 20000;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isCampusEmail(email) {
  return CAMPUS_EMAIL_PATTERN.test(normalizeEmail(email));
}

export function isCampusStudentEmail(email) {
  return CAMPUS_STUDENT_EMAIL_PATTERN.test(normalizeEmail(email));
}

export function isLegacyGmailEmail(email) {
  return GMAIL_EMAIL_PATTERN.test(normalizeEmail(email));
}

export function isLoginEmailAllowed(email) {
  return isCampusEmail(email) || isLegacyGmailEmail(email);
}

export function campusEmailError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function assertCampusEmail(email) {
  if (!isCampusEmail(email)) {
    throw campusEmailError('auth/campus-email-required', CAMPUS_SIGNUP_REQUIRED_MESSAGE);
  }
  if (!isCampusStudentEmail(email)) {
    throw campusEmailError('auth/student-id-required', CAMPUS_STUDENT_ID_REQUIRED_MESSAGE);
  }
  return normalizeEmail(email);
}

export function assertLoginEmailAllowed(email) {
  if (!isLoginEmailAllowed(email)) {
    throw campusEmailError('auth/campus-email-login-only', CAMPUS_LOGIN_ALLOWED_MESSAGE);
  }
  return normalizeEmail(email);
}

export function isLikelyNewFirebaseUser(user) {
  const created = Date.parse(user?.creationTime || '');
  const lastSignIn = Date.parse(user?.lastSignInTime || '');
  if (!Number.isFinite(created) || !Number.isFinite(lastSignIn)) return false;
  return Math.abs(lastSignIn - created) < NEW_USER_WINDOW_MS;
}

export function hasVerifiedCampusEmail(profile) {
  return profile?.campusEmailVerified === true
    && isCampusEmail(profile?.campusEmail || profile?.email);
}

export function isBlockedCampusAccount(user) {
  if (!user || isCampusEmail(user.email)) return false;
  return isLikelyNewFirebaseUser(user);
}

export function needsCampusEmailMigration(user, profile) {
  if (!user || !profile) return false;
  if (isCampusEmail(user.email)) return false;
  if (isLikelyNewFirebaseUser(user)) return false;
  return true;
}

export function getLoggedInRoute(user, profile) {
  if (!user) return '/';
  if (isBlockedCampusAccount(user, profile) || !profile) return null;
  if (needsCampusEmailMigration(user, profile)) return '/verify-campus-email';
  if (profile.isNewUser) return '/setup';
  return '/home';
}

export function getPasswordResetSentMessage(email) {
  const normalized = normalizeEmail(email);
  return `ถ้ามีบัญชี CampusMate ที่ใช้อีเมล ${normalized} ระบบจะส่งลิงก์จาก ${CAMPUS_EMAIL_SENDER} `
    + 'ให้ตั้งรหัสผ่านใหม่หรือแจ้งวิธีเข้าสู่ระบบ '
    + CAMPUS_EMAIL_INBOX_HINT;
}

export function getPasswordResetErrorMessage(error) {
  const code = String(error?.code || '').replace(/^functions\//, '');
  if (code === 'auth/campus-email-required' || code === 'auth/campus-email-login-only') {
    return CAMPUS_LOGIN_ALLOWED_MESSAGE;
  }
  if (code === 'auth/invalid-email' || code === 'invalid-argument') {
    return 'รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบ เช่น name@psu.ac.th';
  }
  if (code === 'auth/too-many-requests' || code === 'resource-exhausted') {
    return 'คุณส่งคำขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอประมาณ 1 นาทีแล้วลองใหม่';
  }
  if (code === 'auth/network-request-failed') {
    return 'ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ กรุณาตรวจสอบสัญญาณเน็ตแล้วลองใหม่อีกครั้ง';
  }
  if (code === 'unavailable' || code === 'failed-precondition' || code === 'internal' || code === 'unauthenticated') {
    return 'ส่งอีเมลตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่ในอีกสักครู่';
  }
  return getCampusEmailErrorMessage(error);
}

export function getCampusEmailErrorMessage(error) {
  const code = String(error?.code || '').replace(/^functions\//, '');
  if (code === 'auth/campus-email-required') return CAMPUS_SIGNUP_REQUIRED_MESSAGE;
  if (code === 'auth/student-id-required') return CAMPUS_STUDENT_ID_REQUIRED_MESSAGE;
  if (code === 'auth/campus-email-login-only') return CAMPUS_LOGIN_ALLOWED_MESSAGE;
  if (code === 'auth/email-already-in-use' || code === 'already-exists') {
    return CAMPUS_EMAIL_ALREADY_USED_MESSAGE;
  }
  if (code === 'auth/campus-email-not-found' || code === 'not-found') {
    return CAMPUS_EMAIL_NOT_IN_WORKSPACE_MESSAGE;
  }
  if (code === 'auth/campus-email-check-unavailable') {
    return CAMPUS_EMAIL_CHECK_UNAVAILABLE_MESSAGE;
  }
  if (code === 'auth/requires-recent-login' || code === 'unauthenticated') {
    return 'กรุณาออกจากระบบแล้วเข้าสู่ระบบอีกครั้ง แล้วค่อยยืนยันอีเมลใหม่';
  }
  if (code === 'auth/operation-not-allowed' || code === 'auth/operation-not-supported-in-this-environment') {
    return 'ยังเปลี่ยนอีเมลบัญชีนี้ไม่ได้ในตอนนี้ กรุณาออกจากระบบแล้วเข้าใหม่อีกครั้ง';
  }
  if (code === 'auth/invalid-email' || code === 'invalid-argument') return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (code === 'auth/too-many-requests' || code === 'resource-exhausted') {
    return 'ส่งอีเมลยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
  }
  if (code === 'unavailable' || code === 'failed-precondition') {
    return error?.message || 'ส่งอีเมลจากโดเมน getcampusmate.app ไม่สำเร็จ กรุณาลองใหม่';
  }
  return null;
}
