const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const map = JSON.parse(fs.readFileSync('android/app/build/generated/sourcemaps/react/release/index.android.bundle.map', 'utf8'));
const files = ['src/components/FaceVerificationModal.js', 'src/components/FaceVerificationDetails.js', 'src/screens/ProfileScreen.js', 'src/services/membershipService.js', 'src/context/MembershipContext.js'];
const normalize = s => s.replaceAll('\r\n', '\n');
const checks = Object.fromEntries(files.map(file => {
  const index = map.sources.findIndex(s => s.replaceAll('\\', '/').endsWith(file));
  return [file, index >= 0 && normalize(map.sourcesContent[index] || '') === normalize(fs.readFileSync(file, 'utf8'))];
}));
if (!Object.values(checks).every(Boolean)) throw new Error(`Stale APK bundle: ${JSON.stringify(checks)}`);
const destination = 'artifacts/android/campusmate-profile-plus-fix-qa-x86.apk';
fs.copyFileSync('android/app/build/outputs/apk/release/app-release.apk', destination);
const result = { artifact: path.resolve(destination), sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'), checks };
fs.writeFileSync('artifacts/android/profile-plus-bundle-verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
