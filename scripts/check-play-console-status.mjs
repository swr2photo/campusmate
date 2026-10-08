import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GoogleAuth } = require('D:/project-mobile application/functions/node_modules/google-auth-library');

const KEY_PATH = 'C:\\Users\\This PC\\Downloads\\campusmate-7f1ab-5a54a4f99711.json';
const PACKAGE_NAME = 'com.campusmate.app';

async function checkPlayConsoleStatus() {
  console.log('====================================================');
  console.log(' ตรวจสอบสถานะ Google Play Console ปัจจุบัน');
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

  const headers = {
    Authorization: `Bearer ${token.token}`,
    Accept: 'application/json',
  };

  // 1. Check Edits & Tracks
  let editId = null;
  try {
    const editRes = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    if (editRes.status === 200) {
      const edit = await editRes.json();
      editId = edit.id;
      console.log(`[1] Edit Session Created: ${editId}`);

      // List tracks
      const tracksRes = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/tracks`, { headers });
      if (tracksRes.status === 200) {
        const tracksData = await tracksRes.json();
        console.log('\n--- สถานะ Tracks ใน Play Console ---');
        for (const t of tracksData.tracks || []) {
          console.log(`Track: [${t.track}]`);
          for (const rel of t.releases || []) {
            console.log(`  - Version Codes: [${rel.versionCodes?.join(', ')}] | Status: ${rel.status} | Name: ${rel.name}`);
          }
        }
      }

      // Check bundles uploaded
      const bundlesRes = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/bundles`, { headers });
      if (bundlesRes.status === 200) {
        const bundlesData = await bundlesRes.json();
        console.log('\n--- รายการ App Bundles ที่มีในระบบ ---');
        for (const b of bundlesData.bundles || []) {
          console.log(`  - versionCode: ${b.versionCode} (sha256: ${b.sha256?.slice(0, 12)}...)`);
        }
      }
    } else {
      console.log(`[1] Failed to create edit: ${editRes.status} ${await editRes.text()}`);
    }
  } catch (err) {
    console.error('Error checking tracks:', err.message);
  } finally {
    if (editId) {
      await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}`, {
        method: 'DELETE',
        headers,
      });
    }
  }

  // 2. Check Subscriptions (monetization API)
  try {
    const subRes = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/monetization/subscriptions`, { headers });
    console.log('\n--- ตรวจสอบการสมัครรับข้อมูล (Subscriptions) ---');
    if (subRes.status === 200) {
      const subData = await subRes.json();
      const subs = subData.subscriptions || [];
      if (subs.length === 0) {
        console.log('  ยังไม่มี Subscription ในระบบ (พร้อมสร้างได้แล้ว)');
      } else {
        for (const s of subs) {
          console.log(`  - Subscription ID: ${s.productId} (Package: ${s.packageName})`);
          for (const bp of s.basePlans || []) {
            console.log(`      Base Plan: ${bp.basePlanId} | Status: ${bp.state} | AutoRenewing: ${!!bp.autoRenewingBasePlanType}`);
          }
        }
      }
    } else {
      console.log(`  Subscriptions API status: ${subRes.status} ${await subRes.text()}`);
    }
  } catch (err) {
    console.error('Error checking subscriptions:', err.message);
  }

  // 3. Check In-App Products
  try {
    const iapRes = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/inappproducts`, { headers });
    console.log('\n--- ตรวจสอบสินค้าในแอป (In-App Products) ---');
    if (iapRes.status === 200) {
      const iapData = await iapRes.json();
      const inapps = iapData.inappproduct || [];
      if (inapps.length === 0) {
        console.log('  ยังไม่มี In-App Product ในระบบ');
      } else {
        for (const p of inapps) {
          console.log(`  - SKU: ${p.sku} | Type: ${p.purchaseType} | Status: ${p.status}`);
        }
      }
    } else {
      console.log(`  In-App Products API status: ${iapRes.status}`);
    }
  } catch (err) {
    console.error('Error checking inappproducts:', err.message);
  }

  console.log('\n====================================================\n');
}

checkPlayConsoleStatus();
