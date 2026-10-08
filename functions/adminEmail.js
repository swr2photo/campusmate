import { HttpsError } from 'firebase-functions/v2/https';
import {
  buildActionCodeSettings, buildPasswordResetActionCodeSettings,
  buildHostedEmailActionUrl, buildHostedPasswordResetUrl,
  buildSignupVerifyEmail, buildCampusVerifyEmail, buildPasswordResetEmail,
  buildGoogleSignInNoticeEmail, isCampusStudentEmail, isSupportedLoginEmail,
} from './campusEmailMailer.js';

export const ADMIN_EMAIL_KINDS = ['verification', 'passwordReset', 'googleNotice', 'campusChange'];
export async function prepareAdminEmail({auth,user,kind,pendingEmail}) {
  if (!ADMIN_EMAIL_KINDS.includes(kind)) throw new HttpsError('invalid-argument','ประเภทอีเมลไม่ถูกต้อง');
  if (user.disabled) throw new HttpsError('failed-precondition','บัญชีนี้ถูกระงับอยู่');
  if (!isSupportedLoginEmail(user.email)) throw new HttpsError('failed-precondition','บัญชีนี้ไม่มีอีเมลที่ระบบรองรับ');
  const providers=user.providerData?.map(p=>p.providerId)||[];
  let message, to=user.email;
  if(kind==='verification') {
    const link=await auth.generateEmailVerificationLink(to,buildActionCodeSettings());
    message=buildSignupVerifyEmail({verifyUrl:buildHostedEmailActionUrl(link)});
  } else if(kind==='passwordReset') {
    if(!providers.includes('password'))throw new HttpsError('failed-precondition','บัญชีนี้ไม่ได้ใช้รหัสผ่าน กรุณาส่งคำแนะนำการเข้าสู่ระบบด้วย Google');
    const link=await auth.generatePasswordResetLink(to,buildPasswordResetActionCodeSettings());
    message=buildPasswordResetEmail({resetUrl:buildHostedPasswordResetUrl(link)});
  } else if(kind==='googleNotice') {
    if(!providers.includes('google.com')||providers.includes('password'))throw new HttpsError('failed-precondition','คำแนะนำนี้ใช้กับบัญชีที่เข้าสู่ระบบด้วย Google อย่างเดียว');
    message=buildGoogleSignInNoticeEmail();
  } else {
    if(!isCampusStudentEmail(pendingEmail)||pendingEmail===to||isCampusStudentEmail(to))throw new HttpsError('failed-precondition','ไม่มีคำขอเปลี่ยนเป็นอีเมลมหาวิทยาลัยที่ส่งซ้ำได้');
    // Destination comes from a prior server-owned change request, never client input.
    to=pendingEmail;
    const link=await auth.generateVerifyAndChangeEmailLink(user.email,to,buildActionCodeSettings());
    message=buildCampusVerifyEmail({verifyUrl:buildHostedEmailActionUrl(link)});
  }
  return {to,...message};
}
