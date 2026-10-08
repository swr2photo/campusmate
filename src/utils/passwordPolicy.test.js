import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_REUSED_MESSAGE,
  evaluatePasswordRules,
  getPasswordError,
  getPasswordIssues,
} from './passwordPolicy.js';

const strong = 'Cm#2026Safe';

test('accepts a strong password that is not the old one', () => {
  assert.equal(getPasswordError(strong, {
    email: '6710210317@psu.ac.th',
    confirmPassword: strong,
    currentPassword: 'OldPass#99',
  }), null);
});

test('rejects reused, weak, common, emailed, and mismatched passwords', () => {
  assert.equal(getPasswordError('Abcdef1!', { currentPassword: 'Abcdef1!' }), PASSWORD_REUSED_MESSAGE);
  assert.match(getPasswordError('short1!'), /อย่างน้อย 8/);
  assert.match(getPasswordError('alllowercase1!'), /พิมพ์ใหญ่/);
  assert.match(getPasswordError('ALLUPPERCASE1!'), /พิมพ์เล็ก/);
  assert.match(getPasswordError('NoDigits!!'), /ตัวเลข/);
  assert.match(getPasswordError('NoSpecial1'), /อักขระพิเศษ/);
  assert.match(getPasswordError('Has space1!'), /ช่องว่าง/);
  assert.match(getPasswordError('Password1!'), /คำทั่วไป/);
  assert.match(getPasswordError('X6710210317a!A', { email: '6710210317@psu.ac.th' }), /อีเมล/);
  assert.equal(getPasswordError(strong, { confirmPassword: 'other' }), PASSWORD_MISMATCH_MESSAGE);
  assert.ok(getPasswordIssues('').length > 0);
});

test('marks each strength rule independently', () => {
  const rules = evaluatePasswordRules(strong, { email: '6710210317@psu.ac.th' });
  assert.deepEqual(rules, {
    minLength: true,
    maxLength: true,
    lower: true,
    upper: true,
    digit: true,
    special: true,
    noSpace: true,
    notCommon: true,
    notEmail: true,
  });
});
