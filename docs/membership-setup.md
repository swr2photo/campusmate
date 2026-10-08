# ตั้งค่า CampusMate Plus

หน้าในภาพยังไม่มีแพ็กเกจ เพราะ client/backend ยังปิดและสินค้าจริงยังไม่ได้เชื่อมครบ การเปิด flag อย่างเดียวไม่ได้สร้างสินค้า ราคา หรือสิทธิ์สมาชิก

## สถานะที่ตรวจจาก Dashboard วันที่ 6 ตุลาคม 2026

- สร้าง RevenueCat project `CampusMate` (`66fb23d5`) แล้ว
- สร้าง Android configuration `CampusMate (Play Store)` (`app0b008ae693`) สำหรับ `com.campusmate.app` แล้ว
- บันทึก public Android SDK key ลง `.env` แล้ว ตรวจด้วย readiness script ได้ `androidSdkKeyPresent: true` โดยไม่แสดงค่า key
- Entitlement identifier `campusmate_plus` และ current offering `default` ผูกแพ็กเกจสินค้าจริงของ Google Play Store สำเร็จแล้ว (ตรวจผ่าน API สด):
  - `$rc_monthly` 👉 `campusmate_plus` (base plan: `monthly`)
  - `$rc_annual` 👉 `campusmate_plus` (base plan: `annual`)
- สร้าง Service Account `revenuecat-service-account@campusmate-7f1ab.iam.gserviceaccount.com` แล้ว (unique ID `111511555518496599042`) และบันทึก Pub/Sub Editor / Monitoring Viewer แล้ว
- สร้าง JSON และ Google Cloud ยืนยันว่าดาวน์โหลดเป็น `C:\Users\This PC\Downloads\campusmate-7f1ab-5a54a4f99711.json` แล้ว ตรวจไฟล์อยู่จริง 2394 bytes โดยไม่แสดงเนื้อหาและไม่เก็บใน Git
- ผู้ใช้อัปโหลด JSON ใน RevenueCat แล้ว และบันทึกการตั้งค่าเรียบร้อย โหลดหน้าใหม่ยืนยันช่อง JSON แสดง `File saved` / ปุ่ม Save changes disabled
- ตรวจสิทธิ์ที่บันทึกจริงใน Play Console แล้ว: สิทธิ์อ่านข้อมูลแอป/การเงิน จัดการคำสั่งซื้อและสมาชิก และจัดการ Store ถูกเลือกครบเฉพาะ CampusMate
- ผลการตรวจสอบ Credentials ใน RevenueCat Dashboard:
  - `[✓]` Can read the Google Play in-app product catalog: ผ่าน
  - `[✓]` Can read the Google Play subscription catalog and base plans: ผ่าน
  - `[✓]` Can validate Google Play subscription purchases: ผ่านครบทั้ง 3 ข้อสมบูรณ์ 100%
- การเชื่อมต่อระหว่าง Google Cloud Service Account, Google Play Console และ RevenueCat พร้อมใช้งานแล้ว
- Google Play Android Developer API และ Cloud Pub/Sub API เปิดอยู่แล้ว; เปิด Reporting API ตามคำยืนยันของผู้ใช้สำเร็จ หน้า API/Service Details แสดง Status Enabled
- Play Console บัญชี `8248658073474241664` มีแอป CampusMate `com.campusmate.app` จริง มีโปรไฟล์การชำระเงินที่ใช้งานอยู่ และบัญชีบริการ `revenuecat-service-account` ได้รับสิทธิ์ครบถ้วน
- สร้าง Cloud Pub/Sub Topic `projects/campusmate-7f1ab/topics/revenuecat-rtdn` สำเร็จแล้ว พร้อมให้สิทธิ์ Publisher แก่ `google-play-developer-notifications@system.gserviceaccount.com` เรียบร้อยสำหรับ RTDN
- บิลด์ไฟล์ Release AAB สำหรับ Internal Testing สำเร็จแล้ว: `android/app/build/outputs/bundle/release/app-release.aab` (ขนาด 133.47 MB, version `2.1.8`, `versionCode: 78`) พร้อมสิทธิ์ `com.android.vending.BILLING` เพื่อปลดล็อกหน้า Subscriptions บน Play Console
- iOS configuration ยังไม่ได้สร้าง เพราะฟอร์มต้องใช้ In-App Purchase Key `.p8`, Key ID และ Issuer ID
- Deploy Cloud Functions สมาชิกและ Webhook สำเร็จแล้ว:
  - `getMembershipState` (asia-southeast1)
  - `syncMembership` (asia-southeast1, ผูก Secret `REVENUECAT_SECRET_API_KEY`)
  - `revenueCatWebhook` (asia-southeast1, ผูก Secret `REVENUECAT_SECRET_API_KEY` และ `REVENUECAT_WEBHOOK_AUTHORIZATION`)
  - Webhook URL: `https://asia-southeast1-campusmate-7f1ab.cloudfunctions.net/revenueCatWebhook`


## ขั้นตอนเตรียม Service Account JSON สำหรับ Android

1. ยืนยันอีเมล RevenueCat ผ่านอีเมลที่ได้รับ
2. ใน Google Cloud เลือก project `campusmate-7f1ab`; เปิด Google Play Android Developer API, Google Play Developer Reporting API และ Cloud Pub/Sub API
3. ไป IAM & Admin → Service Accounts → Create service account ใช้ ID `revenuecat-service-account` ที่เตรียมไว้
4. ให้ roles `Pub/Sub Editor` และ `Monitoring Viewer` สำหรับ developer notifications ตามคู่มือ RevenueCat แล้วกด Done
5. เปิดบัญชีบริการ → Keys → Add key → Create new key → JSON เก็บไฟล์ที่ดาวน์โหลดไว้นอก Git และไม่ส่งเนื้อหาในแชต
6. ไป Play Console → Users and permissions เพิ่มอีเมล `revenuecat-service-account@campusmate-7f1ab.iam.gserviceaccount.com` และเลือกแอป CampusMate ตรวจสิทธิ์ที่คู่มือระบุ: View app information and download bulk reports, View financial data/orders/cancellation responses, Manage orders and subscriptions และ Manage store presence ขั้นนี้เป็นการให้สิทธิ์อ่านข้อมูลซื้อ/จัดการสมาชิกและสินค้า ต้องตรวจขอบเขตในหน้าจอก่อนบันทึก
7. อัปโหลด JSON ที่ [CampusMate Play Store configuration](https://app.revenuecat.com/projects/66fb23d5/apps/app0b008ae693) → Service Account Credentials JSON → Save changes
8. ตรวจสถานะ credentials และตั้ง Google developer notifications; credentials ใหม่อาจใช้เวลาถึง 36 ชั่วโมง
9. นำเข้าสินค้า Play ที่มีอยู่จริง ผูกกับ `campusmate_plus` และแพ็กเกจรายเดือน/รายปีใน offering `default` แล้วทดสอบผ่าน Play testing track

การสร้าง key/ให้สิทธิ์และส่ง JSON ให้ RevenueCat ต้องยืนยันการเข้าถึงก่อนทำผ่านเบราว์เซอร์ ห้ามใช้ Firebase Admin หรือบัญชี push notifications ที่มีอยู่แทนบัญชีบริการเฉพาะนี้

อ้างอิงขั้นตอนและสิทธิ์: [RevenueCat Google Play Service Credentials](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials)

## 1. สร้างสินค้าในสโตร์

ใช้ package/bundle ID `com.campusmate.app` ที่มีอยู่ในโปรเจกต์

- Android: ใน Play Console สร้าง subscription สำหรับ Plus พร้อม base plans รายเดือนและรายปี แบบต่ออายุอัตโนมัติ ไม่มี trial; ตั้งราคาและ license testers
- iOS: ใน App Store Connect สร้าง subscription group เดียว มีสินค้ารายเดือน/รายปี ไม่มี trial; ตั้งราคาและ sandbox testers
- ชื่อ ID เสนอสำหรับสินค้าใหม่: Android subscription `campusmate_plus` และ base plans `monthly`/`annual`; iOS `campusmate_plus_monthly`/`campusmate_plus_annual` หากมีสินค้าอยู่แล้วให้ใช้ ID เดิม ไม่สร้างซ้ำ
- ราคายังไม่ได้กำหนด แอปจะแสดง `priceString` ที่ได้จากสโตร์ ไม่ใส่ราคาทดลองแทนราคาจริง

## 2. เชื่อม RevenueCat

สร้างโปรเจกต์ CampusMate แล้วเชื่อม Google Play/Apple ตามแพลตฟอร์มที่ต้องการเปิดก่อน นำ credentials ของสโตร์ใส่เฉพาะใน RevenueCat dashboard

1. Product catalog → Entitlements → สร้าง `campusmate_plus`
2. นำเข้าสินค้าจริง และ attach รายเดือน/รายปีเข้ากับ entitlement นี้
3. สร้าง offering เช่น `default` แล้วตั้งเป็น Current
4. ใส่ packages `$rc_monthly` / `$rc_annual` ให้แต่ละแพลตฟอร์มผูกกับสินค้าหรือ base plan ที่ถูกต้อง
5. เลือก restore/transfer policy ให้สมาชิกผูกกับ Firebase UID และทดสอบบัญชีเดิม/ใหม่

อ้างอิง: [RevenueCat Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements), [การเชื่อม Expo และการสร้าง offering](https://www.revenuecat.com/docs/getting-started/installation/expo)

## 3. ใส่ค่าลงโปรเจกต์

Public SDK keys ใส่ใน `.env` ซึ่งไม่ต้องส่งในแชต:

```dotenv
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=
CAMPUSMATE_PLUS_BACKEND_ENABLED=false
CAMPUSMATE_SECURE_DISCOVERY_ENABLED=false
```

Server keys ใส่ Secret Manager ผ่านคำสั่งแบบ interactive ไม่ใส่ใน client `.env`:

```powershell
firebase functions:secrets:set REVENUECAT_SECRET_API_KEY --project campusmate-7f1ab
firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTHORIZATION --project campusmate-7f1ab
```

Authorization ของ webhook ต้องสุ่มยาวอย่างน้อย 24 ตัวอักษรและตรงกับค่าที่ตั้งใน RevenueCat ตั้ง webhook หลัง deploy endpoint `revenueCatWebhook`; ใช้ URL จริงจากผล deploy ไม่เดา URL

ตรวจสถานะ local โดยไม่พิมพ์ key:

```powershell
node scripts/check-membership-config.mjs
```

ตรวจสิทธิ์ Google Play Developer API สดกับ Service Account:

```powershell
node scripts/verify-play-api-permissions.mjs
```


## 4. สถานะการติดตั้งและการทดสอบ (Completed & Verified)

- [x] **Google Play Developer API & Service Account**: สิทธิ์ Financial Data และ Billing API ตรวจสอบผ่าน (HTTP 200)
- [x] **Release AAB v2.1.8 (code 78)**: บิลด์สำเร็จพร้อม `BILLING` permission และอัปโหลดขึ้น Play Console Track Beta สำเร็จ
- [x] **Google Play Subscriptions**: Subscription ID `campusmate_plus` พร้อม Base Plan `monthly` (฿99.00) และ `annual` (฿799.00) สถานะ Active
- [x] **RevenueCat Catalog & Offerings**: Entitlement `campusmate_plus` ผูกสินค้าเรียบร้อย, Offering `default` เชื่อมโยงแพ็กเกจ `$rc_monthly` และ `$rc_annual` (SDK Offerings API ตอบ HTTP 200)
- [x] **Google Cloud Pub/Sub & RTDN**: Topic `projects/campusmate-7f1ab/topics/revenuecat-rtdn` ตั้งค่าและเชื่อมต่อกับ Google Play Console เรียบร้อย
- [x] **Google Secret Manager**: จัดเก็บ `REVENUECAT_SECRET_API_KEY` (v1) และ `REVENUECAT_WEBHOOK_AUTHORIZATION` (v1) ปลอดภัยตามหลัก Zero Trust
- [x] **Cloud Functions (asia-southeast1)**: Deploy สำเร็จ 3 ฟังก์ชัน:
  - `getMembershipState` (Callable)
  - `syncMembership` (Callable - ผูก Secret API Key)
  - `revenueCatWebhook` (HTTPS Webhook - ผูก Secret API Key + Webhook Authorization Header)
- [x] **RevenueCat Webhook Integration**: ตั้งค่า URL ปลายทางและ Authorization Header ใน RevenueCat Dashboard เรียบร้อย
- [x] **Feature Flags**: เปิดใช้งาน `CAMPUSMATE_PLUS_BACKEND_ENABLED=true`, `CAMPUSMATE_SECURE_DISCOVERY_ENABLED=true` ใน `.env` และ `CAMPUSMATE_PLUS_ENABLED=true`, `CAMPUSMATE_PLUS_ALLOW_SANDBOX=true` ใน `functions/.env`

---

## 5. ขั้นตอนทดสอบการซื้อจริง (End-to-End License Testing)

1. **Google Play License Testing**:
   - เพิ่มบัญชี Google ของผู้ทดสอบใน Play Console > Settings > License testing และตั้งค่าการตอบรับเป็น `RESPOND_NORMALLY`
   - ผู้ทดสอบตอบรับคำเชิญเข้าร่วม Track Beta ผ่าน Opt-in URL
2. **ทดสอบ Webhook จาก Dashboard (ทางเลือก)**:
   - ใน RevenueCat Dashboard > Integrations > Webhook กดปุ่ม **"Send test event"** เพื่อตรวจสอบการตอบรับ HTTP 200 จาก `revenueCatWebhook`
3. **ทดสอบซื้อในแอป**:
   - เปิดแอป CampusMate (Build 78 หรือรันสภาพแวดล้อมที่เชื่อมต่อกับ Play Billing)
   - เข้าหน้า **CampusMate Plus (MembershipScreen)** ตรวจสอบราคาแพ็กเกจแสดงถูกต้อง
   - กดปุ่มสมัครสมาชิก จะมี Google Play Bottom Sheet ขึ้นแสดงว่า *"Test card, always approves"* (ไม่เสียเงินจริง)
   - ดำเนินการชำระเงินจนสำเร็จ:
     - แอปจะเรียก `syncMembership` เพื่อซิงค์สิทธิ์ลง Firestore `entitlements/{uid}`
     - RevenueCat Webhook จะส่งอีเวนต์มายืนยันและบันทึกลง `revenueCatEvents/{eventId}`
     - หน้าจอแอปจะอัปเดตสถานะเป็นสมาชิก CampusMate Plus ปลดล็อกสิทธิ์ทันที
4. **ก่อนขึ้น Production จริง**:
   - ปิด `CAMPUSMATE_PLUS_ALLOW_SANDBOX=false` ใน `functions/.env` เพื่อป้องกันการเปิดสิทธิ์จาก Sandbox ในสภาพแวดล้อมจริง

สถานะและหลักฐานส่วนอื่นอยู่ใน [plus-map-rollout.md](./plus-map-rollout.md)

