# กู้คืนหน้าโปรไฟล์และการตั้งค่า

อัปเดต: 2 ตุลาคม 2026

## แหล่งอ้างอิง

- หน้าตั้งค่าเดิม: commit `8ba164d`; route หลัก `/me` และ `/profile-settings` redirect ไปหน้านี้
- ส่วนฟอร์มที่หาย: Git blob `b635d1e7408736fdef4bf1e4df3f30da3ad5027c` ขนาด 56,652 bytes
- กู้เฉพาะส่วนที่หายและรักษาการแก้ไขอื่นใน working tree

## ผลการแก้ไข

- คืน state, helper และ JSX ของฟอร์มโปรไฟล์ Android พร้อมแท็บแก้ไข/ตัวอย่าง
- ปรับหน้าตั้งค่าให้แยกหมวด มีคำอธิบาย สถานะการแสดงโปรไฟล์ และการตอบสนองเมื่อกด
- แสดงเมนูเพลงตามสิทธิ์ Spotify ของบัญชี; Android เปิดและเลื่อนไปส่วนเพลง
- แสดงตรายืนยันอีเมลเมื่อ Firebase Auth ยืนยันแล้ว และรักษาชื่อชั้นปีที่เป็นข้อความ
- รองรับรูปหลัก 1 รูปและแกลเลอรีไม่เกิน 5 รูป พร้อมการประมวลผลภาพและสถานะรอ
- อัปโหลดแกลเลอรีผ่าน callable `uploadProfileGalleryImage` โดยใช้ UID จากผู้ที่ล็อกอิน ตรวจภาพบนเซิร์ฟเวอร์ และแยกไฟล์แต่ละรูป
- เพิ่ม gallery ในการเขียน/อ่านโปรไฟล์ public, private, discovery และกฎ Firestore
- อัปเดตสถานะโปรไฟล์และแคชบัญชีหลังบันทึกสำเร็จหรือเข้าคิว offline สำเร็จ; เมื่อถูกปฏิเสธจะรักษาค่าเดิม
- ลบบริเวณ `profile_gallery/<UID>/` เมื่อเรียก `deleteUserData`

## การตรวจสอบ

- Babel production transform ของหน้าจอ Android/iOS, routes, context และ services ผ่าน
- ตรวจชื่อที่อ้างอิงในหน้าจอ/route แล้วไม่มีชื่อที่ยังไม่ได้ประกาศ
- การทดสอบต่อไปนี้ผ่าน 23 กรณี:

```powershell
node --test functions/profileGallery.test.js functions/profileGalleryClient.test.js functions/profileSaveClient.test.js functions/discoveryProfile.test.js
```

- กฎ gallery ผ่าน Firestore emulator 12 assertions: เจ้าของบันทึก/ล้างรูปได้, เกิน 5 รูปหรือชนิดข้อมูลผิดถูกปฏิเสธ, บัญชีอื่นเขียนไม่ได้ และอ่าน private ไม่ได้

```powershell
firebase emulators:exec --only firestore --project demo-campusmate 'node scripts/test-profile-gallery-rules.mjs'
```

- Expo export Android ผ่าน (3,068 modules); ผลลัพธ์ใน `scratch/profile-ui-export`
- ยังตรวจ UI บนอุปกรณ์จริงไม่ได้: AVD ทั้ง `CampusMate_Pixel6_API37` และ `Pixel_10a` อ้างถึง Android system image ที่ไม่มีอยู่

## ก่อนใช้งานแกลเลอรีจริง

ยังไม่ได้ deploy backend ในงานนี้ ต้องนำ `uploadProfileGalleryImage`, `syncPublicProfile`, `syncDiscoveryProfile`, `deleteUserData` และกฎ Firestore ที่รองรับ gallery ขึ้นระบบก่อนใช้งานทางอัปโหลดใหม่

การทดสอบใช้ storage/moderation จำลอง; ยังไม่ได้ยืนยันการอัปโหลดจริง การตรวจภาพจริง หรือการแสดงผลบนอุปกรณ์
