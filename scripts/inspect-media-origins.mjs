#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const projectId = process.argv[2];
if (!projectId) throw new Error('Usage: node scripts/inspect-media-origins.mjs <firebase-project-id>');
const app = initializeApp({ credential: applicationDefault(), projectId });
const snapshot = await getFirestore(app).collection('profiles').limit(25).get();
const origins = new Map();
let probeUrl;
for (const document of snapshot.docs) {
  const data = document.data();
  const urls = [data.avatarUri, data.photoURL, data.photoUrl, data.avatarUrl, ...(Array.isArray(data.photos) ? data.photos : [])];
  for (const value of new Set(urls.filter((entry) => typeof entry === 'string'))) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') {
        origins.set(url.hostname, (origins.get(url.hostname) || 0) + 1);
        if (!probeUrl && url.hostname.endsWith('.r2.dev')) probeUrl = url.toString();
      }
    } catch { /* Local images are excluded. */ }
  }
}
// Keep profile IDs, names, image paths and signed query strings out of output.
console.log(JSON.stringify({ profilesRead: snapshot.size, origins: Object.fromEntries(origins) }, null, 2));
await deleteApp(app);
if (process.argv.includes('--probe') && probeUrl) {
  const domainIndex = process.argv.indexOf('--delivery-domain');
  if (domainIndex !== -1) {
    const domain = new URL(process.argv[domainIndex + 1]);
    if (domain.protocol !== 'https:' || domain.hostname !== 'images.getcampusmate.app') throw new Error('Unexpected delivery domain');
    const original = new URL(probeUrl);
    if (original.hostname !== 'pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev') throw new Error('Unexpected source bucket');
    original.hostname = domain.hostname;
    probeUrl = original.toString();
  }
  process.argv[2] = probeUrl;
  await import('./check-r2-delivery.mjs');
}
