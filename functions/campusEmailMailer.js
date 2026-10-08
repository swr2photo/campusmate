import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const CAMPUS_EMAIL_PATTERN = /^[a-z0-9._%+\-]+@psu\.ac\.th$/i;
const CAMPUS_STUDENT_EMAIL_PATTERN = /^\d{10}@psu\.ac\.th$/i;
const DEFAULT_FROM_ADDRESS = 'noreply@getcampusmate.app';
const DEFAULT_FROM_NAME = 'CampusMate';
const DEFAULT_SMTP_HOST = 'smtp.gmail.com';
const DEFAULT_SMTP_PORT = 587;
const AUTH_CONTINUE_URL = 'https://campusmate-7f1ab.web.app/email-verified.html';
const PASSWORD_RESET_URL = 'https://campusmate-7f1ab.web.app/reset.html';
const BRAND_ICON_URL = 'https://campusmate-7f1ab.web.app/brand-icon.png';
export const BRAND_ICON_CID = 'campusmate-brand@getcampusmate.app';
const BRAND_ICON_PATH = fileURLToPath(new URL('./brand-icon.png', import.meta.url));
const MIN_RESEND_INTERVAL_MS = 45_000;
export const MIN_PASSWORD_RESET_INTERVAL_MS = 60_000;
const SUPPORTED_LOGIN_EMAIL_PATTERN = /^[a-z0-9._%+\-]+@(psu\.ac\.th|gmail\.com|googlemail\.com)$/i;

export const CAMPUS_EMAIL_FROM = DEFAULT_FROM_ADDRESS;

export function getBrandIconSrc() {
  return BRAND_ICON_URL;
}

function brandIconAttachments() {
  return [];
}

export function normalizeCampusEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isCampusEmail(email) {
  return CAMPUS_EMAIL_PATTERN.test(normalizeCampusEmail(email));
}

export function isCampusStudentEmail(email) {
  return CAMPUS_STUDENT_EMAIL_PATTERN.test(normalizeCampusEmail(email));
}

export function isSupportedLoginEmail(email) {
  return SUPPORTED_LOGIN_EMAIL_PATTERN.test(normalizeCampusEmail(email));
}

export function getEmailSendingConfig(env = process.env) {
  const fromAddress = env.CAMPUS_EMAIL_FROM || DEFAULT_FROM_ADDRESS;
  const fromName = env.CAMPUS_EMAIL_FROM_NAME || DEFAULT_FROM_NAME;
  const resendApiKey = env.RESEND_API_KEY || '';
  const smtpHost = env.SMTP_HOST || DEFAULT_SMTP_HOST;
  const smtpPort = Number(env.SMTP_PORT || DEFAULT_SMTP_PORT);
  const smtpUser = env.SMTP_USER || env.GMAIL_SMTP_USER || '';
  const smtpPass = env.SMTP_PASS || env.GMAIL_SMTP_PASS || env.GMAIL_APP_PASSWORD || '';
  return {
    provider: resendApiKey ? 'resend' : 'google-workspace',
    resendApiKey,
    smtpHost,
    smtpPort: Number.isFinite(smtpPort) ? smtpPort : DEFAULT_SMTP_PORT,
    smtpUser,
    smtpPass,
    fromAddress,
    fromName,
  };
}

export function isEmailSendingConfigured(env = process.env) {
  const config = getEmailSendingConfig(env);
  if (config.resendApiKey && config.fromAddress) return true;
  return Boolean(config.smtpUser && config.smtpPass && config.fromAddress);
}

export function canSendCampusEmailChange(previousMs, nowMs = Date.now(), minIntervalMs = MIN_RESEND_INTERVAL_MS) {
  if (!previousMs) return true;
  return nowMs - previousMs >= minIntervalMs;
}

export function canSendPasswordResetEmail(previousMs, nowMs = Date.now()) {
  return canSendCampusEmailChange(previousMs, nowMs, MIN_PASSWORD_RESET_INTERVAL_MS);
}

export function getPasswordResetAccountAction(userRecord) {
  const providers = Array.isArray(userRecord?.providerData) ? userRecord.providerData : [];
  if (providers.some((provider) => provider?.providerId === 'password')) return 'send-reset';
  if (providers.some((provider) => provider?.providerId === 'google.com')) return 'send-google-notice';
  return 'ignore';
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildActionCodeSettings() {
  return {
    url: AUTH_CONTINUE_URL,
    handleCodeInApp: false,
  };
}

export function buildPasswordResetActionCodeSettings() {
  return {
    url: PASSWORD_RESET_URL,
    handleCodeInApp: false,
  };
}

export function buildHostedPasswordResetUrl(firebaseUrl) {
  let source;
  try {
    source = new URL(String(firebaseUrl || '').trim());
  } catch (_) {
    throw new Error('Firebase password reset URL is invalid');
  }
  const mode = source.searchParams.get('mode');
  const oobCode = source.searchParams.get('oobCode');
  const apiKey = source.searchParams.get('apiKey');
  if (mode !== 'resetPassword' || !oobCode || !apiKey) {
    throw new Error('Firebase password reset URL is missing required parameters');
  }
  const destination = new URL(PASSWORD_RESET_URL);
  destination.searchParams.set('mode', mode);
  destination.searchParams.set('oobCode', oobCode);
  destination.searchParams.set('apiKey', apiKey);
  const languageCode = source.searchParams.get('lang');
  if (languageCode) destination.searchParams.set('lang', languageCode);
  return destination.toString();
}

const EMAIL_ACTION_MODES = new Set(['verifyEmail', 'verifyAndChangeEmail', 'recoverEmail']);

export function buildHostedEmailActionUrl(firebaseUrl) {
  let source;
  try {
    source = new URL(String(firebaseUrl || '').trim());
  } catch (_) {
    throw new Error('Firebase email action URL is invalid');
  }
  const mode = source.searchParams.get('mode');
  const oobCode = source.searchParams.get('oobCode');
  const apiKey = source.searchParams.get('apiKey');
  if (!EMAIL_ACTION_MODES.has(mode) || !oobCode || !apiKey) {
    throw new Error('Firebase email action URL is missing required parameters');
  }
  const destination = new URL(AUTH_CONTINUE_URL);
  destination.searchParams.set('mode', mode);
  destination.searchParams.set('oobCode', oobCode);
  destination.searchParams.set('apiKey', apiKey);
  const newEmail = source.searchParams.get('newEmail');
  if (newEmail) destination.searchParams.set('newEmail', newEmail);
  const languageCode = source.searchParams.get('lang');
  if (languageCode) destination.searchParams.set('lang', languageCode);
  return destination.toString();
}

function buildFormalEmailHtml({
  preheader,
  eyebrow,
  title,
  bodyHtml,
  actionLabel,
  actionUrl,
  securityNote,
}) {
  const safeActionUrl = escapeHtml(String(actionUrl || '').trim());
  return [
    '<!doctype html>',
    '<html lang="th">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CampusMate</title></head>',
    '<body style="margin:0;padding:0;background:#f4f6fa;color:#10203a;font-family:\'Leelawadee UI\',\'Sarabun\',\'Segoe UI\',Arial,Tahoma,sans-serif">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f6fa">',
    '<tr><td align="center" style="padding:0">',
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff">',
    '<tr><td style="height:4px;background:#5b5ce2;font-size:0;line-height:0">&nbsp;</td></tr>',
    '<tr><td style="padding:18px 28px;border-bottom:1px solid #e7ebf2">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>',
    '<td width="44" height="44" valign="middle"><img src="' + getBrandIconSrc() + '" width="44" height="44" alt="CampusMate" style="display:block;width:44px;height:44px;border-radius:11px;border:0"></td>',
    '<td valign="middle" style="padding-left:12px"><div style="color:#10203a;font-size:15px;font-weight:700;line-height:1.3">CampusMate</div><div style="color:#60708a;font-size:12px;line-height:1.4">ระบบบัญชีและความปลอดภัย</div></td>',
    '</tr></table>',
    '</td></tr>',
    '<tr><td style="padding:28px 24px 24px;background:#f4f6fa">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e7ebf2;border-radius:12px;background:#ffffff">',
    '<tr><td style="padding:28px 26px 24px">',
    `<div style="margin:0 0 10px;color:#5b5ce2;font-size:11px;font-weight:700;letter-spacing:1.4px">${escapeHtml(eyebrow)}</div>`,
    `<h1 style="margin:0 0 14px;color:#10203a;font-size:24px;line-height:1.35;font-weight:700">${escapeHtml(title)}</h1>`,
    `<div style="color:#60708a;font-size:15px;line-height:1.75">${bodyHtml}</div>`,
    actionUrl
      ? [
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 26px"><tr>',
        `<td style="border-radius:8px;background:#5b5ce2"><a href="${safeActionUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(actionLabel)}</a></td>`,
        '</tr></table>',
        '<div style="margin:0 0 22px;padding:14px 16px;border:1px solid #e7ebf2;border-radius:8px;background:#f4f6fa">',
        '<div style="margin-bottom:6px;color:#60708a;font-size:12px;font-weight:600">หากปุ่มไม่ทำงาน ให้เปิดลิงก์นี้ในเบราว์เซอร์</div>',
        `<a href="${safeActionUrl}" style="color:#4546b8;font-size:13px;line-height:1.55;word-break:break-all;text-decoration:underline">${safeActionUrl}</a>`,
        '</div>',
      ].join('')
      : '<div style="height:18px"></div>',
    `<div style="padding:13px 14px;border-left:3px solid #5b5ce2;background:#eef0ff;color:#60708a;font-size:13px;line-height:1.65"><strong style="color:#10203a">คำแนะนำด้านความปลอดภัย</strong><br>${escapeHtml(securityNote)}</div>`,
    '</td></tr></table>',
    '</td></tr>',
    '<tr><td style="padding:4px 28px 28px;background:#f4f6fa;color:#8b98ac;font-size:12px;line-height:1.65;text-align:left">',
    'อีเมลอัตโนมัติจาก CampusMate กรุณาอย่าตอบกลับ<br>',
    'ส่งโดย noreply@getcampusmate.app',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body></html>',
  ].join('');
}

export function buildSignupVerifyEmail({ verifyUrl }) {
  const safeUrl = String(verifyUrl || '').trim();
  const subject = 'ยืนยันอีเมลบัญชี CampusMate';
  const text = [
    'สวัสดี',
    '',
    'นี่เป็นอีเมลยืนยันตัวตนจาก CampusMate สำหรับบัญชีที่เพิ่งสมัคร',
    'กรุณายืนยันเฉพาะเมื่อคุณเป็นคนสร้างบัญชีนี้',
    '',
    `เปิดลิงก์นี้: ${safeUrl}`,
    '',
    'หากคุณไม่ได้สมัคร CampusMate สามารถละเว้นข้อความนี้ได้',
    '',
    'CampusMate',
    DEFAULT_FROM_ADDRESS,
  ].join('\n');
  const html = buildFormalEmailHtml({
    preheader: 'ยืนยันอีเมลบัญชีเพื่อเริ่มใช้งาน CampusMate',
    eyebrow: 'การยืนยันตัวตน',
    title: 'ยืนยันอีเมลบัญชี',
    bodyHtml: [
      '<p style="margin:0 0 12px">สวัสดี</p>',
      '<p style="margin:0 0 12px">เราได้รับคำขอสร้างบัญชี CampusMate ด้วยอีเมลนี้</p>',
      '<p style="margin:0">กรุณากดปุ่มด้านล่างเพื่อยืนยันว่าคุณเป็นเจ้าของอีเมลนี้</p>',
    ].join(''),
    actionLabel: 'ยืนยันอีเมล',
    actionUrl: safeUrl,
    securityNote: 'ยืนยันเฉพาะเมื่อคุณเป็นผู้สมัครบัญชี CampusMate หากไม่ได้เป็นผู้ดำเนินการ สามารถละเว้นอีเมลฉบับนี้ได้',
  });
  return { subject, text, html };
}

export function buildCampusVerifyEmail({ verifyUrl }) {
  const safeUrl = String(verifyUrl || '').trim();
  const subject = 'ยืนยันอีเมลมหาวิทยาลัยสำหรับ CampusMate';
  const text = [
    'สวัสดี',
    '',
    'นี่เป็นอีเมลยืนยันตัวตนจาก CampusMate สำหรับการเปลี่ยนไปใช้อีเมล @psu.ac.th',
    'กรุณายืนยันเฉพาะเมื่อคุณเป็นคนขอเปลี่ยนอีเมลในแอป',
    '',
    `เปิดลิงก์นี้: ${safeUrl}`,
    '',
    'หากคุณไม่ได้ขอเปลี่ยนอีเมล สามารถละเว้นข้อความนี้ได้',
    '',
    'CampusMate',
    DEFAULT_FROM_ADDRESS,
  ].join('\n');
  const html = buildFormalEmailHtml({
    preheader: 'ยืนยันอีเมลมหาวิทยาลัยเพื่อใช้งานบัญชี CampusMate ต่อ',
    eyebrow: 'การยืนยันตัวตน',
    title: 'ยืนยันอีเมลมหาวิทยาลัย',
    bodyHtml: [
      '<p style="margin:0 0 12px">สวัสดี</p>',
      '<p style="margin:0 0 12px">เราได้รับคำขอเปลี่ยนอีเมลบัญชี CampusMate ไปใช้อีเมลมหาวิทยาลัย <strong style="color:#172033">@psu.ac.th</strong></p>',
      '<p style="margin:0">กรุณากดปุ่มด้านล่างเพื่อยืนยันว่าคุณเป็นเจ้าของอีเมลนี้</p>',
    ].join(''),
    actionLabel: 'ยืนยันอีเมล',
    actionUrl: safeUrl,
    securityNote: 'ยืนยันเฉพาะเมื่อคุณเป็นผู้ส่งคำขอจากแอป CampusMate หากไม่ได้เป็นผู้ดำเนินการ สามารถละเว้นอีเมลฉบับนี้ได้',
  });
  return { subject, text, html };
}

export function buildGoogleSignInNoticeEmail() {
  const subject = 'เข้าสู่ระบบ CampusMate ด้วย Google';
  const text = [
    'สวัสดี',
    '',
    'บัญชี CampusMate ของอีเมลนี้เข้าสู่ระบบด้วย Google และไม่ได้ตั้งรหัสผ่านไว้',
    'กรุณาเปิดแอป CampusMate แล้วเลือก Continue with Google',
    '',
    'หากคุณไม่ได้ขออีเมลนี้ สามารถละเว้นข้อความนี้ได้',
    '',
    'CampusMate',
    DEFAULT_FROM_ADDRESS,
  ].join('\n');
  const html = buildFormalEmailHtml({
    preheader: 'บัญชีนี้เข้าสู่ระบบด้วย Google ไม่ได้ใช้รหัสผ่าน',
    eyebrow: 'ความปลอดภัยของบัญชี',
    title: 'เข้าสู่ระบบด้วย Google',
    bodyHtml: [
      '<p style="margin:0 0 12px">สวัสดี</p>',
      '<p style="margin:0 0 12px">บัญชี CampusMate ของอีเมลนี้เข้าสู่ระบบด้วย <strong style="color:#172033">Google</strong> และไม่ได้ตั้งรหัสผ่านไว้</p>',
      '<p style="margin:0">กรุณาเปิดแอป CampusMate แล้วเลือก Continue with Google</p>',
    ].join(''),
    securityNote: 'หากคุณไม่ได้ขออีเมลนี้ สามารถละเว้นข้อความนี้ได้ ไม่มีการเปลี่ยนรหัสผ่านใด ๆ',
  });
  return { subject, text, html };
}

export function buildPasswordResetEmail({ resetUrl }) {
  const safeUrl = String(resetUrl || '').trim();
  const subject = 'ตั้งรหัสผ่าน CampusMate ใหม่';
  const text = [
    'สวัสดี',
    '',
    'เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี CampusMate ของคุณ',
    'เปิดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ รหัสใหม่ต้องไม่ซ้ำรหัสเดิม และต้องมีพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ:',
    safeUrl,
    '',
    'หากคุณไม่ได้ขอตั้งรหัสผ่านใหม่ สามารถละเว้นอีเมลฉบับนี้ได้ รหัสผ่านเดิมจะยังใช้งานได้ตามปกติ',
    '',
    'CampusMate',
    DEFAULT_FROM_ADDRESS,
  ].join('\n');
  const html = buildFormalEmailHtml({
    preheader: 'ตั้งรหัสผ่านใหม่สำหรับบัญชี CampusMate ของคุณ',
    eyebrow: 'ความปลอดภัยของบัญชี',
    title: 'ตั้งรหัสผ่านใหม่',
    bodyHtml: [
      '<p style="margin:0 0 12px">สวัสดี</p>',
      '<p style="margin:0 0 12px">เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี CampusMate ของคุณ</p>',
      '<p style="margin:0">กดปุ่มด้านล่างเพื่อกำหนดรหัสผ่านใหม่ รหัสใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม และต้องมีพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ</p>',
    ].join(''),
    actionLabel: 'ตั้งรหัสผ่านใหม่',
    actionUrl: safeUrl,
    securityNote: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม หากคุณไม่ได้ขอตั้งรหัสผ่านใหม่ สามารถละเว้นอีเมลฉบับนี้ได้ รหัสผ่านเดิมจะยังใช้งานได้ตามปกติ',
  });
  return { subject, text, html };
}

export async function sendGoogleWorkspaceEmail({
  host,
  port,
  user,
  pass,
  from,
  to,
  subject,
  html,
  text,
  createTransport = (options) => nodemailer.createTransport(options),
}) {
  const transporter = createTransport({
    host,
    port,
    secure: Number(port) === 465,
    auth: { user, pass },
  });
  try {
    const fromAddress = from?.address || DEFAULT_FROM_ADDRESS;
    const info = await transporter.sendMail({
      from: from?.name ? `${from.name} <${fromAddress}>` : fromAddress,
      to,
      replyTo: fromAddress,
      subject,
      html,
      text,
      envelope: { from: fromAddress, to },
      attachments: brandIconAttachments(),
      headers: {
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
        'X-Priority': '1',
        Importance: 'high',
        Precedence: 'high',
      },
    });
    return {
      messageId: info?.messageId || '',
      accepted: info?.accepted || [],
      rejected: info?.rejected || [],
      response: info?.response || '',
    };
  } catch (error) {
    throw Object.assign(new Error(error?.message || 'Google Workspace email send failed'), {
      code: 'email/send-failed',
      cause: error,
    });
  }
}

export async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
  fetchFn = fetch,
}) {
  const fromAddress = from?.address || DEFAULT_FROM_ADDRESS;
  const fromHeader = from?.name ? `${from.name} <${fromAddress}>` : fromAddress;
  try {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [to],
        reply_to: fromAddress,
        subject,
        html,
        text,
        headers: {
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'X-Priority': '1',
          Importance: 'high',
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || `Resend API error (${res.status})`);
    }
    return {
      messageId: data?.id || '',
      accepted: [to],
      rejected: [],
      response: `250 Resend ${data?.id || ''}`,
    };
  } catch (error) {
    throw Object.assign(new Error(error?.message || 'Resend email send failed'), {
      code: 'email/send-failed',
      cause: error,
    });
  }
}

export async function sendCampusEmail(config, message, options = {}) {
  if (config?.provider === 'resend' || config?.resendApiKey) {
    return sendResendEmail({
      apiKey: config.resendApiKey,
      from: { address: config.fromAddress, name: config.fromName },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      fetchFn: options.fetchFn,
    });
  }
  return sendGoogleWorkspaceEmail({
    host: config.smtpHost,
    port: config.smtpPort,
    user: config.smtpUser,
    pass: config.smtpPass,
    from: { address: config.fromAddress, name: config.fromName },
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    createTransport: options.createTransport,
  });
}
