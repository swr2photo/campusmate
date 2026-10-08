export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const PASSWORD_REQUIREMENTS_MESSAGE =
  'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร ประกอบด้วยพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ ไม่มีช่องว่าง ไม่ซ้ำรหัสเดิม และไม่ใช้ส่วนหนึ่งของอีเมล';
export const PASSWORD_MISMATCH_MESSAGE = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
export const PASSWORD_REUSED_MESSAGE = 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม';
export const PASSWORD_RULES_HINT =
  'ต้องมีพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ ห้ามมีช่องว่าง ห้ามใช้รหัสเดิม และห้ามใช้ส่วนหนึ่งของอีเมล';

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password1!',
  'password123',
  'password123!',
  'qwerty123',
  'qwerty123!',
  '12345678',
  '123456789',
  '11111111',
  'abcdefgh',
  'abcdefg1',
  'campusmate',
  'campusmate1',
  'campusmate1!',
  'psu12345',
  'psu12345!',
  'welcome1',
  'welcome1!',
  'letmein1',
  'admin123',
  'iloveyou',
  'iloveyou1',
  'passw0rd',
  'passw0rd!',
]);

function emailLocalPart(email) {
  return String(email || '').trim().split('@')[0] || '';
}

export function evaluatePasswordRules(password, { email } = {}) {
  const value = String(password || '');
  const local = emailLocalPart(email);
  return {
    minLength: value.length >= MIN_PASSWORD_LENGTH,
    maxLength: value.length <= MAX_PASSWORD_LENGTH,
    lower: /[a-z]/.test(value),
    upper: /[A-Z]/.test(value),
    digit: /\d/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
    noSpace: value.length > 0 && !/\s/.test(value),
    notCommon: value.length > 0 && !COMMON_PASSWORDS.has(value.toLowerCase()),
    notEmail: value.length > 0 && (!local || local.length < 4 || !value.toLowerCase().includes(local.toLowerCase())),
  };
}

export function getPasswordIssues(password, { email, confirmPassword, currentPassword } = {}) {
  const value = String(password ?? '');
  if (!value) return ['กรุณาตั้งรหัสผ่านใหม่'];

  const rules = evaluatePasswordRules(value, { email });
  const issues = [];
  if (!rules.maxLength) issues.push('รหัสผ่านยาวเกินไป ใช้ได้ไม่เกิน 128 ตัวอักษร');
  if (!rules.minLength || !rules.lower || !rules.upper || !rules.digit || !rules.special) {
    issues.push('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร ประกอบด้วยพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ');
  }
  if (!rules.noSpace) issues.push('รหัสผ่านต้องไม่มีช่องว่าง');
  if (!rules.notCommon) issues.push('รหัสผ่านนี้เดาง่ายเกินไป กรุณาตั้งรหัสที่ไม่ใช่คำทั่วไป');
  if (!rules.notEmail) issues.push('รหัสผ่านต้องไม่มีส่วนหนึ่งของอีเมล');
  if (currentPassword) {
    if (value === currentPassword) issues.push(PASSWORD_REUSED_MESSAGE);
  }
  if (confirmPassword != null && value !== confirmPassword) {
    issues.push(PASSWORD_MISMATCH_MESSAGE);
  }
  return issues;
}

export function getPasswordError(password, options) {
  return getPasswordIssues(password, options)[0] || null;
}
