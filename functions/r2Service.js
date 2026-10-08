import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_R2_CONFIG = {
  bucketName: 'campusmate-chat-media',
  publicDomain: 'https://pub-50c04ae03d1b4222b7402a2b1ff02c62.r2.dev',
};

export const ENCRYPTED_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const LEGACY_MEDIA_CACHE_CONTROL = 'private, max-age=86400, immutable';

export function getR2SecretNames(env = process.env) {
  // Enable only after the deployment operator creates both secrets. Defining
  // them unconditionally would make existing Firebase-only deployments fail.
  const names = env.CAMPUSMATE_R2_SECRETS_ENABLED === 'true'
    ? ['CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY']
    : [];
  if (env.CAMPUSMATE_R2_WORKER_ENABLED === 'true') names.push('R2_UPLOAD_SIGNING_KEY');
  return names;
}

// Only ciphertext may be shared by the CDN. The UUID object key is immutable,
// while plaintext from older clients stays in each client's private cache.
export function getChatMediaCacheControl({ contentType, extension } = {}) {
  return contentType === 'application/octet-stream' && extension === 'enc'
    ? ENCRYPTED_MEDIA_CACHE_CONTROL
    : LEGACY_MEDIA_CACHE_CONTROL;
}

export function normalizeR2PublicDomain(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('R2 download domain must be a public HTTPS delivery endpoint');
  }
  return url.toString().replace(/\/$/, '');
}

export function isR2Configured(env = process.env) {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID;
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  return Boolean(accountId && accessKeyId && secretAccessKey);
}

export function getR2Config(env = process.env) {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID;
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are not configured');
  }
  const bucketName = env.CLOUDFLARE_R2_BUCKET_NAME || env.R2_BUCKET_NAME || DEFAULT_R2_CONFIG.bucketName;
  const publicDomain = normalizeR2PublicDomain(env.CLOUDFLARE_R2_CDN_DOMAIN || env.R2_CDN_DOMAIN
    || env.CLOUDFLARE_R2_PUBLIC_DOMAIN || env.R2_PUBLIC_DOMAIN || DEFAULT_R2_CONFIG.publicDomain);

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicDomain,
    deliveryMode: new URL(publicDomain).hostname.endsWith('.r2.dev') ? 'development' : 'cdn',
  };
}

export function generateR2ObjectKey({ conversationId, mediaType = 'image', extension }) {
  const ext = extension || (mediaType === 'audio' ? 'm4a' : (mediaType === 'enc' ? 'enc' : 'jpg'));
  const randomSuffix = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return `chat_media/${conversationId}/${Date.now()}_${randomSuffix}.${ext}`;
}

export function createR2S3Client(config) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

let cachedR2Client = null;
let cachedR2Credentials = null;

export function getR2S3Client(config) {
  if (cachedR2Client
    && cachedR2Credentials.accountId === config.accountId
    && cachedR2Credentials.accessKeyId === config.accessKeyId
    && cachedR2Credentials.secretAccessKey === config.secretAccessKey) {
    return cachedR2Client;
  }

  cachedR2Client?.destroy();
  cachedR2Client = createR2S3Client(config);
  cachedR2Credentials = {
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  return cachedR2Client;
}

export async function generateR2UploadPresignedUrl(s3Client, {
  bucket,
  key,
  contentType,
  cacheControl,
  // Metadata is intentionally omitted from the signed PUT. Including it forces
  // clients to send matching x-amz-meta-* headers; Expo FileSystem.uploadAsync
  // only sends Content-Type, which otherwise produces 403 and a slow Firebase fallback.
  expiresIn = 300,
} = {}) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
  });

  // v1 callers send only Content-Type. v2 callers receive uploadHeaders and
  // send the exact signed cache metadata, preventing changes to cache policy.
  return getSignedUrl(s3Client, command, {
    expiresIn,
    ...(cacheControl ? { signableHeaders: new Set(['content-type', 'cache-control']) } : {}),
  });
}

export function buildR2DownloadUrl({ publicDomain, objectKey }) {
  // The S3 endpoint requires authentication and cannot be a public-download
  // fallback. Keep upload signing on S3 and downloads on the delivery host.
  const cleanDomain = normalizeR2PublicDomain(publicDomain);
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  return `${cleanDomain}/${encodedKey}`;
}
