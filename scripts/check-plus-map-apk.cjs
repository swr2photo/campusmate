const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceMap = JSON.parse(fs.readFileSync(path.join(root, 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map'), 'utf8'));
const files = ['app/onboarding.js', 'src/context/AppContext.js', 'src/services/firestoreService.js',
  'src/services/secureDiscoveryService.js', 'src/components/CachedImage.js', 'src/services/versionCheckService.js',
  'src/utils/versionUpdatePolicy.js', 'src/components/AppUpdateModal.js', 'src/services/notificationPrivacy.js',
  'src/services/notificationService.js', 'src/components/NotificationManager.js'];
const normalized = (text) => text.replaceAll('\r\n', '\n');
const checks = Object.fromEntries(files.map((file) => {
  const index = sourceMap.sources.findIndex((source) => source.replaceAll('\\', '/').endsWith(file));
  return [file, index >= 0 && normalized(sourceMap.sourcesContent[index] || '') === normalized(fs.readFileSync(path.join(root, file), 'utf8'))];
}));
if (!Object.values(checks).every(Boolean)) {
  console.error(JSON.stringify({ checks })); throw new Error('APK bundle source differs from the workspace. Rebuild before installation.');
}
const source = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const destination = path.join(root, 'artifacts/android/campusmate-plus-map-qa-x86.apk');
fs.copyFileSync(source, destination);
const result = { apkSha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'), checks };
fs.writeFileSync(path.join(root, 'artifacts/android/plus-map-bundle-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
