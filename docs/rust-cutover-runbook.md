# CampusMate: ย้ายแอปทั้งระบบไป Rust backend (runbook)

อัปเดต 13 ตุลาคม 2026

## สถานะ

- **Backend (`rust-backend/`)** ครอบคลุมทุกฟีเจอร์ของแอปแล้ว ได้แก่
  - บัญชี: email/รหัสผ่าน, Google, ย้าย session จาก Firebase, ตรวจรหัสผ่านเดิมกับ Firebase ครั้งเดียวแล้วเก็บเป็น Argon2, ยืนยันอีเมล, ลืมรหัสผ่าน, เปลี่ยนเป็นอีเมลมหาวิทยาลัย, ลบบัญชีด้วย OTP
  - โปรไฟล์, การมองเห็น, บล็อก, รายงาน, ค้นหา/likes/match/rewind
  - แชตตัวต่อตัวแบบเข้ารหัส: รายการห้อง, unread, อ่านแล้ว, reaction, ซ่อน/unsend, ดูครั้งเดียว, วิดีโอคุณภาพสูง, นัดหมาย
  - ตี้และแชตกลุ่มแบบเข้ารหัส (epoch และ rotate key)
  - การโทร (LiveKit)
  - แจ้งเตือน: inbox และ push ผ่าน Expo พร้อม outbox ใน transaction
  - สื่อ: รูปโปรไฟล์/แกลเลอรีที่ server re-encode และตรวจด้วย Rekognition, ตั๋วอัปโหลดสื่อแชตเข้ารหัสไป R2
  - Plus: RevenueCat sync และ webhook
  - หน้าแอดมิน, เพลง, ระยะทาง, การตั้งค่าแอป
  - Realtime ผ่าน SSE กับ PostgreSQL NOTIFY
  - งานเบื้องหลัง: ส่ง push, ตรวจ receipt, ปิดตี้ที่หมดเวลา, ปิดสายค้าง, ล้าง inbox ที่หมดอายุ
- **แอป** สลับทั้งแอปด้วย `EXPO_PUBLIC_BACKEND=rust` และ `EXPO_PUBLIC_RUST_BACKEND_URL` ถ้าไม่ตั้งค่า แอปยังใช้ Firebase เหมือนเดิม
- **หน้าแอดมินเว็บ** สลับด้วย `VITE_BACKEND=rust` และ `VITE_RUST_BACKEND_URL`
- **ย้ายข้อมูล**: `import-export --apply` แปลงทุก collection ด้วย allowlist เดียวกับ API ข้อความเข้ารหัสถูกคัดลอกแบบ ciphertext ล้วน plaintext เดิมไม่ถูกนำเข้า และสิทธิ์แอดมินไม่ถูกนำเข้า
- **เทสต์**: Rust ทั้งหมดรันบน PostgreSQL 18 ใน Cloud Build รวม end-to-end ของ RPC และการนำเข้าข้อมูลสังเคราะห์ ฝั่ง client มี node tests ของ protocol

## Staging (ทำแล้ว 13 ต.ค. 2026)

- Neon branch `schema-check-20261012`: รัน migration 0006–0008 และ runtime grants แล้วผ่าน `cloudbuild.neon-migrate.yaml` (รันเทสต์ทั้งหมดก่อน และใช้รหัสผ่านจาก Secret Manager โดยไม่ผ่านมือคน) สั่งซ้ำได้อย่างปลอดภัย
- Fly `campusmate-backend-502731779521`: deploy image `rust-platform-20261013` แล้ว `/healthz` ready ส่วน endpoint ที่ต้องล็อกอินตอบ 401 ถูกต้อง
- แอปทดสอบ: profile `rust-staging` (Android APK) และ `rust-staging-simulator` (iOS Simulator) ใน `eas.json` ชี้ไปที่ staging
- ฟีเจอร์ที่ staging ยังตอบ 503 เพราะยังไม่ได้ตั้ง secret: Google Places, Plus/RevenueCat, LiveKit, Spotify, push (`EXPO_ACCESS_TOKEN` ไม่บังคับ) และอีเมล (ต้อง deploy `email-worker`)
- ตรวจภาพ: ตั้ง `MODERATION_REGION=ap-southeast-7` แล้ว แต่ต้องเพิ่มสิทธิ์ IAM ก่อน (คำสั่งอยู่ในข้อ 2)

## ขอบเขตที่ยืนยันล่าสุด

เจ้าของระบบเลือก **เติม staging และทดสอบก่อน** เพราะยังไม่ได้ทดสอบบนเครื่องจริง การเตรียมเครื่องมือด้านล่างไม่ใช่การอนุมัติให้ freeze ระบบจริง ส่งออก/นำเข้าข้อมูลจริง หรือเปลี่ยน production ในรอบนี้ ต้องผ่านการทดสอบล็อกอิน แชต realtime อัปโหลดรูป และ Face Liveness บนเครื่องจริงก่อน

## ซ้อมก่อนเปิดช่วงตัดระบบ

1. ใช้ข้อมูลสังเคราะห์กับ Neon branch ที่แยกสำหรับ rehearsal และ R2 bucket ทดสอบที่แยกจากรูปผู้ใช้จริง รัน migrations/grants และ `check-database --kind api` / `--kind mail` ด้วย login ของแต่ละ process
2. รัน `node --test scripts/test-native-export.mjs scripts/test-gallery-copy.mjs` เพื่อตรวจ exporter/copy tool โดยไม่เรียก cloud
3. รัน importer แบบไม่ใส่ `--apply` เพื่อตรวจรูปแบบ จำนวนแถว ขนาดไฟล์ และ SHA-256 ของ snapshot **ขั้นนี้ไม่เชื่อมต่อฐานข้อมูลและไม่ซ้อมแปลงข้อมูล** จากนั้นจึง `--apply` กับฐานข้อมูล rehearsal ที่ว่างและข้อมูลสังเคราะห์ ตรวจจำนวนแต่ละตาราง รายการ `migration.skipped` สิทธิ์ การอ่านประวัติแชตเข้ารหัส และไฟล์สื่อที่อ้างถึงจริง
4. ทดสอบ gallery copy กับ fixture ที่ได้รับอนุญาตก่อน production: generation/checksum ต้องตรง snapshot, MIME ต้องตรง, R2 ที่มี key อยู่แล้วต้องอ่านกลับมาตรวจ bytes และ HTTP 403/5xx ต้องหยุด ห้ามถือว่า key หายและเขียนทับ เครื่องมือไม่ลบหรือเขียนทับ object ที่มีอยู่ หากหยุดกลางทางให้ตรวจและรันซ้ำกับ snapshot เดิม
5. เตรียมแอป production/admin build ที่ชี้ URL production ที่อนุมัติไว้และผ่านการทดสอบก่อน maintenance window; profile `production` ใน `eas.json` ยังไม่ได้ตั้ง Rust URL อย่านำ URL staging มาใช้แทน ทดสอบ rollback และบันทึกผู้ตัดสินใจ จุดเปิดรับ writes และเกณฑ์ยกเลิกการย้าย

## ขั้นตอน production ที่ยังไม่ได้รัน

ทุกขั้นด้านล่างกระทบผู้ใช้จริงหรือข้อมูลจริง จึงยังไม่ได้รัน

1. สร้าง Neon branch สำหรับ production แล้วรัน `migrate` และ `operations/runtime-grants.sql`
2. ตั้ง secrets บน Fly (รายการอยู่ใน `rust-backend/.env.example`) แล้ว deploy API
   - ต้องเพิ่มสิทธิ์ `rekognition:DetectModerationLabels` ให้ IAM role `campusmate-backend` ถ้ายังไม่เพิ่ม การอัปโหลดรูปโปรไฟล์จะตอบว่า "ยังตรวจสอบภาพไม่ได้" นโยบายฉบับใหม่อยู่ใน `docs/face-verification/iam/backend-permissions.json` และใช้ภูมิภาค ap-southeast-7 เพราะ trust policy ของ role จำกัดไว้ที่ภูมิภาคนี้: `aws iam put-role-policy --profile campusmate --role-name campusmate-backend --policy-name CampusMateFaceVerificationThailand --policy-document file://docs/face-verification/iam/backend-permissions.json`
   - ไม่ต้องตั้ง `DATABASE_LISTEN_URL` ถ้า `DATABASE_URL` เป็น Neon pooler เพราะ backend แปลงเป็น endpoint ตรงให้เอง
3. Deploy `email-worker` แยกเครื่อง ตั้ง `NATIVE_AUTH_EMAIL_ORIGIN` เป็น origin จริงของ API
4. เตรียม RevenueCat webhook `POST /v1/webhooks/revenuecat` และแผนพัก/เก็บ/replay events ระหว่าง freeze; เปลี่ยนปลายทางเมื่อถึงจุดเปิด production ที่อนุมัติ
5. ช่วงตัดระบบ (write freeze) หลัง native QA และ rehearsal ผ่านแล้วเท่านั้น:
   1. ประกาศ maintenance พร้อมเวลาสิ้นสุดและ rollback checkpoint แล้ว **บังคับหยุดทุก writer ก่อนเริ่ม export**: client Firestore/Storage writes, Functions/Admin SDK, scheduled/background jobs, admin actions, การสมัคร/แก้บัญชี Auth และ webhook ภายนอก ต้องกำหนดวิธีพัก/replay events ที่เกิดช่วงนี้และตรวจว่าการเขียนจริงถูกปฏิเสธ หยุดเฉพาะ rules ไม่ครอบคลุม Admin SDK; repo ยังไม่มีสวิตช์ freeze ทั้งระบบที่ผ่านการทดสอบ
   2. บันทึก revision/config เดิมของ rules, writers, webhook, app/admin และ backup/restore point ของฐานข้อมูล เก็บ Rust production ปิดรับผู้ใช้และหยุด mail/push worker ระหว่างนำเข้า จนกว่าจะผ่าน checkpoint เปิด writes
   3. `node scripts/export-native-backend.mjs --project campusmate-7f1ab --confirm-production-export --run <RUN>` เก็บ snapshot แบบ private และคง freeze ตลอดการอ่านหลาย collection; exporter ไม่ใช่ snapshot เดียวกันทุกเวลา
   4. จาก repo root รัน `node scripts/copy-gallery-to-r2.mjs --run <RUN>` เพื่อตรวจ manifest และ metadata สื่อในเครื่อง และจาก `rust-backend/` รัน `cargo run --bin import-export -- --manifest ../artifacts/rust-migration/<RUN>/manifest.json` (ตรวจไฟล์เท่านั้น)
   5. จาก repo root รัน `node scripts/copy-gallery-to-r2.mjs --run <RUN> --apply` ด้วย source read-only และ R2 credentials ที่ scoped ต่อ bucket ที่อนุมัติ เครื่องมือใช้ source generation จาก export, ตรวจ MD5/CRC32C, conditional create และอ่าน R2 กลับมาตรวจ bytes/MIME ทั้ง object ใหม่และเดิม ต้องสำเร็จทุก object ก่อนเปิดข้อมูลที่อ้างรูป; ถ้า generation ต้นทางหาย checksum ไม่ตรง หรือ provider ปฏิเสธ ให้คง freeze และตรวจสาเหตุ
   6. ตั้ง `PROFILE_MEDIA_ORIGIN` ให้ตรงปลายทางรูปที่ตรวจแล้ว จาก `rust-backend/` รัน importer คำสั่งข้อ 4 พร้อม `--apply` กับฐานข้อมูล production ที่ว่าง และ schema owner endpoint ตรงเท่านั้น Import transaction จะปฏิเสธฐานข้อมูลที่มี accounts/profiles/migration_documents อยู่แล้ว ห้าม reset/drop ฐานข้อมูลเพื่อฝืนให้ผ่าน
   7. ตรวจจำนวนข้อมูลต้นทาง/ปลายทางและ `migration.skipped` แยกแต่ละ domain, session migration, legacy-password login, ciphertext/keys, profile/gallery URL, reviewer/admin grants ที่ต้องออกใหม่ และ worker outbox ก่อนเปิดผู้ใช้จริง เก็บรายงานแบบ aggregate ห้าม log records หรือ secrets
   8. ตัดสินใจ go/rollback **ก่อนเปิด writes ฝั่ง Rust** หากไม่ผ่านให้กลับ revision/config Firebase เดิมโดยยังไม่เปิด Rust; หลังเปิด Rust writes แล้วต้องมีแผน reconcile ข้อมูลใหม่ก่อนย้อนกลับ ห้ามเปิด writers ทั้งสองระบบพร้อมกันโดยไม่มีระบบ reconciliation
6. เปิดแอป release ที่เตรียมไว้ด้วย EAS `EXPO_PUBLIC_BACKEND=rust` และ `EXPO_PUBLIC_RUST_BACKEND_URL` ของ production ตามแผน rollout ที่อนุมัติ เก็บ Firebase writers ปิดต่อเนื่องสำหรับแอปเก่าและบังคับอัปเดตตามแผน ผู้ใช้ที่ล็อกอินค้างอยู่จะถูกย้าย session อัตโนมัติ ส่วนคนที่ออกจากระบบไปแล้วใช้รหัสผ่านเดิมได้ ต้องทดสอบสองเส้นทางนี้ก่อน release
7. เปิดหน้าแอดมินที่เตรียมไว้ด้วย `VITE_BACKEND=rust`, `VITE_RUST_BACKEND_URL` แล้วตั้ง `ADMIN_CONSOLE_ORIGINS` บน API เปิด RevenueCat webhook/mail/push worker ที่ตรวจแล้วตาม checkpoint เดียวกัน
8. หลังผู้ใช้อัปเดตแอปครบ:
   - ปิด Cloud Functions ฝั่งเขียน
   - เปลี่ยน Firestore rules เป็นอ่านอย่างเดียว
   - คง Firebase Auth ไว้จนกว่าจะไม่มีบัญชีที่ `legacy_password=true` เหลืออยู่
   - คง Firebase Storage แบบอ่านอย่างเดียวไว้สำหรับไฟล์แชตเก่า เพราะ URL ของไฟล์เหล่านี้อยู่ใน ciphertext ซึ่งแก้ไม่ได้

## ข้อควรรู้

- **รหัสห้องแชต**: ใช้ `c-{uid เล็ก}-{uid ใหญ่}` แบบเดิม แอปจึงคำนวณรหัสเองได้
- **Gmail เดิม**: บัญชีที่ยังใช้ Gmail ล็อกอินได้ แต่ต้องยืนยันอีเมล @psu.ac.th ก่อนใช้ฟีเจอร์หลัก เหมือนแอปเดิม
- **ย้อนกลับ**: ก่อนเปิด Rust writes สามารถคืน revision/config และ writer ของ Firebase ตาม checkpoint ที่บันทึกไว้ หากมีข้อมูลใหม่บน Rust แล้ว ห้ามเปิด Firebase writers กลับโดยไม่ reconcile เพราะ build เดิมไม่เห็นข้อมูลใหม่นั้น การย้อนกลับไม่ได้ลบ/reset Neon หรือ R2 โดยอัตโนมัติ
- **ค่าใช้จ่าย**: SSE ทำให้ Fly machine ทำงานตลอดเวลาที่มีคนเปิดแอปอยู่ ส่วน Rekognition คิดเงินตามจำนวนรูปที่ตรวจ
