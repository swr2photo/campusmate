export function isRemoteImageUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function isLocalImageUri(url) {
  return typeof url === 'string' && /^(file:\/\/|content:\/\/|data:)/i.test(url);
}

export function rewriteProfileImageUrl(url, deliveryHost) {
  if (!isRemoteImageUrl(url) || !deliveryHost) return url;
  if (/[?&](?:x-amz-signature|signature|sig)=/i.test(url)) return url;
  const host = String(deliveryHost).replace(/^https:\/\//i, '').replace(/\/$/, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev' || !parsed.pathname.startsWith('/users/')) return url;
    parsed.protocol = 'https:';
    parsed.hostname = host;
    parsed.port = '';
    return parsed.toString();
  } catch { return url; }
}

export function getR2AvatarOwnerId(uri, deliveryHost) {
  if (!isRemoteImageUrl(uri)) return null;
  try {
    const parsed = new URL(uri);
    const match = parsed.pathname.match(/^\/users\/([^/]+)\/avatar\.(?:jpe?g|png|webp)$/i);
    if (!match) return null;
    const hostname = parsed.hostname.toLowerCase();
    const configuredHost = String(deliveryHost || '').replace(/^https:\/\//i, '').replace(/\/$/, '').toLowerCase();
    const isStorageHost = hostname.endsWith('.r2.dev') || hostname.endsWith('.workers.dev')
      || hostname.endsWith('.r2.cloudflarestorage.com');
    if (!isStorageHost && (!configuredHost || hostname !== configuredHost)) return null;
    return decodeURIComponent(match[1]);
  } catch { return null; }
}

export function normalizeImageVersion(version) {
  if (version === null || version === undefined || version === '') return 0;
  if (typeof version?.toMillis === 'function') return version.toMillis();
  if (version instanceof Date) return version.getTime();
  if (typeof version === 'object' && Number.isFinite(version.seconds)) {
    return version.seconds * 1000 + Math.floor((version.nanoseconds || 0) / 1e6);
  }
  if (Number.isFinite(Number(version))) return Number(version);
  const parsed = Date.parse(String(version));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function getRemoteImageRequestUrl(url, version) {
  if (!isRemoteImageUrl(url)) return null;
  if (version === null || version === undefined || version === '') return url;
  // Signed URLs must keep the exact query string used by the signer.
  if (/[?&](?:x-amz-signature|signature|sig)=/i.test(url)) return url;
  const [base, fragment] = url.split('#');
  const clean = base.replace(/([?&])cmv=[^&]*(&|$)/g, (_, prefix, suffix) => suffix ? prefix : '').replace(/[?&]$/, '');
  const millis = normalizeImageVersion(version);
  const versioned = millis ? `${clean}${clean.includes('?') ? '&' : '?'}cmv=${encodeURIComponent(String(millis))}` : clean;
  return fragment === undefined ? versioned : `${versioned}#${fragment}`;
}

// Bound the longest side while preserving aspect ratio and never upscale.
export function imageResizeActions(width, height, maxDimension) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  if (Math.max(width, height) <= maxDimension) return [];
  return [{ resize: width >= height ? { width: maxDimension } : { height: maxDimension } }];
}

export function isEncryptedMediaUrl(url) {
  if (typeof url !== 'string') return false;
  try { return /\.enc(?:$|[?&#])/i.test(decodeURIComponent(url)); }
  catch { return /\.enc(?:$|[?&#])/i.test(url); }
}

// Plaintext cached from an encrypted object belongs to the key that opened it.
// This identity is only kept in memory; disk filenames use a SHA-256 digest.
export function getMediaCacheKey(url, mediaType, conversationKey) {
  if (!url) return null;
  if (!isEncryptedMediaUrl(url)) return `${mediaType}:${url}`;
  if (!(conversationKey instanceof Uint8Array) || conversationKey.length !== 32) return null;
  const keyIdentity = Array.from(conversationKey, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${mediaType}:${url}:${keyIdentity}`;
}
