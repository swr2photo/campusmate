import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCampusEmail,
  assertLoginEmailAllowed,
  CAMPUS_EMAIL_SENDER,
  getCampusEmailErrorMessage,
  getLoggedInRoute,
  getPasswordResetErrorMessage,
  getPasswordResetSentMessage,
  hasVerifiedCampusEmail,
  isBlockedCampusAccount,
  isCampusEmail,
  isCampusStudentEmail,
  isLegacyGmailEmail,
  isLikelyNewFirebaseUser,
  needsCampusEmailMigration,
  normalizeEmail,
} from './campusEmail.js';

test('normalizes and accepts only @psu.ac.th for new campus emails', () => {
  assert.equal(normalizeEmail('  Foo.Bar@PSU.ac.th '), 'foo.bar@psu.ac.th');
  assert.equal(isCampusEmail('student@psu.ac.th'), true);
  assert.equal(isCampusStudentEmail('6710210317@psu.ac.th'), true);
  assert.equal(isCampusStudentEmail('student@psu.ac.th'), false);
  assert.equal(isCampusEmail('student@email.psu.ac.th'), false);
  assert.equal(isCampusEmail('student@gmail.com'), false);
  assert.equal(isCampusEmail('not-an-email'), false);
});

test('legacy Gmail includes googlemail', () => {
  assert.equal(isLegacyGmailEmail('old.user@gmail.com'), true);
  assert.equal(isLegacyGmailEmail('old.user@googlemail.com'), true);
  assert.equal(isLegacyGmailEmail('old.user@yahoo.com'), false);
});

test('signup rejects non-PSU and login allows PSU plus Gmail', () => {
  assert.equal(assertCampusEmail('6710210317@psu.ac.th'), '6710210317@psu.ac.th');
  assert.throws(() => assertCampusEmail('a@psu.ac.th'), { code: 'auth/student-id-required' });
  assert.throws(() => assertCampusEmail('a@gmail.com'), { code: 'auth/campus-email-required' });
  assert.equal(assertLoginEmailAllowed('a@gmail.com'), 'a@gmail.com');
  assert.throws(() => assertLoginEmailAllowed('a@yahoo.com'), { code: 'auth/campus-email-login-only' });
});

test('new Firebase users are detected from matching timestamps', () => {
  const created = '2026-09-19T12:00:00.000Z';
  assert.equal(isLikelyNewFirebaseUser({
    creationTime: created,
    lastSignInTime: created,
  }), true);
  assert.equal(isLikelyNewFirebaseUser({
    creationTime: '2025-01-01T00:00:00.000Z',
    lastSignInTime: created,
  }), false);
});

test('existing Gmail accounts must migrate until a campus email is verified', () => {
  const user = {
    email: 'old@gmail.com',
    creationTime: '2025-01-01T00:00:00.000Z',
    lastSignInTime: '2026-09-19T12:00:00.000Z',
  };
  const profile = { isNewUser: false, email: 'old@gmail.com' };
  assert.equal(needsCampusEmailMigration(user, profile), true);
  assert.equal(getLoggedInRoute(user, profile), '/verify-campus-email');
  assert.equal(hasVerifiedCampusEmail({
    campusEmail: 'stu@psu.ac.th',
    campusEmailVerified: true,
  }), true);
  assert.equal(getLoggedInRoute(user, {
    ...profile,
    campusEmail: 'stu@psu.ac.th',
    campusEmailVerified: true,
  }), '/verify-campus-email');
  assert.equal(getLoggedInRoute({ ...user, email: 'stu@psu.ac.th' }, profile), '/home');
});

test('new non-PSU accounts are blocked instead of migrated', () => {
  const created = '2026-09-19T12:00:00.000Z';
  const user = {
    email: 'new@gmail.com',
    creationTime: created,
    lastSignInTime: created,
  };
  assert.equal(isBlockedCampusAccount(user), true);
  assert.equal(needsCampusEmailMigration(user, { isNewUser: true }), false);
  assert.equal(getLoggedInRoute(user, { isNewUser: true }), null);
});

test('branded campus mail uses the verified Google Workspace sender', () => {
  assert.equal(CAMPUS_EMAIL_SENDER, 'noreply@getcampusmate.app');
  assert.equal(
    getCampusEmailErrorMessage({ code: 'functions/already-exists' }),
    'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมล @psu.ac.th ของคุณ'
  );
});

test('password reset copy does not reveal whether an account exists', () => {
  const message = getPasswordResetSentMessage('  Stu@PSU.ac.th ');
  assert.match(message, /stu@psu\.ac\.th/);
  assert.match(message, /noreply@getcampusmate\.app/);
  assert.match(message, /Junk/);
  assert.equal(
    getPasswordResetErrorMessage({ code: 'functions/unavailable' }),
    'ส่งอีเมลตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่ในอีกสักครู่'
  );
  assert.equal(
    getPasswordResetErrorMessage({ code: 'functions/resource-exhausted' }),
    'คุณส่งคำขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอประมาณ 1 นาทีแล้วลองใหม่'
  );
});

test('PSU users go to setup or home', () => {
  const user = { email: 'stu@psu.ac.th' };
  assert.equal(getLoggedInRoute(user, { isNewUser: true }), '/setup');
  assert.equal(getLoggedInRoute(user, { isNewUser: false }), '/home');
  assert.equal(getLoggedInRoute(user, null), null);
});
