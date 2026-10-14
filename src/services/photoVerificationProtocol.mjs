// Photo verification flow against the Rust backend. Pure logic, no React
// Native imports, so it can be tested with node.
//
// The native liveness screen only streams video to AWS; its callback is not
// evidence. The decision always comes from POST .../complete on the server.

export const PHOTO_BADGE = 'PHOTO_VERIFIED';
/** AWS Face Liveness without the flashing colour sequence (photosensitivity). */
export const NO_FLASH_CHALLENGE = 'FACE_MOVEMENT';
export const ALTERNATIVE_REASONS = ['PHOTOSENSITIVITY', 'CAMERA_UNAVAILABLE', 'ACCESSIBILITY', 'OTHER'];
const CHALLENGES = ['FACE_MOVEMENT_AND_LIGHT', NO_FLASH_CHALLENGE];
const STATUSES = ['UNVERIFIED', 'VERIFIED', 'LEGACY', 'REVIEW_REQUIRED', 'REVOKED'];

const MESSAGES = {
  CONSENT_REQUIRED: 'กรุณาอ่านและยินยอมการประมวลผลภาพใบหน้าก่อนเริ่ม',
  RATE_LIMITED: 'ลองยืนยันหลายครั้งเกินไป กรุณารอประมาณ 30 นาทีแล้วลองใหม่',
  VERIFICATION_IN_PROGRESS: 'มีการยืนยันที่ยังไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่',
  ALREADY_VERIFIED: 'รูปโปรไฟล์นี้ยืนยันแล้ว',
  REFERENCE_UNAVAILABLE: 'กรุณาตั้งรูปโปรไฟล์หลักผ่านแอปก่อนยืนยันใบหน้า',
  REFERENCE_UNUSABLE: 'รูปโปรไฟล์หลักใช้เปรียบเทียบไม่ได้ กรุณาอัปโหลดรูปที่เห็นใบหน้าชัด',
  IDENTITY_UNAVAILABLE: 'ระบบยืนยันใบหน้ายังไม่เปิดให้ใช้งาน',
  SERVICE_UNAVAILABLE: 'ระบบยืนยันใบหน้าไม่พร้อม กรุณาลองใหม่ภายหลัง',
  AWAITING_RESULT: 'ยังไม่ได้รับผลการตรวจ กรุณาลองอีกครั้ง',
  SESSION_EXPIRED: 'หมดเวลาการตรวจ กรุณาเริ่มใหม่',
  IMAGE_CHANGED: 'รูปโปรไฟล์เปลี่ยนระหว่างตรวจ กรุณาเริ่มใหม่',
  LIVENESS_NOT_CONFIRMED: 'ยืนยันใบหน้าจริงไม่สำเร็จ กรุณาอยู่ในที่สว่าง มองกล้องตรง แล้วลองใหม่',
  FACE_NOT_MATCHED: 'ใบหน้าไม่ตรงกับรูปโปรไฟล์หลัก กรุณาใช้รูปหลักที่เห็นใบหน้าตนเองชัดเจน',
  REFERENCE_IMAGE_MISSING: 'ระบบยังได้ภาพไม่ครบ กรุณาลองใหม่',
  REFERENCE_TAMPERED: 'ตรวจพบความผิดปกติของรูปอ้างอิง กรุณาเริ่มใหม่',
  REVIEW_REQUIRED: 'ส่งให้เจ้าหน้าที่ตรวจสอบแล้ว ผลจะแสดงในแอปเมื่อพิจารณาเสร็จ',
  REVIEW_REJECTED: 'เจ้าหน้าที่ตรวจแล้วยืนยันไม่ได้ กรุณาลองใหม่ด้วยรูปหลักที่เห็นใบหน้าชัด',
  NOT_APPEALABLE: 'รายการนี้ขอทบทวนไม่ได้',
  CAMERA_UNAVAILABLE: 'เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้องในการตั้งค่า',
  CANCELLED: 'ยกเลิกการยืนยันใบหน้าแล้ว',
  NATIVE_UNAVAILABLE: 'แอปเวอร์ชันนี้ยังไม่รองรับการตรวจใบหน้าจริง กรุณาอัปเดตแอป',
};

export function messageFor(code) {
  return MESSAGES[code] || 'ยืนยันใบหน้าไม่สำเร็จ กรุณาลองใหม่';
}

function codeOf(error) {
  return error?.details?.reason || error?.code || 'SERVICE_UNAVAILABLE';
}

function failure(code) {
  return { status: 'FAILED', badge: null, reason: code, message: messageFor(code) };
}

/** Keep only the public decision fields; drop anything else the server sends. */
export function publicDecision(value = {}) {
  const status = typeof value.status === 'string' ? value.status : 'FAILED';
  return {
    verificationId: typeof value.verificationId === 'string' ? value.verificationId : null,
    status,
    badge: value.badge === PHOTO_BADGE && status === 'VERIFIED' ? PHOTO_BADGE : null,
    verifiedAt: status === 'VERIFIED' && typeof value.verifiedAt === 'string' ? value.verifiedAt : null,
    reason: status === 'VERIFIED' ? null : (typeof value.reason === 'string' ? value.reason : null),
  };
}

/** The caller's badge state. `LEGACY` badges came from the old selfie check. */
export function publicStatus(value = {}) {
  const status = STATUSES.includes(value.status) ? value.status : 'UNVERIFIED';
  const badge = value.badge === PHOTO_BADGE && (status === 'VERIFIED' || status === 'LEGACY') ? PHOTO_BADGE : null;
  return {
    status,
    badge,
    verifiedAt: status === 'VERIFIED' && typeof value.verifiedAt === 'string' ? value.verifiedAt : null,
    needsReverification: status === 'LEGACY',
    legacyGraceUntil: status === 'LEGACY' && typeof value.legacyGraceUntil === 'string' ? value.legacyGraceUntil : null,
    reviewPending: value.reviewPending === true,
    alternativeRequest: value.alternativeRequest === 'OPEN' ? 'OPEN' : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function cleanNote(note) {
  const text = typeof note === 'string' ? note.trim() : '';
  return text ? [...text].slice(0, 500).join('') : undefined;
}

/**
 * @param client     `{ request(path, { method, body }) }` from rustBackendClient
 * @param bridge     `{ isAvailable(), present({ sessionId, region, challenge, credentials }) }`
 * @param syncBadge  optional `() => { badge }`: asks the server to mirror its
 *                   decision into the profile badge others see. Never decides.
 */
export function createPhotoVerification({ client, bridge, consentVersion, syncBadge = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  /** true when the profile badge now matches a VERIFIED decision. */
  async function mirror() {
    if (typeof syncBadge !== 'function') return false;
    try {
      return (await syncBadge())?.badge === PHOTO_BADGE;
    } catch {
      return false;
    }
  }

  async function complete(id) {
    // Results can lag the stream briefly; retry a few times, never past expiry.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return publicDecision(await client.request(`/v1/identity/photo-verifications/${id}/complete`, { method: 'POST', body: {} }));
      } catch (error) {
        if (codeOf(error) !== 'AWAITING_RESULT' || attempt === 3) throw error;
        await sleep(1500 * (attempt + 1));
      }
    }
    throw Object.assign(new Error(messageFor('AWAITING_RESULT')), { code: 'AWAITING_RESULT' });
  }

  return {
    async status() {
      return publicStatus(await client.request('/v1/identity/photo-verification', { method: 'GET' }));
    },

    /**
     * `consent` must come from an explicit user action on the consent screen.
     * `noFlash` asks AWS for the movement-only check (no flashing lights).
     */
    async run({ consent, noFlash = false, onStage = () => {} } = {}) {
      if (consent !== true) return failure('CONSENT_REQUIRED');
      if (!bridge?.isAvailable?.()) return failure('NATIVE_UNAVAILABLE');
      let session;
      try {
        onStage('creating');
        const body = { consent: true, consentVersion };
        if (noFlash === true) body.challenge = NO_FLASH_CHALLENGE;
        session = await client.request('/v1/identity/photo-verifications', { method: 'POST', body });
      } catch (error) {
        return failure(codeOf(error));
      }
      if (!UUID.test(session?.verificationId || '') || typeof session?.sessionId !== 'string') {
        return failure('SERVICE_UNAVAILABLE');
      }
      // The server decides the challenge; never let a reply widen it to the
      // flashing check after the person asked for the no-flash one.
      const challenge = CHALLENGES.includes(session.challenge) ? session.challenge : 'FACE_MOVEMENT_AND_LIGHT';
      if (noFlash === true && challenge !== NO_FLASH_CHALLENGE) return failure('SERVICE_UNAVAILABLE');
      onStage('capturing');
      let streamed;
      try {
        // Credentials stay in memory for this call only and are never logged.
        streamed = await bridge.present({
          sessionId: session.sessionId, region: session.region, challenge, credentials: session.credentials,
        });
      } catch (error) {
        const code = ['CANCELLED', 'CAMERA_UNAVAILABLE', 'SESSION_EXPIRED'].includes(error?.code) ? error.code : 'SERVICE_UNAVAILABLE';
        // An abandoned attempt simply expires on the server.
        return failure(code);
      }
      if (!streamed?.streamCompleted) return failure('CANCELLED');
      onStage('checking');
      try {
        const decision = await complete(session.verificationId);
        if (decision.status !== 'VERIFIED') return { ...decision, message: messageFor(decision.reason || decision.status) };
        const badgeSynced = await mirror();
        return {
          ...decision,
          badgeSynced,
          message: badgeSynced ? 'ยืนยันใบหน้าสำเร็จ' : 'ยืนยันใบหน้าสำเร็จ เครื่องหมายจะแสดงบนโปรไฟล์เมื่อระบบซิงก์เสร็จ',
        };
      } catch (error) {
        return failure(codeOf(error));
      }
    },

    /** Ask a person to look at a failed or ambiguous attempt. */
    async appeal(verificationId, note) {
      if (!UUID.test(verificationId || '')) return { ok: false, reason: 'NOT_APPEALABLE', message: messageFor('NOT_APPEALABLE') };
      try {
        const body = {};
        const text = cleanNote(note);
        if (text) body.note = text;
        await client.request(`/v1/identity/photo-verifications/${verificationId}/appeal`, { method: 'POST', body });
        return { ok: true };
      } catch (error) {
        const code = codeOf(error);
        return { ok: false, reason: code, message: messageFor(code) };
      }
    },

    /** For people who cannot take any camera check. Never grants a badge. */
    async requestAlternative({ reason, note } = {}) {
      if (!ALTERNATIVE_REASONS.includes(reason)) return { ok: false, reason: 'INVALID_REASON', message: 'กรุณาเลือกเหตุผล' };
      try {
        const body = { reason };
        const text = cleanNote(note);
        if (text) body.note = text;
        const value = await client.request('/v1/identity/photo-verification/alternative', { method: 'POST', body });
        return { ok: true, requestId: typeof value?.requestId === 'string' ? value.requestId : null };
      } catch (error) {
        const code = codeOf(error);
        return { ok: false, reason: code, message: messageFor(code) };
      }
    },

    /** Re-mirror the server decision into the profile badge (self-heal). */
    syncBadge: mirror,

    /** Remove the badge and every stored verification image of the caller. */
    async deleteVerification() {
      try {
        await client.request('/v1/identity/photo-verification', { method: 'DELETE' });
        await mirror();
        return { ok: true };
      } catch (error) {
        const code = codeOf(error);
        return { ok: false, reason: code, message: messageFor(code) };
      }
    },
  };
}
