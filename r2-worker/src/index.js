const MAX_BYTES = 25 * 1024 * 1024;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const validKey = (key) => /^chat_media\/[A-Za-z0-9_-]{1,256}\/[A-Za-z0-9_-]{1,160}\.enc$/.test(key);
const errorResponse = (status, message) => new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), (char) => char.charCodeAt(0));
}

async function verifyTicket(token, objectKey, secret, action, now = Date.now()) {
  try {
    if (!secret || !token || token.length > 2048 || !validKey(objectKey)) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', hmac, decodeBase64Url(parts[1]), new TextEncoder().encode(parts[0]))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const seconds = Math.floor(now / 1000);
    const common = claims.v === 1 && claims.key === objectKey && Number.isInteger(claims.exp)
      && claims.exp > seconds && claims.exp <= seconds + 300
    return common && (action === 'delete' ? claims.action === 'delete' : !claims.action
      && Number.isInteger(claims.maxBytes) && claims.maxBytes > 0 && claims.maxBytes <= MAX_BYTES) ? claims : null;
  } catch { return null; }
}
export const verifyUploadTicket = (token, key, secret, now) => verifyTicket(token, key, secret, 'upload', now);
export const verifyDeleteTicket = (token, key, secret, now) => verifyTicket(token, key, secret, 'delete', now);
const blockedKey = key => 'moderation_blocks/' + key;
async function removeMedia(request, env, key, cache) {
  if (request.method !== 'DELETE') return errorResponse(405, 'DELETE required');
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!await verifyDeleteTicket(token, key, env.R2_UPLOAD_SIGNING_KEY)) return errorResponse(403, 'Invalid moderation permission');
  // Check this durable marker before every cached read and upload, across all locations.
  await env.MEDIA.put(blockedKey(key), new Uint8Array([1]));
  await env.MEDIA.delete(key);
  const url = new URL(request.url); url.pathname = '/' + key; url.search = '';
  await cache?.delete(new Request(url, { method: 'GET' }));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

async function readLimited(body, maximum) {
  if (!body) throw new Error('EMPTY_BODY');
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error('TOO_LARGE');
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return buffer;
}

async function upload(request, env, objectKey) {
  if (request.method !== 'PUT') return errorResponse(405, 'PUT required');
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  const ticket = await verifyUploadTicket(token, objectKey, env.R2_UPLOAD_SIGNING_KEY);
  if (!ticket) return errorResponse(403, 'Upload permission is invalid or expired');
  if (await env.MEDIA.head(blockedKey(objectKey))) return errorResponse(410, 'Media removed by moderator');
  if (request.headers.get('Content-Type') !== 'application/octet-stream') return errorResponse(415, 'Encrypted bytes required');
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > ticket.maxBytes)) return errorResponse(413, 'File exceeds upload limit');
  let data;
  try { data = await readLimited(request.body, ticket.maxBytes); }
  catch { return errorResponse(413, 'File exceeds upload limit or is incomplete'); }
  if (data.byteLength < 28 || (declared && Number(declared) !== data.byteLength)) return errorResponse(400, 'Invalid encrypted file length');
  const stored = await env.MEDIA.put(objectKey, data, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/octet-stream', cacheControl: CACHE_CONTROL },
  });
  if (await env.MEDIA.head(blockedKey(objectKey))) {
    await env.MEDIA.delete(objectKey);
    return errorResponse(410, 'Media removed by moderator');
  }
  // Never overwrite an immutable URL, even if an upload ticket is reused.
  return stored ? new Response(null, { status: 201, headers: { ETag: stored.httpEtag, 'Cache-Control': 'no-store' } })
    : errorResponse(409, 'Object already exists; request a new upload');
}

async function download(request, env, ctx, objectKey, cache) {
  if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(405, 'GET or HEAD required');
  if (await env.MEDIA.head(blockedKey(objectKey))) return errorResponse(404, 'Not found');
  const url = new URL(request.url);
  url.search = '';
  const cacheKey = new Request(url, { method: 'GET' });
  const lookup = new Request(url, { method: 'GET', headers: request.headers });
  const hit = await cache?.match(lookup);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('X-CampusMate-Cache', 'HIT');
    return new Response(request.method === 'HEAD' ? null : hit.body, { status: hit.status, headers });
  }
  const object = request.method === 'HEAD' ? await env.MEDIA.head(objectKey)
    : await env.MEDIA.get(objectKey, { onlyIf: request.headers, range: request.headers });
  if (!object) return errorResponse(404, 'Not found');
  // This route can never expose old plaintext files or unrelated bucket paths.
  if (object.httpMetadata?.contentType !== 'application/octet-stream') return errorResponse(404, 'Not found');
  const headers = new Headers({ 'Content-Type': 'application/octet-stream', 'Cache-Control': CACHE_CONTROL,
    'X-CampusMate-Revision': '20261005-admin',
    ETag: object.httpEtag, 'Last-Modified': object.uploaded.toUTCString(), 'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes', 'X-CampusMate-Cache': 'MISS' });
  if (request.method === 'GET' && !('body' in object)) return new Response(null, { status: 304, headers });
  let status = 200;
  if (request.headers.has('Range') && object.range) {
    const offset = object.range.offset ?? Math.max(0, object.size - object.range.suffix);
    const length = object.range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else headers.set('Content-Length', String(object.size));
  const response = new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
  if (cache && request.method === 'GET' && status === 200) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => console.warn('media_cache_write_failed')));
  }
  return response;
}

export async function handleMedia(request, env, ctx, cache = globalThis.caches?.default) {
  const url = new URL(request.url);
  const origins = new Set((env.ALLOWED_ORIGINS || '').split(',').filter(Boolean));
  const origin = request.headers.get('Origin');
  if (origin && !origins.has(origin)) return errorResponse(403, 'Origin not allowed');
  const uploadRoute = url.pathname.startsWith('/upload/');
  const moderationRoute = url.pathname.startsWith('/moderate/');
  const objectKey = uploadRoute ? url.pathname.slice(8) : moderationRoute ? url.pathname.slice(10) : url.pathname.slice(1);
  if (!validKey(objectKey)) return errorResponse(404, 'Not found');
  let response;
  try {
    if (request.method === 'OPTIONS') response = new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Methods': uploadRoute ? 'PUT, OPTIONS' : moderationRoute ? 'DELETE, OPTIONS' : 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Cache-Control, Range, If-None-Match',
      'Access-Control-Max-Age': '3600', 'Cache-Control': 'no-store',
    } });
    else response = moderationRoute ? await removeMedia(request, env, objectKey, cache)
      : uploadRoute ? await upload(request, env, objectKey) : await download(request, env, ctx, objectKey, cache);
  } catch {
    console.error('media_request_failed');
    response = errorResponse(503, 'Media temporarily unavailable');
  }
  if (origin) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'ETag, Content-Length, X-CampusMate-Cache');
    headers.append('Vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}

export default { fetch: handleMedia };
