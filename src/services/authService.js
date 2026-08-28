// จุดเชื่อมต่อสำหรับ Firebase Google Sign-In ตามขอบเขตในรายงาน
// ตอนนี้เปิด demo mode เพื่อให้ทีมสามารถรันและทดสอบ flow ได้โดยไม่ต้องใส่ credential ลงใน source code
const hasFirebaseConfig = Boolean(
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY
  && process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
);

export async function signInWithGoogle() {
  if (!hasFirebaseConfig) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return {
      mode: 'demo',
      user: {
        id: 'demo-user',
        email: 'thanapat.demo@psu.ac.th',
        displayName: 'ธนภัทร วงศ์สว่าง',
      },
    };
  }

  throw new Error('พบ Firebase config แล้ว กรุณาเชื่อม Google OAuth provider ใน authService ก่อนใช้งานจริง');
}

export function isFirebaseConfigured() {
  return hasFirebaseConfig;
}

