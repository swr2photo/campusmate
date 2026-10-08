import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileGalleryUploader, MAX_GALLERY_IMAGE_BYTES, profileGalleryPrefix } from './profileGallery.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const allowed = { status: 'allowed', isSafe: true, policyVersion: 2 };
const request = (imageBase64 = jpeg) => ({ auth: { uid: 'owner' }, data: { imageBase64, userId: 'another-user' } });

function fixture(moderation = async () => allowed) {
  const writes = [];
  let checks = 0;
  let ids = 0;
  const upload = createProfileGalleryUploader({
    getBucket: () => ({ name: 'test-bucket', file: (key) => ({ save: async (bytes, options) => writes.push({ key, bytes, options }) }) }),
    moderate: async (image) => { checks++; return moderation(image); },
    makeId: () => `image-${++ids}`,
  });
  return { upload, writes, checks: () => checks };
}

test('gallery upload requires authentication before processing images', async () => {
  const f = fixture();
  await assert.rejects(f.upload({ data: { imageBase64: jpeg } }), { code: 'unauthenticated' });
  assert.equal(f.checks(), 0);
  assert.equal(f.writes.length, 0);
});

test('gallery upload rejects malformed, non-JPEG and oversized images before moderation', async () => {
  const f = fixture();
  const oversized = Buffer.alloc(MAX_GALLERY_IMAGE_BYTES + 1, 0xff);
  oversized[1] = 0xd8;
  for (const input of [null, '', '!!!!', 'abc', 'hello world', Buffer.from('PNG').toString('base64'), oversized.toString('base64')]) {
    await assert.rejects(f.upload(request(input)), { code: 'invalid-argument' });
  }
  assert.equal(f.checks(), 0);
  assert.equal(f.writes.length, 0);
});

test('blocked images preserve moderation details and never reach storage', async () => {
  const f = fixture(async () => ({ status: 'blocked', isSafe: false, reason: 'adult' }));
  await assert.rejects(f.upload(request()), (error) => error.code === 'failed-precondition'
    && error.details.moderationStatus === 'blocked' && error.details.reason === 'adult');
  assert.equal(f.writes.length, 0);
});

test('unavailable or outdated moderation never permits uploads', async () => {
  for (const result of [undefined, { status: 'unavailable' }, { ...allowed, policyVersion: 1 }, { ...allowed, isSafe: false }]) {
    const f = fixture(async () => result);
    await assert.rejects(f.upload(request()), (error) => error.code === 'unavailable' && error.details.moderationStatus === 'unavailable');
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(async () => { throw new Error('Vision unavailable'); });
  await assert.rejects(f.upload(request()), { code: 'unavailable' });
  assert.equal(f.writes.length, 0);
});

test('allowed uploads use the authenticated UID and unique gallery objects', async () => {
  const f = fixture();
  const first = await f.upload(request());
  const second = await f.upload(request());
  assert.equal(first.userId, 'owner');
  assert.deepEqual(f.writes.map((write) => write.key), ['profile_gallery/owner/image-1.jpg', 'profile_gallery/owner/image-2.jpg']);
  assert.notEqual(first.url, second.url);
  const url = new URL(first.url);
  assert.equal(url.hostname, 'firebasestorage.googleapis.com');
  assert.equal(decodeURIComponent(url.pathname), '/v0/b/test-bucket/o/profile_gallery/owner/image-1.jpg');
  assert.equal(url.searchParams.get('token'), f.writes[0].options.metadata.metadata.firebaseStorageDownloadTokens);
  assert.equal(f.writes[0].options.metadata.metadata.uploadedBy, 'owner');
  assert.equal(f.writes[0].options.metadata.contentType, 'image/jpeg');
  assert.deepEqual(f.writes[0].bytes, Buffer.from(jpeg, 'base64'));
});

test('gallery prefix isolates UIDs containing path separators', () => {
  assert.equal(profileGalleryPrefix('a/b'), 'profile_gallery/a%2Fb/');
});
