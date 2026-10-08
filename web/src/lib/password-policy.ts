export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const PASSWORD_REUSED_MESSAGE = 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม';
export const PASSWORD_MISMATCH_MESSAGE = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';

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

export const PASSWORD_RULES = [
  { key: 'minLength', label: 'อย่างน้อย 8 ตัวอักษร' },
  { key: 'lower', label: 'มีตัวพิมพ์เล็ก' },
  { key: 'upper', label: 'มีตัวพิมพ์ใหญ่' },
  { key: 'digit', label: 'มีตัวเลข' },
  { key: 'special', label: 'มีอักขระพิเศษ เช่น # ? !' },
  { key: 'noSpace', label: 'ไม่มีช่องว่าง' },
  { key: 'notCommon', label: 'ไม่ใช่รหัสที่เดาง่าย' },
  { key: 'notEmail', label: 'ไม่ใช้ส่วนหนึ่งของอีเมล' },
] as const;

export type PasswordRuleKey = (typeof PASSWORD_RULES)[number]['key'];

function emailLocalPart(email: string) {
  return String(email || '').trim().split('@')[0] || '';
}

export function evaluatePasswordRules(password: string, { email }: { email?: string } = {}) {
  const value = String(password || '');
  const local = emailLocalPart(email || '');
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
  } satisfies Record<PasswordRuleKey | 'maxLength', boolean>;
}

export function getPasswordIssues(
  password: string,
  { email, confirmPassword }: { email?: string; confirmPassword?: string } = {}
) {
  const value = String(password ?? '');
  if (!value) return ['กรุณาตั้งรหัสผ่านใหม่'];

  const rules = evaluatePasswordRules(value, { email });
  const issues: string[] = [];
  if (!rules.maxLength) issues.push('รหัสผ่านยาวเกินไป ใช้ได้ไม่เกิน 128 ตัวอักษร');
  if (!rules.minLength || !rules.lower || !rules.upper || !rules.digit || !rules.special) {
    issues.push('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร ประกอบด้วยพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ');
  }
  if (!rules.noSpace) issues.push('รหัสผ่านต้องไม่มีช่องว่าง');
  if (!rules.notCommon) issues.push('รหัสผ่านนี้เดาง่ายเกินไป กรุณาตั้งรหัสที่ไม่ใช่คำทั่วไป');
  if (!rules.notEmail) issues.push('รหัสผ่านต้องไม่มีส่วนหนึ่งของอีเมล');
  if (confirmPassword != null && value !== confirmPassword) {
    issues.push(PASSWORD_MISMATCH_MESSAGE);
  }
  return issues;
}
