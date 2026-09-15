import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

/**
 * Script for managing app_config/version in Firestore
 * Usage:
 *   node scripts/set-version-config.mjs [latestVersion] [minVersion] [--force] [--published]
 * Examples:
 *   node scripts/set-version-config.mjs 1.2.0
 *   node scripts/set-version-config.mjs 1.2.0 1.1.0
 *   node scripts/set-version-config.mjs 1.2.0 1.2.0 --force
 *   node scripts/set-version-config.mjs 1.2.0 1.1.0 --published
 */

try {
  initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'campusmate-7f1ab',
  });
} catch (e) {
  // Already initialized
}

const db = getFirestore();
const args = process.argv.slice(2);
const isForce = args.includes('--force');
const isPlayStorePublished = args.includes('--published') || args.includes('--play-store-published');
const cleanArgs = args.filter((a) => !a.startsWith('--'));

const latestVersion = cleanArgs[0] || '1.2.0';
const minVersion = cleanArgs[1] || '1.1.0';

const configData = {
  enabled: true,
  latestVersion,
  playStorePublished: isPlayStorePublished,
  minVersion,
  forceUpdate: isForce,
  title: 'มีเวอร์ชันใหม่พร้อมใช้งาน',
  message: `CampusMate เวอร์ชัน ${latestVersion} พร้อมให้อัปเดตแล้วบน Google Play Store เพื่อประสบการณ์การใช้งานที่ดีที่สุด`,
  releaseNotes: '• ปรับปรุงระบบค้นหาเพื่อนและประสิทธิภาพการเชื่อมต่อ\n• ปรับปรุงความเร็วและความเสถียรของแอพ\n• แก้ไขข้อผิดพลาดทั่วไป',
  playStoreUrl: 'market://details?id=com.campusmate.app',
  playStoreWebUrl: 'https://play.google.com/store/apps/details?id=com.campusmate.app',
  snoozeHours: 24,
  updatedAt: FieldValue.serverTimestamp(),
};

async function run() {
  console.log('Updating Firestore app_config/version...');
  console.log(`Google Play published: ${isPlayStorePublished ? 'yes' : 'no'}`);
  console.log(JSON.stringify(configData, null, 2));

  await db.collection('app_config').doc('version').set(configData, { merge: true });
  console.log('✅ Successfully updated app_config/version in Firestore!');
}

run().catch((error) => {
  console.error('❌ Failed to update app_config/version:', error?.message || error);
  process.exitCode = 1;
});
