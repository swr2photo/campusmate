import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { MAX_PLACE_PHOTO_BYTES, preparePlacePhoto, placePhotoMetadata, validatePlacePhotoInput } from '../functions/placePhotos.js';

const req = createRequire(new URL('../functions/package.json', import.meta.url));
const sharp = req('sharp');

const args = process.argv.slice(2);
if (args.some((argument) => !['--prepare', '--upload', '--publish'].includes(argument)) || args.length !== 1) {
  throw new Error('Usage: node scripts/import-place-photos.mjs --prepare|--upload|--publish');
}
const domain = process.env.CAMPUSMATE_PLACE_CDN_DOMAIN || 'https://photos.getcampusmate.app';
const folder = resolve('artifacts/place-photos');
const manifest = JSON.parse(await readFile('assets/places/manifest.json', 'utf8'));

if (args[0] === '--prepare') {
  await mkdir(folder, { recursive: true });
  const ready = [];
  for (const entry of manifest) {
    const attribution = validatePlacePhotoInput(entry);
    let rawBuffer;
    if (entry.localFile) {
      rawBuffer = await readFile(resolve(entry.localFile));
    } else {
      const url = new URL(entry.downloadUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Expected a public HTTPS photo source');
      const response = await fetch(url, {
        headers: { 'User-Agent': 'CampusMate-place-photos/1.0 (https://getcampusmate.app; admin@getcampusmate.app)' },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`Source HTTP ${response.status} for ${entry.spotId}: ${entry.downloadUrl}`);
      const chunks = [];
      for await (const chunk of response.body) {
        chunks.push(chunk);
      }
      rawBuffer = Buffer.concat(chunks);
    }

    if (rawBuffer.length > MAX_PLACE_PHOTO_BYTES) {
      console.log(`Pre-compressing ${entry.spotId} (${(rawBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);
      rawBuffer = await sharp(rawBuffer)
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    }

    const prepared = await preparePlacePhoto(rawBuffer, attribution);
    for (const object of prepared.objects) {
      const file = resolve(folder, object.key.split('/').at(-1));
      await writeFile(file, object.bytes);
      console.log(JSON.stringify({ spotId: entry.spotId, bucket: 'campusmate-public-images', key: object.key, file, bytes: object.bytes.length }));
    }
    ready.push(placePhotoMetadata(prepared, domain));
  }
  await writeFile(resolve(folder, 'ready.json'), JSON.stringify(ready, null, 2));
  console.log(`Successfully prepared ${ready.length} place photos in ${folder}`);
} else if (args[0] === '--upload') {
  const ready = JSON.parse(await readFile(resolve(folder, 'ready.json'), 'utf8'));
  console.log(`Uploading ${ready.length} place photos to R2...`);
  for (const photo of ready) {
    for (const fileUrl of [photo.url, photo.thumbnailUrl]) {
      const key = new URL(fileUrl).pathname.replace(/^\//, '');
      const fileName = key.split('/').at(-1);
      const filePath = resolve(folder, fileName);

      try {
        const check = await fetch(fileUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (check.ok && check.headers.get('Content-Type')?.startsWith('image/webp')) {
          console.log(`Already uploaded: ${key}`);
          continue;
        }
      } catch { /* proceed to upload */ }

      execSync(`npx wrangler r2 object put "campusmate-public-images/${key}" --file "${filePath}" --content-type image/webp --remote`, {
        stdio: 'inherit',
      });
    }
  }
  console.log('Upload complete.');
} else {
  const ready = JSON.parse(await readFile(resolve(folder, 'ready.json'), 'utf8'));
  console.log(`Verifying ${ready.length} place photos on CDN...`);
  for (const photo of ready) for (const url of [photo.url, photo.thumbnailUrl]) {
    if (new URL(url).origin !== new URL(domain).origin) throw new Error('Prepared domain differs from delivery domain');
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/webp')
      || !response.headers.get('Cache-Control')?.includes('immutable')) {
      throw new Error(`Photo upload/CDN is not ready for ${url} (status: ${response.status})`);
    }
  }
  console.log('All CDN URLs verified. Publishing to Firestore...');

  initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'campusmate-7f1ab' });
  const db = getFirestore();

  for (const legacyId of ['s1', 's2', 's3', 's4']) {
    const legacyRef = db.collection('spots').doc(legacyId);
    const doc = await legacyRef.get();
    if (doc.exists) {
      await legacyRef.delete();
      console.log(`Deleted legacy spot document: ${legacyId}`);
    }
  }

  const code = await readFile('src/data/campusSpots.js', 'utf8');
  const { CAMPUS_SPOTS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

  for (const photo of ready) {
    const ref = db.collection('spots').doc(photo.spotId);
    const existing = await ref.get();
    const spot = CAMPUS_SPOTS.find((entry) => entry.id === photo.spotId);
    if (!spot) throw new Error(`Unknown curated place: ${photo.spotId}`);

    if (!existing.exists) {
      await ref.create({ ...spot, placePhoto: photo, updatedAt: FieldValue.serverTimestamp() });
      console.log(JSON.stringify({ created: photo.spotId, revision: photo.revision }));
    } else {
      await ref.update({ ...spot, placePhoto: photo, updatedAt: FieldValue.serverTimestamp() });
      console.log(JSON.stringify({ updated: photo.spotId, revision: photo.revision }));
    }
  }
  console.log(`Successfully published all ${ready.length} place photos to Firestore!`);
}
