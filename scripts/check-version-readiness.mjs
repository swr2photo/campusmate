import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { evaluateVersionPolicy } from '../src/utils/versionUpdatePolicy.js';

// Read-only production audit. It never advances a release or enables minimum build gates.
initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'campusmate-7f1ab' });
const snapshot = await getFirestore().collection('app_config').doc('version').get();
const config = snapshot.exists ? snapshot.data() : null;
const gradle = readFileSync('android/app/build.gradle', 'utf8');
const currentVersion = gradle.match(/versionName\s+['"]([^'"]+)['"]/)?.[1] || '';
const currentBuild = gradle.match(/versionCode\s+(\d+)/)?.[1] || '';
const result = evaluateVersionPolicy(config, { platform: 'android', currentVersion, currentBuild });
const summary = {
  firestoreWrites: 0, configExists: snapshot.exists, enabled: config?.enabled !== false,
  android: { currentVersion, currentBuild, storePublished: config?.platforms?.android?.storePublished === true
    || config?.platforms?.android?.playStorePublished === true
    || (!config?.platforms?.android && config?.playStorePublished === true),
    needsUpdate: result.needsUpdate, isForce: result.isForce === true, invalidConfig: result.invalidConfig === true },
  ios: { storePublished: config?.platforms?.ios?.storePublished === true
    || config?.platforms?.ios?.appStorePublished === true
    || (!config?.platforms?.ios && config?.appStorePublished === true), nativeRuntimeVerified: false },
};
mkdirSync('artifacts/server-staging', { recursive: true });
writeFileSync('artifacts/server-staging/version-readiness.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
