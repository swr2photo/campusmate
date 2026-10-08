# รูปสถานที่ แผนที่ และ CampusMate Plus

สถานะ 2026-10-04: งานยังดำเนินอยู่ ระบบสมาชิกยังไม่เปิดขายจริง ผู้ใช้ยืนยันว่ายังไม่มี RevenueCat, AdMob และสินค้าในสโตร์

## ขอบเขตที่อนุมัติ

- แก้ภาพ onboarding หาย ใช้ภาพที่อยู่ในบันเดิล โหลดล่วงหน้า และตรวจแบบออฟไลน์
- รูปโปรไฟล์ใช้ `avatarRevision` เฉพาะเมื่อเปลี่ยนภาพ; bio และข้อมูลอื่นใช้ `updatedAt` แยกกัน
- รูปสถานที่จริงที่มีสิทธิ์เก็บและเผยแพร่ได้ แปลง WebP 320/1200 พิกเซล อัปโหลด R2 เก็บแหล่งที่มา เจ้าของภาพ ใบอนุญาตและ revision
- รูปสถานที่อัปเดตผ่าน listener `spots` เดิม หน้าที่เปิดอยู่รับภาพใหม่ได้ ไม่ใช้ภาพคนละสถานที่แทน
- Google native maps บน Android/iOS, หมุดและ picker ใช้พิกัดเดียวกัน, ค้นหาภายใน 3 กม. ของ ม.อ. หาดใหญ่, แจ้งข้อผิดพลาด/ลองใหม่/เปิด Google Maps ภายนอก
- Plus หนึ่งระดับ รายเดือน/รายปี ไม่มี trial ราคาอ่านจากสโตร์ ซื้อ/คืนค่า/ต่ออายุ/หมดอายุ/คืนเงิน/สลับบัญชีผ่าน RevenueCat และตรวจสิทธิ์บนเซิร์ฟเวอร์
- ฟรี: เพศ อายุ ระยะทาง กิจกรรม; Plus: คณะ ชั้นปี เวลาว่าง pace
- ฟรี: จำนวนคนที่ถูกใจ; Plus: รายชื่อและรูป; จับคู่และแชตที่ยอมรับแล้วใช้งานฟรีต่อได้
- Rewind: Plus ย้อน skip หรือ like ที่ยังไม่จับคู่ ตามลำดับการกระทำ ย้อน match/chat ที่ยอมรับแล้วไม่ได้ และไม่คืนคนที่ถูกบล็อกหรือลบบัญชี
- Incognito: ให้คนที่เรา like และคนที่จับคู่แล้วเห็น; หมดสมาชิกแล้วยังคงส่วนตัวจนเจ้าของเลือก public เอง
- โฆษณา native card หลังทุก 10 discovery actions และ 6 activity items, no-fill ข้าม, Plus ไม่ร้องขอโฆษณา
- ย้ายการอ่าน profiles/discoveryProfiles/incoming decisions ไป server APIs ก่อนปิด reads เดิมและตั้ง minimum build; ล้าง cache ของสิทธิ์ที่หมดอายุ

## ทำแล้วและหลักฐาน

### ภาพและสถานที่

- `OnboardingScreen`: ระบุขนาดจริง, expo-image/CachedImage, preload ภาพทั้งสาม, มี retry
- `avatarRevision` ผ่าน profile save/account storage/public/discovery/conversation projections และ rules ใน workspace
- `CachedImage` เก็บ placeholder ตาม identity จำกัด 300 รูป; prefetch ใช้ revision เดียวกับภาพที่แสดง
- `PlacePhoto` รับรูปใหม่จาก `useAppFeed().campusSpots` และมีเครดิต/ใบอนุญาต/ลิงก์/สถานะผิดพลาด
- R2 bucket `campusmate-public-images` สร้างแล้ว แยกจากสื่อแชตเข้ารหัส
- Worker `campusmate-place-photos` ที่ `photos.getcampusmate.app` deploy แล้ว version `3f07d70e-4a7c-4681-946b-fe79badfb52a`
- รูปอ่างเก็บน้ำ ม.อ. จาก Wutkh/Wikimedia Commons ตาม `assets/places/manifest.json` อัปโหลดจริงและเผยแพร่ใน Firestore `spots/spot-reservoir-heart`
- full WebP 128,980 bytes, thumbnail 8,396 bytes, revision `5deb0cb12c1ac8f3303ca12f39bcf2e50d9721b605a964866815e61867f9540a`
- GET thumbnail จาก SIN: 200/MISS แล้ว 200/HIT สองครั้ง; `CF-Cache-Status: HIT`, `Cache-Control: public, max-age=31536000, immutable`
- สถานที่อื่นยังต้องเพิ่มภาพที่ตรวจสอบได้ ปัจจุบันแสดง placeholder หากไม่มีภาพ ไม่จับคู่กับภาพหมวดหมู่แบบเดิม
- เพิ่มรูปคณะวิทยาศาสตร์และพิพิธภัณฑ์ธรรมชาติวิทยา ม.อ. จาก Wutkh/Commons ที่ตรวจ CC-BY-4.0 แล้วใน `spots/spot-natural-museum`; full 165,928 bytes, thumbnail 11,892 bytes, revision `d926a48724e1ae1070f5c0c215168110416d9abb335126892fd40c09c02e3836`
- ทั้งรูปอ่างเก็บน้ำและพิพิธภัณฑ์แสดงจริงใน Android แล้ว: `artifacts/android/reservoir-r2-native.png`, `museum-r2-native.png`; thumbnail พิพิธภัณฑ์ GET 200/MISS แล้ว 200/HIT สองครั้ง (`artifacts/place-photos/museum-cache-check.json`)
- สลับโปรไฟล์/กิจกรรม 10 รอบ (20 tab changes) แล้วรูปพิพิธภัณฑ์และคำค้นยังอยู่: `museum-after-tab-switches.png`, `place-tab-switch-verification.json`; Worker tail ไม่ใช่การจับ HTTP ทั้งเครื่อง จึงยังไม่สรุปว่าไม่มี request ซ้ำ
- Importer CLI `node scripts/import-place-photos.mjs --prepare`, อัปโหลด immutable objects ด้วย Wrangler, `--publish` ตรวจ HEAD/CDN ก่อนเขียน Firestore
- Callable `uploadPlacePhoto` มี auth/admin claim, จำกัด 5 MB/24 MP, ลบ EXIF, เขียน URL หลังอัปโหลดสองขนาดสำเร็จ; ยังไม่ได้ deploy/ตั้ง S3 secrets สำหรับ callable

### แผนที่

- `CampusMapView.native.js` ใช้ react-native-maps และ Google provider มีหมุด เลือกสถานที่ นัดหมาย ไปตำแหน่งปัจจุบัน และ error/retry/external maps
- เอา Leaflet/CDN และ undocumented Google tile URL ออกจาก `CampusMapView.js`; web ใช้รายการและลิงก์แผนที่
- Maps Android/iOS SDK และ billing เปิดอยู่แล้วในโปรเจกต์จริง
- อ่าน Maps SDK keys เดิมที่จำกัด API/package/SHA-1 และ iOS bundle แล้วเชื่อม `.env` (ไม่บันทึกค่า key ในรายงาน)
- API Keys API ใช้ ADC ต้องใส่ `x-goog-user-project: campusmate-7f1ab`; การอ่านครั้งแรกที่ขาด quota project ได้ 403 จาก SERVICE_DISABLED ไม่ใช่ขาดสิทธิ์เจ้าของ
- Android export ผ่าน 3,102 modules และรวมภาพ onboarding; export นี้เริ่มก่อนเชื่อม Maps key ไม่ใช่หลักฐาน runtime ของแผนที่
- APK สำหรับ QA x86 สร้างสำเร็จ 3,326 modules โดยปิด minification/shrinking เฉพาะคำสั่ง QA; ไม่ใช่ release สำหรับสโตร์
- แผนที่ Google native แสดงถนน ป้ายสถานที่และหมุดใน ม.อ. หาดใหญ่บน Android API 25 แล้ว: `artifacts/android/plus-map-adb-map-loaded.png`
- ตรวจแผนที่จาก APK ที่รวมการป้องกัน profile bootstrap แล้วเช่นกัน: `artifacts/android/plus-map-latest-qa-loaded.png`
- `agent-device` บางครั้งคืน snapshot/ภาพที่ไม่ตรงกัน จึงตรวจภาพสดด้วย ADB screencap ประกอบ; ภาพชื่อ `plus-map-qa-*.png` ชุดแรกไม่ใช้ยืนยันแผนที่
- แก้ Metro build ให้ใช้ worker เดียวหลังรอบที่เปิด emulator พร้อมบิลด์เกิด Node `Fatal process out of memory: Zone`; รอบล่าสุด BUILD SUCCESSFUL ใน 4m 58s
- APK ชุดก่อน minimum-build guard SHA256 `89b72981b97536e4551b526e53c90df5e7b38ec9e35dcf62ac794a8069f5ef2d` ติดตั้ง `-r` และตรวจ onboarding/แผนที่/R2 แล้ว
- ไฟล์ปัจจุบัน `artifacts/android/campusmate-plus-map-qa-x86.apk` SHA256 `65a864d443c73cc8f969ad0f9e8f6d8bfca8c832c74d26d9cf80c682e02990fd`; BUILD SUCCESSFUL 4m 3s, 3,328 modules; `node scripts/check-plus-map-apk.cjs` ยืนยัน source map ตรง 11 ไฟล์รวม minimum-build/notification/privacy/image guard (`plus-map-bundle-verification.json`)
- ติดตั้ง APK นี้ด้วย `adb install -r` Success และเปิดแอป/โปรไฟล์/กิจกรรมได้; log native `expo-image` ยืนยัน `place:spot-reservoir-heart cache=disk` และ `place:spot-natural-museum cache=disk` (`image-cache-native.log`, `build-gate-native-verification.json`); ผลนี้ยืนยันแหล่ง cache ของการโหลดดังกล่าว แต่ยังไม่แทน HTTP capture หรือการสลับแท็บครบ 10 รอบบน APK ใหม่นี้
- QA-only `imageCacheDiagnostics` เปิดจาก build helper เฉพาะ `--qa`; log ไม่พิมพ์ URL/UID ของภาพส่วนตัว และ secure flag ยัง false จึงยังไม่ได้ตรวจ notification cleanup native
- ตรวจภาพ onboarding ครบสามหน้าตอน `wifi_on=0` แล้วเปิด Wi-Fi คืน: `artifacts/android/onboarding-offline-page1.png` ถึง `page3.png`

### สมาชิกและโฆษณา

- ติดตั้ง react-native-purchases 10.11.0 และ react-native-google-mobile-ads 17.2.0; functions sharp 0.35.5
- มีหน้า `/membership`, ลิงก์จากตั้งค่า, อ่าน monthly/annual packages และราคา, ซื้อ/คืนค่าการซื้อ/ลิงก์จัดการสมาชิก
- มี MembershipProvider, แยกข้อมูลตาม Firebase UID, expiry timer, foreground refresh, ไม่เปิด SDK หากไม่ตั้งค่าจริง
- Server entitlement sync re-fetch RevenueCat; generation ป้องกัน response เก่าที่มาหลัง refund re-grant สิทธิ์
- Webhook ตรวจ authorization, deduplicate event หลังประมวลผลสำเร็จ, ตรวจ transfer ทั้งบัญชีเดิมและใหม่, failure ให้ retry
- Sandbox ปิดใน production, ไม่รับ test-store/lifetime promotional; paid expiry, grace, refund และการยกเลิกก่อนหมดรอบมี tests
- NativeAdCard รอ consent, เปิดเฉพาะฟรีที่ server ยืนยันแล้ว, Plus/unknown/offline ไม่ request, hook destroy เมื่อ unmount, no-fill ไม่ทิ้งช่องว่าง
- `adPolicy` กำหนด 10 actions / 6 items และเชื่อมการ์ดเข้าทั้งสอง feed แล้ว; ยังไม่มี AdMob IDs จึงไม่ส่งคำขอโฆษณาจริง
- Visibility/filter policies ผูกกับ server APIs เมื่อเปิด secure flag แล้ว; ยังไม่ตัดการอ่านเดิมและยังไม่เปิด Incognito
- เมื่อยังไม่มี AdMob app ID ลบ SDK auto-init provider เพื่อไม่ crash; Expo plugin และ Android manifest ตรงกัน; `newArchEnabled=true` ตาม SDK ที่ใช้
- หน้า Plus แสดงสิทธิประโยชน์และแจ้งว่ายังไม่เปิดสมัคร เมื่อไม่มีบัญชี/สินค้าจริง: `artifacts/android/membership-unconfigured-native.png`; ไม่แสดงราคา/การซื้อปลอม

### API และการย้ายระบบ

- มี server visible-profile/discovery/count-only incoming likes APIs, opaque owner-bound pagination และตรวจ advanced filters ด้วย entitlement ฝั่ง server
- record/respond/cancel/unmatch/rewind ใช้ Firestore transactions ร่วมกัน; Rewind มี sequence และ idempotent receipts ไม่ย้อน accepted matches หรือคืน block/deleted users
- Incognito และ entitlement เปลี่ยนแล้วส่ง global revision; GPS/last-seen ไม่สั่ง reload feed ทุกคน
- เปลี่ยน profile detail และ chat Android/iOS, party member names และ E2EE key hydration ให้ใช้ APIs เมื่อเปิด secure flag; group key API คืนเฉพาะ id/device keys ที่มีสิทธิ์
- เพิ่ม pending-like pagination, native ad cards ใน discovery/party list, membership expiry guard และล้าง expo cache/SwiftUI file references; ไม่เก็บ secure discovery profiles ใน fast-boot cache
- compatible `firestore.rules` รองรับ avatarRevision และ private entitlement/visibility deploy แล้ว; **ยังเปิด reads เดิม** ขณะเตรียม cutover
- compatible rules ที่เพิ่ม owner-only `matchingSignals` read / ปฏิเสธ client writes deploy สำเร็จแล้ว หลังผ่าน actual rules emulator; indexes deploy สำเร็จและ `gcloud firestore indexes composite list` ยืนยันทั้ง 10 indexes เป็น `READY`
- สร้าง `firestore.secure.rules` ด้วย `node scripts/prepare-secure-profile-rules.mjs`; ยังไม่ deploy ไฟล์นี้ และ firebase.json ยังชี้ compatible rules
- actual Firestore emulator ผ่าน ordered/idempotent Rewind, acceptance races, cancel/unmatch, expired Incognito และ party key authorization; staged rules ผ่านการปฏิเสธ direct profile/discovery/pending-like reads และ forged privilege
- `node scripts/migrate-secure-matching.mjs --dry-run` ตรวจ Firestore จริง: 14 users, 29 legacy actions, 0 missing ordering, 0 writes
- Migration เก็บเฉพาะ decision เดิมที่ยังเหลือ พร้อมเวลาที่ตรวจสอบได้; ไม่อ้างว่ากู้ประวัติการกระทำที่ถูกทับหรือลบไปแล้วได้ Apply ต้องปิด legacy writes ก่อนเริ่ม และต้องทำก่อนเปิด action APIs
- secure APIs 11 endpoints deploy แล้วโดย `node scripts/deploy-secure-access.mjs --deploy` ใช้ source entry เฉพาะชุดนี้ ไม่โหลด secret RevenueCat ที่ยังไม่มี; config ยังชี้ codebase default และไม่แก้ endpoint อื่น
- live HTTP ตรวจ getVisibleProfiles/getDiscoveryPage/getIncomingLikeSummary/record/rewind/visibility คืน `FAILED_PRECONDITION` ตาม `CAMPUSMATE_SECURE_DISCOVERY_ENABLED=false` (`artifacts/server-staging/disabled-live-check.json`)
- secure client/Plus/ads flags ยังปิด; restrictive cutover และ RevenueCat/AdMob ยังไม่ขึ้น production
- เพิ่ม “ดูหน้าแนะนำอีกครั้ง” ในตั้งค่า เพื่อทดสอบ/ดู onboarding โดยเก็บ login และกุญแจแชตไว้
- แก้ AppContext ให้ใช้ outgoing decision array จริง: skip ไม่กลับมาแสดง และ snapshot ว่างหลัง Rewind ล้าง decision cache เก่าได้
- รีเฟรช secure discovery ทุกหน้าที่เคยโหลด และไม่ทิ้ง visibility signal ที่มาระหว่าง pagination; response ก่อนเปลี่ยนบัญชีหรือหลังหมด Plus ไม่คืน pending identities
- การทดสอบ `scripts/test-discovery-client.mjs` 7/7, profile save 4/4, app/group regressions + ad policy 14/14 และ entitlement/notification/distance 13/13 ผ่าน

### การอ่านโปรไฟล์หลังกลับมาออนไลน์

- เครื่อง QA กลับไปหน้าสร้างโปรไฟล์ระหว่างตรวจ offline/online; พบการเขียนโปรไฟล์ว่างและหยุดแอปก่อนตรวจข้อมูลจริง
- แก้การอ่านไม่ให้คืน `null` เมื่ออ่านล้มเหลวหรือมีเพียง cache absence; สร้างบัญชีใหม่ได้เมื่อ server ยืนยัน absence เท่านั้น และ `onlyIfMissing` ใช้ transaction ป้องกันเขียนทับโปรไฟล์ที่กู้คืน/สร้างพร้อมกัน
- กู้ 8 fields ที่ตรงกันจาก participant projections 9 ห้องของบัญชี QA ได้แก่ name/age/faculty/year/gender/avatarUri/activity/availability; ไม่เดา activityLabel/bio/meetup ที่ต่างกัน เก็บ backup ใน `artifacts/private-qa/` ซึ่ง git-ignore แล้ว
- อ่าน Firestore หลังซ่อมยืนยัน users/profiles/discoveryProfiles มีภาพและกิจกรรม และ `isNewUser=false`; ห้องแชต 9 ห้องและ device keys เดิมไม่ได้ถูกแก้ในการซ่อม
- สาเหตุที่ข้อมูล server หายก่อน bootstrap ยังไม่ได้ยืนยัน; การป้องกัน read failure/absence/race และการกู้เฉพาะข้อมูลที่ตรวจสอบได้ผ่านการทดสอบแล้ว

## งานที่ต้องทำต่อ

1. ตรวจ Android สลับแท็บพร้อมวัด request, รูปที่อัปเดตขณะหน้าเปิด และเปลี่ยน avatar จริง; ตรวจ iOS native runtime
2. ตรวจ minimum native build และ notification/cache cleanup บนเครื่องเมื่อเปิด secure QA; เปิด minimum build จริงเฉพาะรุ่นที่เผยแพร่และดาวน์โหลดได้จากแต่ละสโตร์
3. ตรวจ migration/visibility metadata/counters กับ production แบบ dry-run; ปิด legacy writes, apply ordered history และตัด reads เดิมเมื่อ client พร้อมเท่านั้น
4. ทดสอบ secure flows บน Android/iOS กับ backend ที่เปิดเฉพาะสภาพแวดล้อม QA รวม E2EE/party; production ยังปิดไว้
5. ตั้ง RevenueCat/AdMob/สินค้า Play+App Store ตามคู่มือด้านล่าง ตรวจ sandbox lifecycle และ ad no-fill จริง แล้วจึงเปิด flags
6. เพิ่มภาพจริงให้สถานที่อีก 33 แห่งจากเจ้าของภาพหรือแหล่งที่อนุญาต; callable importer ยังต้องตั้ง secrets/deploy

## การตรวจ native build ก่อน cutover

- ตัวตรวจอัปเดตอ่าน `expo-application` native version/build จาก binary; OTA version ใช้แทน native version ไม่ได้ ตาม [Expo Application](https://docs.expo.dev/versions/latest/sdk/application/)
- Firestore `app_config/version.platforms.android` และ `.ios` แยก `latestVersion/latestBuild/minVersion/minBuild/storePublished`; legacy Google Play config ใช้เฉพาะ Android ส่วน iOS ต้องมีสถานะ App Store และ URL ที่ใช้ได้ของตนเอง
- build ใหม่ที่เลขเวอร์ชันเดิมตรวจได้; snooze แยก platform/version/build และข้ามไม่ได้เมื่ออยู่ต่ำกว่า minimum; ไม่บังคับดาวน์เกรดหรืออัปเดตไป minimum ที่สูงกว่ารุ่นซึ่งมีให้ดาวน์โหลด
- Android build เป็น versionCode ที่เพิ่มต่อเนื่อง; iOS minBuild ผูกกับ latestVersion และเมื่อข้ามเวอร์ชันต้องระบุ minVersion เพื่อรองรับ CFBundleVersion ที่เริ่มใหม่
- `node scripts/set-version-config.mjs 2.1.8 2.1.8 --platform android --latest-build 78 --min-build 78` เป็นตัวอย่าง **local proposal เท่านั้น** ไม่ใช่เวอร์ชันที่เผยแพร่จริง; 0 Firestore writes เว้นแต่ใส่ `--apply` และต้องใช้เลข build จริงจากสโตร์เมื่อใส่ `--published`
- คำสั่งนี้แทนที่ config เฉพาะ platform ที่เลือกและรักษา platform อื่น; staging release จาก `release-version.mjs` ตั้ง Android unpublished พร้อมล้าง minimum เก่า
- `node scripts/check-version-readiness.mjs` อ่านสถานะจริงโดยไม่แก้ config: Android รุ่น native ที่ build อยู่ 2.1.7/77 ไม่ถูกบังคับอัปเดต และ iOS ยังไม่ published; `scripts/test-version-update.mjs` ผ่าน 9/9 รวม native-vs-OTA, same-version build, store publication, snooze, preview versionCode และ delayed snapshot
- CLI default proposal และ validation ก่อน apply ผ่าน 2/2 ใน `scripts/test-version-config-cli.mjs`; Android/iOS proposals ที่เตรียมไว้ยัง unpublished และไม่ได้ apply
- เมื่อเปิด secure flag จะล้างเฉพาะแจ้งเตือน pending like จาก Expo/NotifyKit ที่แสดงอยู่/ตั้งเวลาไว้ รวม last like response ตอนเริ่ม session, เปลี่ยนสิทธิ์ และ foreground; ไม่ล้าง accepted matches/chat/calls
- foreground legacy like ที่มี profileId/รูป/ชื่อถูกระงับ; source tests ผ่าน 3/3 ใน `scripts/test-notification-privacy.mjs` แต่ยังต้องตรวจ native ตอนเปิด secure QA และไม่สามารถย้อนไปลบข้อมูลที่ผู้ใช้เห็นจาก push ก่อน cutover แล้วได้ ตาม [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)

## ตั้งค่าบัญชีที่ยังไม่มี

ผู้ใช้ต้องสร้างบัญชี/ยอมรับเงื่อนไข/กำหนดการชำระเงินด้วยตนเอง ไม่ส่งรหัสผ่านหรือ secret ในแชต

- Play Console: สร้าง subscription Plus, base plans monthly และ annual, ไม่มี trial/introductory offer, ตั้งราคาที่ต้องการและ license testers
- App Store Connect: subscription group เดียว, monthly และ annual products, ไม่มี trial, ราคาและ sandbox testers
- RevenueCat: โปรเจกต์เดียวมี Android และ iOS apps, entitlement `campusmate_plus`; current offering มี `$rc_monthly` และ `$rc_annual` ผูกสินค้าจริง
- App User ID ใช้ Firebase UID; เลือก restore/transfer policy ให้ตรงการผูกสมาชิกกับบัญชีแอปและทดสอบการสลับบัญชี
- ใส่ public SDK keys ใน environment ตาม `.env.example`; server secret `REVENUECAT_SECRET_API_KEY` และ webhook authorization แบบสุ่มยาวอย่างน้อย 24 ตัวอักษรใน Secret Manager
- Webhook endpoint `revenueCatWebhook` ใช้ Authorization ตรงกับ secret; ทดสอบทั้งซื้อ ต่ออายุ ยกเลิก หมดอายุ grace คืนเงิน transfer และ duplicate/out-of-order delivery
- AdMob: สร้าง Android/iOS app + native ad unit; ตั้ง UMP consent message; ใช้ test devices ระหว่าง QA; ใส่ app IDs/unit IDs ตาม `.env.example`
- ยังไม่เปิด `CAMPUSMATE_PLUS_BACKEND_ENABLED`, `CAMPUSMATE_PLUS_ENABLED`, `CAMPUSMATE_NATIVE_ADS_ENABLED` จน migration, rules, products และ lifecycle tests ครบ

แหล่งเอกสาร: [RevenueCat Expo](https://www.revenuecat.com/docs/getting-started/installation/expo), [webhooks](https://www.revenuecat.com/docs/integrations/webhooks), [native ads](https://docs.page/invertase/react-native-google-mobile-ads/ad-formats/native), [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).
