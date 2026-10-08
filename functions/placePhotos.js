import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { buildR2DownloadUrl, getR2Config, normalizeR2PublicDomain } from './r2Service.js';

export const MAX_PLACE_PHOTO_BYTES = 5 * 1024 * 1024;
export const PLACE_PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const LICENSES = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'owned', 'permission']);

export function validatePlacePhotoInput(input) {
  if (!input || !/^spot-[a-z0-9-]{1,70}$/.test(input.spotId || '')
    || input.rightsConfirmed !== true || !LICENSES.has(input.license)) {
    throw new HttpsError('invalid-argument', 'ระบุสถานที่และสิทธิ์การใช้ภาพให้ครบถ้วน');
  }
  if (typeof input.credit !== 'string' || !input.credit.trim() || input.credit.length > 200
    || typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 2000) {
    throw new HttpsError('invalid-argument', 'ต้องระบุเจ้าของภาพและลิงก์แหล่งที่มา');
  }
  let url;
  try { url = new URL(input.sourceUrl); } catch { /* validated below */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password) {
    throw new HttpsError('invalid-argument', 'แหล่งที่มาต้องเป็นลิงก์ HTTPS');
  }
  return { spotId: input.spotId, credit: input.credit.trim(), sourceUrl: url.href, license: input.license };
}

export function decodePlacePhoto(base64) {
  if (typeof base64 !== 'string' || !base64.length
    || base64.length > 4 * Math.ceil(MAX_PLACE_PHOTO_BYTES / 3)
    || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new HttpsError('invalid-argument', 'ภาพต้องมีขนาดไม่เกิน 5 MB');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_PLACE_PHOTO_BYTES) {
    throw new HttpsError('invalid-argument', 'ภาพต้องมีขนาดไม่เกิน 5 MB');
  }
  return bytes;
}

export async function preparePlacePhoto(bytes, attribution) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_PLACE_PHOTO_BYTES) {
    throw new HttpsError('invalid-argument', 'ภาพต้องมีขนาดไม่เกิน 5 MB');
  }
  const { default: sharp } = await import('sharp');
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning', animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp', 'avif'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('Unsupported image');
    // Re-encoding strips GPS/EXIF and bounds both download size and decoding work.
    const full = await image.rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const thumbnail = await sharp(full).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const revision = createHash('sha256').update(full).update(thumbnail).digest('hex');
    const prefix = `places/${attribution.spotId}/${revision}`;
    return { attribution, revision, objects: [
      { key: `${prefix}.webp`, bytes: full }, { key: `${prefix}-320.webp`, bytes: thumbnail },
    ] };
  } catch {
    throw new HttpsError('invalid-argument', 'อ่านภาพไม่ได้ รองรับ JPEG, PNG, WebP หรือ AVIF ที่ไม่เคลื่อนไหว');
  }
}

export function placePhotoMetadata(prepared, publicDomain) {
  const licenseUrls = { 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/' };
  return {
    ...prepared.attribution,
    licenseUrl: licenseUrls[prepared.attribution.license] || null,
    modifications: 'Resized and converted to WebP',
    url: buildR2DownloadUrl({ publicDomain, objectKey: prepared.objects[0].key }),
    thumbnailUrl: buildR2DownloadUrl({ publicDomain, objectKey: prepared.objects[1].key }),
    revision: prepared.revision,
  };
}

export function getPlaceR2Config(env = process.env) {
  if (!env.CAMPUSMATE_PLACE_CDN_DOMAIN) throw new Error('Configure CAMPUSMATE_PLACE_CDN_DOMAIN');
  const publicDomain = normalizeR2PublicDomain(env.CAMPUSMATE_PLACE_CDN_DOMAIN);
  if (new URL(publicDomain).hostname.endsWith('.r2.dev')) throw new Error('Place photos require a CDN delivery domain');
  const bucketName = env.CAMPUSMATE_PLACE_R2_BUCKET_NAME || 'campusmate-public-images';
  const chatBucket = env.CLOUDFLARE_R2_BUCKET_NAME || env.R2_BUCKET_NAME || 'campusmate-chat-media';
  if (bucketName === chatBucket || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucketName)) throw new Error('Place photos require a separate public bucket');
  return { ...getR2Config(env), bucketName, publicDomain };
}

export function createPlacePhotoImporter({ db, getConfig, putObject, serverTimestamp }) {
  return async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
    if (request.auth.token?.admin !== true) throw new HttpsError('permission-denied', 'เฉพาะผู้ดูแลเท่านั้น');
    const attribution = validatePlacePhotoInput(request.data);
    const bytes = decodePlacePhoto(request.data.imageBase64);
    const ref = db.collection('spots').doc(attribution.spotId);
    if (!(await ref.get()).exists) throw new HttpsError('not-found', 'ไม่พบสถานที่');
    let config;
    try { config = getConfig(); } catch { throw new HttpsError('failed-precondition', 'ระบบภาพสถานที่ยังไม่พร้อม'); }
    const prepared = await preparePlacePhoto(bytes, attribution);
    // Never publish a Firestore URL before both immutable objects are available.
    for (const object of prepared.objects) await putObject(config, { ...object, contentType: 'image/webp', cacheControl: PLACE_PHOTO_CACHE_CONTROL });
    const placePhoto = placePhotoMetadata(prepared, config.publicDomain);
    await ref.update({ placePhoto, updatedAt: serverTimestamp() });
    return { spotId: attribution.spotId, placePhoto };
  };
}
