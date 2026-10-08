import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = path.join(root, 'app.json');
const releaseType = process.argv[2] || 'patch';

if (!['major', 'minor', 'patch'].includes(releaseType)) {
  console.error('Usage: node scripts/release-version.mjs [major|minor|patch]');
  process.exit(1);
}

const appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const currentVersion = appConfig.expo?.version;
const versionParts = currentVersion?.split('.').map(Number);

if (
  !currentVersion
  || versionParts.length !== 3
  || versionParts.some((part) => !Number.isInteger(part) || part < 0)
) {
  console.error(`Invalid Expo version in app.json: ${currentVersion || '(missing)'}`);
  process.exit(1);
}

const [major, minor, patch] = versionParts;
const nextVersion = releaseType === 'major'
  ? `${major + 1}.0.0`
  : releaseType === 'minor'
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;

appConfig.expo.version = nextVersion;
appConfig.expo.runtimeVersion = nextVersion;
if (typeof appConfig.expo?.android?.versionCode === 'number') {
  appConfig.expo.android.versionCode += 1;
}
fs.writeFileSync(appJsonPath, `${JSON.stringify(appConfig, null, 2)}\n`);

const buildGradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(buildGradlePath)) {
  let gradleContent = fs.readFileSync(buildGradlePath, 'utf8');
  if (appConfig.expo?.android?.versionCode) {
    gradleContent = gradleContent.replace(/versionCode\s+\d+/, `versionCode ${appConfig.expo.android.versionCode}`);
  }
  gradleContent = gradleContent.replace(/versionName\s+["'][^"']+["']/, `versionName "${nextVersion}"`);
  fs.writeFileSync(buildGradlePath, gradleContent);
}

const stringsPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsPath)) {
  let stringsContent = fs.readFileSync(stringsPath, 'utf8');
  stringsContent = stringsContent.replace(
    /(<string name="expo_runtime_version">)[^<]+(<\/string>)/,
    `$1${nextVersion}$2`,
  );
  fs.writeFileSync(stringsPath, stringsContent);
}

console.log(`Version updated: ${currentVersion} -> ${nextVersion} (versionCode: ${appConfig.expo?.android?.versionCode || 'auto'})`);
console.log('EAS will auto-increment Android versionCode during the next production build.');

try {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  try {
    initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'campusmate-7f1ab',
    });
  } catch {}
  const db = getFirestore();
  await db.collection('app_config').doc('version').set({
    enabled: true,
    latestVersion: nextVersion,
    // A release is not eligible for update prompts until it is published on
    // Google Play and `version:set ... --published` is run.
    playStorePublished: false,
    platforms: { android: {
      enabled: true, latestVersion: nextVersion, latestBuild: null,
      minVersion: null, minBuild: null, forceUpdate: false,
      storePublished: false, playStorePublished: false,
    } },
    updatedAt: FieldValue.serverTimestamp(),
    title: 'มีเวอร์ชันใหม่พร้อมใช้งาน',
    message: `CampusMate เวอร์ชัน ${nextVersion} พร้อมให้อัปเดตแล้วบน Google Play Store เพื่อประสบการณ์การใช้งานที่ดีที่สุด`,
  }, { merge: true });
  console.log(`✅ Firestore app_config/version staged at ${nextVersion}; waiting for Google Play publication.`);
} catch (e) {
  console.log(`ℹ️ Could not stage Firestore (${e.message}). Use version:set explicitly after verifying the published native build.`);
}
