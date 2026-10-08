import { HttpsError } from 'firebase-functions/v2/https';

export const REPORT_STATUSES = ['pending', 'reviewing', 'resolved', 'dismissed'];
export function requireAdmin(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  if (request.auth.token?.admin !== true || request.auth.token?.email_verified !== true)
    throw new HttpsError('permission-denied', 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล หรือยังไม่ได้ยืนยันอีเมล');
  return request.auth.uid;
}
export function validateReview(data) {
  if (!REPORT_STATUSES.includes(data.status)) throw new HttpsError('invalid-argument', 'สถานะไม่ถูกต้อง');
  if (typeof data.note !== 'string' || data.note.length > 2000) throw new HttpsError('invalid-argument', 'หมายเหตุยาวเกินไป');
  if (['resolved', 'dismissed'].includes(data.status) && !data.note.trim()) throw new HttpsError('invalid-argument', 'กรุณาระบุผลการตรวจสอบ');
  return { status: data.status, reviewNote: data.note.trim() };
}
export function validateVersion(data) {
  const allowed = ['enabled', 'latestVersion', 'minVersion', 'forceUpdate', 'playStorePublished', 'snoozeHours', 'title', 'message', 'releaseNotes', 'playStoreUrl', 'playStoreWebUrl', 'appStoreUrl'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) throw new HttpsError('invalid-argument', 'การตั้งค่าไม่ถูกต้อง');
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (['enabled', 'forceUpdate', 'playStorePublished'].includes(key)) {
      if (typeof value !== 'boolean') throw new HttpsError('invalid-argument', key + ' ต้องเป็นเปิด/ปิด');
    } else if (key === 'snoozeHours') {
      if (!Number.isFinite(value) || value < 1 || value > 720) throw new HttpsError('invalid-argument', 'เวลาพักต้องอยู่ระหว่าง 1–720 ชั่วโมง');
    } else {
      if (typeof value !== 'string' || value.length > 4000) throw new HttpsError('invalid-argument', 'ข้อความไม่ถูกต้อง');
      if (['latestVersion', 'minVersion'].includes(key) && value && !/^\d+\.\d+\.\d+$/.test(value)) throw new HttpsError('invalid-argument', 'รูปแบบเวอร์ชันต้องเป็น 1.2.3');
      if (key.endsWith('Url') && value) {
        let url; try { url = new URL(value); } catch { throw new HttpsError('invalid-argument', 'URL ไม่ถูกต้อง'); }
        if(key==='playStoreUrl'){if(value!=='market://details?id=com.campusmate.app')throw new HttpsError('invalid-argument','ใช้ market://details?id=com.campusmate.app เท่านั้น');out[key]=value;continue;}
        const valid = key === 'appStoreUrl' ? url.hostname === 'apps.apple.com' : url.hostname === 'play.google.com';
        if (url.protocol !== 'https:' || !valid) throw new HttpsError('invalid-argument', 'ใช้ URL ร้านค้าอย่างเป็นทางการเท่านั้น');
      }
    }
    out[key] = value;
  }
  const compare = (a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]-y[i]; return 0; };
  if (out.minVersion && out.latestVersion && compare(out.minVersion,out.latestVersion)>0) throw new HttpsError('invalid-argument', 'เวอร์ชันขั้นต่ำต้องไม่สูงกว่าเวอร์ชันล่าสุด');
  if (out.forceUpdate && (!out.latestVersion || !out.playStorePublished || !out.enabled)) throw new HttpsError('invalid-argument', 'บังคับอัปเดตได้เมื่อเปิดแจ้งเตือนและเผยแพร่เวอร์ชันบน Play Store แล้ว');
  return out;
}
