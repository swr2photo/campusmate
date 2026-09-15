import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isR2Configured,
  getR2Config,
  generateR2ObjectKey,
  buildR2DownloadUrl,
} from './r2Service.js';

test('isR2Configured returns false when missing credentials', () => {
  assert.equal(isR2Configured({}), false);
  assert.equal(isR2Configured({ R2_ACCOUNT_ID: 'abc' }), false);
});

test('isR2Configured returns true when credentials present', () => {
  assert.equal(
    isR2Configured({
      CLOUDFLARE_R2_ACCOUNT_ID: 'acc123',
      CLOUDFLARE_R2_ACCESS_KEY_ID: 'key123',
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'sec123',
    }),
    true
  );

  assert.equal(
    isR2Configured({
      R2_ACCOUNT_ID: 'acc123',
      R2_ACCESS_KEY_ID: 'key123',
      R2_SECRET_ACCESS_KEY: 'sec123',
    }),
    true
  );
});

test('getR2Config extracts values with defaults', () => {
  const config = getR2Config({
    R2_ACCOUNT_ID: 'my-acc',
    R2_ACCESS_KEY_ID: 'my-key',
    R2_SECRET_ACCESS_KEY: 'my-secret',
    R2_PUBLIC_DOMAIN: 'https://media.campusmate.app/',
  });

  assert.equal(config.accountId, 'my-acc');
  assert.equal(config.accessKeyId, 'my-key');
  assert.equal(config.secretAccessKey, 'my-secret');
  assert.equal(config.bucketName, 'campusmate-chat-media');
  assert.equal(config.publicDomain, 'https://media.campusmate.app');
});

test('generateR2ObjectKey creates unguessable path with conversationId', () => {
  const imageKey = generateR2ObjectKey({ conversationId: 'conv_999', mediaType: 'image' });
  assert.match(imageKey, /^chat_media\/conv_999\/\d+_[0-9a-f-]+\.jpg$/);

  const audioKey = generateR2ObjectKey({ conversationId: 'conv_abc', mediaType: 'audio', extension: 'm4a' });
  assert.match(audioKey, /^chat_media\/conv_abc\/\d+_[0-9a-f-]+\.m4a$/);

  const encKey = generateR2ObjectKey({ conversationId: 'conv_xyz', extension: 'enc' });
  assert.match(encKey, /^chat_media\/conv_xyz\/\d+_[0-9a-f-]+\.enc$/);
});

test('buildR2DownloadUrl formats URL correctly with public domain or fallback', () => {
  const customUrl = buildR2DownloadUrl({
    publicDomain: 'https://cdn.campusmate.app',
    bucketName: 'campusmate-chat-media',
    accountId: 'acc123',
    objectKey: 'chat_media/123/sample.jpg',
  });
  assert.equal(customUrl, 'https://cdn.campusmate.app/chat_media/123/sample.jpg');

  const fallbackUrl = buildR2DownloadUrl({
    publicDomain: '',
    bucketName: 'chat-media',
    accountId: 'acc123',
    objectKey: 'chat_media/123/sample.m4a',
  });
  assert.equal(fallbackUrl, 'https://chat-media.acc123.r2.cloudflarestorage.com/chat_media/123/sample.m4a');
});
