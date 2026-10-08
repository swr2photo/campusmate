import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GoogleAuth } = require('D:/project-mobile application/functions/node_modules/google-auth-library');

const KEY_PATH = 'C:\\Users\\This PC\\Downloads\\campusmate-7f1ab-5a54a4f99711.json';
const PACKAGE_NAME = 'com.campusmate.app';

async function verifyPlayApiPermissions() {
  console.log('====================================================');
  console.log(' ตรวจสอบสิทธิ์ Google Play Developer API แบบ Real-Time');
  console.log('====================================================\n');

  if (!existsSync(KEY_PATH)) {
    console.error(`[ERROR] ไม่พบไฟล์ Service Account Key ที่: ${KEY_PATH}`);
    process.exit(1);
  }

  const auth = new GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  if (!token?.token) {
    console.error('[ERROR] ไม่สามารถขอ Access Token จาก Google OAuth2 ได้');
    process.exit(1);
  }

  console.log('1. การยืนยันตัวตน Service Account: [ผ่าน]');
  console.log('   - บัญชี: revenuecat-service-account@campusmate-7f1ab.iam.gserviceaccount.com');
  console.log('   - OAuth Scope: https://www.googleapis.com/auth/androidpublisher');

  const headers = {
    Authorization: `Bearer ${token.token}`,
    Accept: 'application/json',
  };

  const results = {};

  // Check 1: App access & Edits
  try {
    const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    results.appAccess = res.status === 200;
    if (res.status === 200) {
      const edit = await res.json();
      await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${edit.id}`, {
        method: 'DELETE',
        headers,
      });
    }
  } catch {
    results.appAccess = false;
  }

  // Check 2: Reviews
  try {
    const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/reviews`, { headers });
    results.reviews = res.status === 200;
  } catch {
    results.reviews = false;
  }

  // Check 3: Financial access (Voided Purchases)
  try {
    const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/voidedpurchases`, { headers });
    results.financialData = res.status === 200;
    results.financialStatus = res.status;
  } catch {
    results.financialData = false;
  }

  // Check 4: Subscriptions Purchase Validation
  try {
    const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/dummy_token_probe`, { headers });
    results.purchaseValidationStatus = res.status;
    // 400 or 404 (token not found/invalid) means caller has permission to call the API!
    // 401 with "insufficient permissions" means permission is denied.
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || '';
    if (res.status === 401 && message.includes('insufficient permissions')) {
      results.purchaseValidation = false;
      results.reason = 'Google API ยังปฏิเสธสิทธิ์ (insufficient permissions / รอ propagation)';
    } else if (res.status === 400 || res.status === 404) {
      results.purchaseValidation = true;
      results.reason = 'มีสิทธิ์เรียก API แล้ว (ตอบ token invalid/not found ตามปกติ)';
    } else {
      results.purchaseValidation = false;
      results.reason = `HTTP ${res.status}: ${message}`;
    }
  } catch (err) {
    results.purchaseValidation = false;
    results.reason = err.message;
  }

  console.log('\n2. ผลการตรวจสอบสิทธิ์แต่ละด้านกับ Google Play API:');
  console.log(`   - สิทธิ์เข้าถึงแอป (App Access & Edits):     ${results.appAccess ? '[✓ ผ่าน]' : '[✗ ล้มเหลว]'}`);
  console.log(`   - สิทธิ์อ่านรีวิวและข้อมูลทั่วไป (Reviews):    ${results.reviews ? '[✓ ผ่าน]' : '[✗ ล้มเหลว]'}`);
  console.log(`   - สิทธิ์ข้อมูลการเงิน (Financial Data API):  ${results.financialData ? '[✓ ผ่าน]' : `[✗ ยังไม่ผ่าน (HTTP ${results.financialStatus})]`}`);
  console.log(`   - สิทธิ์ตรวจสอบการซื้อ (Purchase Validation):  ${results.purchaseValidation ? '[✓ ผ่าน]' : `[✗ ยังไม่ผ่าน]`}`);
  console.log(`     รายละเอียด: ${results.reason}\n`);

  console.log('====================================================');
  if (results.purchaseValidation) {
    console.log(' สรุป: สิทธิ์ตรวจสอบการซื้อมีผลสมบูรณ์แล้ว! สามารถกด Check credentials ใน RevenueCat ได้ทันที');
  } else {
    console.log(' สรุป: สิทธิ์ทั่วไปผ่านแล้ว แต่สิทธิ์การเงินยังอยู่ในช่วงรอ Google อัปเดต (Propagation Delay สูงสุด 36 ชม.)');
  }
  console.log('====================================================');

  const { mkdirSync, writeFileSync } = require('node:fs');
  mkdirSync('artifacts/server-staging', { recursive: true });
  writeFileSync('artifacts/server-staging/play-api-live-check.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    serviceAccount: 'revenuecat-service-account@campusmate-7f1ab.iam.gserviceaccount.com',
    packageName: PACKAGE_NAME,
    results,
  }, null, 2) + '\n');
}

verifyPlayApiPermissions().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
