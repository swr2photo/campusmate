import crypto from 'node:crypto';

export const R2_WORKER_MAX_BYTES = 25 * 1024 * 1024;
export const isEncryptedObjectKey = (key) => typeof key === 'string'
  && /^chat_media\/[A-Za-z0-9_-]{1,256}\/[A-Za-z0-9_-]{1,160}\.enc$/.test(key);

export function createR2WorkerUpload({ domain, secret, objectKey, now = Date.now() }) {
  const url = new URL(domain);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Worker delivery domain must be an HTTPS origin');
  }
  if (!isEncryptedObjectKey(objectKey) || typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error('Encrypted object key or signing secret is invalid');
  }
  const payload = Buffer.from(JSON.stringify({
    v: 1, key: objectKey, exp: Math.floor(now / 1000) + 300, maxBytes: R2_WORKER_MAX_BYTES,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret.trim()).update(payload).digest('base64url');
  return {
    success: true,
    provider: 'r2',
    uploadUrl: `${url.origin}/upload/${objectKey}`,
    downloadUrl: `${url.origin}/${objectKey}`,
    objectKey,
    contentType: 'application/octet-stream',
    uploadHeaders: {
      Authorization: `Bearer ${payload}.${signature}`,
      'Content-Type': 'application/octet-stream',
      // PUT capabilities must never be reused by an intermediary cache. The
      // Worker sets immutable cache metadata on the stored ciphertext itself.
      'Cache-Control': 'no-store',
    },
  };
}
