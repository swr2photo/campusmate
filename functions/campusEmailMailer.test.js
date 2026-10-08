import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionCodeSettings,
  buildCampusVerifyEmail,
  buildSignupVerifyEmail,
  buildGoogleSignInNoticeEmail,
  buildHostedEmailActionUrl,
  buildHostedPasswordResetUrl,
  buildPasswordResetActionCodeSettings,
  buildPasswordResetEmail,
  canSendCampusEmailChange,
  canSendPasswordResetEmail,
  escapeHtml,
  getEmailSendingConfig,
  getPasswordResetAccountAction,
  isCampusEmail,
  isCampusStudentEmail,
  isEmailSendingConfigured,
  isSupportedLoginEmail,
  MIN_PASSWORD_RESET_INTERVAL_MS,
  normalizeCampusEmail,
  sendCampusEmail,
  sendGoogleWorkspaceEmail,
} from './campusEmailMailer.js';

test('accepts only @psu.ac.th campus emails', () => {
  assert.equal(normalizeCampusEmail('  Foo@PSU.ac.th '), 'foo@psu.ac.th');
  assert.equal(isCampusEmail('stu@psu.ac.th'), true);
  assert.equal(isCampusStudentEmail('6710210317@psu.ac.th'), true);
  assert.equal(isCampusStudentEmail('stu@psu.ac.th'), false);
  assert.equal(isCampusEmail('stu@gmail.com'), false);
});

test('accepts the supported CampusMate login email domains', () => {
  assert.equal(isSupportedLoginEmail('student@psu.ac.th'), true);
  assert.equal(isSupportedLoginEmail('legacy@gmail.com'), true);
  assert.equal(isSupportedLoginEmail('legacy@googlemail.com'), true);
  assert.equal(isSupportedLoginEmail('person@example.com'), false);
});

test('email sending requires Google Workspace SMTP credentials', () => {
  assert.equal(isEmailSendingConfigured({}), false);
  assert.equal(isEmailSendingConfigured({ CLOUDFLARE_API_TOKEN: 'token' }), false);
  assert.equal(isEmailSendingConfigured({ SMTP_USER: 'noreply@getcampusmate.app' }), false);
  assert.equal(isEmailSendingConfigured({
    SMTP_USER: 'noreply@getcampusmate.app',
    SMTP_PASS: 'app-password',
  }), true);
  const config = getEmailSendingConfig({
    SMTP_USER: 'noreply@getcampusmate.app',
    SMTP_PASS: 'app-password',
    CAMPUS_EMAIL_FROM: 'hello@getcampusmate.app',
  });
  assert.equal(config.provider, 'google-workspace');
  assert.equal(config.smtpHost, 'smtp.gmail.com');
  assert.equal(config.smtpPort, 587);
  assert.equal(config.fromAddress, 'hello@getcampusmate.app');
  assert.equal(config.fromName, 'CampusMate');
});

test('rate-limits campus verification resends', () => {
  assert.equal(canSendCampusEmailChange(0, 1_000), true);
  assert.equal(canSendCampusEmailChange(1_000, 20_000), false);
  assert.equal(canSendCampusEmailChange(1_000, 50_000), true);
});

test('rate-limits password reset mail separately from campus verification', () => {
  assert.equal(canSendPasswordResetEmail(1_000, 50_000), false);
  assert.equal(canSendPasswordResetEmail(1_000, 1_000 + MIN_PASSWORD_RESET_INTERVAL_MS), true);
});

test('chooses password reset, Google notice, or ignore from auth providers', () => {
  assert.equal(getPasswordResetAccountAction({
    providerData: [{ providerId: 'password' }, { providerId: 'google.com' }],
  }), 'send-reset');
  assert.equal(getPasswordResetAccountAction({
    providerData: [{ providerId: 'google.com' }],
  }), 'send-google-notice');
  assert.equal(getPasswordResetAccountAction({ providerData: [] }), 'ignore');
});

test('builds a branded signup verification email', () => {
  const message = buildSignupVerifyEmail({
    verifyUrl: 'https://campusmate-7f1ab.web.app/email-verified.html?mode=verifyEmail&oobCode=abc',
  });
  assert.equal(message.subject, 'ยืนยันอีเมลบัญชี CampusMate');
  assert.match(message.html, /ยืนยันอีเมลบัญชี/);
  assert.match(message.html, /https:\/\/campusmate-7f1ab\.web\.app\/brand-icon\.png/);
  assert.match(message.html, /ระบบบัญชีและความปลอดภัย/);
  assert.match(message.html, /email-verified\.html/);
  assert.doesNotMatch(message.html, />CM</);
});

test('builds a branded verification email with escaped html', () => {
  const message = buildCampusVerifyEmail({
    verifyUrl: 'https://example.com/verify?x="><script>',
  });
  assert.match(message.subject, /CampusMate/);
  assert.match(message.text, /https:\/\/example.com\/verify/);
  assert.match(message.html, /&quot;&gt;&lt;script&gt;/);
  assert.match(message.html, /การยืนยันตัวตน/);
  assert.match(message.html, /คำแนะนำด้านความปลอดภัย/);
  assert.match(message.html, /https:\/\/campusmate-7f1ab\.web\.app\/brand-icon\.png/);
  assert.match(message.html, /ระบบบัญชีและความปลอดภัย/);
  assert.doesNotMatch(message.html, />CM</);
  assert.equal(escapeHtml('<b>'), '&lt;b&gt;');
});

test('builds a Google-only sign-in notice without a reset link', () => {
  const message = buildGoogleSignInNoticeEmail();
  assert.equal(message.subject, 'เข้าสู่ระบบ CampusMate ด้วย Google');
  assert.match(message.text, /Continue with Google/);
  assert.match(message.html, /เข้าสู่ระบบด้วย Google/);
  assert.match(message.html, /https:\/\/campusmate-7f1ab\.web\.app\/brand-icon\.png/);
  assert.doesNotMatch(message.html, /ตั้งรหัสผ่านใหม่/);
});

test('builds a formal branded password reset email', () => {
  const message = buildPasswordResetEmail({
    resetUrl: 'https://example.com/reset?oobCode=abc&next="unsafe"',
  });
  assert.equal(message.subject, 'ตั้งรหัสผ่าน CampusMate ใหม่');
  assert.match(message.text, /https:\/\/example\.com\/reset/);
  assert.match(message.html, /ความปลอดภัยของบัญชี/);
  assert.match(message.html, /ตั้งรหัสผ่านใหม่/);
  assert.match(message.html, /https:\/\/campusmate-7f1ab\.web\.app\/brand-icon\.png/);
  assert.match(message.html, /ไม่ซ้ำกับรหัสผ่านเดิม/);
  assert.match(message.text, /ไม่ซ้ำรหัสเดิม/);
  assert.match(message.html, /&amp;next=&quot;unsafe&quot;/);
});

test('converts a Firebase email action into the hosted CampusMate verification page', () => {
  const hostedUrl = buildHostedEmailActionUrl(
    'https://campusmate-7f1ab.firebaseapp.com/__/auth/action?mode=verifyAndChangeEmail&oobCode=secret-code&apiKey=web-key&lang=th&newEmail=stu%40psu.ac.th'
  );
  const parsed = new URL(hostedUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://campusmate-7f1ab.web.app/email-verified.html');
  assert.equal(parsed.searchParams.get('mode'), 'verifyAndChangeEmail');
  assert.equal(parsed.searchParams.get('oobCode'), 'secret-code');
  assert.equal(parsed.searchParams.get('newEmail'), 'stu@psu.ac.th');
  assert.throws(() => buildHostedEmailActionUrl(
    'https://campusmate-7f1ab.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=secret-code&apiKey=web-key'
  ));
});

test('converts a Firebase reset action into the hosted CampusMate reset page', () => {
  const hostedUrl = buildHostedPasswordResetUrl(
    'https://campusmate-7f1ab.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=secret-code&apiKey=web-key&continueUrl=https%3A%2F%2Fexample.com&lang=th'
  );
  const parsed = new URL(hostedUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://campusmate-7f1ab.web.app/reset.html');
  assert.equal(parsed.searchParams.get('mode'), 'resetPassword');
  assert.equal(parsed.searchParams.get('oobCode'), 'secret-code');
  assert.equal(parsed.searchParams.get('apiKey'), 'web-key');
  assert.equal(parsed.searchParams.get('lang'), 'th');
  assert.equal(parsed.searchParams.has('continueUrl'), false);
  assert.throws(() => buildHostedPasswordResetUrl('https://example.com/no-code'));
  assert.deepEqual(buildPasswordResetActionCodeSettings(), {
    url: 'https://campusmate-7f1ab.web.app/reset.html',
    handleCodeInApp: false,
  });
});

test('sends through Google Workspace SMTP', async () => {
  const calls = [];
  const result = await sendGoogleWorkspaceEmail({
    host: 'smtp.gmail.com',
    port: 587,
    user: 'noreply@getcampusmate.app',
    pass: 'app-password',
    from: { address: 'noreply@getcampusmate.app', name: 'CampusMate' },
    to: 'stu@psu.ac.th',
    subject: 'ยืนยันอีเมล',
    html: '<p>hi</p>',
    text: 'hi',
    createTransport: (options) => {
      calls.push(options);
      return {
        sendMail: async (payload) => {
          calls.push(payload);
          return { messageId: 'smtp-1' };
        },
      };
    },
  });
  assert.equal(result.messageId, 'smtp-1');
  assert.equal(calls[0].host, 'smtp.gmail.com');
  assert.equal(calls[0].auth.user, 'noreply@getcampusmate.app');
  assert.equal(calls[1].to, 'stu@psu.ac.th');
  assert.equal(calls[1].from, 'CampusMate <noreply@getcampusmate.app>');
  assert.equal(calls[1].replyTo, 'noreply@getcampusmate.app');
  assert.equal(calls[1].headers['X-Auto-Response-Suppress'], 'OOF, AutoReply');
  assert.equal(calls[1].headers['Importance'], 'high');
  assert.equal(calls[1].headers['Precedence'], 'high');
  assert.equal(calls[1].attachments?.length || 0, 0);
});

test('sendCampusEmail uses Workspace SMTP from config', async () => {
  let payload;
  await sendCampusEmail(
    getEmailSendingConfig({
      SMTP_USER: 'noreply@getcampusmate.app',
      SMTP_PASS: 'app-password',
    }),
    {
      to: 'stu@psu.ac.th',
      subject: 'ยืนยันอีเมล',
      html: '<p>hi</p>',
      text: 'hi',
    },
    {
      createTransport: () => ({
        sendMail: async (mail) => {
          payload = mail;
          return { messageId: 'smtp-2' };
        },
      }),
    }
  );
  assert.equal(payload.to, 'stu@psu.ac.th');
  assert.match(payload.from, /noreply@getcampusmate\.app/);
});

test('action settings return verified email changes to the confirmation page', () => {
  const settings = buildActionCodeSettings();
  assert.deepEqual(settings, {
    url: 'https://campusmate-7f1ab.web.app/email-verified.html',
    handleCodeInApp: false,
  });
});

test('detects and configures Resend provider', () => {
  const config = getEmailSendingConfig({
    RESEND_API_KEY: 're_test_12345',
    CAMPUS_EMAIL_FROM: 'noreply@getcampusmate.app',
  });
  assert.equal(config.provider, 'resend');
  assert.equal(config.resendApiKey, 're_test_12345');
  assert.equal(isEmailSendingConfigured({
    RESEND_API_KEY: 're_test_12345',
    CAMPUS_EMAIL_FROM: 'noreply@getcampusmate.app',
  }), true);
});

test('sends transactional email through Resend API', async () => {
  let requestUrl, requestOptions;
  const mockFetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-msg-123' }),
    };
  };

  const config = getEmailSendingConfig({
    RESEND_API_KEY: 're_test_key',
    CAMPUS_EMAIL_FROM: 'noreply@getcampusmate.app',
  });

  const res = await sendCampusEmail(
    config,
    {
      to: '6710210317@psu.ac.th',
      subject: 'ยืนยันอีเมลด่วน',
      html: '<p>Click to verify</p>',
      text: 'Click to verify',
    },
    { fetchFn: mockFetch }
  );

  assert.equal(res.messageId, 'resend-msg-123');
  assert.equal(requestUrl, 'https://api.resend.com/emails');
  assert.equal(requestOptions.headers['Authorization'], 'Bearer re_test_key');
  const body = JSON.parse(requestOptions.body);
  assert.deepEqual(body.to, ['6710210317@psu.ac.th']);
  assert.equal(body.subject, 'ยืนยันอีเมลด่วน');
  assert.equal(body.headers['Importance'], 'high');
});
