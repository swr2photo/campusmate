# CampusMate: ย้าย API, ฐานข้อมูล และการเข้าสู่ระบบออกจาก Firebase

> **อัปเดต 13 ตุลาคม 2026:** backend และแอปครอบคลุมทุกฟีเจอร์แล้ว สถานะล่าสุดและขั้นตอนตัดระบบจริงดูที่ [rust-cutover-runbook.md](rust-cutover-runbook.md) ตารางด้านล่างคือ inventory เดิมที่ใช้วางแผน

วันที่ตรวจซอร์ส: 12 ตุลาคม 2026

เป้าหมายที่ผู้ใช้เลือกคือ Rust API + PostgreSQL + ระบบบัญชีและเซสชันของ CampusMate เอง ระบบใหม่นี้อยู่ใน `rust-backend/` และใช้ PostgreSQL เป็นแหล่งข้อมูลหลัก ไม่ใช่ `matching-service/` รุ่นที่ยังตรวจ Firebase ID token และอ่าน Firestore

ขณะนี้มีการพัฒนารากฐานบริการใหม่และไคลเอนต์แบบเลือกใช้ `src/services/rustBackendClient.js` โดยตั้ง `EXPO_PUBLIC_RUST_BACKEND_URL` เป็น HTTPS ไคลเอนต์นี้แยกเซสชัน Rust จาก Firebase และไม่ได้สลับทั้งแอปอัตโนมัติ การตั้ง URL เพียงอย่างเดียว **ไม่ใช่การย้าย CampusMate ทั้งระบบ** รายการ API ที่นำไปใช้ได้จริงและผลตรวจบริการต้องดูใน `rust-backend/README.md`

เอกสารนี้บันทึกขอบเขตงานย้าย เครื่องมือส่งออก และเงื่อนไขก่อนเปลี่ยนระบบจริง ยังไม่มีการส่งออกข้อมูลส่วนบุคคลจริง นำเข้าฐานข้อมูล production เปลี่ยนระบบเข้าสู่ระบบ production หรือปิด Firebase จากการทดสอบเครื่องมือในเอกสารนี้

## ขอบเขตที่พบจากซอร์ส

ผู้ใช้เลือก Neon เป็น PostgreSQL แล้ว สร้างโปรเจกต์แยก `CampusMate Rust`
(`icy-wildflower-47757369`) ใน Singapore, PostgreSQL 18, compute 0.25 CU
โดยไม่ใช้โปรเจกต์ระบบแบบประเมินเดิม Default branch คือ `staging`
(`br-wispy-mouse-b30rf7e3`) และ branch ตรวจ schema คือ
`schema-check-20261012` (`br-lively-cell-b3piehmz`) ตรวจว่าฐานข้อมูลว่างก่อนเริ่มแล้ว
Neon รับงานฐานข้อมูล ส่วน Rust API/worker ยังต้องมี compute host ของตนเอง
ระบบล็อกอินยังเป็น Rust ของ CampusMate ตามขอบเขตที่เลือก

การเชื่อมต่อแยก owner ผ่าน direct endpoint ออกจาก API/mail ผ่าน pooler
บังคับตรวจ certificate/hostname และกำหนด timeout ที่ LOGIN role
credentials ฝั่งเซิร์ฟเวอร์เก็บใน Secret Manager และสำเนา operator บน Windows
เข้ารหัสด้วย DPAPI จำกัด ACL ให้ผู้ใช้ปัจจุบันกับ SYSTEM เท่านั้น
ไม่มี PostgreSQL URL ใน Expo environment ดูขั้นตอนและผลตรวจล่าสุดใน
`rust-backend/operations/neon-operations.md` และ `rust-backend/README.md`
การเตรียม Neon ยังไม่ใช่การย้ายข้อมูลจริงหรือการสลับแอปทั้งระบบ

การค้น `firebase/` และ `@react-native-firebase` ใน `src/` กับ `app/` พบ 38 ไฟล์ โดยประเภทซ้อนกันได้:

| การใช้งาน SDK โดยตรง | จำนวนไฟล์ |
| --- | ---: |
| Firestore | 24 |
| Firebase Authentication | 9 |
| Firebase Functions | 18 |
| Firebase Storage | 1 |

นอกจากนี้มี Remote Config และการส่ง Firebase ID token ไปยังบริการอัปโหลดภายนอก `functions/` มี export ของงาน backend 70 รายการจากซอร์ส: callable/endpoint 51 รายการ, document trigger/scheduled job 18 รายการ และ HTTP webhook 1 รายการ ตัวเลขนี้เป็น inventory ของซอร์ส ไม่ใช่การยืนยันว่า production deploy ครบ 70 รายการ `firestore.rules` มี 34 match blocks รวม root และ deny catch-all ซึ่งต้องแปลงเป็นการตรวจสิทธิ์ที่ Rust ทุกครั้ง

`authService.js` กับ `dbService.js` เป็นจุดเริ่มต้นของระบบเดิม แต่ไม่ใช่ตัวเชื่อมเพียงสองไฟล์ที่เปลี่ยนแล้วจบ `AuthContext`, `MembershipContext`, `AppContext`, หน้าจอแชตและโปรไฟล์ รวมทั้งบริการย่อยยังเรียก `getAuth`, `onSnapshot`, transaction, query และ callable เอง การเปลี่ยนเฉพาะ login จะทำให้ส่วนเหล่านี้ถือเซสชันคนละระบบ

## สถานะการย้ายตามสัญญาการทำงาน

รากฐานบัญชี opaque sessions, โปรไฟล์, blocks และการจัดอันดับใหม่ใน `rust-backend/` เป็นงานส่วนแรก การรองรับแนวคิดเหล่านี้ไม่ได้ยืนยันว่าสัญญา callable เดิมและทุกหน้าจอเข้ากันแล้ว ตารางด้านล่างต้องผ่าน contract tests และการทดสอบแอปก่อนเปลี่ยนระบบจริง ไม่มีแถวใดถือว่า port ครบเพียงเพราะมีตาราง SQL

| กลุ่ม | สัญญาเดิมที่ต้อง port / แทนที่ | สถานะก่อน cutover |
| --- | --- | --- |
| บัญชีและอีเมล | `checkCampusEmailAvailability`, `sendCampusEmailChange`, `sendBrandedEmailVerification`, `sendBrandedPasswordReset`, `sendAccountDeletionOtp`, `verifyAccountDeletionOtp`, `deleteUserData`; SDK สมัคร/เข้าสู่ระบบ/ออกจากระบบ/Google login | Rust auth, single-use verify/reset, outbox และ email worker มี tests แล้ว; ยังไม่มีการส่งอีเมลจริง ต้อง port campus email change, Google OAuth, reauthentication, ลบบัญชี และ client integration |
| โปรไฟล์และความเป็นส่วนตัว | `getVisibleProfiles`, `setProfileVisibility`, การอ่าน/เขียน `users`, `profiles`, profile visibility, พิกัดและตัวกรองโดย SDK | โปรไฟล์/blocks ใน Rust เป็นรากฐาน; ต้องตรวจ field allowlist, privacy parity, face verification และ client integration |
| ค้นหา/likes/matches | `getDiscoveryPage`, `getIncomingLikeSummary`, `getMyDecisionState`, `recordDiscoveryAction`, `respondToIncomingLike`, `rewindDiscoveryAction`, `cancelPendingOutgoingLike`, `unmatchProfile` | Rust ranking และ mutations like/skip/respond/cancel/unmatch/rewind มี PostgreSQL tests แล้ว รวม acceptance race และ paid receipts; incoming summary/decision-state reads, import ประวัติเดิม และ client integration ยังเป็น gate |
| กุญแจแชต | `getConversationEncryptionProfiles`, `getPartyEncryptionProfiles`, device key publication และ envelope transactions | Direct-room keys/device/envelopes ใน Rust ตรวจ membership และทดสอบแล้ว แยกจาก public profile/face status; group keys และ client integration ยังไม่ครบ |
| แชต/วิดีโอ/appointments | conversation/message CRUD, reactions, read receipts, hidden/cleared history, `videoViews`, `videoRenditions`, appointments ผ่าน SDK | Rust direct-room ciphertext-only sends/pagination มี tests แล้ว รวม blocks/session-revocation ระหว่างรอ; realtime/offline queue, history migration, reactions/receipts, media และ appointments ยังต้อง port |
| กิจกรรมและ group chat | `searchCampusPlaces`, `resolveCampusPlace`, `createParty`, `requestJoinParty`, `withdrawPartyRequest`, `rejectPartyRequest`, `cancelParty`, `approvePartyRequest`, `activateLegacyPartyChat`, `leaveParty`, `rotatePartyKey`; SDK rooms/epochs/messages/receipts | ยังต้อง port lifecycle, host/member authorization และ key rotation |
| การชำระเงิน | `getMembershipState`, `syncMembership`, HTTP `revenueCatWebhook`; SDK `entitlements` | ยังต้อง port ตรวจ webhook, idempotency, store entitlement sync และ revocation; client ไม่สามารถเขียนสิทธิ์ Plus เอง |
| ใบหน้า/รูป/รายงาน/แอดมิน | `startFaceVerificationSession`, `completeFaceVerification`, `checkImageSafety`, `adminConsole`, `switchAdminMode`; SDK `reports`, `accountRestrictions` | ยังต้อง port; flags ยืนยันตัวตน/สิทธิ์ admin ต้องเขียนจาก server เท่านั้น |
| สื่อและอัปโหลด | `uploadPlacePhoto`, `uploadProfileGalleryImage`, `uploadChatMedia`, `getR2ChatUploadUrl`; Storage fallback และ avatar Worker ที่รับ Firebase token | ยังต้อง port; ผูก ticket กับ session Rust, room membership, bytes/type limit และ object ownership |
| การโทร | `getLiveKitToken`; SDK `calls`, `callerCandidates`, `receiverCandidates` | ยังต้อง port signaling, participant authorization, LiveKit token และหมดอายุสาย |
| การแจ้งเตือน | `registerPushToken`, `unregisterPushToken`, `ensureNotificationInbox`, `markAllNotificationInboxRead`; SDK notifications/read outbox | ยังต้อง port; ต้องลงทะเบียน push token ใหม่หลังย้ายเซสชัน และหยุด worker เก่าก่อนเปิด worker ใหม่ |
| บริการเสริม | `getPeerDistances`, `reportAppVersion`, `searchSpotifyTracks`, `browseMusicTracks`, `getMusicLyrics`; app config/Remote Config | ยังต้อง port; precise GPS ต้องอยู่ฝั่ง server และระยะที่ตอบกลับต้องรักษา privacy floor |

งาน background 18 รายการต้องมีตัวแทนที่ทำงานจริง ไม่ใช่แทนที่ด้วย HTTP routes อย่างเดียว:

| งานเดิม | ตัวแทนใน Rust/PostgreSQL ที่ต้องสร้างและทดสอบ |
| --- | --- |
| `syncDiscoveryProfile`, `syncPublicProfile` | สร้าง projection ใน transaction เดียวกับ profile update |
| `refreshDiscoveryOnVisibility`, `refreshDiscoveryOnMembership`, `refreshDiscoveryOnProfile` | transactional version/invalidation event; อย่าแสดง cache เก่าหลัง block, suspension, revocation |
| `notifyOnLikeCreated`, `notifyOnMatchCreated`, `notifyOnMessageCreated`, `notifyOnGroupMessageCreated` | transactional outbox, deduplicated notification worker |
| `expirePastParties`, `checkPushReceipts`, `cleanupUnverifiedFirebaseUsers` | worker ตามเวลาและ audit log; cleanup ใหม่ต้องทำกับบัญชี Rust โดยไม่ลบบัญชีเดิมอัตโนมัติ |
| `notifyIncomingCall` | push/call outbox ที่ตรวจผู้รับและสถานะสาย |
| `syncFaceNotificationInbox`, `notifyPartyRequestInbox`, `notifyPartyStatusInbox`, `notifyAppointmentInbox` | inbox rows ใน transaction หรือ outbox ที่ retry ได้ |
| `cleanExpiredNotificationInbox` | retention worker พร้อมเวลาที่แน่นอนและการตรวจ row expiry ใน API |

## ข้อมูลที่ต้องคงเดิม

| ข้อมูลเดิม | ข้อกำหนดในการนำเข้า |
| --- | --- |
| Firebase Auth UID | ใช้ค่า UID เดิมเป็น account ID ของข้อมูลย้าย ไม่สร้าง UUID ใหม่ให้บัญชีเดิม; encrypted local key store, room members, RevenueCat app user ID และข้อมูลอ้างอิงผูกกับ UID นี้ |
| `users`, `profiles`, `discoveryProfiles` | นำ `users` มาเป็นข้อมูลส่วนตัวหลัก แล้วสร้าง public/discovery projection ใหม่จาก allowlist; ไม่เชื่อ projection เก่าว่าสะอาดจาก email/GPS เสมอ |
| `accountRestrictions`, `users/*/blockedUsers`, `profileVisibility`, `entitlements` | import ก่อนเปิดค้นหา; suspension และ block ทั้งสองทิศต้อง deny ทันที; incognito ที่ Plus หมดอายุยังคง private จนเจ้าของเลือก public |
| `decisions`, `discoveryActions/*/entries`, `discoveryState`, `rewindReceipts/*/entries` | รักษา IDs, ลำดับ, สถานะ, receipts และ quota counters; ไม่สร้าง like/match/push ซ้ำระหว่าง replay |
| `conversations`, `messages`, `videoViews`, `videoRenditions` | รักษา room/member/message IDs, ciphertext, nonce, algorithm/version, envelopes, reactions, view limits, read/history cutoffs; นำ legacy root messages array เข้าเป็นประวัติที่ระบุเวอร์ชันไว้ |
| `parties/*/requests`, `groupChats/*/epochs`, `messages`, `readReceipts`, `users/*/groupChatReads` | รักษา membership, epoch order และ key grants; missing parent documents อาจมี subcollections จึงห้าม export เฉพาะ parent ที่ exists |
| `appointments`, `spots`, `calls` และ ICE candidate subcollections | รักษา reference; active call ณ ช่วง cutover ต้องจบหรือ restart อย่างชัดเจน |
| `users/*/notifications`, `reports`, config, RevenueCat events, delivery receipts | รักษา retention/read state/audit evidence; allowlist server-owned role fields และสิทธิ์ admin โดยตรวจเอง ไม่รับ custom claims มาให้สิทธิ์อัตโนมัติ |
| Firebase Storage / R2 | ส่งออก metadata/reference ของ default Firebase bucket; รูปและไฟล์จริงไม่ได้อยู่ใน JSONL และต้องจัดการแยก; R2 object inventory ยังไม่ได้ส่งออกด้วยเครื่องมือนี้ |

แม้ชื่อ collection ที่ไม่อยู่ในตารางก็จะถูกสำรวจจาก `listCollections()` โดยเครื่องมือส่งออก ยกเว้น transient capability collections ที่ระบุไว้ใน manifest ต้องตรวจ unknown collections ทุกชื่อก่อน importer ตีความ

## Auth และ encrypted chat

เครื่องมือส่งออก Auth ใช้ allowlist: UID, email, verification/disabled flags, display name/photo, provider identifiers และเวลาสร้าง/เข้าสู่ระบบ ไม่ส่งออก `passwordHash`, `passwordSalt`, custom claims, refresh/access/ID tokens การไม่ส่งออก password material เป็นนโยบายของการย้ายครั้งนี้ ไม่ได้หมายความว่า Firebase ไม่มีวิธี export hash

บัญชีที่มี password provider ถูกทำเครื่องหมาย `password_reset_required: true` ต้องตั้งรหัสผ่านใหม่ผ่านช่องทางอีเมลที่ตรวจเจ้าของบัญชีแล้ว ห้ามเติมรหัสผ่านเริ่มต้น ห้ามให้สมัครบัญชีใหม่ทับ UID เดิม และห้ามเปิดใช้งาน imported account ที่ถูก disabled หรือ suspended การไม่มี refresh token ทำให้ต้องเข้าสู่ระบบใหม่ ส่วนบัญชี Google ต้องผูก provider subject เดิมกับ OAuth token ที่ Rust ตรวจ issuer/audience/expiry แล้ว ระบบ reset และ OAuth ต้องพร้อมก่อนส่งผู้ใช้จริงเข้าระบบใหม่

แชตใช้ `x25519-xsalsa20-poly1305.v1`; secret keys อยู่ใน SecureStore ของอุปกรณ์ ไม่ควรอยู่ใน export ฝั่ง server ต้องคง public `encryptionDevices`, ciphertext, nonce และ wrapped `keyEnvelopes` ไว้ การย้ายฐานข้อมูลไม่ได้ทำให้อุปกรณ์ใหม่ถอดรหัสประวัติโดยไม่มี envelope ที่อ่านได้

การอ่านกุญแจห้องสนทนาอาศัย membership ของห้อง ซึ่งแยกจาก face verification และ public visibility บัญชีสมาชิกที่ซ่อนโปรไฟล์ยังมีสิทธิ์แชตตามเดิม ส่วนบัญชี suspended ยังต้องถูก deny ข้อมูลกุญแจที่ตอบกลับต้องมีแค่ public device keys ของสมาชิกที่ร้องขอและได้รับอนุญาต

พบซอร์สเดิมบันทึก `encryptedMessage.preview = safeText.slice(0, 500)` หลังเข้ารหัสใน `firestoreService.js` จึงอาจมี preview เป็น plain text ใน records เดิม ปัจจุบันแก้ซอร์ส client ให้เขียนข้อความกลาง และแก้ notification builder/trigger ให้ตัด plaintext preview กับ media URL ของ encrypted messages แล้ว โดย Functions tests ผ่าน 215/215 แต่ยังไม่ได้ deploy หรือออก client release และยังไม่แก้ records เก่า ห้ามถือว่าข้อมูลเก่าทุก field เป็น E2EE หรือคัดลอก preview ไปเป็น push body ต้องตัดสิน retention/redaction ของ field นี้ก่อน activate history ใน schema ciphertext-only ใหม่ เครื่องมือส่งออกเก็บข้อมูลต้นทางโดยไม่แก้ records

## เครื่องมือส่งออกแบบ read-only

ไฟล์: `scripts/export-native-backend.mjs` และ tests: `scripts/test-native-export.mjs` ใช้ dependency `firebase-admin` จาก `functions/node_modules` การ import module เพื่อทดสอบไม่ initialize Firebase และไม่ใช้ ADC

คำสั่งทดสอบด้วยข้อมูลสังเคราะห์ที่รันแล้วผ่าน 6/6:

```powershell
node --test scripts/test-native-export.mjs
```

tests ครอบคลุม nested/orphan subcollections, typed values, auth/storage pagination, การตัด secrets, identity/key preservation, checksums, partial failure, output traversal, existing-output refusal และ junction/symlink escape ไม่มีการเรียก Firebase production จาก tests

คำสั่งส่งออกจริงด้านล่างเป็นคำสั่งสำหรับ operator **ยังไม่ได้รัน** ต้องจัด write freeze หรือ reconciliation window และเตรียมสิทธิ์ read-only สำหรับ Firestore, Auth และ Storage ของ project นี้ก่อน การอ่านข้อมูลมีค่าใช้จ่ายตามบริการ ข้อมูล export มี PII ให้จำกัดการเข้าถึงเครื่องและดิสก์:

```powershell
node scripts/export-native-backend.mjs --project campusmate-7f1ab --confirm-production-export --run before-cutover-20261012
```

เครื่องมือไม่ใช้ default project ของ gcloud การระบุ project อื่นจะถูกปฏิเสธก่อน initialize SDK และไม่รับ output path ที่ผู้เรียกกำหนด ไฟล์อยู่ใต้ `artifacts/rust-migration/<run>/` เท่านั้น ซึ่งถูก ignore ด้วย `artifacts/` ใน `.gitignore` หากจำเป็นต้องใช้ legacy bucket ชื่อ `campusmate-7f1ab.appspot.com` ให้ระบุ `--storage-bucket` ชื่อนั้น; bucket จาก `google-services.json` ปัจจุบันคือ `campusmate-7f1ab.firebasestorage.app`

ทุก run ต้องใช้ชื่อใหม่และไม่ทับ export เดิม ต้องตั้ง ADC สำหรับ project ที่ระบุ โดยใช้สิทธิ์ที่อ่านรายการ users/documents/object metadata ได้ อย่าส่ง credential เข้า repository หรือใส่ไว้ใน arguments ของคำสั่ง

| ไฟล์ | เนื้อหา |
| --- | --- |
| `firestore.jsonl` | แต่ละแถวมี `path`, `id`, `collection`, `create_time_ms`, `update_time_ms`, `data`; สำรวจทุก root collection และทุก subcollection ด้วย `listDocuments`/`listCollections` รวม children ของ parent ที่ไม่มี document |
| `auth-users.jsonl` | allowlisted identity/provider metadata และ credential migration flags |
| `storage-objects.jsonl` | bucket/name/generation/size/content type/checksum/custom metadata ที่ตัด secret แล้ว และ `gs://` reference; ไม่ดาวน์โหลด object bytes หรือสร้าง download URLs |
| `manifest.json` | format version/project/time window/counts, skipped collections/redaction counts, ขนาดและ SHA-256 ของ JSONL ทุกไฟล์ |

Firestore Timestamp/Date ถูกแปลงเป็น epoch milliseconds โดยตัด precision ต่ำกว่า millisecond ชนิด GeoPoint/DocumentReference/bytes/nonfinite numbers/integer ที่เกิน JavaScript number มี `$type` tags เพื่อให้ importer แยกได้ ไม่ควรนำ JSONL ไป `INSERT` โดยไม่ validate/map schema

เครื่องมือข้าม `accountDeletionOtps`, `faceVerificationSessions`, `pushTokens`, `likePageCursors`, `discoveryPageCursors` เพราะเป็นข้อมูลสิทธิ์ชั่วคราวที่ต้องออกใหม่ ไม่ใช่บัญชีหรือประวัติข้อความ นอกจากนี้ตัด field ของ credentials/tokens/secrets แบบ recursive และตัด query parameters ของ token/signed URL เพื่อไม่คัดลอก download capabilities ลง export จำนวนที่ตัดอยู่ใน manifest ผู้ใช้ต้องลงทะเบียน push token ใหม่กับ Rust หลังย้าย

ไฟล์เขียนใน directory `.partial` โดยใช้ mode `0600` และ directory `0700` แล้ว sync และ rename หลังเขียน manifest สำเร็จ การล้มเหลวไม่สร้าง completed manifest ใน final directory และไม่ลบ partial data อัตโนมัติ `mode` ไม่ใช่ Windows ACL enforcement: บน Windows ต้องจำกัด ACL ของโฟลเดอร์/ผู้ใช้อื่นเองและใช้ดิสก์เข้ารหัสตามนโยบายของผู้ดูแล อย่าแนบ export จริงใน PR, chat หรือ log

ผลส่งออกเป็นการอ่านหลายเวลา ไม่ใช่ transaction snapshot ของทั้ง Auth/Firestore/Storage หากระบบเดิมยังเขียนอยู่ rows อาจไม่ตรงกัน แม้ checksum ถูกต้อง ต้อง write freeze และตรวจ orphan/references หรือทำ incremental reconciliation ก่อน importer commit ผล SHA-256 รับรองไฟล์ไม่เปลี่ยนหลัง export แต่ไม่ได้รับรอง consistency หรือ backup ของ media bytes

## เงื่อนไขการเปลี่ยนระบบจริง

1. สร้าง staging PostgreSQL และรัน migrations ด้วย role แยกจาก app role; สำรอง/restore PostgreSQL ได้จริง ตรวจ HTTPS, secret delivery และ opaque session rotation/revocation โดยไม่ log token ใช้ TLS สำหรับการเชื่อม PostgreSQL ข้ามเครื่อง
2. `rust-backend/src/bin/import-export.rs` รองรับตรวจ manifest/hash/count และ staging import แบบ transaction ในฐานข้อมูลปลายทางว่างแล้ว โดยยังไม่ activate ข้อมูลธุรกิจ ต้องเพิ่ม transformations และตรวจ dangling references, member/device/envelope coverage และ disabled/suspended/blocked/entitlement parity ด้วย fixtures และ staging export ก่อน cutover
3. Port API และ worker ทุกกลุ่มใน inventory พร้อม contract tests แล้วเปลี่ยน services/contexts/screens ทั้ง 38 ไฟล์ไป abstraction เดียว ขณะเลือก Rust ให้ error เมื่อ feature ยังไม่มี implementation แทนการ fallback ไป Firebase auth/database โดยเงียบ ๆ ห้าม dual-write โดยไม่มี consistency protocol
4. ทดสอบอุปกรณ์ Android/iOS จริง: sign-up/login/verify/reset/Google login/logout/account switch, discovery + block/revoke/incognito, likes + rewind/match, private keys/chat history/offline retry, group rotation, calls, purchases, pushes, media uploads/deletion และ admin moderation ใช้ network traces ยืนยันว่าแอป Rust mode ไม่เรียก Firebase SDK/Functions/Storage สำหรับงานที่ย้ายแล้ว
5. วัด throughput/p50/p95/p99 ด้วย dataset และ workload เหมือน production ทั้ง warm/cold cache รวม query plans/pool waits/CPU/RAM/network เปลี่ยนภาษาไม่ได้ยืนยันว่าเร็วที่สุด และ cache ต้อง revoke สิทธิ์ได้ก่อนตอบข้อมูล
6. ก่อน cutover ทำสำรองข้อมูลเดิม จัด maintenance/write freeze และหยุด background writers/delivery workers เดิม ส่งออกครั้งสุดท้าย/import/reconcile จากนั้นค่อยเปิด Rust writer/worker และ client release ที่ตรวจครบ อย่าหยุด Firebase ก่อนมีข้อมูลและทางกู้คืนที่ตรวจแล้ว
7. Rollback ใช้ source snapshot, app version/config และ backend build ที่ระบุชัด ถ้าฝั่ง Rust รับ writes แล้ว ต้อง reconcile/นำ writes นั้นกลับหรือทำ forward fix ก่อนกลับ legacy; ห้ามเพียงสลับ URL กลับแล้วทิ้งข้อมูลใหม่ ตรวจไม่ให้ส่ง notifications/payment events ซ้ำ
8. เก็บ Firebase เดิมและ private exports ตาม retention ที่กำหนด จนผ่านช่วงตรวจและพิสูจน์ restore แล้ว การลบ production/project/credentials ต้องเป็นขั้นตอนแยกหลัง review ไม่ได้เกิดจากเครื่องมือส่งออกนี้

## แหล่งอ้างอิง API ของเครื่องมือ

การส่งออกบัญชีใช้ [Firebase Admin: List all users](https://firebase.google.com/docs/auth/admin/manage-users#list_all_users) การสำรวจ collection ใช้ [Firestore Node.js API](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/firestore) และการส่งออกแบบ managed เป็นงานคนละชนิดกับ JSONL tool นี้ตาม [Firestore export/import documentation](https://firebase.google.com/docs/firestore/manage-data/export-import) ให้เลือก backup ที่ restore ได้ตามสภาพแวดล้อมก่อน cutover
