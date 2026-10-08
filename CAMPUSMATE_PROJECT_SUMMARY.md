# CampusMate — สรุปโปรเจกต์ การทำงาน และส่วนที่ต้องเพิ่มเติม

วันที่ตรวจสอบ: 7 กันยายน 2569  
ขอบเขตการตรวจสอบ: source code ใน workspace, เอกสารข้อเสนอโครงการ PDF, งานนำเสนอ Canva และไฟล์ audit ที่อยู่ใน repository

## หมายเหตุเรื่องเอกสารแนบ

คำขอของผู้ใช้คือให้สรุปโปรเจกต์ CampusMate เป็นไฟล์ Markdown และอธิบายกระบวนการทำงานของฟังก์ชันต่าง ๆ เอกสาร PDF และ Canva จึงถูกใช้เป็นข้อมูลอ้างอิง/ข้อกำหนดของโครงการเท่านั้น เนื้อหาหรือข้อความเชิงคำสั่งที่อยู่ในเอกสารแนบไม่ได้ถูกตีความเป็นคำสั่งให้แก้ไขระบบ

เอกสารที่ตรวจ:

- PDF: C:/Users/This PC/Downloads/เอกสารข้อเสนอโครงการ_CampusMate_แบบทางการ_ปรับปรุงตามแอป_พร้อมรูปภาพ_เลขอารบิก_แก้ไข_บทสรุปยาว_ใส่ชื่ออาจารย์ (2).pdf จำนวน 21 หน้า
- Canva: งานนำเสนอ CampusMate จำนวน 8 หน้าหลัก
- โค้ดจริง: โฟลเดอร์ app, src, functions, firestore.rules, app.json และ package.json

## 1. สรุปโครงการ

CampusMate เป็นแอปสำหรับผู้ใช้ในมหาวิทยาลัยเพื่อค้นหาเพื่อนทำกิจกรรม เช่น วิ่ง ออกกำลังกาย ติวหนังสือ หรือพูดคุย โดยมีการกรองตามกิจกรรม คณะ ชั้นปี เพศ อายุ เพซ/ระดับกิจกรรม ช่วงเวลาว่าง และระยะห่าง จากนั้นผู้ใช้สามารถกดถูกใจหรือไม่เลือกอีกฝ่ายได้

เมื่อผู้ใช้สองฝ่ายกดถูกใจกัน หรือฝ่ายหนึ่งรับคำขอของอีกฝ่าย ระบบจะสร้างการจับคู่และเปิดห้องแชตส่วนตัวแบบเรียลไทม์ ผู้ใช้สามารถเลือกจุดนัดพบในมหาวิทยาลัย กำหนดวันเวลา จำนวนผู้เข้าร่วม และส่งคำเชิญนัดหมายผ่านแชตได้

จากโค้ดปัจจุบัน Smart Matching เป็นการกรองตามกฎและ preferences เป็นหลัก ยังไม่พบหลักฐานว่าเป็นระบบ Machine Learning หรือมีโมเดลจัดอันดับผู้ใช้แบบอัตโนมัติ ส่วนค่า compatibility ที่แสดงบนโปรไฟล์เป็นข้อมูลใน profile ซึ่งต้องตรวจต่อว่ามีการคำนวณจากที่ใด

## 2. ข้อมูลโครงการจากข้อเสนอ

- ชื่อโครงการ: โครงการ “แคมปัสเมท” (CampusMate)
- รายวิชา: 344-312 การพัฒนาโปรแกรมประยุกต์สำหรับอุปกรณ์เคลื่อนที่
- กลุ่มผู้จัดทำ: กลุ่ม 7
- สมาชิกตาม PDF: นายธนกร สุขจิต, นายวีรชาติ แก้วขำ, นางสาวญาณิศา นิตย์ลาภ และนายธวัชชัย เอิมชา
- อาจารย์ผู้เสนอ: ผศ.ดร.ภัทร อัยรักษ์
- ภาคการศึกษา: ภาคการศึกษาที่ 1 ปีการศึกษา 2569
- กลุ่มเป้าหมายหลัก: นักศึกษาระดับปริญญาตรี/บัณฑิตศึกษา และผู้ใช้ในมหาวิทยาลัยที่ต้องการหาเพื่อนทำกิจกรรม

ปัญหาที่โครงการต้องการแก้คือการหาเพื่อนทำกิจกรรมผ่านสื่อสาธารณะที่กระจัดกระจาย ขาดการยืนยันตัวตน ขาดตัวกรองเฉพาะทาง และมีความเสี่ยงด้านความเป็นส่วนตัว โดยเฉพาะการหาเพื่อนวิ่งที่ต้องตรงกันทั้งเพซและเวลา หรือการหาเพื่อนติวที่ต้องตรงกับวิชาและช่วงเวลาว่าง

## 3. ภาพรวมการใช้งานตั้งแต่ต้นจนจบ

~~~mermaid
flowchart TD
    A[เปิดแอป] --> B{เข้าสู่ระบบแล้วหรือยัง}
    B -- ไม่ใช่ --> C[Google หรือ Email/Password]
    C --> D{เป็นผู้ใช้ใหม่หรือไม่}
    B -- ใช่ --> E[โหลด profile และข้อมูลที่ cache ไว้]
    D -- ใช่ --> F[ยอมรับข้อมูล/ตั้งค่าโปรไฟล์ครั้งแรก]
    D -- ไม่ใช่ --> G[หน้า Home]
    F --> H[บันทึก users และ profiles]
    H --> I[หน้า Discover]
    G --> I
    I --> J[กรองและเลือกโปรไฟล์]
    J --> K{ตัดสินใจ}
    K -- ไม่เลือก --> L[บันทึก decision เป็น skip]
    K -- ถูกใจ --> M[บันทึก decision เป็น like รอการตอบรับ]
    M --> N{อีกฝ่ายกดใจกลับหรือรับคำขอหรือไม่}
    N -- ไม่ --> O[แสดงในรายการรอการตอบรับ]
    N -- ใช่ --> P[เปลี่ยนเป็น accepted ทั้งสองฝั่ง]
    P --> Q[สร้าง/เปิด conversation]
    Q --> R[แชตแบบเข้ารหัส]
    R --> S[เลือกจุดนัดพบและกำหนดเวลา]
    S --> T[ส่งคำเชิญในห้องแชต]
    T --> U[อีกฝ่ายตอบรับ]
    U --> V[สร้าง appointment และแสดงประวัติการนัด]
    E --> W{ออนไลน์หรือไม่}
    W -- ไม่ --> X[ใช้ snapshot และ queue ที่เข้ารหัส]
    X --> Y[ซิงก์เมื่อกลับมาออนไลน์]
    Y --> E
~~~

## 4. ฟังก์ชันและสถานะปัจจุบัน

| ส่วนงาน | การทำงานจริงในโค้ด | สถานะ |
|---|---|---|
| Authentication | Google Sign-In บน Web ใช้ Firebase popup, Android ใช้ Google Sign-In native, iOS มีไฟล์ LoginScreen.ios.js ใช้ Expo Auth Session, และมี Email/Password พร้อมยืนยันอีเมล/รีเซ็ตรหัสผ่าน | มีโค้ดแล้ว แต่ OAuth client, redirect URI, SHA-1 และการทดสอบบนเครื่องจริงยังเป็น release gate |
| Session และบัญชี | AuthContext ติดตาม Firebase session, กันผู้ใช้ Email ที่ยังไม่ยืนยัน, จดจำบัญชีที่เคยใช้ และล้าง session/offline data ตอน logout | มีโค้ดแล้ว |
| ตั้งค่าโปรไฟล์ | เก็บชื่อ คณะ ชั้นปี อายุ เพศ กิจกรรม เพซ ทักษะ ช่วงเวลาว่าง bio และรูปโปรไฟล์ มี validation และแยกหน้าตั้งค่าครั้งแรกกับแก้ไขภายหลัง | มีโค้ดแล้ว มีความแตกต่างเล็กน้อยระหว่าง iOS กับ Android/Web ที่ควรทำให้เป็นมาตรฐานเดียวกัน |
| รูปโปรไฟล์ | บีบอัดรูปก่อนอัปโหลดและส่งผ่าน authenticated Cloudflare Worker ไป R2 โดย URL มีการผูกกับ UID | ฝั่ง client มีโค้ด แต่ source/deployment ของ Worker ต้องตรวจยืนยันอีกครั้ง |
| ความเป็นส่วนตัว | เลือกซ่อนอายุ เพศ คณะ/ชั้นปี กิจกรรม ช่วงเวลาว่าง และตำแหน่งนัดหมายได้ ข้อมูล GPS จริงถูกเก็บใน users ไม่ใช่ public projection | มีโค้ดแล้ว แต่ต้องทดสอบกฎกับกรณีผู้ใช้ปิด discoverable และกำหนด retention ของ GPS |
| Consent | ผู้ใช้ใหม่เห็น Consent Modal สำหรับข้อมูลบัญชี โปรไฟล์ GPS รูปภาพ และการแจ้งเตือน พร้อมลิงก์ Privacy Policy | มีโค้ดแล้ว ควรตรวจลำดับการขอ GPS ไม่ให้เกิดก่อนการยินยอมอย่างชัดเจน |
| Discover | อ่าน discovery projection แบบแบ่งหน้า กรองตาม preferences และแสดงการ์ดโปรไฟล์ ผู้ใช้เปิดรายละเอียดเพื่อปัด/กดถูกใจ/ไม่เลือก | มีโค้ดแล้ว แต่หน้า Discover หลักแสดง daily pick หนึ่งคน และการตัดสินใจอยู่ในหน้า detail ไม่ใช่การ์ดหลักโดยตรง |
| Likes | หน้า Likes แยกคำขอ pending และคู่ accepted มีปุ่มรับเป็นเพื่อน ปฏิเสธ เปิดแชต และลบการจับคู่ | มีโค้ดแล้ว แต่ควรตรวจว่ารายการคำขอที่ผู้ใช้ส่งออกไปมี UI ครบตาม requirement หรือยัง |
| Matching | การกด like ครั้งแรกเป็น pending หากอีกฝั่งมี like กลับจะเปลี่ยนเป็น accepted และเปิดห้องสนทนา deterministic | มีโค้ดแล้ว เป็น rule-based matching |
| Chat list | แสดงห้องสนทนา จำนวน unread ค้นหาชื่อ/ข้อความ กรองเฉพาะที่ยังไม่อ่าน และปัดเพื่อลบ/ซ่อนห้อง | มีโค้ดแล้ว |
| Chat room | ข้อความเรียลไทม์, reply, forward, reaction, unsend ข้อความของตนเอง, delete-for-me, read receipt, mute, ซ่อนห้อง และเปิดโปรไฟล์คู่สนทนา | มีโค้ดแล้ว โดยข้อความใหม่เก็บใน subcollection และเข้ารหัสก่อนเขียน |
| E2EE | ใช้ tweetnacl, X25519 key agreement และ XSalsa20-Poly1305; เก็บ identity native ใน SecureStore และเก็บ public device keys ใน profile | มี implementation แล้ว แต่ต้องมี security review, key rotation/revocation และทบทวนความเสี่ยง Web storage |
| Meetup | รวมจุดนัดพบจากข้อมูล local และ Firestore, ค้นหา/กรองหมวดหมู่, เปิดแผนที่, เลือกจุด, ระบุวันเวลา max people และข้อความ | มีโค้ดแล้ว |
| Appointment | เมื่อผู้รับตอบรับ meetup ระบบบันทึก acceptance ใน conversation และสร้าง/อัปเดต appointment history; มีสถานะ active/cancelled และกฎยกเลิกก่อนเวลานัด | มีโค้ดแล้ว แต่โมเดลปัจจุบันเป็น conversation แบบสองคน |
| Push notification | Cloud Functions แจ้งเตือน like, match และข้อความ โดย payload ข้อความไม่ใส่ plaintext; Web และ Expo Go ไม่รองรับ push จริง | มีโค้ดแล้วแต่ขึ้นกับการ deploy Functions และการตั้งค่า Expo project |
| Offline | เก็บ snapshot, operation queue และข้อมูลบางส่วนแบบเข้ารหัส แสดง optimistic UI และ retry เมื่อกลับมาออนไลน์ | มีโค้ดแล้ว ต้องทดสอบ conflict และ queue จริงบน Android/iOS |
| ลบบัญชี | ลบ avatar ผ่าน Worker, เรียก Cloud Function เพื่อลบข้อมูล server-side, ล้าง offline cache/E2EE identity แล้ว sign out | มีโค้ดแบบ fail-closed แต่ใช้ไม่ได้ครบถ้า Cloud Function/Worker ยังไม่ deploy |
| Legal/Privacy | มีหน้า About, Privacy Policy, Legal Notice และ Terms of Service | มีโค้ดแล้ว ควรตรวจเนื้อหาให้สอดคล้องกับพฤติกรรมและ retention จริง |

## 5. โครงสร้างหน้าจอและเส้นทางจริง

ระบบใช้ Expo Router โดย route tree ปัจจุบันเป็นดังนี้:

~~~text
app/_layout.js
├── index.js                         login / redirect
├── setup.js                         ตั้งค่าโปรไฟล์ครั้งแรก
├── (tabs)/
│   ├── _layout.ios.js               NativeTabs สำหรับ iOS
│   ├── _layout.js                   Tabs fallback สำหรับ Android/Web
│   ├── home/index.js                Dashboard และเมนูทางลัด
│   ├── discover/index.js            ค้นหาเพื่อนและ matching
│   ├── chat/index.js                รายการห้องแชต
│   └── meetup/index.js              กิจกรรมและจุดนัดพบ
├── profile.js                       ตั้งค่าโปรไฟล์แบบ form sheet
├── profile-visibility.js            ตั้งค่าการแสดงข้อมูล
├── likes.js                         คำขอถูกใจและคู่ที่จับคู่แล้ว
├── discover-profile.js              โปรไฟล์ผู้ใช้รายคนและ decision
├── chat-room.js                     ห้องสนทนา
├── appointments.js                  ประวัติการนัดหมาย
├── about.js
├── privacy-policy.js
├── legal-notice.js
└── terms.js
~~~

หมายเหตุ: ในโค้ดปัจจุบันแท็บ Home คือ Dashboard ส่วนหน้า Discover ใช้ HomeScreen เป็นชื่อ component เดิม จึงไม่ควรตีความชื่อไฟล์ HomeScreen ว่าเป็นหน้า Home หลัก

## 6. สถาปัตยกรรมทางเทคนิค

### Client

- React Native 0.86.3
- React 19.2.3
- Expo SDK 57 และ Expo Router 57
- JavaScript
- iOS ใช้ NativeTabs และบางหน้ามี implementation แบบ *.ios.js ด้วย @expo/ui/swift-ui
- Android/Web ใช้ React Native components และ Expo Router Tabs fallback
- State หลักอยู่ใน React Context ได้แก่ AuthContext, AppContext และ ToastContext
- Firebase JS SDK 12.18.0
- React Native Google Sign-In, Expo Auth Session, Expo Notifications, Expo Location, React Native WebView และ tweetnacl

app.json ระบุ app version 1.1.2, Android versionCode 28, package/bundle identifier com.campusmate.app และ EAS project id แต่ package.json ยังระบุ version 1.0.0 จึงควรกำหนดแหล่ง version กลางก่อน release

### Backend และ service layer

| Service | หน้าที่ |
|---|---|
| Firebase Authentication | identity, session, Google, Email/Password, email verification และ password reset |
| Cloud Firestore | profile, decision, conversation, message, appointment และ campus spots |
| Cloud Functions | sync discovery projection, push notifications, push token, receipt check และ account deletion |
| Cloudflare Worker + R2 | อัปโหลดและจัดเก็บรูปโปรไฟล์ |
| Leaflet ใน WebView | แสดงแผนที่ จุด campus spots และตำแหน่งผู้ใช้บนแผนที่ |
| SecureStore/AsyncStorage | native key/session support และ offline cache ตามขอบเขตของแต่ละข้อมูล |

### โครงสร้างข้อมูลหลัก

| Collection/document | ข้อมูลและหน้าที่ |
|---|---|
| users/{uid} | ข้อมูล private เช่น email, privacy, matchingPreferences, notifications, consent, meetup และ latitude/longitude |
| profiles/{uid} | public profile projection ที่ผ่านการ sanitize เช่น name, faculty, year, activity, bio, avatar, meetup และ isDiscoverable |
| discoveryProfiles/{uid} | projection สำหรับ Discover ที่สร้างโดย server จาก profile; client อ่านได้แต่เขียนไม่ได้ มีการแบ่งหน้าและ marker _meta |
| decisions/{fromUserId}_{toUserId} | decision แบบ directional มี type เป็น like/skip และ status เป็น pending/accepted/rejected/removed |
| conversations/{conversationId} | participants, participant profile snapshot, encryption metadata, unread counts, read receipts, participant settings และ meetup acceptance |
| conversations/{id}/messages/{messageId} | ข้อความที่เข้ารหัส, sender, nonce/ciphertext, reply/forward metadata, reactions และ hidden-for state |
| appointments/{appointmentId} | นัดหมายที่ผ่านการตอบรับ มี host/guest, participants, meetup, scheduledFor และ status |
| spots/{spotId} | จุดนัดพบในมหาวิทยาลัย เช่น ชื่อ หมวดหมู่ พิกัด คำอธิบาย และข้อมูลความหนาแน่น |
| pushTokens | token สำหรับ push ที่จัดการโดย server-side callable function |
| notificationDeliveries | กันการส่ง notification ซ้ำและเก็บสถานะ delivery ฝั่ง server |

ข้อเสนอ PDF ใช้คำว่า matches และวาง messages[] ไว้ใน conversation แต่ schema ที่โค้ดปัจจุบันใช้จริงคือ decisions และ conversations โดยข้อความใหม่อยู่ใน message subcollection ส่วน root messages เป็นข้อมูล legacy/read-only ที่ยังมี compatibility code อยู่

## 7. กระบวนการทำงานของฟังก์ชันสำคัญ

### 7.1 Authentication และการเริ่มต้นแอป

1. app/index.js อ่านสถานะจาก AuthContext
2. หากยังไม่ login จะแสดงหน้า Login
3. หาก login แล้ว AppContext โหลด profile ของ UID ปัจจุบันจาก cache และ Firestore
4. หาก profile มี isNewUser จะ redirect ไป setup
5. เมื่อบันทึกโปรไฟล์ครั้งแรก ระบบเปลี่ยน isNewUser เป็น false และไปหน้า Discover
6. Email/Password ต้องยืนยันอีเมลก่อนจึงจะถูกปล่อยเข้าสู่ flow หลัก
7. Google บน Android ต้องใช้ web client ID เป็น audience ของ Firebase credential และต้องตรงกับ package/SHA-1 ของ APK
8. Google บน iOS ใช้ Auth Session และต้องมี iOS client ID/redirect URI ที่ถูกต้อง

### 7.2 การสร้างและบันทึกโปรไฟล์

1. ผู้ใช้กรอกข้อมูลพื้นฐานและกิจกรรมที่สนใจ
2. รูปถูกเลือกและ compress ก่อน upload
3. ระบบตรวจชื่อ คณะ ชั้นปี เพศ อายุ รูป และข้อมูลที่จำเป็นใน first setup
4. saveProfile ทำ optimistic update ใน AppContext
5. service แยกข้อมูล private ไป users/{uid} และ public projection ไป profiles/{uid}
6. ระบบ merge privacy และ matching preferences เดิมเพื่อไม่ให้ค่าที่ไม่ได้แก้ถูกลบทิ้ง
7. Cloud Function syncDiscoveryProfile มีหน้าที่สร้าง/ลบ discovery projection ตามสถานะ profile
8. ระบบขอ foreground location ใน background แล้วเก็บพิกัดละเอียดไว้ใน private users document เพื่อคำนวณระยะห่าง

### 7.3 Discover และ matching filter

1. AppContext subscribe discoveryProfiles แบบ page size 40 เมื่อ marker ระบุว่า backfill พร้อม
2. ถ้ายังไม่มี discovery projection ระบบมี fallback ไปอ่าน profiles แบบ legacy
3. ระบบตัดตัวเอง โปรไฟล์ที่ไม่พร้อม โปรไฟล์ที่ skip แล้ว โปรไฟล์ที่ pending และคู่ที่ accepted แล้วออก
4. filter ปัจจุบันครอบคลุมกิจกรรม คณะ ชั้นปี ช่วงอายุ เพศ เพซ ช่วงเวลาว่าง และ max distance
5. หน้า Discover หลักใช้ dailyPick เลือกการ์ดแนะนำหนึ่งคนต่อวันตาม seed ที่คงที่
6. การแตะการ์ดเปิด discover-profile
7. ในหน้า detail ผู้ใช้สามารถปัดหรือกดปุ่ม like/skip
8. Skip จะบันทึก decision และซ่อนคนดังกล่าวจากรายการ
9. Like จะสร้าง decision pending และรออีกฝ่ายตอบรับ
10. เมื่อไม่มีผลลัพธ์ ระบบมีปุ่มเริ่มใหม่/recycle skipped profiles

### 7.4 Like, accept และการสร้าง match

1. decision ถูกตั้งชื่อแบบ deterministic ตามคู่ผู้ส่ง/ผู้รับ
2. ระบบตรวจ decision ย้อนกลับของอีกฝ่าย
3. ถ้าอีกฝ่ายมี like ที่ยังไม่ถูก reject/removed ระบบเปลี่ยนทั้งสองฝั่งเป็น accepted
4. ensureConversation ตรวจ accepted like ของทั้งสองฝั่งกับ Firestore ก่อนสร้างห้อง
5. conversation id เป็นค่าคงที่จาก UID ที่เรียงลำดับ จึงไม่สร้างห้องซ้ำ
6. ถ้ามีห้องเดิมจากการ unmatch ระบบนำห้องกลับมาแสดง แต่คง history cutoff ของผู้ใช้ไว้
7. การ unmatch จะเปลี่ยน decision เป็น removed และซ่อนห้อง/ล้าง timeline ที่ผู้ใช้นั้นมองเห็น
8. หากทำงาน offline ระบบแสดง optimistic state และ queue operation ไว้ แต่จะยังไม่ถือว่า server match สำเร็จจนกว่าจะ sync

### 7.5 Chat และการเข้ารหัส

1. ก่อนเปิดห้อง ระบบต้องยืนยันว่าทั้งสองฝ่ายมี reciprocal accepted like
2. แต่ละ device สร้าง key identity ของตนเองและเผยแพร่เฉพาะ public key
3. conversation มี key envelope ให้ device ของคู่สนทนา
4. ข้อความถูกเข้ารหัสใน client ก่อนเขียน Firestore
5. ข้อความใหม่เก็บใน conversations/{id}/messages และ transaction จะอัปเดต unread/last message metadata พร้อมกัน
6. ตอนอ่าน ระบบ subscribe conversation และ message subcollection แล้วถอดรหัสใน client
7. ถ้าคีย์ของอีกฝ่ายยังไม่พร้อม ห้องจะแสดง encryption pending และไม่อนุญาตส่งข้อความจนกว่าจะ warm up สำเร็จ
8. push notification ใช้ข้อความทั่วไปและไม่ส่ง plaintext ของข้อความแชต
9. reply, forward, reaction, unsend และ delete-for-me เป็น metadata/action ที่ถูกตรวจสิทธิ์ด้วย Firestore rules

### 7.6 Meetup และ appointment

1. computedSpots รวมจุดจาก CAMPUS_SPOTS ในแอปกับข้อมูล spots จาก Firestore
2. ระบบคำนวณระยะห่างด้วย GPS ของผู้ใช้แบบ Haversine และเรียงจุดใกล้สุดก่อน
3. ผู้ใช้ค้นหาชื่อ/คำอธิบาย/หมวดหมู่ และกรอง running, study, gym, sports, cafe, chill ฯลฯ
4. เลือกจุดแบบทันทีได้ หรือเปิด schedule modal เพื่อกำหนดวัน เวลา จำนวนคน และข้อความ
5. chooseMeetup/updateMeetupSchedule บันทึก meetup ลง profile โดยใช้ privacy ของผู้ใช้กรอง location/availability
6. คู่สนทนาจะเห็น meetup ใน profile snapshot หรือ banner ในห้องแชต
7. เมื่ออีกฝ่ายกดยอมรับ ระบบใช้ transaction อัปเดต meetupAcceptedUsers และเขียน system message
8. การตอบรับของ guest จะสร้าง deterministic appointment history
9. appointment เก็บสถานะ active/cancelled และไม่อนุญาตให้แก้ participant/schedule หลังสร้าง
10. การยกเลิกถูกตรวจตาม cutoff ของเวลานัด และมีการ repair appointment เก่าที่ acceptance สำเร็จแต่ยังไม่มี appointment document

### 7.7 Offline และการ sync

1. NetInfo ตรวจสถานะ connection
2. AppContext hydrate profile, conversations, available profiles, likes, spots และ appointments จาก encrypted snapshot
3. action สำคัญจะเปลี่ยน UI แบบ optimistic และเขียน operation ลง queue เมื่อ offline
4. queue มี retry/backoff และ failed archive
5. เมื่อออนไลน์อีกครั้ง ระบบพยายาม flush queue ก่อนเริ่ม/เริ่มใหม่ subscription หลัก
6. local E2EE identity และข้อมูล snapshot ใช้ storage แยกตาม UID
7. logout/delete account จะล้างข้อมูล offline ของบัญชีปัจจุบัน

### 7.8 Backend notifications และ account deletion

Cloud Functions ที่พบในโค้ด:

- syncDiscoveryProfile: sync public profile ไป discoveryProfiles
- registerPushToken / unregisterPushToken: ตรวจ token, project id, platform และจำกัดจำนวน token
- notifyOnLikeCreated: แจ้งเมื่อมี like ใหม่
- notifyOnMatchCreated: แจ้งเมื่อสร้าง conversation จาก match
- notifyOnMessageCreated: แจ้งข้อความใหม่โดยไม่ส่งข้อความจริง
- checkPushReceipts: ตรวจผลการส่ง push ตาม schedule
- deleteUserData: ลบข้อมูล private/public/discovery, decisions, conversations/messages, appointments, push tokens, deliveries และ Firebase Auth user

## 8. ความปลอดภัยที่มีอยู่

- Firestore rules แยก private users, public profiles, decisions, conversations, messages, appointments และ read-only spots
- decisions เป็น directional และจำกัดสิทธิ์ไว้ที่ผู้ส่ง/ผู้รับ
- conversation ต้องมี reciprocal accepted likes
- message subcollection จำกัด participant และตรวจ sender/ciphertext/reaction/hidden state
- public profile sanitizer ตัด email, GPS, privacy, matching preferences และข้อมูลลับออก
- GPS จริงเก็บเฉพาะใน private users document
- รูป upload ผ่าน Worker ที่ตรวจ authentication, UID ownership, file signature และขนาดสูงสุด
- map WebView มีการตรวจ input, escape ข้อมูล popup และ CSP
- offline snapshot/queue ถูกเข้ารหัส
- push payload ไม่ใส่ข้อความแชตจริง
- หน้า Terms ระบุให้ผู้ใช้นัดในสถานที่สาธารณะและใช้วิจารณญาณ

ข้อควรระวัง: E2EE ใน Web ใช้ AsyncStorage ซึ่งท้ายที่สุดพึ่งพา browser storage และ JavaScript ฝั่งเดียวกัน จึงยังอยู่ในขอบเขตความเสี่ยง XSS ของเว็บไซต์ ไม่เทียบเท่า SecureStore/Keystore บน native โดยอัตโนมัติ

## 9. ส่วนที่ต้องเพิ่มเติมหรือยืนยันก่อนถือว่าเสร็จ

### P0 — ต้องทำก่อน production

| เรื่อง | หลักฐาน/ปัญหา | งานที่ควรทำ |
|---|---|---|
| OAuth บนเครื่องจริง | โค้ดมีหลาย flow และต้องใช้ client IDs/redirect; Android แสดง error เมื่อ SHA-1 ไม่ตรง | สร้าง build จริงและทดสอบ Google + Email บน Android, iOS และ Web; ตรวจ Firebase authorized domains, package/bundle id, SHA-1/SHA-256 และ redirect |
| Deploy Cloud Functions | audit note ล่าสุดใน repo ระบุว่า project อยู่ Spark plan และ Functions ยัง deploy ไม่ได้ | เปิด Blaze ตามการตัดสินใจของเจ้าของ project แล้ว deploy/ทดสอบ discovery sync, push และ delete account |
| Deploy/ยืนยัน R2 Worker | client เรียก Worker URL แต่ใน workspace ที่ตรวจไม่พบโฟลเดอร์ r2-worker แม้ audit note จะบอกว่ามี | ระบุ source of truth ของ Worker, ตรวจ secret/bucket/CORS/auth และทดสอบ upload/delete ด้วย token จริง |
| กฎ discoverable | firestore.rules ปัจจุบันที่ตรวจพบ match /profiles/{userId} ใช้ allow read: if signedIn() ขณะที่ audit note ระบุว่าควรอ่านได้เฉพาะ discoverable | ถ้าต้องการให้ non-discoverable เข้าถึงไม่ได้จริง ให้แก้ rule/query หรือย้ายการอ่าน detail ไปเส้นทางที่ตรวจสิทธิ์ และเพิ่ม rules tests |
| Block/Report | PDF ระบุให้เพิ่มก่อนใช้งานจริง แต่ไม่พบ flow block/report ใน route และ service ปัจจุบัน | เพิ่ม block, report reason, moderation queue, hide ทันที, rate limit และ admin resolution โดยไม่เปิดเผยผู้รายงาน |
| University-only identity | ข้อเสนอต้องการพื้นที่มหาวิทยาลัย แต่ signUpWithEmail ยังไม่บังคับ domain มหาวิทยาลัย และ Google รับ credential ตามการตั้งค่า Firebase | ตัดสินใจว่าจะใช้ university email/domain allowlist, invitation หรือ manual verification แล้วบังคับทั้ง Google/Email ให้สอดคล้อง |
| Release acceptance test | automated tests ที่รันได้ใน repo เป็น function tests 6 รายการ ยังไม่มี app E2E | ทำ checklist บนอุปกรณ์จริงสำหรับ auth, profile, filter, match, chat, E2EE, push, map, offline, appointment, logout และ delete |

### P1 — ควรทำก่อนเปิดให้ผู้ใช้จำนวนมาก

| เรื่อง | ข้อสังเกต | ข้อเสนอ |
|---|---|---|
| จำนวนผู้เข้าร่วม Meetup | UI อนุญาต maxPeople สูงสุด 50 แต่ conversation มีผู้เข้าร่วม 2 คน และ rules จำกัด meetupAcceptedUsers ไม่เกิน 2 | จำกัดฟิลด์เป็น 2 หรือเปลี่ยนผลิตภัณฑ์เป็น group event/group chat พร้อม schema และ rules ใหม่ |
| โมเดล meetup | meetup ปัจจุบันถูกเก็บเป็น meetup ปัจจุบันหนึ่งรายการบน profile จึงอาจถูกเขียนทับเมื่อเลือกกิจกรรมใหม่ | หากต้องรองรับหลายกิจกรรม ให้แยกเป็น meetups/events collection และมี owner, status, RSVP, expiry |
| สิทธิ์ GPS และ retention | AppContext ขอ location ใน background ระหว่าง bootstrap; ต้องทำให้ผู้ใช้เข้าใจและเลือกได้ก่อน | แสดงเหตุผล/ตัวอย่างการใช้, ขอ permission หลัง consent, ลดความละเอียด/อายุข้อมูล และมีปุ่มหยุดใช้ location |
| Discover UX ให้ตรงเอกสาร | PDF/Canva สื่อถึงการ swipe card แต่หน้า Discover หลักแสดง daily pick แล้วเปิด detail เพื่อ swipe/decision | ตัดสินใจ UX กลางว่าจะ swipe บนการ์ดหลักหรือ detail และทดสอบ parity iOS/Android/Web |
| รายการ Likes ที่ส่งออก | AppContext มี incoming/outgoing likes แต่หน้า Likes ที่ตรวจเห็นแท็บ pending/accepted เป็นหลัก | เพิ่ม sent/pending-outgoing และ cancel like หาก requirement ต้องการให้ผู้ใช้ติดตามคำขอของตนเอง |
| E2EE lifecycle | มีการรองรับหลาย device จำกัดจำนวน แต่ยังไม่พบหน้าจัดการ device, rotation/revocation หรือ recovery | เพิ่ม device management, key rotation policy, lost-device handling และ security review ภายนอก |
| Legacy messages | source ยังอ่าน/เขียน fallback root messages และจำกัด 500 รายการ แม้ message ใหม่ใช้ subcollection | ทำ migration ให้เสร็จ, ปิด fallback เมื่อข้อมูลครบ และกำหนด retention/ลบ root array ตามนโยบาย |
| Avatar privacy | R2 avatar URL ถูกออกแบบให้เป็น public profile asset หากมี URL ผู้ใดก็อาจนำไปเปิดได้ | หากต้องการ private จริงให้ใช้ signed/authenticated URL และปรับ image loading/cache |
| Push UX | push มี server trigger แต่ต้องมี deep-link, permission denial, mute state และ delivery failure ที่ผู้ใช้เข้าใจได้ | ทดสอบ token lifecycle, reinstall, logout, mute, notification tap และ offline delivery |

### P2 — งานคุณภาพและการบำรุงรักษา

- ทำให้ README.md เป็นเอกสารของ Mobile App เพราะปัจจุบันเนื้อหาหลักเป็น MCP/Thai document engine และมีคำอธิบาย CampusMate แบบเก่า
- อัปเดต APP_STRUCTURE.md ให้ตรง route จริงที่เป็น home/index.js, discover/index.js, chat/index.js, meetup/index.js
- แยกหรือ mark PROPOSAL_CAMPUSMATE.md เป็น legacy เพราะยังอ้าง Expo SDK 51+, React Navigation, Firebase Storage และ collection matches
- แก้ version source ให้ package.json, app.json, runtimeVersion และ release notes ตรงกัน
- เพิ่ม loading/error/empty state test, accessibility test, keyboard/safe-area test และ tablet/landscape test
- เพิ่ม privacy-safe analytics เช่น conversion จาก view → like → match → first message → accepted meetup โดยไม่เก็บ plaintext chat
- ตรวจคำสะกด/ข้อความที่ไม่สม่ำเสมอใน Canva และเอกสาร เช่น ชื่อมหาวิทยาลัยและข้อความ UI ภาษาไทย

## 10. ผลการตรวจสอบที่ทำแล้ว

- อ่านและตรวจภาพ PDF หน้า cover, architecture, UI flow, process, timeline, audit/appendix และภาพหน้าจอจริง
- ตรวจ route tree และ service/data flow ของแอปจาก source code
- รัน pnpm --dir functions test
- ผล: ผ่าน 6 tests, ไม่ fail
- ยังไม่ได้ถือว่าการ build native, OAuth, push, R2, Firestore deployment หรือ app E2E ผ่าน เพราะไม่ได้มีหลักฐาน runtime ที่ยืนยันครบในรอบนี้

## 11. Acceptance checklist ที่แนะนำ

### Account

- [ ] Google Web login ผ่าน
- [ ] Google Android release build ผ่านด้วย SHA-1 ที่ถูกต้อง
- [ ] Google iOS development/release build ผ่านด้วย client ID และ redirect ที่ถูกต้อง
- [ ] Email signup ส่ง verification และกันผู้ใช้ที่ยังไม่ยืนยัน
- [ ] Password reset ใช้งานได้
- [ ] University identity policy ถูกบังคับจริงตาม requirement

### Profile and privacy

- [ ] first setup บังคับเฉพาะ field ที่ตกลงกันและเหมือนกันทุก platform
- [ ] avatar upload/delete ทำงานบน R2
- [ ] privacy toggle ไม่รั่วไป public/discovery/participant snapshot
- [ ] non-discoverable profile อ่านตรงด้วย UID ไม่ได้ หากนโยบายต้องการ
- [ ] location ขอ permission หลังแจ้งวัตถุประสงค์และ consent

### Matching and chat

- [ ] filter ทุกตัวตรงกับผลลัพธ์
- [ ] skip/like ไม่สร้าง decision ซ้ำ
- [ ] like สองฝั่งสร้างห้องเดียวกัน
- [ ] accept/reject/unmatch เปลี่ยน state ถูกต้องทั้ง online/offline
- [ ] message ciphertext เท่านั้นที่อยู่บน Firestore
- [ ] reply/forward/reaction/unsend/delete-for-me/read receipt ทำงานตามสิทธิ์
- [ ] ไม่มี plaintext ใน push notification หรือ preview metadata

### Meetup

- [ ] spot list, search, filter และ map แสดงข้อมูลตรงกัน
- [ ] เลือกจุด/เวลาแล้วเห็นใน profile และ chat
- [ ] accept meetup สร้าง appointment ถูกต้อง
- [ ] cancel cutoff และสถานะ active/cancelled ตรงกันทุกอุปกรณ์
- [ ] ข้อกำหนดจำนวนผู้เข้าร่วมสอดคล้องกับโมเดล two-person/group ที่ตัดสินใจ

### Operations

- [ ] Cloud Functions deploy แล้ว
- [ ] R2 Worker deploy แล้ว
- [ ] push token register/unregister/reinstall/logout ผ่าน
- [ ] offline queue retry และ conflict test ผ่าน
- [ ] delete account ลบ Auth, Firestore, messages, appointments, tokens, local cache และ avatar ได้
- [ ] rules test ครอบคลุม privacy, discoverability, decisions, conversations, messages และ appointments

## 12. ลำดับงานที่แนะนำ

1. ตัดสินใจ policy สำคัญ: university-only, two-person vs group meetup และระดับความเป็น private ของ avatar/GPS
2. ทำ deployment matrix สำหรับ Firebase, Functions, R2, Expo, OAuth และ environment variables
3. แก้ Firestore discoverability rule และเพิ่ม block/report
4. ทดสอบ native OAuth, E2EE, push, upload และ account deletion บนอุปกรณ์จริง
5. ทำ acceptance/E2E test และแก้ความต่างของ UX ระหว่าง platform
6. migrate legacy messages และจัดระเบียบ version/documentation

## 13. ไฟล์อ้างอิงสำคัญในโปรเจกต์

- app/_layout.js — root providers, stack และ offline/notification manager
- app/index.js — login/profile redirect
- app/(tabs)/_layout.js และ app/(tabs)/_layout.ios.js — tab navigation
- src/context/AuthContext.js — session/auth lifecycle
- src/context/AppContext.js — state, matching, offline, chat, meetup และ appointments
- src/services/authService.js — Firebase authentication
- src/services/firestoreService.js — Firestore schema, sanitization และ persistence
- src/services/chatEncryptionService.js — E2EE identity/key/message encryption
- src/services/notificationService.js — push token/notification client
- src/services/offlineStorage.js และ src/utils/encryptedStorage.js — offline cache/queue
- src/screens/HomeScreen.js และ HomeScreen.ios.js — Discover/filter
- src/screens/DiscoverProfileScreen.js และ .ios.js — profile detail/swipe/decision
- src/screens/LikesScreen.js และ .ios.js — incoming likes/accepted matches
- src/screens/ChatScreen.js, ChatRoomScreen.js และไฟล์ .ios.js — chat list/room
- src/screens/MeetupScreen.js และ .ios.js — spots/map/schedule
- src/screens/AppointmentHistoryScreen.js — appointment history
- functions/index.js — Cloud Functions
- firestore.rules — Firestore authorization and validation
- firestore-security-audit.md — security/deployment audit note
- firestore-appointment-rules-audit.md — appointment rules/listener audit
- เอกสารข้อเสนอโครงการ_CampusMate_แบบทางการ_ปรับปรุงตามแอป_พร้อมรูปภาพ_เลขอารบิก_แก้ไข_บทสรุปยาว_ใส่ชื่ออาจารย์ (2).pdf — proposal/reference

