# CampusMate — โครงสร้างแอปสำหรับ iOS 27

โปรเจกต์ใช้ Expo SDK 57 และ Expo Router เป็นระบบนำทางหลัก โดย iOS ใช้ Native Tabs ตามเอกสาร Expo Router ส่วน Android และ Web ใช้ Tabs แบบ JavaScript เป็น fallback

## Route tree

```text
app/_layout.js                 Root providers and stack
├── index.js                   Login route
├── (tabs)/
│   ├── _layout.ios.js         Expo Router NativeTabs on iOS
│   ├── _layout.js             Tabs fallback on Android/Web
│   ├── home.js                Dashboard
│   ├── discover.js            Discover and matching
│   ├── chat.js                Conversations and chat
│   └── meetup.js              Meetups and places
└── profile.js                 Profile form sheet
```

## Navigation behavior

- มีแท็บหลัก 4 รายการ: Home, Discover, Chat และ Meetup
- iOS ใช้ `NativeTabs` จาก `expo-router/unstable-native-tabs` พร้อม SF Symbols และ unread badge ในแท็บ Chat
- iOS 26/27 ให้ระบบวาด Liquid Glass ของ tab bar ตามพฤติกรรม native ของระบบ
- Android/Web ใช้ `Tabs` ของ Expo Router และ `expo-symbols` เป็น fallback
- Profile เปิดเป็น `formSheet` จาก avatar และมีปุ่มปิด/ออกจากระบบ
- หน้า `likes.js` แสดงคนที่กดใจ พร้อมการรับเป็นเพื่อนหรือปฏิเสธ และลิงก์ไปห้องแชตหลังจับคู่
- Root layout ครอบด้วย `AppProvider`, `AuthProvider` และ `ToastProvider`
- Native tab bar จัดการ safe area ให้อัตโนมัติ ส่วนหน้าเนื้อหายังคงใช้พื้นผิวทึบเพื่อให้อ่านง่าย

## Files ที่เกี่ยวข้อง

- `app/_layout.js` — root stack และ providers
- `app/(tabs)/_layout.ios.js` — native iOS tabs
- `app/(tabs)/_layout.js` — fallback tabs
- `app/profile.js` — profile sheet
- `src/screens/DashboardScreen.ios.js` — หน้า Home แบบ native SwiftUI ที่แสดงเฉพาะเมนูทางลัดและเว้นระยะจาก iOS safe area
- `src/screens/HomeScreen.ios.js` — หน้า Discover แบบ native SwiftUI พร้อมการ์ดโปรไฟล์ ปุ่มข้าม/ถูกใจ และเมนูวงกลมตามหน้าอ้างอิง
- `src/screens/ProfileScreen.ios.js` — หน้าโปรไฟล์และการตั้งค่าแบบ native SwiftUI โดยจัด avatar และข้อมูลเจ้าของบัญชีไว้กึ่งกลาง
- `src/screens/ChatScreen.ios.js` — รายการแชตและห้องสนทนาแบบ native SwiftUI พร้อม message composer
- `src/screens/MeetupScreen.ios.js` — หน้ากิจกรรมและจุดนัดพบแบบ native SwiftUI พร้อมตัวกรองและสถานะเลือก
- `src/screens/LikesScreen.ios.js` — หน้า incoming likes แบบ native SwiftUI ด้วย `@expo/ui`
- `src/screens/LikesScreen.js` — fallback สำหรับ Android และ Web
- `src/context/AuthContext.js` — auth state
- `src/context/ToastContext.js` — toast state

## การทดสอบ

```bash
pnpm exec expo start --clear
pnpm exec expo export --platform ios
pnpm exec expo export --platform web
```

Native Tabs เป็น API ที่ยังอยู่ในสถานะ alpha จึงควรทดสอบบน iOS Simulator หรือ development build เมื่อจะตรวจพฤติกรรม native จริง
