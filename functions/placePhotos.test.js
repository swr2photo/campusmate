import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createPlacePhotoImporter, getPlaceR2Config, placePhotoMetadata, preparePlacePhoto, validatePlacePhotoInput } from './placePhotos.js';

const attribution = { spotId: 'spot-reservoir-heart', credit: 'Wutkh', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Reservoir.jpg', license: 'CC0-1.0', rightsConfirmed: true };
const bytes = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#3285b4' } }).jpeg().toBuffer();

test('image versions are content based, WebP is bounded and has no EXIF', async () => {
  const first = await preparePlacePhoto(bytes, validatePlacePhotoInput(attribution));
  const second = await preparePlacePhoto(bytes, validatePlacePhotoInput({ ...attribution, credit: 'Updated credit' }));
  assert.equal(first.revision, second.revision);
  const metadata = await sharp(first.objects[0].bytes).metadata();
  assert.equal(metadata.width, 1200); assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined);
  assert.equal((await sharp(first.objects[1].bytes).metadata()).width, 320);
  const changed = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).jpeg().toBuffer();
  assert.notEqual((await preparePlacePhoto(changed, validatePlacePhotoInput(attribution))).revision, first.revision);
  assert.match(placePhotoMetadata(first, 'https://photos.example.com').thumbnailUrl, /\/[a-f0-9]{64}-320\.webp$/);
});

test('unlicensed, invalid identifiers, unsafe URLs and malformed bytes are refused', async () => {
  for (const input of [{ ...attribution, rightsConfirmed: false }, { ...attribution, license: 'google-places' },
    { ...attribution, spotId: '../other' }, { ...attribution, sourceUrl: 'https://user:password@example.com' }]) {
    assert.throws(() => validatePlacePhotoInput(input), { code: 'invalid-argument' });
  }
  await assert.rejects(preparePlacePhoto(Buffer.from('not an image'), attribution), { code: 'invalid-argument' });
});

function fixture(failSecondUpload = false) {
  const events = [];
  const ref = { get: async () => ({ exists: true }), update: async (data) => events.push({ write: data }) };
  const run = createPlacePhotoImporter({ db: { collection: () => ({ doc: () => ref }) },
    getConfig: () => ({ bucketName: 'public', publicDomain: 'https://photos.example.com' }),
    putObject: async (_config, object) => { events.push({ upload: object.key }); if (failSecondUpload && events.length === 2) throw new Error('upload unavailable'); },
    serverTimestamp: () => 123 });
  return { events, run };
}

test('only a verified admin may import, and URLs are published after both uploads', async () => {
  const f = fixture();
  const data = { ...attribution, imageBase64: bytes.toString('base64') };
  await assert.rejects(f.run({ data }), { code: 'unauthenticated' });
  await assert.rejects(f.run({ data, auth: { uid: 'user', token: { role: 'admin' } } }), { code: 'permission-denied' });
  assert.equal(f.events.length, 0);
  const result = await f.run({ data, auth: { uid: 'admin', token: { admin: true } } });
  assert.equal(result.placePhoto.credit, 'Wutkh'); assert.ok(f.events[0].upload); assert.ok(f.events[1].upload); assert.ok(f.events[2].write);
  const failed = fixture(true);
  await assert.rejects(failed.run({ data, auth: { uid: 'admin', token: { admin: true } } }));
  assert.equal(failed.events.filter((event) => event.write).length, 0);
});

test('public photos cannot use the private chat bucket or r2.dev', () => {
  const env = { CLOUDFLARE_R2_ACCOUNT_ID: 'account', CLOUDFLARE_R2_ACCESS_KEY_ID: 'key', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret', CAMPUSMATE_PLACE_CDN_DOMAIN: 'https://photos.example.com' };
  assert.equal(getPlaceR2Config(env).bucketName, 'campusmate-public-images');
  assert.throws(() => getPlaceR2Config({ ...env, CAMPUSMATE_PLACE_R2_BUCKET_NAME: 'campusmate-chat-media' }));
  assert.throws(() => getPlaceR2Config({ ...env, CAMPUSMATE_PLACE_CDN_DOMAIN: 'https://pub-example.r2.dev' }));
});
