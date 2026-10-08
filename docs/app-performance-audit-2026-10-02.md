# ตรวจประสิทธิภาพและบัค CampusMate — 2026-10-02

## ขอบเขตและหลักฐาน

ตรวจโค้ดและจำลองส่วนทำงานจริงบน Node ด้วย boundary mocks รายการเดิมด้านล่างเป็นหลักฐานก่อนแก้ไข รอบแก้ไข 2026-10-02 แก้ครบทั้ง 9 จุดตามตารางนี้ ยังไม่ได้วัด cold-start, FPS หรือ memory บนอุปกรณ์ จึงไม่อ้างตัวเลขความเร็วทั้งแอป

## ผลการแก้ไข 2026-10-02

| จุด | สิ่งที่แก้ | หลักฐาน |
| --- | --- | --- |
| 1 แคชข้อความ | ตรวจ Uint8Array 32 bytes ก่อนเปิด cache; cache ผูกกับ key/nonce/ciphertext และล้างเมื่อเปลี่ยนบัญชี | Wrong/missing/malformed key และ nonce ที่เปลี่ยนต้องถอดรหัสไม่ผ่านแม้ warm cache |
| 2 Fast boot/Auth | Live Auth มี revision guard; storage writes เรียงลำดับ; late reads ถูก invalidate; ไม่คง profile/feed ข้ามบัญชี | Live Auth null/new user ไม่ถูก cache เก่าทับ; save ตามด้วย clear เหลือข้อมูลว่าง |
| 3 ออฟไลน์ | คง queued/pending จน queue flush รับ acknowledgement; failed มีปุ่มลองส่งใหม่ | ส่งออฟไลน์ยัง pending; acknowledgement จึงเป็น sent; retry ใช้ ID เดิม |
| 4 ประวัติกลุ่ม | Merge ตาม ID และ timestamp, เก็บข้อความที่หลุด live window, รักษา cursor ของประวัติ | ข้อความ 1–250 หลัง live window ขยับ 50 ครั้งยังครบ ไม่มีซ้ำ |
| 5 Subscription | อ่านแชต/นัดหมาย/โปรไฟล์ได้ระหว่างมีคิว; merge เฉพาะ profile edits ที่ยังรอ sync | ยกเลิก pending-count guard ของ read subscriptions; pending messages merge ตาม ID |
| 6 สถานะกลุ่ม | Loading/empty/error/retry, encrypted outbox ถาวร, sent/failed/read receipts และ unread filter; รีเซ็ตรูปเมื่อกุญแจพร้อม | Queue/archive/retry tests และ rules tests สำหรับ receipts; former member ไม่มีสิทธิ์เขียน/อ่านใหม่ |
| 7 ปริมาณโหลด | ตี้/คำขอเริ่ม 30, ห้องกลุ่ม 20; โหลดเพิ่มตามคำสั่ง; รายการกลุ่มอยู่ใน FlatList; อ่าน receipt เฉพาะห้องที่โหลด | Query-bound tests; index readiness probes โดยไม่เขียน production |
| 8 กุญแจกลุ่ม | ใช้ epochs ที่ listener โหลดแล้ว; reuse key เมื่อ envelope/device ไม่เปลี่ยน; ล้าง cache เมื่อออกจากบัญชี | Hydrate ซ้ำไม่มี getDocs เพิ่ม และ unwrap เพียงครั้งเดียว |
| 9 เวลา | คำนวณใหม่ตรงเวลาเริ่มนัดและเมื่อกลับเข้า foreground | Deadline boundary และ foreground tests |

แก้ test harness การเรียงแชตให้ตรงกับ metadata subscription ปัจจุบันด้วย Inbox ใช้ one-shot preview reads และมี listener เพียงตัวเดียวในกรณีทดสอบ นอกจากนี้ trigger ของข้อความกลุ่มอัปเดต sender/message ID แบบ transaction เพื่อไม่ให้ event เก่าทับข้อความล่าสุด

### การตรวจยืนยัน

- `node --test scripts/test-app-bug-regressions.mjs scripts/test-image-cache.mjs`: 20/20 ผ่าน
- `node scripts/test-conversation-order.mjs`: ผ่าน
- `node --test functions/*.test.js`: 127/127 ผ่าน
- Firestore emulator: `scripts/test-party-rules.mjs` และ `scripts/test-party-functions.mjs` ผ่าน รวมกรณีปลอม receipt, เปลี่ยน receipt ของคนอื่น, future timestamp และสมาชิกที่ออก
- Expo Android/iOS export ผ่าน; Android native config ผ่าน 12 fields/10 permissions
- Deploy rules, indexes และ `notifyOnGroupMessageCreated` ไป `campusmate-7f1ab` สำเร็จ โดยใช้ density `SPARSE_ALL` ให้ตรงกับดัชนีเดิม
- ดัชนี composite ทั้ง 7 ตัวเป็น `READY`; `scripts/check-party-readiness.mjs` ตรวจ query จริงทั้ง 5 แบบผ่าน (ผล 0 documents; read-only Admin ADC probe ใช้ยืนยัน indexes ไม่ใช่ยืนยันสิทธิ์ของผู้ใช้จริง)
- Android build เดิม `956e162b-375e-46f2-8636-b9fe3799b1ce` ล้มเพราะ patch ปิด Kotlin compiler ทั้งที่ `android.builtInKotlin=false` แก้ WebView/LiveKit/NotifyKit patches ให้เปิด legacy Kotlin compiler เมื่อ flag นี้เป็น false แล้ว refresh เฉพาะ patch hashes ใน lockfile; งาน compile WebView บนเครื่องนี้ผ่าน

Pagination ใช้การขยายหน้าต่าง query ที่มี limit ทีละหน้าเมื่อผู้ใช้กดโหลดเพิ่ม เพื่อให้ห้องที่โหลดแล้วยังรับการเปลี่ยนสมาชิกและการลบออกทันที การโหลดเพิ่มจะอ่านหน้าต่างนั้นอีกครั้ง ไม่ใช่ cursor ที่อ่านเฉพาะรายการใหม่

การอ่านแล้วเก็บเฉพาะ timestamp/message ID; เนื้อความและ URL รูปยังอยู่ในข้อความเข้ารหัส คิวกลุ่มเก็บ ciphertext ลง encrypted storage ก่อนคืนผลไป UI การ retry หลังหมุนกุญแจเข้ารหัส payload ใหม่บนอุปกรณ์และคง ID เพื่อป้องกันการส่งซ้ำ

### ข้อจำกัดที่ยังต้องตรวจบนอุปกรณ์

ยังไม่มีผลเปิด native build ใหม่บน Android/iOS จึงยังไม่ยืนยัน cold start, scroll FPS, keyboard/read-receipt behavior, สลับเครือข่ายจริง หรือ UI ตัวอักษรใหญ่/โหมดมืดครบทุกหน้า iOS Simulator ไม่ใช่ build สำหรับติดตั้งบน iPhone

ส่ง EAS builds ใหม่แล้ว:

- Android preview: `8f4ecb23-1eaa-428d-9bb1-ef3e039fe4a0` — ล่าสุด IN_QUEUE
- iOS Simulator: `00dcb555-46c0-4181-bac5-a368d91ab03f` — ล่าสุด IN_PROGRESS

`agent-device open com.campusmate.app --platform android --foreground` ยังคืน `DEVICE_NOT_FOUND` รอบนี้ จึงยังไม่ได้ทำ on-device smoke test

กรณีจำลองก่อนแก้ใช้ `tmp/app-performance-audit-probes.mjs` หลังแก้ให้ใช้ `scripts/test-app-bug-regressions.mjs` ซึ่งปรับให้ตรงกับโค้ดปัจจุบัน ไม่มีบัญชีหรือข้อมูลผู้ใช้จริง

การตรวจเดิมมีการทดสอบ R2/client/cache 28 ข้อผ่าน ส่วน `scripts/test-conversation-order.mjs` เคยรันไม่ผ่านเพราะ test harness ไม่ได้ส่ง dependency `selectLegacyPreviewMessages` ที่โค้ด subscription ใช้ ขณะนี้แก้ harness แล้วและรันผ่าน

## หลักฐานบัคก่อนแก้ไข

### 1. Cache ข้อความไม่ผูกกับกุญแจ — P1

- โค้ด: `src/services/chatEncryptionService.js:587`
- cache identity ใช้เพียง message ID และ ciphertext และคืน cache ก่อนตรวจสอบกุญแจ
- ผลจำลอง: ถอดรหัสด้วย key A แล้วเรียกข้อความเดียวกันด้วย key B ระบบคืนข้อความเดิมพร้อม `decryptionFailed: false`
- ผลกระทบ: สถานะถอดรหัสผิด และความลับใน memory cache ไม่แยกตามกุญแจ การจำลองนี้ไม่ได้พิสูจน์ว่าบัญชีอื่นอ่านข้อมูลผ่าน Firestore ได้
- แก้: ตรวจรูปแบบ key ก่อน lookup, แยก cache ตามกุญแจ/ขอบเขตห้องและบัญชี, ล้าง cache เมื่อออกจากระบบหรือเปลี่ยนบัญชี
- ทดสอบ: key ผิด/หายหลัง warm cache ต้องไม่คืน plaintext; key ที่ถูกต้องยัง reuse cache ได้

### 2. Fast-boot cache อาจเขียนทับ Firebase Auth — P1

- โค้ด: `src/context/AuthContext.js:32` และ `:47`
- Promise อ่าน cache กับ callback Firebase Auth ทำงานพร้อมกัน ไม่มี guard ว่า live Auth ตอบแล้วหรือยัง
- ผลจำลอง: Firebase ตอบ user=null ก่อน จากนั้น cache เก่าตอบ ระบบสุดท้ายกลับเป็น stale-cached-user
- ผลกระทบ: หน้าจออาจแสดง session เก่าหรือเข้าสู่หน้าแอปผิดหลังผล Auth จริง ไม่ใช่การข้ามสิทธิ์ฝั่งเซิร์ฟเวอร์
- แก้: ให้ผล live Auth มีลำดับความสำคัญสูงสุด ใช้ generation/settled guard ป้องกัน cache late result และ cache writes แข่งกับการล้างข้อมูล
- ทดสอบ: cache ตอบก่อน/หลัง Auth, sign-out และเปลี่ยนบัญชี

### 3. ส่งออฟไลน์ถูกแสดงเหมือนส่งแล้ว — P1

- โค้ด: `src/context/AppContext.js:2401` และ `:2412`
- `runOrQueue` คืน `{queued:true}` แต่ `sendMessage` ล้าง `pendingSync` ทันทีหลัง await
- ผลจำลอง: มีงานในคิว 1 งาน แต่ข้อความมี `pendingSync:false`
- ผลกระทบ: ผู้ใช้เห็นสถานะส่งสำเร็จทั้งที่ยังไม่ถึงเซิร์ฟเวอร์ และข้อความที่รอส่งอาจไม่ถูกเก็บไว้โดยตรรกะ merge ที่อาศัย pendingSync
- แก้: แยก queued/sending/sent/failed และล้าง pending เมื่อ server acknowledge หรือ queue flush สำเร็จเท่านั้น
- ทดสอบ: airplane mode, เน็ตหลุดหลังส่ง, reconnect และ retries ต้องไม่สร้างข้อความซ้ำ

### 4. ข้อความแชตกลุ่มหลุดจาก timeline หลังโหลดประวัติ — P1

- โค้ด: `src/screens/GroupChatRoomScreen.js:65`, `:96`, `:123`; live query จำกัดล่าสุด 100 ข้อความ
- recent window ถูกแทนที่ทั้งชุด ขณะที่ older เก็บเฉพาะหน้าที่โหลดก่อนหน้านั้น
- ผลจำลอง: โหลดข้อความ 1–200 แล้วมีข้อความ 201 ใหม่ หน้าจอเหลือ 200 ข้อความและข้อความ 101 หาย ทั้งที่ข้อมูลต้นทางไม่ได้ถูกลบ
- แก้: merge ข้อความตาม ID เก็บรายการที่หลุดจาก live window, เรียงตาม timestamp และ ID แบบแน่นอน, แยก pagination cursor จาก recent window
- ทดสอบ: โหลดประวัติพร้อมข้อความใหม่หลายชุด ต้องไม่มีช่องว่าง/ซ้ำ/ตำแหน่งเลื่อนกระโดด

## ประสิทธิภาพและการแสดงผลที่ควรปรับถัดไป

### 5. งานคิวหนึ่งงานหยุด live subscriptions หลายส่วน — P2

- `src/context/AppContext.js:1291` และ `:1323` รวมถึงการโหลดโปรไฟล์ ตรวจ pendingSyncCount>0 แล้วไม่ subscribe
- ขณะ queue flush ล้มเหลว/retry แอปอาจไม่รับแชตใหม่หรือนัดหมายใหม่ แม้การอ่านข้อมูลยังทำงานได้
- ควรให้ read subscriptions ทำงานต่อและ merge optimistic writes รายรายการ แยกสถานะ sync ของแต่ละงานแทนการหยุดทั้งระบบ

### 6. แชตกลุ่มยังขาด loading/pending/read states — P2

- `src/screens/GroupChatRoomScreen.js:223` แสดง “เริ่มสนทนา” ตั้งแต่ข้อมูลยังไม่มา และถอดรหัสก่อนกุญแจพร้อมอาจแสดงข้อความผิดพลาดชั่วคราว
- `src/components/GroupChatListSection.js:13` ล้างรายการเมื่อ error โดยไม่แสดงเหตุผล; ไม่มี read receipt ที่ทำให้ป้าย “มีข้อความใหม่” หายหลังอ่าน
- ควรแยก loading/empty/error/key-loading, เก็บรายการเดิมเมื่อเน็ตขัดข้อง, มี retry และสถานะ unread จริง
- การส่งกลุ่มใช้ busy ปิด composer ระหว่างรอ server และไม่มี outbox/pending bubble แบบแชตคู่ จึงรู้สึกรอแม้ Firestore มี local writes

### 7. ฟีดตี้และแชตกลุ่มไม่มีเพดานจำนวนเอกสาร — P2

- `src/services/partyService.js:63` ไม่มี limit/pagination: cutoff ย้อนหลัง 24 ชั่วโมงแต่ไม่จำกัดจำนวนตี้อนาคต
- `subscribeMyPartyRequests` อ่านคำขอทั้งหมดของบัญชี, `subscribeGroupChats` อ่านทุกห้อง แล้ว GroupChatListSection ใช้ map เป็น header ของ FlatList จึงไม่ได้ virtualize แถวกลุ่ม
- ควรแบ่งหน้าและกำหนดขนาดฟีดแรก จำกัดคำขอสถานะที่ต้องใช้ และรวมกลุ่มเป็นแถวของ virtualized list
- เป็นต้นทุนที่เห็นจากโค้ด; ระยะเวลาและ memory ที่เพิ่มจริงต้องวัดเมื่อมีข้อมูลมาก

### 8. อ่านกุญแจกลุ่มซ้ำ — P2

- `GroupChatRoomScreen.js:64` subscribe epochs แล้ว `:78` เรียก getGroupKeys ซึ่ง `groupChatEncryption.js:84` getDocs epochs ทั้งหมดอีกครั้ง
- ใช้ epoch snapshot ที่ได้รับแล้วแทนอ่านชุดเดิมซ้ำ และ unwrap เฉพาะ epoch/device envelope ที่เปลี่ยน จะลด read และเวลารอ key
- ต้องคงการตรวจประวัติทุก epoch ในขั้นตอนอนุมัติสมาชิกใหม่

### 9. สถานะตี้หมดเวลาไม่เปลี่ยนตามนาฬิกาทันที — P2

- `src/hooks/usePartyFeed.js:191` คำนวณ Date.now ใน useMemo โดยไม่มี clock dependency
- หากเปิดหน้าค้างไว้โดยไม่มี snapshot/dependency เปลี่ยน สถานะ may remain open จนมี event ใหม่หรือ scheduled expiry
- Callable ตรวจเวลาฝั่งเซิร์ฟเวอร์อยู่แล้ว แต่ UI ควรอัปเดตด้วย clock tick หรือ timer ของนัดถัดไป และ refresh เมื่อ app กลับ foreground

## ลำดับงาน

1. แก้ P1 ทั้ง 4 และเพิ่ม regression tests จากกรณีจำลอง
2. รักษา live reads ขณะ flush queue และปรับ loading/unread/pending กลุ่ม
3. จำกัดฟีด/virtualize กลุ่ม/เลิกอ่าน epochs ซ้ำ
4. ซ่อม conversation-order test harness แล้วทดสอบส่ง/รับ/อ่าน/ย้อนประวัติ
5. วัดบน release binary: cold-start ถึงกดได้, เปิดแชตจนเห็น cached messages, message acknowledgement, avatar first paint, scroll FPS และ memory กับ 100/500/2000 ข้อความ ใช้ชุดข้อมูลและเครือข่ายเดียวกันก่อน/หลัง

## Native build ที่ตรวจล่าสุด

- iOS Simulator f9e2b52e-3416-4614-b512-c490d9e081ee: FINISHED มี artifact แล้ว ยังไม่ใช่ผลทดสอบ runtime
- Android 956e162b-375e-46f2-8636-b9fe3799b1ce: IN_QUEUE
- Emulator เครื่องนี้ยังไม่มี system image ที่ใช้บูตได้ จึงยังไม่สามารถยืนยันการแสดงผลใน native runtime
