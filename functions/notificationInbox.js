import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const INBOX_DAYS = 90;
export const inboxId = (key, uid) => createHash('sha256').update(`${key}:${uid}`).digest('hex');
export function inboxPayload(notification, now = Date.now()) {
  const data = notification.data || {};
  const type = String(data.type || 'system');
  const target = {};
  for (const field of ['conversationId', 'messageId', 'partyId', 'appointmentId', 'route']) {
    if (typeof data[field] === 'string') target[field] = data[field].slice(0, 200);
  }
  // Never persist a plaintext preview or private like identity in the inbox.
  return {
    type, title: String(notification.title || 'CampusMate').slice(0, 180),
    body: ['message', 'group_message'].includes(type) ? 'คุณมีข้อความใหม่ แตะเพื่อเปิดแชต' : String(notification.body || '').slice(0, 2000),
    target, readAt: null, createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + INBOX_DAYS * 86400000),
  };
}
export async function persistInbox(db, key, uid, notification) {
  const id = inboxId(key, uid), ref = db.doc(`users/${uid}/notifications/${id}`);
  try { await ref.create(inboxPayload(notification)); }
  catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
  return id;
}
export async function syncFaceInbox(db, uid, user) {
  if (!user) return;
  const ref = db.doc(`users/${uid}/notifications/face-verification`);
  await db.runTransaction(async (tx) => {
    const [old, current] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${uid}`))]);
    if (!current.exists) return;
    const verified = current.get('isFaceVerified') === true;
    if (!old.exists) {
      if (verified) return;
      tx.create(ref, { type: 'face_verification', title: 'ยืนยันใบหน้าเพื่อเปิดโปรไฟล์',
        body: 'โปรไฟล์ของคุณจะแสดงให้คนอื่นเห็นหลังยืนยันใบหน้า เตรียมอยู่ในที่สว่างและทำตามคำแนะนำบนหน้าจอ ระหว่างนี้คุณยังคุยกับเพื่อนที่จับคู่ไว้แล้วได้',
        target: {}, status: 'required', readAt: null, createdAt: FieldValue.serverTimestamp(), expiresAt: null });
    } else if (old.get('status') !== (verified ? 'completed' : 'required')) {
      tx.update(ref, { status: verified ? 'completed' : 'required',
        title: verified ? 'ยืนยันใบหน้าสำเร็จแล้ว' : 'ยืนยันใบหน้าเพื่อเปิดโปรไฟล์',
        body: verified ? 'คุณยืนยันใบหน้าแล้ว โปรไฟล์พร้อมแสดงตามการตั้งค่าความเป็นส่วนตัวของคุณ' : 'ยืนยันใบหน้าอีกครั้งเพื่อให้โปรไฟล์ของคุณแสดงให้คนอื่นเห็น',
        readAt: verified ? old.get('readAt') : null,
        expiresAt: verified ? Timestamp.fromMillis(Date.now() + INBOX_DAYS * 86400000) : null });
    }
  });
}
