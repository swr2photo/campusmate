import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isR2Configured,
  getR2Config,
  generateR2ObjectKey,
  buildR2DownloadUrl,
  createR2S3Client,
  generateR2UploadPresignedUrl,
  getChatMediaCacheControl,
  ENCRYPTED_MEDIA_CACHE_CONTROL,
  LEGACY_MEDIA_CACHE_CONTROL,
  getR2SecretNames,
} from './r2Service.js';

test('isR2Configured returns false when missing credentials', () => {
  assert.equal(isR2Configured({}), false);
  assert.equal(isR2Configured({ R2_ACCOUNT_ID: 'abc' }), false);
});

test('Firebase secret bindings are opt-in until both R2 secrets are provisioned', () => {
  assert.deepEqual(getR2SecretNames({}), []);
  assert.deepEqual(getR2SecretNames({ CAMPUSMATE_R2_SECRETS_ENABLED: 'false' }), []);
  assert.deepEqual(getR2SecretNames({ CAMPUSMATE_R2_SECRETS_ENABLED: 'true' }),
    ['CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY']);
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

test('buildR2DownloadUrl uses the public delivery host and encodes object paths', () => {
  const customUrl = buildR2DownloadUrl({
    publicDomain: 'https://cdn.campusmate.app',
    bucketName: 'campusmate-chat-media',
    accountId: 'acc123',
    objectKey: 'chat_media/123/sample.jpg',
  });
  assert.equal(customUrl, 'https://cdn.campusmate.app/chat_media/123/sample.jpg');

  assert.equal(buildR2DownloadUrl({
    publicDomain: 'https://cdn.campusmate.app/',
    objectKey: 'chat_media/123/a b#c.enc',
  }), 'https://cdn.campusmate.app/chat_media/123/a%20b%23c.enc');
});

test('public downloads reject the authenticated S3 endpoint and insecure URL configurations', () => {
  for (const publicDomain of ['', 'http://cdn.example.test', 'https://user:pass@cdn.example.test',
    'https://cdn.example.test?token=secret', 'https://account.r2.cloudflarestorage.com']) {
    assert.throws(() => buildR2DownloadUrl({ publicDomain, objectKey: 'chat_media/123/a.enc' }));
  }
});

test('CDN domain takes precedence and development delivery is identifiable', () => {
  const credentials = { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' };
  const customConfig = getR2Config({ ...credentials,
    R2_PUBLIC_DOMAIN: 'https://pub-existing.r2.dev',
    CLOUDFLARE_R2_CDN_DOMAIN: 'https://media.example.test/',
  });
  assert.equal(customConfig.publicDomain, 'https://media.example.test');
  assert.equal(customConfig.deliveryMode, 'cdn');
  assert.equal(getR2Config(credentials).deliveryMode, 'development');
});

test('shared immutable cache is limited to encrypted bytes', () => {
  assert.equal(getChatMediaCacheControl({ contentType: 'application/octet-stream', extension: 'enc' }),
    ENCRYPTED_MEDIA_CACHE_CONTROL);
  for (const media of [{ contentType: 'image/jpeg', extension: 'jpg' },
    { contentType: 'image/jpeg', extension: 'enc' },
    { contentType: 'application/octet-stream', extension: 'jpg' }]) {
    assert.equal(getChatMediaCacheControl(media), LEGACY_MEDIA_CACHE_CONTROL);
  }
});

test('v2 PUT signature requires the exact cache metadata while v1 remains compatible', async () => {
  const client = createR2S3Client({ accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret' });
  try {
    const params = { bucket: 'chat', key: 'chat_media/room/immutable.enc', contentType: 'application/octet-stream' };
    const v2 = new URL(await generateR2UploadPresignedUrl(client, { ...params,
      cacheControl: ENCRYPTED_MEDIA_CACHE_CONTROL,
    }));
    assert.equal(v2.searchParams.get('X-Amz-SignedHeaders'), 'cache-control;content-type;host');
    assert.equal(v2.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(v2.hostname, 'chat.account.r2.cloudflarestorage.com');
    const v1 = new URL(await generateR2UploadPresignedUrl(client, params));
    assert.equal(v1.searchParams.get('X-Amz-SignedHeaders').includes('cache-control'), false);
  } finally {
    client.destroy();
  }
});
