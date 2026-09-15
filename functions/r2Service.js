import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_R2_CONFIG = {
  accountId: '3dd0f976f772d6bfb28fc82710a63a9c',
  bucketName: 'campusmate-chat-media',
  publicDomain: 'https://pub-50c04ae03d1b4222b7402a2b1ff02c62.r2.dev',
  accessKeyId: 'a7ea683e10b2624dc9c332f1673cb15b',
  secretAccessKey: 'ab778d400bf591fd2765651d4de7ccaa09ccdca827b74aa3d2f1ecf1c6188d2e',
};

export function isR2Configured(env = process.env) {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID || (env === process.env ? DEFAULT_R2_CONFIG.accountId : '');
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || (env === process.env ? DEFAULT_R2_CONFIG.accessKeyId : '');
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || (env === process.env ? DEFAULT_R2_CONFIG.secretAccessKey : '');
  return Boolean(accountId && accessKeyId && secretAccessKey);
}

export function getR2Config(env = process.env) {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID || DEFAULT_R2_CONFIG.accountId;
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || DEFAULT_R2_CONFIG.accessKeyId;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || DEFAULT_R2_CONFIG.secretAccessKey;
  const bucketName = env.CLOUDFLARE_R2_BUCKET_NAME || env.R2_BUCKET_NAME || DEFAULT_R2_CONFIG.bucketName;
  const publicDomain = (env.CLOUDFLARE_R2_PUBLIC_DOMAIN || env.R2_PUBLIC_DOMAIN || DEFAULT_R2_CONFIG.publicDomain).replace(/\/$/, '');

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicDomain,
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

export async function generateR2UploadPresignedUrl(s3Client, { bucket, key, contentType, metadata = {}, expiresIn = 300 }) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    Metadata: metadata,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export function buildR2DownloadUrl({ publicDomain, bucketName, accountId, objectKey }) {
  if (publicDomain) {
    const cleanDomain = publicDomain.replace(/\/$/, '');
    return `${cleanDomain}/${objectKey}`;
  }
  return `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${objectKey}`;
}
