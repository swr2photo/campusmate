import { createReadStream, statSync, existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GoogleAuth } = require('D:/project-mobile application/functions/node_modules/google-auth-library');

const appConfig = JSON.parse(readFileSync('app.json', 'utf8'));
const appVersion = appConfig.expo?.version || '3.1.6';

const KEY_PATH = 'C:\\Users\\This PC\\Downloads\\campusmate-7f1ab-5a54a4f99711.json';
const PACKAGE_NAME = 'com.campusmate.app';
const AAB_PATH = 'D:/project-mobile application/android/app/build/outputs/bundle/release/app-release.aab';
const TARGET_TRACK = process.argv[2] || 'beta'; // default to beta (open testing)

async function uploadToPlayStore() {
  console.log('====================================================');
  console.log(` อัปโหลด App Bundle ขึ้น Google Play Console (${TARGET_TRACK})`);
  console.log('====================================================\n');

  if (!existsSync(AAB_PATH)) {
    console.error(`[ERROR] ไม่พบไฟล์ AAB ที่: ${AAB_PATH}`);
    process.exit(1);
  }

  const fileStats = statSync(AAB_PATH);
  const fileSize = fileStats.size;
  console.log(`ไฟล์ AAB: ${AAB_PATH}`);
  console.log(`ขนาดไฟล์: ${(fileSize / (1024 * 1024)).toFixed(2)} MB (${fileSize} bytes)`);

  if (!existsSync(KEY_PATH)) {
    console.error(`[ERROR] ไม่พบ Service Account Key ที่: ${KEY_PATH}`);
    process.exit(1);
  }

  // 1. Authenticate with Google
  console.log('\n[1/5] กำลังตรวจสอบสิทธิ์ Google Play API...');
  const auth = new GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = tokenResponse.token;
  console.log('  ยืนยันสิทธิ์สำเร็จ!');

  const apiHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  // 2. Create Edit Session
  console.log('\n[2/5] กำลังสร้าง Edit Session บน Play Console...');
  const editRes = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
  });

  if (!editRes.ok) {
    const errorBody = await editRes.text();
    console.error(`[ERROR] สร้าง Edit Session ล้มเหลว: HTTP ${editRes.status} ${errorBody}`);
    process.exit(1);
  }

  const edit = await editRes.json();
  const editId = edit.id;
  console.log(`  Edit ID: ${editId}`);

  try {
    // 3. Initiate Resumable Upload
    console.log('\n[3/5] เริ่มกระบวนการ Resumable Upload ไปยัง Google Play...');
    const initRes = await fetch(
      `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/bundles?uploadType=resumable`,
      {
        method: 'POST',
        headers: {
          ...apiHeaders,
          'X-Upload-Content-Type': 'application/octet-stream',
          'X-Upload-Content-Length': String(fileSize),
        },
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`เริ่ม Resumable Upload ล้มเหลว (${initRes.status}): ${err}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new Error('ไม่พบ Location Header สำหรับ Resumable Upload URL');
    }
    console.log('  ได้รับ Resumable Upload URL แล้ว กำลังเริ่มสตรีมข้อมูล...');

    // Upload the file via stream with progress
    const uploadedBundle = await new Promise((resolve, reject) => {
      const parsedUrl = new URL(uploadUrl);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'PUT',
        headers: {
          'Content-Length': fileSize,
          'Content-Type': 'application/octet-stream',
        },
      };

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const bundleData = JSON.parse(responseBody);
              resolve(bundleData);
            } catch {
              resolve({ raw: responseBody });
            }
          } else {
            reject(new Error(`Upload ล้มเหลว HTTP ${res.statusCode}: ${responseBody}`));
          }
        });
      });

      req.on('error', (err) => reject(err));

      const readStream = createReadStream(AAB_PATH);
      let uploadedBytes = 0;
      let lastReport = 0;

      readStream.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastReport > 2500 || uploadedBytes === fileSize) {
          lastReport = now;
          const pct = ((uploadedBytes / fileSize) * 100).toFixed(1);
          const mb = (uploadedBytes / (1024 * 1024)).toFixed(1);
          const totalMb = (fileSize / (1024 * 1024)).toFixed(1);
          process.stdout.write(`\r  กำลังอัปโหลด: ${pct}% (${mb}/${totalMb} MB)`);
        }
      });

      readStream.pipe(req);
    });

    console.log('\n  อัปโหลดไฟล์ AAB สำเร็จ!');
    console.log(`  Bundle Version Code: ${uploadedBundle.versionCode}`);
    console.log(`  Bundle SHA256: ${uploadedBundle.sha256}`);

    const bundleVersionCode = uploadedBundle.versionCode;

    // 4. Update Target Track
    console.log(`\n[4/5] กำลังอัปเดต Release ใน Track [${TARGET_TRACK}] ด้วย Version Code [${bundleVersionCode}]...`);
    const trackPayload = {
      track: TARGET_TRACK,
      releases: [
        {
          name: `${bundleVersionCode} (${appVersion})`,
          versionCodes: [String(bundleVersionCode)],
          status: 'completed',
          releaseNotes: [
            {
              language: 'th',
              text: `อัปเดตเวอร์ชัน ${appVersion}: ปรับปรุงประสิทธิภาพและเสถียรภาพการทำงานของระบบห้องแชตและโปรไฟล์`,
            },
            {
              language: 'en-US',
              text: `Version ${appVersion}: Performance and stability improvements for chat and user profile.`,
            },
          ],
        },
      ],
    };

    const trackRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/tracks/${TARGET_TRACK}`,
      {
        method: 'PUT',
        headers: {
          ...apiHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(trackPayload),
      }
    );

    if (!trackRes.ok) {
      const err = await trackRes.text();
      throw new Error(`อัปเดต Track [${TARGET_TRACK}] ล้มเหลว (${trackRes.status}): ${err}`);
    }

    const trackData = await trackRes.json();
    console.log(`  Track [${trackData.track}] ได้รับการอัปเดตแล้ว: status = ${trackData.releases?.[0]?.status}`);

    // 5. Commit Edit Session
    console.log('\n[5/5] กำลัง Commit การเปลี่ยนแปลงขึ้น Google Play Store...');
    const commitRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}:commit`,
      {
        method: 'POST',
        headers: apiHeaders,
      }
    );

    if (!commitRes.ok) {
      const err = await commitRes.text();
      throw new Error(`Commit ล้มเหลว (${commitRes.status}): ${err}`);
    }

    const commitData = await commitRes.json();
    console.log(`  Commit สำเร็จ! Edit ID: ${commitData.id}`);

    console.log('\n====================================================');
    console.log(` สำเร็จ! เวอร์ชัน ${appVersion} (versionCode ${bundleVersionCode}) เผยแพร่ขึ้น Google Play แล้ว`);
    console.log(` Track: ${TARGET_TRACK} (Open Testing / Beta)`);
    console.log('====================================================\n');
  } catch (error) {
    console.error('\n[ERROR]', error.message);
    console.log('กำลังยกเลิก Edit Session...');
    await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}`, {
      method: 'DELETE',
      headers: apiHeaders,
    }).catch(() => {});
    process.exit(1);
  }
}

uploadToPlayStore();
