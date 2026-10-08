import { writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { evaluateVersionPolicy, normalizeNativeBuild } from '../src/utils/versionUpdatePolicy.js';

// Default is a local review artifact. --apply writes only the selected platform.
// node scripts/set-version-config.mjs 2.1.8 2.1.8 --platform android --latest-build 78 --min-build 78
// Add --published --apply only after this exact binary is downloadable from its store.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  platform: { type: 'string', default: 'android' },
  'latest-build': { type: 'string' }, 'min-build': { type: 'string' },
  'app-store-url': { type: 'string' }, force: { type: 'boolean', default: false },
  published: { type: 'boolean', default: false }, 'play-store-published': { type: 'boolean', default: false },
  apply: { type: 'boolean', default: false },
} });
const platform = values.platform, [latestVersion, minVersion] = positionals;
if (!['android', 'ios'].includes(platform) || positionals.length > 2
  || !/^\d+\.\d+\.\d+$/.test(latestVersion || '')
  || (minVersion && !/^\d+\.\d+\.\d+$/.test(minVersion))) {
  throw new Error('Usage: node scripts/set-version-config.mjs VERSION [MIN_VERSION] --platform android|ios [--latest-build BUILD] [--min-build BUILD] [--published] [--apply]');
}
const latestBuild = values['latest-build'] ?? null, minBuild = values['min-build'] ?? null;
for (const [label, value] of [['latest-build', latestBuild], ['min-build', minBuild]]) {
  if (value !== null && !normalizeNativeBuild(value, platform)) throw new Error(`Invalid ${label} for ${platform}`);
}
const published = values.published || values['play-store-published'];
if (values['play-store-published'] && platform !== 'android') throw new Error('Use --published for iOS; Google Play cannot publish iOS');
if (published && !latestBuild) throw new Error('A published platform release requires its exact native build');
const release = {
  enabled: true, latestVersion, latestBuild, minVersion: minVersion || null, minBuild,
  storePublished: published, forceUpdate: values.force,
  title: 'มีเวอร์ชันใหม่พร้อมใช้งาน',
  message: `CampusMate เวอร์ชัน ${latestVersion} พร้อมให้อัปเดตแล้ว`,
  snoozeHours: 24,
  ...(platform === 'android' ? {
    playStorePublished: published,
    playStoreUrl: 'market://details?id=com.campusmate.app',
    playStoreWebUrl: 'https://play.google.com/store/apps/details?id=com.campusmate.app',
  } : { appStorePublished: published, appStoreUrl: values['app-store-url'] || null }),
};
// Validate minimums as published even when staging.
const validation = evaluateVersionPolicy({ platforms: { [platform]: { ...release, storePublished: true,
  ...(platform === 'ios' ? { appStoreUrl: release.appStoreUrl || 'https://apps.apple.com/app/id1' } : {}) } } },
{ platform, currentVersion: '0.0.0', currentBuild: '0' });
if (validation.invalidConfig) throw new Error('Minimum version/build must be reachable in the target release; iOS minBuild must belong to latestVersion');
if (published && platform === 'ios' && !/^https:\/\/(?:apps|itunes)\.apple\.com\//i.test(String(release.appStoreUrl || ''))) {
  throw new Error('A published iOS release requires its App Store URL');
}
const proposed = { platforms: { [platform]: release } };
mkdirSync('artifacts/server-staging', { recursive: true });
const reviewPath = `artifacts/server-staging/version-${platform}-proposed.json`;
writeFileSync(reviewPath, JSON.stringify(proposed, null, 2) + '\n');
console.log(JSON.stringify({ platform, latestVersion, latestBuild, minVersion: release.minVersion, minBuild,
  storePublished: published, apply: values.apply, reviewPath }));
if (values.apply) {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'campusmate-7f1ab' });
  const payload = { platforms: { [platform]: { ...release, updatedAt: FieldValue.serverTimestamp() } } };
  const mergeFields = [`platforms.${platform}`];
  if (platform === 'android') {
    // Old clients still read these fields until the secure cutover.
    Object.assign(payload, { latestVersion, minVersion: release.minVersion, playStorePublished: published,
      forceUpdate: release.forceUpdate, updatedAt: FieldValue.serverTimestamp() });
    mergeFields.push('latestVersion', 'minVersion', 'playStorePublished', 'forceUpdate', 'updatedAt');
  }
  await getFirestore().collection('app_config').doc('version').set(payload, { mergeFields });
  console.log(`Applied ${platform} version configuration; the other platform was preserved.`);
} else {
  console.log('Local proposal only; 0 Firestore writes.');
}
