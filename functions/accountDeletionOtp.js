import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

const TTL = 10 * 60_000;
const RECENT_AUTH = 5 * 60_000;
const RESEND_INTERVAL = 60_000;
const MAX_ATTEMPTS = 5;
const digest = (id, code) => createHash('sha256').update(`${id}:${code}`).digest('hex');
const emailOf = record => String(record.email || '').trim().toLowerCase();

// This collection is server-only. Never trust the legacy client-writable
// accountDeletionOtps document as authorization for an irreversible operation.
export function createAccountDeletionOtp({ db, auth, sendEmail, now = Date.now }) {
  const refFor = uid => db.doc(`accountDeletionChallenges/${uid}`);
  function uidOf(request) {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อน');
    return request.auth.uid;
  }
  async function send(request) {
    const uid = uidOf(request);
    const email = emailOf(await auth.getUser(uid));
    if (!email) throw new HttpsError('failed-precondition', 'ไม่พบบัญชีอีเมลปัจจุบัน');
    const id = randomUUID(), code = String(randomInt(100000, 1000000));
    const ref = refFor(uid), createdAt = now();
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists && createdAt - previous.get('createdAt') < RESEND_INTERVAL) {
        throw new HttpsError('resource-exhausted', 'กรุณารอ 1 นาทีก่อนขอรหัสใหม่');
      }
      tx.set(ref, { id, email, codeHash: digest(id, code), createdAt, expiresAt: createdAt + TTL,
        purgeAt: Timestamp.fromMillis(createdAt + TTL), attempts: 0, state: 'sending' });
    });
    try {
      await sendEmail({ email, code });
    } catch {
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (snapshot.get('id') === id) tx.update(ref, { state: 'failed' });
      });
      throw new HttpsError('unavailable', 'ส่งอีเมลยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
    const accepted = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (snapshot.get('id') !== id) return false;
      tx.update(ref, { state: 'sent' });
      return true;
    });
    if (!accepted) throw new HttpsError('aborted', 'คำขอเปลี่ยนแล้ว กรุณาใช้รหัสล่าสุด');
    return { sent: true, email };
  }
  async function verify(request) {
    const uid = uidOf(request), code = String(request.data?.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'กรุณาระบุรหัสยืนยัน 6 หลัก');
    const email = emailOf(await auth.getUser(uid));
    const error = await db.runTransaction(async tx => {
      const ref = refFor(uid), snapshot = await tx.get(ref), data = snapshot.data();
      if (!data || data.email !== email || now() >= data.expiresAt || !['sent', 'verified'].includes(data.state)) {
        return new HttpsError('failed-precondition', 'ไม่พบคำขอที่ใช้ได้ กรุณาขอรหัสใหม่');
      }
      if (data.attempts >= MAX_ATTEMPTS) return new HttpsError('resource-exhausted', 'รหัสถูกล็อก กรุณาขอรหัสใหม่');
      const actual = Buffer.from(digest(data.id, code), 'hex');
      const expected = Buffer.from(data.codeHash, 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
        // Return the error after commit so wrong attempts cannot roll back.
        tx.update(ref, { attempts: data.attempts + 1 });
        return new HttpsError('permission-denied', 'รหัสยืนยันจากอีเมลไม่ถูกต้อง');
      }
      tx.update(ref, { state: 'verified', verifiedAt: now() });
      return null;
    });
    if (error) throw error;
    return { verified: true };
  }
  async function authorize(request) {
    const uid = uidOf(request), authTime = Number(request.auth.token?.auth_time) * 1000;
    if (!Number.isFinite(authTime) || authTime > now() + 60_000 || now() - authTime > RECENT_AUTH) {
      throw new HttpsError('failed-precondition', 'กรุณายืนยันรหัสผ่านอีกครั้งก่อนลบบัญชี');
    }
    const [snapshot, user] = await Promise.all([refFor(uid).get(), auth.getUser(uid)]);
    const data = snapshot.data();
    if (!data || data.state !== 'verified' || !Number.isFinite(data.verifiedAt)
      || data.attempts >= MAX_ATTEMPTS || now() >= data.expiresAt || data.email !== emailOf(user)) {
      throw new HttpsError('failed-precondition', 'กรุณายืนยันรหัส OTP ก่อนลบบัญชี');
    }
    return { uid, challengeId: data.id };
  }
  async function complete({ uid, challengeId }) {
    await db.runTransaction(async tx => {
      const ref = refFor(uid), snapshot = await tx.get(ref);
      if (snapshot.get('id') === challengeId) tx.delete(ref);
    });
  }
  return { send, verify, authorize, complete };
}
