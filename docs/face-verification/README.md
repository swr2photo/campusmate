# CampusMate — ยืนยันใบหน้า (Rekognition Face Liveness + CompareFaces)

สเปกอ้างอิง: [`docs/CampusMate_S_Tier_Face_Verification.md`](../CampusMate_S_Tier_Face_Verification.md) (เนื้อหาเดียวกับ blueprint ของ skill `campusmate-face-verification-rekognition`)
วันที่: 12 ตุลาคม 2026 • สถานะ: **ยังไม่ deploy production และยังไม่แตะข้อมูลชีวมิติจริง**

ตราที่ได้คือ `PHOTO_VERIFIED` = "คนที่ทำ liveness อยู่จริงและหน้าคล้ายรูปโปรไฟล์ที่ปักหมุดไว้" ไม่ใช่การยืนยันตัวตนตามกฎหมาย สถานะนักศึกษา หรือสิทธิ์เข้าสู่ระบบ

---

## Phase 0 — ผลตรวจระบบเดิม (Firebase Functions + Expo)

ระบบที่ใช้งานจริงตอนนี้คือ `functions/faceVerification.js` + `src/components/FaceVerificationModal.js`

| # | ช่องโหว่ / ช่องว่าง | ความรุนแรง | หลักฐาน | สถานะ |
|---|---|---|---|---|
| V1 | **ข้ามการตรวจใบหน้าได้ด้วยการแก้อีเมลในเอกสารโปรไฟล์ตัวเอง**: auto-verify อ่าน `users/{uid}.email` ซึ่ง client เขียนได้ (`firestore.rules` → `validPrivateProfile` อนุญาต `email` แค่เป็น string ≤ 320 ตัว) ตั้งเป็น `6710210317@psu.ac.th` แล้วได้ตรายืนยันพร้อมคะแนน 100 โดยไม่ถ่ายหน้า | **Critical** | `faceVerification.js` (เดิม) บรรทัด 217, 299–334 | แก้แล้ว (1A) |
| V2 | **ไม่มี liveness จริง**: Face Liveness **ไม่มีใน `ap-southeast-2`** ที่ระบบตั้งไว้ (ภูมิภาคที่รองรับ: N. Virginia, Oregon, Ireland, Tokyo, Mumbai, São Paulo, Malaysia, Thailand) `CreateFaceLivenessSession` จึงล้มแล้ว fallback เป็น session สุ่ม ที่ใช้จริงคือภาพนิ่งจากกล้อง + CompareFaces ภาพถ่ายของภาพถ่ายก็ผ่านได้ | **High** | `faceVerification.js` เดิม 228–242, 338–380; AWS Face Liveness FAQ | ระบบใหม่ (1B/2) ใช้ liveness จริง; ระบบเดิมยังเป็นภาพนิ่ง (ดู Blockers) |
| V3 | **เปลี่ยนรูปหลังยืนยันแล้วตรายังอยู่**: แอปยืนยันกับรูปเก่าแล้วบันทึกรูปใหม่ทีหลัง และ server ไม่เพิกถอนตราเมื่อรูปเปลี่ยน | **High** | `ProfileScreen.js`, `ProfilePhotosScreen.js` (เดิม) | แก้แล้ว (1A, 1B) |
| V4 | ส่งเซลฟีซ้ำได้ไม่จำกัดใน session เดียว (15 นาที) ใช้ไต่หาเกณฑ์ได้ และ `complete` สองครั้งพร้อมกันประเมินซ้ำได้ | Medium | `verifyFaceMatch` เดิมไม่มี transaction | แก้แล้ว (1A) |
| V5 | **คะแนนดิบรั่ว**: ส่ง `similarity` กลับ client, เขียน `faceMatchScore` ลงเอกสาร และ copy ไป `profiles`/`discoveryProfiles` ที่คนอื่นอ่านได้, แสดง "ความตรงกัน 93%" | Medium | `discoveryProfile.js` 360/424, modal, logs | แก้แล้ว (1A, 1B) |
| V6 | Server ดึงรูปจาก URL ที่ผู้ใช้กำหนด (`avatarUri`) โดยไม่จำกัด host/ขนาด/ชนิด (SSRF, ไฟล์ใหญ่, MIME ปลอม) | Medium | `verifyFaceMatch` เดิม 416–430 | แก้แล้ว (1A); 1B อ่านจาก R2 ตาม key ของเจ้าของเท่านั้น |
| V7 | ไม่มี rate limit (ต้นทุน AWS + brute force) | Medium | — | แก้แล้ว (1A, 1B) |
| V8 | Log มี uid + คะแนน | Low | `faceVerificationFunctions.js` เดิม | แก้แล้ว (1A) |
| V9 | ใช้ IAM access key ถาวร (`functions/.env`, ไม่ได้ commit) ฝั่ง server | Low | ตรวจแค่การมีอยู่ ไม่ได้แสดงค่า | 1B ใช้ default credential chain (แนะนำ OIDC จาก Fly) |
| V10 | เกณฑ์ 85/85 hard-code ไม่ผ่านการ calibrate, ไม่มี consent/retention/appeal | Medium | — | 1B: policy version + ไม่มีค่า default + consent + appeal + ลบ snapshot |
| V11 | รูปโปรไฟล์ใน R2 ใช้ key เดิมซ้ำ (`users/{uid}/avatar.jpg`) จึง overwrite ได้ ไม่ใช่ reference ที่ immutable | Medium | `src/utils/imagePolicy.js` | 1B ทำ snapshot ส่วนตัว + SHA-256 |
| V12 | **อีเมลปลอมในโปรไฟล์ยังให้สิทธิ์ admin ที่อื่น**: `ensureNotificationInbox` และ rewind ใน `matchingActions.js` เชื่ออีเมลจากเอกสาร `users/{uid}` และ rules ปล่อยให้ client เขียนอีเมลอะไรก็ได้ | **High** | `functions/index.js`, `matchingActions.js`, `firestore.rules` | แก้แล้ว: ใช้ `isVerifiedSuperAdmin(token)` + rules `emailFieldAllowed()` ผูก `email` กับอีเมลใน token (ค่าเดิมที่ไม่ตรงคงไว้ได้ แต่เปลี่ยนเป็นของคนอื่นไม่ได้) |
| V13 | Admin ปฏิเสธ review แล้ว `user_photo_verifications` ค้างเป็น `REVIEW_REQUIRED` (ผู้ใช้เห็น "รอตรวจ" ตลอด) | Low | `identity.rs` (1B เดิม) | แก้แล้ว |
| V14 | ลำดับ lock ใน admin decision (review → attempt → profile) สวนทางกับการเพิกถอน (profile → attempt) อาจ deadlock | Low | `identity.rs` (1B เดิม) | แก้แล้ว: ล็อก profile ก่อนเสมอ |
| V15 | ผู้ตรวจอนุมัติได้โดยไม่ต้องดูภาพ และไม่มีภาพจาก liveness ให้ดู (มีแค่ snapshot) | Medium | `identity.rs` (1B เดิม) | แก้แล้ว: เก็บเฟรม liveness เป็นหลักฐานเฉพาะเคสรอตรวจ + ต้องเปิดดูก่อนอนุมัติ (audit) |

หมายเหตุ: บัญชี super admin ในระบบ Firebase เดิมยังยืนยันอัตโนมัติได้ แต่ตอนนี้ต้องเป็นอีเมลจาก Firebase ID token ที่ `email_verified=true` เท่านั้น และ `autoVerifyFace` เป็น field ที่ client เขียนไม่ได้ (rules ไม่อนุญาต) ควรพิจารณาย้ายไปเป็น manual review แบบมี audit (Phase 3)

---

## Phase 1A — Hotfix ระบบเดิม (Firebase) • โค้ดพร้อม ยังไม่ deploy

**ไฟล์ที่แก้**
- `functions/faceVerification.js` — admin shortcut ใช้เฉพาะอีเมลที่ยืนยันแล้วจาก token, session ใช้ได้ครั้งเดียว (transaction `PENDING→PROCESSING`), rate limit (ล้มเหลวจากการเทียบหน้า 5 ครั้งใน 3 นาที → พัก 30 นาที; สร้าง session ได้ 20 ครั้งต่อชั่วโมง), จำกัด host ของรูป + `redirect:'error'` + timeout + ≤ 5 MB + ตรวจ signature JPEG/PNG ทั้งรูปและเซลฟี, ไม่ส่งหรือเก็บคะแนน, ไม่สร้าง AWS liveness session ที่ไม่ได้ใช้แล้ว (ลดต้นทุน), เพิ่ม `shouldRevokeFaceVerification`
- `functions/faceVerificationFunctions.js` — ส่ง `email`/`email_verified` จาก token, log แค่รหัสผลลัพธ์, rate limit ตอบ `resource-exhausted`
- `functions/index.js` — `syncPublicProfile` เพิกถอนตราบน server เมื่อรูปหลักหรือ `avatarRevision` เปลี่ยน
- `functions/discoveryProfile.js` — projection สาธารณะไม่มี `faceMatchScore`
- แอป: `FaceVerificationModal.js` (ไม่ reuse session, ไม่แสดง %), `ProfileScreen.js`, `ProfilePhotosScreen.js`, `ProfileSetupScreen.js` (**บันทึกรูปก่อน แล้วค่อยยืนยันกับรูปที่บันทึก**), `ProfileHubScreen.js`, `FaceVerificationPrompt.js`, `AppContext.js` (`markFaceVerified` ไม่สร้างคะแนนเอง)

- `firestore.rules` / `firestore.secure.rules` — `emailFieldAllowed()` (V12); secure rules สร้างใหม่ด้วย `node scripts/prepare-secure-profile-rules.mjs`

**ผลทดสอบ**
- `cd functions && node --test`: **225/225 PASS** (`faceVerification.test.js` 21 tests: replay, race 2 คำขอ, ปลอมอีเมลในโปรไฟล์, อีเมลที่ยังไม่ยืนยัน, SSRF 8 แบบ, ไฟล์ปลอม/ใหญ่เกิน, cooldown, เพดาน session, กฎเพิกถอน, fail-closed; `adminPolicy.test.js` ต้องมี `email_verified`)
- Firestore emulator: `test-profile-email-rules.mjs` (ใหม่ ทั้งสองไฟล์ rules), `test-secure-profile-rules`, `test-release-profile-rules` (privacy + inbox + gallery), `test-profile-read-privacy-rules`, `firestore-rules-smoke`, `test-admin-restriction-rules`, `test-chat-video-rules`, `test-party-rules`: **ทั้งหมด PASS**
  - แก้ test ที่ล้าสมัย (ไม่ได้ผ่อน rules): gallery test ยังคาดเพดาน 5 รูปแต่ rules ขยายเป็น 8 ตั้งแต่ `a70884f`; smoke test ยังคาดว่าอ่านโปรไฟล์คนอื่นได้ (ปิดตั้งแต่ `36ff010`) และเขียน field `location` ที่ rules เลิกรับแล้ว; fixture token ไม่มี email claim
- ยังไม่ได้รันบนอุปกรณ์จริง: **NOT RUN**

**Deploy (ต้องได้รับอนุญาตก่อน)**
```bash
cd functions
firebase deploy --only functions:startFaceVerificationSession,functions:completeFaceVerification,functions:syncPublicProfile,functions:syncDiscoveryProfile,functions:ensureNotificationInbox,functions:switchAdminMode,functions:rewindDiscoveryAction --project campusmate-7f1ab
firebase deploy --only firestore:rules --project campusmate-7f1ab
```
ตั้ง `FACE_AVATAR_ALLOWED_HOSTS` ให้ตรงกับโดเมน CDN ของรูปโปรไฟล์ (หรือใช้ `CLOUDFLARE_R2_CDN_DOMAIN` ที่มีอยู่) ก่อน deploy ไม่งั้นการยืนยันจะตอบ `avatar_untrusted_host`
แอปต้องออกเวอร์ชันใหม่พร้อมกัน: แอปเก่าจะ reuse session หลังล้มเหลว ซึ่งตอนนี้ได้ `session_already_used` (ผู้ใช้แค่ต้องลองใหม่)

**ผลกระทบ**: ผู้ใช้ที่เปลี่ยนรูปหลักจะถูกเพิกถอนตราและหายจากหน้าค้นหาจนกว่าจะยืนยันใหม่ ถ้าแก้ field อื่นจะไม่ถูกเพิกถอน คะแนนเดิมในเอกสารเก่ายังอยู่จนกว่าจะยืนยันครั้งถัดไป (ไม่ได้รัน migration ข้อมูล)

**Rollback**: `git revert` commit ของ Phase 1A แล้ว deploy functions + rules ชุดเดิม ข้อมูลไม่ต้องย้อน (เพิ่มแค่คอลเลกชัน `faceVerifications`, `faceVerificationThrottle` ซึ่ง rules ปิดไว้แล้วด้วย catch-all deny) ถ้ามีปัญหาเฉพาะ rule อีเมล ให้ลบ `&& emailFieldAllowed()` สองจุดใน `match /users/{userId}` แล้ว deploy rules อย่างเดียว

---

## การตัดสินใจ (12 ต.ค. 2026)

| # | เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|---|
| D1 | เกณฑ์ตัดสิน | **โหมด `manual` เป็นค่าเริ่มต้น**: ผลที่ AWS ยืนยันว่าเป็นคนจริงและพบใบหน้าที่เทียบได้ → `REVIEW_REQUIRED` ให้คนตรวจ ไม่มีการอนุมัติอัตโนมัติจนกว่าจะตั้ง `FACE_DECISION_MODE=automatic` พร้อมเกณฑ์ทั้ง 4 ค่าจากการ calibrate | สเปกห้ามเดาเกณฑ์ (บรรทัด 47, 173) |
| D2 | ทางเลือกสำหรับผู้ไวต่อแสง | ใช้ `FaceMovementChallenge` (ไม่มีแสงกะพริบ) ผ่าน `challenge: "FACE_MOVEMENT"` ยังเป็น liveness ที่ server ตัดสิน แต่**ไม่อนุมัติอัตโนมัติ** (ส่ง review เสมอ) และถ้า AWS รายงาน challenge ที่อ่อนกว่าที่ขอ จะตัดสินตามตัวที่อ่อนกว่า | สเปกบรรทัด 175, 217; คงหลักว่าตราต้องมาจาก liveness |
| D3 | คนที่ตรวจด้วยกล้องไม่ได้เลย | ยื่น `POST /v1/identity/photo-verification/alternative` ให้เจ้าหน้าที่ติดต่อ (เช่น ช่วยทำบนอุปกรณ์อื่น) **การปิดคำขอไม่ให้ตรา** | release gate ของ skill: ตรามาจาก liveness เท่านั้น |
| D4 | หลักฐานสำหรับผู้ตรวจ | เก็บเฟรมอ้างอิงจาก AWS (ไม่ใช่ audit images; `AuditImagesLimit=0` เหมือนเดิม) ใน bucket ส่วนตัว **เฉพาะเคส review** ลบพร้อม snapshot ภายใน 14 วันหรือทันทีที่ตัดสิน/เพิกถอน การเปิดดูต้องเป็น admin ที่ไม่ใช่เจ้าของ และบันทึก audit ก่อนอ่านภาพ การอนุมัติต้องเปิดดูก่อน | สเปกบรรทัด 185, 206 (มีเหตุผลชัด, ลบตามกำหนด, เข้าถึงแคบ, audit) |
| D5 | ตราจากระบบเดิม (ไม่มี liveness) | สถานะ `LEGACY` + `needsReverification` ตรายังแสดง ตั้ง `FACE_LEGACY_GRACE_UNTIL` (RFC 3339) เพื่อให้ sweeper เพิกถอนหลังวันนั้น ถ้าไม่ตั้งจะคงไว้ attempt ที่กำลังทำอยู่ไม่ถูกยกเลิก | ไม่ทำให้ผู้ใช้เดิมหายจากหน้าค้นหาทันที |
| D6 | บัญชีที่ถูกลบ (`accounts.deleted_at`) | sweeper ลบข้อมูลยืนยัน: เพิกถอนตรา, ปิดคำขอ, ลบข้อความ note, ลบภาพทั้งหมด audit event คงไว้ (ไม่มีภาพ/note) | PDPA / สเปกบรรทัด 219 |
| D7 | `DELETE /v1/identity/photo-verification` | นอกจากเพิกถอน+ลบภาพ ยังปิดคำขอ review/alternative ที่ค้างและลบ note ของผู้ใช้ | "ลบข้อมูลของฉัน" ต้องครบ |
| D8 | แอป | ใช้หน้าจอใหม่เมื่อ build ตั้ง `EXPO_PUBLIC_FACE_LIVENESS=true` **และ** มี native module เท่านั้น ไม่งั้นใช้ flow เดิม | ไม่มีปุ่มที่กดแล้วใช้ไม่ได้ |
| D9 | super admin ใน Firebase เดิม | คงทางลัดไว้แต่ต้องมี `email_verified` จาก token (Rust backend ไม่มีทางลัดนี้) | ความเสี่ยงที่เหลือ = บัญชี admin ถูกยึด |

---

## Phase 1B — Backend ใหม่ (Rust/Axum/SQLx + Neon + R2) • ทดสอบผ่าน ยังไม่ deploy

**ไฟล์**
- `rust-backend/migrations/0005_photo_verification.sql` — `face_attempt_state`, `face_verification_attempts` (one-active index, `challenge`, `evidence_key`/`evidence_stored`), `user_photo_verifications` (`method` = `LIVENESS`/`HUMAN_REVIEW`), `identity_verification_audit_events`, `identity_review_requests` (`viewed_by`, สถานะ `WITHDRAWN`), `identity_alternative_requests` (เปิดได้ 1 คำขอต่อคน) เก็บแค่สถานะ/รหัส/key/SHA-256 ไม่มีภาพหรือคะแนน (migration ยังไม่เคย deploy จึงแก้ไฟล์เดิม)
- `rust-backend/operations/runtime-grants.sql` + `src/bin/check-database.rs` — grant ระดับ column ของ `campusmate_api` สำหรับ column/ตารางใหม่ (ไม่มี DELETE, อ่าน audit ไม่ได้)
- `rust-backend/src/identity.rs` — state machine `CREATING→CREATED→IN_PROGRESS→PROCESSING→VERIFIED|REVIEW_REQUIRED|FAILED|EXPIRED`, `REVOKED`; decision policy แบบ versioned (ไม่มีค่า default), claim แบบ atomic (`UPDATE … WHERE state IN … RETURNING`), ไม่ถือ transaction ระหว่างเรียก AWS/R2, idempotent, reconcile + sweeper ทุก 60 วินาที, ลบ snapshot ทันทีหลังตัดสิน (เก็บ 14 วันเฉพาะรอ review), appeal, admin review (ตรวจ role สดจาก DB, ห้ามตัดสินของตัวเอง), DELETE = เพิกถอน + ลบ snapshot
- `rust-backend/src/identity_provider.rs` — AWS Rekognition (`CreateFaceLivenessSession` `AuditImagesLimit=0`, `GetFaceLivenessSessionResults`, `CompareFaces` **Bytes**), STS `AssumeRole` 15 นาทีพร้อม inline policy ที่อนุญาตแค่ `rekognition:StartFaceLivenessSession`, R2 ผ่าน S3 API (อ่านรูปตาม key ของเจ้าของ, เขียน snapshot แบบ `If-None-Match: *`), decode/re-encode ภาพด้วย `image` (จำกัด allocation, ≤ 1600px, ≤ 5 MB, ตัด metadata)
- `rust-backend/src/profiles.rs` — เปลี่ยน/ลบรูปหลัก = เพิกถอนตรา + ยกเลิก attempt ที่ค้าง (ใน transaction เดียวกัน)
- `rust-backend/src/lib.rs`, `main.rs`, `Cargo.toml`, `Cargo.lock` (เพิ่ม dependency ใหม่เท่านั้น ไม่ bump ตัวเดิม), `cloudbuild.test.yaml` (`--no-fail-fast`)
- `rust-backend/tests/identity.rs` 17 tests, `tests/discovery.rs` (fixture เก็บรูปเดิมไว้ เพราะการลบรูปตอนนี้เพิกถอนตรา)

**API**
| Endpoint | หน้าที่ |
|---|---|
| `GET /v1/identity/photo-verification` | สถานะ + badge |
| `POST /v1/identity/photo-verifications` `{consent:true, consentVersion}` | ตรวจ consent, throttle (ผู้ใช้/IP), snapshot รูปของเจ้าของ, สร้าง AWS session, คืน `{verificationId, sessionId, region, expiresAt, state, credentials}` |
| `POST /v1/identity/photo-verifications/{id}/complete` | server ดึงผล AWS เอง เทียบกับ snapshot ที่ปักหมุด แล้วบันทึกผลครั้งเดียว ไม่สนใจ body ของ client |
| `GET /v1/identity/photo-verifications/{id}` | สถานะ attempt ของตัวเองเท่านั้น (ของคนอื่นตอบ 404) |
| `POST …/{id}/appeal` | ขอทบทวน |
| `DELETE /v1/identity/photo-verification` | เพิกถอน + ลบ snapshot |
| `POST /v1/identity/photo-verifications` `{…, challenge:"FACE_MOVEMENT"}` | ตรวจแบบไม่มีแสงกะพริบ (ส่ง review เสมอ) |
| `POST /v1/identity/photo-verification/alternative` `{reason, note?}` | ขอวิธีอื่น (`PHOTOSENSITIVITY`/`CAMERA_UNAVAILABLE`/`ACCESSIBILITY`/`OTHER`) ซ้ำได้ คืนคำขอเดิม |
| `GET /v1/admin/identity-reviews` | คิว review + คำขอวิธีอื่น (ไม่รวมของตัวเอง ไม่มีภาพ/คะแนน) |
| `GET /v1/admin/identity-reviews/{id}/evidence` | snapshot + เฟรม liveness (base64) ตรวจ SHA-256 ของ snapshot บันทึก `EVIDENCE_VIEWED` ก่อนอ่าน |
| `POST /v1/admin/identity-reviews/{id}/decision` | `APPROVE` ต้องมีหลักฐานและผู้ตรวจคนนี้เปิดดูแล้ว, `REJECT` ล้างสถานะรอตรวจ + audit |
| `POST /v1/admin/identity-alternatives/{id}/decision` | `RESOLVED`/`DECLINED` ไม่ให้ตรา + audit |

`GET /v1/identity/photo-verification` คืน `status` (`UNVERIFIED`/`VERIFIED`/`LEGACY`/`REVIEW_REQUIRED`/`REVOKED`), `badge`, `verifiedAt`, `needsReverification`, `legacyGraceUntil`, `reviewPending`, `alternativeRequest`

รหัสผิดพลาดที่ปลอดภัย: `EVIDENCE_NOT_VIEWED`, `EVIDENCE_UNAVAILABLE`, `NOT_REVIEWABLE`, `NOT_APPEALABLE`, `CONSENT_REQUIRED`, `RATE_LIMITED`, `VERIFICATION_IN_PROGRESS`, `ALREADY_VERIFIED`, `REFERENCE_UNAVAILABLE`, `REFERENCE_UNUSABLE`, `AWAITING_RESULT`, `SESSION_EXPIRED`, `IMAGE_CHANGED`, `LIVENESS_NOT_CONFIRMED`, `FACE_NOT_MATCHED`, `REFERENCE_IMAGE_MISSING`, `REFERENCE_TAMPERED`, `REVIEW_REQUIRED`, `IDENTITY_UNAVAILABLE`

**ผลทดสอบ** (Cloud Build `748b41dc`, PostgreSQL 18 ชั่วคราว, 12 ต.ค. 2026): `cargo fmt --check` PASS • unit (lib) 50 PASS • `tests/identity.rs` **26/26 PASS** (ใหม่: โหมด manual, ตรวจแบบไม่มีแสง + AWS รายงาน challenge อ่อนกว่า, หลักฐาน/คิว/ต้องเปิดดูก่อนอนุมัติ, snapshot ถูกแก้ห้ามอนุมัติ, ปฏิเสธแล้วล้างสถานะ, legacy + grace, ขอวิธีอื่น, ลบบัญชีแล้วลบข้อมูล + sweep ซ้ำไม่ทำอะไร, บัญชีไม่มีโปรไฟล์, **ทุก flow ด้วยสิทธิ์ `campusmate_api` จริง**) • chat 7, discovery 7, matching 6, database_roles 1, bins 20 (check-database 6 รวม grant ใหม่) PASS • `clippy -D warnings` PASS • release build PASS
ครอบคลุม threat model: client ส่ง `verified:true` → ไม่มีผล, ผู้ใช้อื่นใช้ attempt → 404, replay → คืนผลเดิม (เทียบครั้งเดียว), race → เทียบครั้งเดียว, หมดอายุ → EXPIRED โดยไม่เรียก AWS, liveness ไม่ผ่าน/หน้าไม่ตรง/ไม่มีเฟรม → ไม่ verified, snapshot ถูกแก้ → `REFERENCE_TAMPERED`, เปลี่ยนรูประหว่าง/หลังยืนยัน → เพิกถอน, SVG/HTML ปลอมเป็นรูป → ปฏิเสธก่อนเรียก AWS, URL ภายนอก/ของคนอื่น/metadata IP → ปฏิเสธโดยไม่อ่าน, AWS ล่มชั่วคราว → ลองต่อได้ไม่เปลี่ยนเป็น verified, ไม่ได้ตั้งค่า → 503
**ยังไม่ได้ทดสอบกับ AWS/R2 จริง (NOT RUN)** — ใช้ test double เท่านั้น

**ตั้งค่า (Fly.io secrets)**: `FACE_VERIFICATION_ENABLED=true`, `FACE_LIVENESS_REGION`, `FACE_LIVENESS_STREAM_ROLE_ARN`, `FACE_CONSENT_VERSION`, `FACE_POLICY_VERSION`, `FACE_DECISION_MODE` (`manual` ค่าเริ่มต้น / `automatic`), `FACE_LIVENESS_MIN`, `FACE_LIVENESS_REVIEW_MIN`, `FACE_SIMILARITY_MIN`, `FACE_SIMILARITY_REVIEW_MIN` (บังคับเฉพาะ `automatic`; ใน `manual` review min เริ่มที่ 0), `FACE_LEGACY_GRACE_UNTIL` (ไม่บังคับ), `PROFILE_MEDIA_ORIGIN`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_MEDIA_BUCKET`, `R2_VERIFICATION_BUCKET` และ AWS credential ของ server (แนะนำ `AWS_ROLE_ARN` + `AWS_WEB_IDENTITY_TOKEN_FILE` ผ่าน Fly OIDC แทน key ถาวร) ถ้าตั้งไม่ครบ server จะไม่ start ถ้าไม่เปิด route จะตอบ 503
**ไม่มีเกณฑ์อนุมัติเริ่มต้นโดยเจตนา** โหมด `manual` จึงต้องมีคนตรวจทุกตรา และในโหมดค้นหาแบบเข้มงวด (`discovery.rs` ใช้ `face_verified`) ผู้ใช้ใหม่จะปรากฏหลังผู้ตรวจอนุมัติ ต้องจัดคนตรวจให้ทัน หรือ calibrate แล้วเปลี่ยนเป็น `automatic`
`fly-client-ip` ใช้ throttle ราย IP ได้เฉพาะหลัง proxy ของ Fly ถ้า deploy ที่อื่นต้องเปลี่ยน header (ผู้ใช้ยังโดน throttle รายบัญชีเสมอ)

**IAM (ภูมิภาคเดียวกับ Face Liveness)**
Role ของ backend:
```json
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["rekognition:CreateFaceLivenessSession","rekognition:GetFaceLivenessSessionResults","rekognition:CompareFaces"],"Resource":"*"},
 {"Effect":"Allow","Action":"sts:AssumeRole","Resource":"arn:aws:iam::<account>:role/campusmate-liveness-stream"}]}
```
Role สำหรับสตรีม (`campusmate-liveness-stream`) — permission:
```json
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"rekognition:StartFaceLivenessSession","Resource":"*"}]}
```
trust: อนุญาตเฉพาะ role ของ backend (`"Principal":{"AWS":"arn:aws:iam::<account>:role/campusmate-backend"}`) ห้ามใช้ `AmazonRekognitionFullAccess`/`AmazonS3FullAccess` ตั้ง AWS Budgets alert และ CloudTrail และพิจารณา AI services opt-out (Organizations)

**R2**: สร้าง bucket แยกสำหรับ snapshot แบบ **private** (ไม่มี custom domain/`r2.dev`), API token จำกัดแค่ "อ่าน media bucket" + "อ่าน/เขียน/ลบ verification bucket", lifecycle rule ลบ object ที่อายุเกิน 15 วันเป็นตาข่ายสำรอง

**Neon**: รัน migration 0005 ด้วย identity ที่ใช้ deploy (`migrate`) แล้ว grant ตารางใหม่ให้ runtime role ตามระบบ role ที่ `check-database`/`provision-neon-logins` (อีกเซสชันกำลังพัฒนาอยู่และอ้างถึงตารางนี้แล้ว)

**Rollback**: ตั้ง `FACE_VERIFICATION_ENABLED=false` (route ตอบ 503 ทันที ไม่ต้อง deploy โค้ดใหม่ แต่ sweeper จะหยุดด้วย จึงควรลบภาพที่ค้างก่อน) ถ้าจะถอนทั้งหมด: deploy รุ่นก่อน แล้ว `DROP TABLE identity_alternative_requests, identity_review_requests, identity_verification_audit_events, user_photo_verifications, face_verification_attempts; DROP TYPE face_attempt_state;` หลังลบ object ใน R2 ทั้ง `reference_key` และ `evidence_key` (ห้าม drop ก่อน เพราะจะไม่รู้ key) ตรา `profiles.face_verified` ที่ได้จากระบบใหม่จะยังอยู่จนกว่าจะสั่งเพิกถอน
ย้อนเฉพาะ D1: ไม่ต้องทำอะไร (manual คือค่าปลอดภัย) • ย้อน D5: ลบ `FACE_LEGACY_GRACE_UNTIL` (ตราที่ถูกเพิกถอนไปแล้วต้องยืนยันใหม่ ไม่คืนอัตโนมัติ)

---

## Phase 2 — แอปและ native • เขียนแล้ว ยังไม่ build

- `src/services/photoVerificationProtocol.mjs` + `photoVerificationService.js` — consent → create → native liveness → `complete` (server ตัดสิน), retry `AWAITING_RESULT` แบบจำกัดครั้ง, ไม่ fallback ไปส่งรูปนิ่งเมื่อไม่มี native module, กรองคำตอบให้เหลือแค่ field สาธารณะ, ตรวจแบบไม่มีแสงกะพริบ (ปฏิเสธถ้า server ตอบ challenge ที่มีแสง), สถานะ `LEGACY`, appeal, ขอวิธีอื่น, ลบข้อมูล, `isLivenessEnabled()` — `node --test scripts/test-photo-verification-client.mjs` **11/11 PASS**
- `src/components/LivenessVerificationSheet.js` — หน้า consent (อธิบายสิ่งที่เกิดขึ้น, การเก็บ/ลบภาพ, ไม่ใช่การยืนยันตัวตน, ไม่บังคับ), คำเตือนแสงกะพริบ + สวิตช์ตรวจแบบไม่มีแสง, checkbox ยินยอม (ระบุเวอร์ชัน), แจ้งให้ยืนยันใหม่ถ้าเป็น `LEGACY`, ผลลัพธ์ (สำเร็จ/รอตรวจ/ไม่ผ่าน + ขอทบทวน), ฟอร์มขอวิธีอื่น, ลบข้อมูลการยืนยัน; รองรับ VoiceOver/TalkBack (role, state, live region) และปุ่ม ≥ 44 pt
- `src/components/FaceVerificationModal.js` — สลับไปหน้าจอใหม่เฉพาะเมื่อ `isLivenessEnabled()` (D8) ไม่เปลี่ยนหน้าจอที่เรียกใช้ทั้ง 5 จุด
- `native-spikes/face-liveness/` — Expo module ห่อ AWS `FaceLivenessDetectorView` (SwiftUI, ผ่าน `spm_dependency`) และ `FaceLivenessDetector` (Compose, activity ไม่ export, `FLAG_SECURE`, credential อยู่ในหน่วยความจำเท่านั้น) **ไว้นอก `modules/` โดยตั้งใจ** เพื่อไม่ให้ build เดิมพังจนกว่าจะผ่าน spike
- **iOS/Android บนอุปกรณ์จริง: NOT RUN** — เครื่องนี้เป็น Windows ไม่มี Xcode, Docker ใช้ไม่ได้ (virtualization ปิด), พื้นที่ดิสก์เหลือ ~2 GB และ Face Liveness ยังเรียกในภูมิภาคปัจจุบันไม่ได้

**Spike checklist** (ต้องทำบน Mac + อุปกรณ์จริง)
1. ย้ายไป `modules/face-liveness` แล้ว `npx expo prebuild` + `eas build --profile development` (ทั้งสอง platform)
2. ยืนยันว่า `spm_dependency` ใช้ได้กับ Expo 58/RN และชื่อ API (`AWSTemporaryCredentials`, `FaceLivenessDetectionError`, `AWSCredentialsProvider` Android) ตรงกับเวอร์ชัน Amplify ที่เลือก
3. ทดสอบบน iPhone (iOS 26/27) และ Android (กล้องหน้า, แสงน้อย, แว่น, ปฏิเสธสิทธิ์กล้อง, กดยกเลิก, สลับแอประหว่างตรวจ, เน็ตหลุดหลังสตรีม)
4. วัด p50/p95/p99 แยก AWS stream / GetResults / R2 GET / CompareFaces / SQL
5. ยืนยันว่า Amplify UI เวอร์ชันที่ปักไว้รองรับ `FaceMovementChallenge` (server เป็นคนเลือก challenge; ค่า default ของ detector ใช้กล้องหน้า)
6. ตรวจหน้าจอ consent ด้วย VoiceOver/TalkBack, Dynamic Type ขนาดใหญ่, dark mode

**Rollback**: ปิด `EXPO_PUBLIC_FACE_LIVENESS` (หรือ build ที่ไม่มี native module) แอปจะกลับไปใช้ flow เดิมทันที

---

## Phase 2B — ท่าทางแบบ Face ID ก่อน AWS liveness (21 ต.ค. 2026)

เจ้าของระบบเลือก "ท่าทาง + AWS" แทนการถ่ายรูปนิ่ง ท่าทางเป็น**ชั้นเพิ่ม** ไม่ได้แทน AWS Face Liveness ซึ่งยังเป็นตัวตัดสินเรื่องการปลอมแปลง (blueprint ข้อ 6 ห้ามใช้ liveness ที่ทำเองแทน AWS และเราไม่ได้ทำแบบนั้น)

- **ลำดับ**: consent → `POST /photo-verifications` (server สุ่มลำดับ `CENTER` + `BLINK`/`TURN_LEFT`/`TURN_RIGHT`/`NOD_DOWN`) → ท่าทางทีละขั้น `POST /photo-verifications/{id}/gestures` → AWS liveness → `complete`
- **Server** (`identity.rs`, migration `0012_face_gestures.sql`): ทุกเฟรมอ่านท่าทางศีรษะ/สถานะตาด้วย DetectFaces ก่อน (ไม่ตัดหน้าที่หันข้างทิ้งแบบ quality filter ของ CompareFaces ซึ่งเป็นสาเหตุที่หันแล้ว "จับได้บ้างไม่ได้บ้าง") แล้ว**เฉพาะเฟรมที่ทำท่าถูก**จึงอ่าน snapshot จาก R2 และเทียบกับรูปหลักที่ pin ไว้ด้วย CompareFaces (`QualityFilter::None`) ในหน่วยความจำ **ไม่เก็บเฟรม** ต้องเป็นใบหน้าเดียว, ตามลำดับ, ภายใน 120 วินาที, หันซ้ายและหันขวาต้องไปคนละทาง (เทียบกันเอง ไม่พึ่งเครื่องหมายของ SDK), พลาด 8 ครั้งแล้วรายการล้มเหลว (นับรวม cooldown) และ `complete` ปฏิเสธ `GESTURES_INCOMPLETE` จนกว่าจะผ่านครบ
- **หลายเฟรมต่อคำขอ (23 ต.ค.)**: `frames` ได้ถึง 3 เฟรมล่าสุด (รวมกันไม่เกิน 700 KiB) เฟรมใดทำท่าถูกก็ผ่าน คำตอบที่ไม่ผ่านมี `hint` บอกสิ่งที่ต้องทำต่อ (`TOO_FAR`, `TOO_CLOSE`, `OFF_CENTER`, `TOO_DARK`, `LOOK_STRAIGHT`, `OPEN_EYES`, `CLOSE_EYES`, `TURN_MORE`, `OTHER_WAY`, `KEEP_LEVEL`, `NOD_MORE`, `HEAD_TILTED`, `HOLD_STILL`, `NO_FACE`, `MULTIPLE_FACES`) และ `progress` 0–0.9 ของมุมหัน/ก้ม (เป็นเรขาคณิตของศีรษะ ไม่ใช่คะแนนใบหน้า) Rekognition throttling ถูกจัดเป็น transient ไม่ใช่ "ไม่พบใบหน้า"
- **แอปที่ไม่มี native tracking (Expo Go)**: ถ่ายเฟรม VGA ต่อเนื่องขณะคำขอก่อนหน้ายังไม่กลับ แล้วส่ง 3 เฟรมล่าสุดรวดเดียว (`src/utils/faceGestureRunner.mjs`) จอแสดงหน้าการ์ตูนทำท่าให้ดู + ป้ายคำแนะนำพร้อมไอคอน (`FaceGestureStage.js`)
- **เกณฑ์มุมศีรษะ** เป็นค่าตั้งต้นที่ต้องปรับบนเครื่องจริง ส่วนความคล้ายของแต่ละเฟรมตั้งด้วย `FACE_GESTURE_SIMILARITY_MIN` (ค่าเริ่มต้นเท่ากับ `FACE_SIMILARITY_REVIEW_MIN`)
- **แอป**: `modules/face-gesture-camera` (CameraX + ML Kit / AVFoundation + Vision) ให้ภาพกล้องและมุมศีรษะ/ตาแบบ real-time เพื่อเลื่อนวงแหวนแบบ Face ID (`src/components/FaceGestureStage.js`, `src/utils/faceGestureDetector.mjs`) เครื่องเป็นแค่ตัวบอกว่าควรส่งเฟรมเมื่อไร เซิร์ฟเวอร์เป็นคนตัดสินทุกขั้น
- **AWS module** ย้ายจาก `native-spikes/face-liveness` ไป `modules/face-liveness` แล้ว (iOS ลิงก์ `AWSPluginsCore` เพิ่ม)
- **IAM**: role `campusmate-backend` มี `rekognition:DetectFaces` แล้ว (อยู่ใน `iam/backend-permissions.json` และใช้กับ AWS แล้ว 22 ต.ค.)
- **เทสต์**: Rust identity 34/34 (รวม 4 เทสต์ท่าทางใหม่) และ unit ของ `judge_gesture`; client `test-photo-verification-client` 16/16, `test-face-gesture-detector` 7/7 **อุปกรณ์จริง: NOT RUN**

---

## Phase 3 — Privacy / production readiness • ส่วนที่เป็นโค้ดเสร็จแล้ว
เสร็จ: D1–D9, audit การเปิดดูหลักฐาน, ลบข้อมูลเมื่อลบบัญชี, ลบข้อมูลตามคำขอ, ทางเลือกการเข้าถึง, ทดสอบทุก flow ด้วยสิทธิ์ `campusmate_api` จริง (`the_runtime_role_can_run_every_identity_flow`)
ยังต้องทำโดยคน/องค์กร (โค้ดทำแทนไม่ได้):
- Calibrate เกณฑ์ด้วยคู่ภาพที่ได้รับความยินยอมและหลากหลาย (แสง, อุปกรณ์, สีผิว, แว่น, ผ้าคลุมศีรษะ) วัด FAR/FRR แล้วค่อยเปิด `automatic`
- ทบทวน PDPA/ผู้ใช้อายุต่ำกว่าเกณฑ์, ข้อความ consent ฉบับ `face-consent-2026-10`, privacy notice (ส่งข้อมูลไป AWS ต่างประเทศ), ระยะเก็บ 14 วันกับฝ่ายกฎหมาย
- หน้าจอ admin สำหรับคิว/หลักฐาน (API พร้อมแล้ว), Pen-test แบบ dynamic, AWS Budgets/quota alert, CloudTrail, AI opt-out
- กำหนด `FACE_LEGACY_GRACE_UNTIL` หลังแจ้งผู้ใช้เดิม

## ภูมิภาค AWS (อัปเดต 12 ต.ค. 2026 22:30)
- เปิด advanced features แล้ว: องค์กร `o-0yiwm4s86j`, management account `028610956731`, **project account ที่ใช้ = Building Momentum `502731779521`** (profile `campusmate`; profile `campusmate-admin` = management)
- เปิดภูมิภาค **Thailand `ap-southeast-7`** ใน Building Momentum แล้ว (ENABLED)
- SCP: แยก `UsEast1Partitional` ไปเป็น `AdvancedModeRegionRestrictionUsEast1` (`p-tdrhd5zq`, ผูกกับ Root) เพราะ policy เดิมใกล้เพดาน 5,120 ตัวอักษร แล้วแก้ `AdvancedModeRegionRestrictionSecurityControlPolicy` (`p-oh1dnpq7`) ให้อนุญาต `ap-southeast-7` เฉพาะ `rekognition:*`, `sts:*`, `cloudshell:*`, `servicequotas:*`, `health:*` — ไฟล์อยู่ใน `docs/face-verification/scp/` (มีสำเนาก่อนแก้)
- ตรวจด้วยการเรียกจริง + IAM simulator: Thailand → Rekognition/STS อนุญาต, `ec2:RunInstances`/`s3:CreateBucket` ถูกปฏิเสธ; us-east-1 → Rekognition/EC2 ถูกปฏิเสธเหมือนเดิม; ภูมิภาคอื่น (เช่น `ap-southeast-1`) ถูกปฏิเสธ
- ย้อนกลับ: ใส่เนื้อหา `scp/0-live-backup-before-edit.json` กลับเข้า `p-oh1dnpq7` แล้ว detach + delete `p-tdrhd5zq`
- AWS Budget `campusmate-monthly-10usd` (10 USD/เดือน รวมทั้งองค์กร, ใน management account) แจ้งอีเมลเมื่อใช้จริงเกิน 50/80/100% และคาดการณ์เกิน 100% — เป็นการเตือนเท่านั้น ไม่หยุดการใช้งาน

## IAM roles + Thailand session smoke test (12 ต.ค. 2026 22:47)

สร้างจริงใน **Building Momentum `502731779521`** แล้ว:

| Role | สิทธิ์ | Trust |
|---|---|---|
| `arn:aws:iam::502731779521:role/campusmate-backend` | CreateFaceLivenessSession, GetFaceLivenessSessionResults, CompareFaces; AssumeRole เฉพาะ role สตรีม | ผู้ดูแลสำหรับ bootstrap และ Fly OIDC เฉพาะแอป `campusmate-backend-502731779521` (ดูผลตรวจด้านล่าง) |
| `arn:aws:iam::502731779521:role/campusmate-liveness-stream` | StartFaceLivenessSession เท่านั้น | เฉพาะ `campusmate-backend` |

- Inline policy `CampusMateFaceVerificationThailand`: ทั้ง Rekognition และ STS AssumeRole จำกัด `aws:RequestedRegion=ap-southeast-7`; ไม่มี managed policy เพิ่มเติม ไม่สร้าง access key ถาวร
- IAM เป็นบริการ global; ใช้ profile/login Region เดิม `ap-southeast-2` สำหรับจัดการ IAM และ refresh CLI login เท่านั้น การทดสอบ STS/Rekognition เรียก Thailand endpoint โดยตรง
- [`iam/`](iam/) มี trust/permission JSON ทั้ง 4 ไฟล์ และ [`live-role-evidence.json`](iam/live-role-evidence.json) สำหรับตรวจเทียบกับค่าจริง
- APIs ทั้ง 4 ไม่รองรับ resource ARN สำหรับ scope ราย session จึงต้องใช้ `Resource: "*"` และจำกัด action/Region; credentials สตรีมยังไม่ผูกกับ session เดียวด้วย IAM ต้องบังคับ ownership/expiry/rate limit ที่ backend ([AWS service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_rekognition.html))

**ผลทดสอบจริง** ([หลักฐาน](iam/live-session-evidence.json)):

- ผู้ดูแล → assume backend 900 วินาที → CreateFaceLivenessSession ใน Thailand: **PASS**, `AuditImagesLimit=0`, ไม่มี S3 OutputConfig
- backend → GetFaceLivenessSessionResults: **PASS**, สถานะ `CREATED` (ยังไม่ส่งวิดีโอ)
- backend → assume stream 900 วินาที พร้อม session policy ที่จำกัดแค่ StartFaceLivenessSession: **PASS**
- ผู้ดูแล assume stream โดยตรง: **AccessDenied ตามคาด**
- stream เรียก Create/Get/Compare และ assume กลับเข้า backend: **AccessDenied ทั้ง 4 กรณีตามคาด**
- IAM simulator: backend อนุญาต Create/Get/Compare แต่ไม่อนุญาต Start; stream อนุญาต Start แต่ไม่อนุญาต Create/Get/Compare; ทั้งสอง role ไม่อนุญาต Rekognition ใน Sydney: **PASS** ([หลักฐาน](iam/simulation-evidence.json))
- สตรีมวิดีโอจริง, backend CompareFaces ด้วยภาพจริง, native iOS/Android, การออกตรา: **NOT RUN**; ไม่อัปโหลดข้อมูลชีวมิติและไม่ deploy แอป production

ทดสอบซ้ำ (สร้าง empty session ใหม่ 1 ครั้ง; credentials อยู่ใน process memory และไม่เขียนลงหลักฐาน):

```powershell
& .\docs\face-verification\iam\test-live-session.ps1
```

**Fly OIDC เชื่อมแล้ว**: provider `arn:aws:iam::502731779521:oidc-provider/oidc.fly.io/werachart-kaewkham`; audience `sts.amazonaws.com`; subject pattern `werachart-kaewkham:campusmate-backend-502731779521:*`; จำกัด STS Region ที่ Thailand มีสำเนา trust ก่อนแก้ใน [`iam/backend-trust-before-fly-oidc.json`](iam/backend-trust-before-fly-oidc.json)

- ติดตั้ง Fly CLI จากแหล่งทางการและลงชื่อเข้าใช้แล้ว ตาม [Fly agent-ready](https://fly.io/agent-ready.md) ใช้ Machines สำหรับ backend (ไม่ได้สร้าง Sprite)
- สร้างแอป `campusmate-backend-502731779521` ใน personal organization และ Machine ทดสอบ `185e262f6650d8` (`oidc-probe`, `sin`, shared CPU/256 MB, ไม่มี public service/volume)
- ทดสอบจาก Machine จริง: `AssumeRoleWithWebIdentity` + `GetCallerIdentity` เป็น `campusmate-backend`: **PASS**; audience ผิดถูกปฏิเสธ: **PASS**; process UID `65532` อ่าน token file อัตโนมัติ `/.fly/oidc_token` ได้: **PASS** ([หลักฐาน](iam/fly-oidc-check-evidence.json))
- `rust-backend/fly.toml` เตรียมแล้วและ `fly config validate` ผ่าน แต่ **ยังไม่ deploy Rust API/ฐานข้อมูล/R2 หรือเปิด flow production**; Machine ที่รันอยู่เป็น Python infrastructure probe สำหรับ OIDC/liveness เท่านั้น
- **สตรีมวิดีโอจริงผ่านแล้ว**: ผู้ใช้ทำหน้ากล้องในเบราว์เซอร์ด้วย `FaceMovementChallenge` ผ่าน React component ของ AWS; Fly สร้าง session และออก stream credentials จริง; server อ่าน GetFaceLivenessSessionResults ได้ `SUCCEEDED` และมี reference image ใน Thailand ไม่บันทึกภาพ/คะแนนและไม่เปลี่ยนตราในระบบ ([หลักฐานผลสำเร็จ](iam/fly-oidc-stream-success-2026-10-12.json), [คู่มือ/ข้อจำกัด/วิธีหยุด](browser-smoke/README.md))
- credential chain แบบ default จาก process UID `65532` บน Fly เรียก STS Thailand เป็น backend role จริงได้: **PASS** ([หลักฐาน](iam/fly-default-chain-evidence.json)); ยังไม่ใช่ผล build/run ของ Rust binary
- หลังทดสอบ ผู้ใช้เลือกหยุด Machine: `185e262f6650d8` ตรวจเป็น `stopped` แล้ว เวลา 23:10 วันที่ 12 ต.ค. 2026 (Asia/Bangkok) เก็บแอป, OIDC provider และ IAM role ทั้งสองไว้ ([หลักฐาน](iam/fly-machine-stopped-evidence.json))
- Build หน้าทดสอบ, ตรวจ syntax, ปฏิเสธคำขอที่ไม่มี cookie/Origin และขาด consent, และ OIDC ผ่าน local API: **PASS**

ค่าที่เตรียมใน Fly config: `AWS_REGION=ap-southeast-7`, `FACE_LIVENESS_REGION=ap-southeast-7`, `FACE_LIVENESS_STREAM_ROLE_ARN=arn:aws:iam::502731779521:role/campusmate-liveness-stream`, `AWS_ROLE_ARN=arn:aws:iam::502731779521:role/campusmate-backend`; Fly จัด token file ให้อัตโนมัติ (ยังไม่ได้ตั้ง production DB/R2 secrets)

`aws freetier get-account-plan-state` ตรวจทั้ง project และ management แล้วคืน `ResourceNotFoundException: Missing data for account`; **ยังยืนยันสถานะ Paid/Free ไม่ได้** ให้ตรวจที่ AWS Settings > Billing ไม่ตีความ error นี้ว่าเป็น FREE หรือ PAID

**Rollback IAM**: หยุดออก credentials ใหม่ แล้วลบ inline policy และ role สตรีมก่อน ตามด้วย inline policy และ role backend หลังยืนยันว่าไม่มี workload ใช้ role อยู่ การลบ role ไม่ใช่การ revoke temporary credentials ที่ออกไปแล้วทันที; ชุดทดสอบขออายุ 900 วินาที Session ของ Rekognition หมดอายุหลัง 3 นาที ([AWS API](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html))

## Blockers ที่ต้องตัดสินใจ
1. ~~**ภูมิภาค AWS**~~ แก้แล้ว (ดูหัวข้อด้านบน) — เดิม: project ใช้ `ap-southeast-2` (จาก `~/.aws/config`) ซึ่งไม่มี Face Liveness และบัญชีแบบ "new AWS experience" สร้าง resource ได้แค่ใน selected Region (ตรวจที่ AWS Settings > View all projects > Overview > Additional Info > Region) ต้องเปิด advanced features หรือใช้ project ที่อยู่ในภูมิภาคที่รองรับ (ใกล้สุด: Thailand `ap-southeast-7`, Malaysia `ap-southeast-5`) ก่อน Phase 2 จะใช้งานได้
2. เครื่องสำหรับ build/ทดสอบ iOS (Mac + Xcode 26) และ Android (SDK + พื้นที่ดิสก์)
3. ค่า threshold จากการ calibrate และการทบทวนทางกฎหมาย
