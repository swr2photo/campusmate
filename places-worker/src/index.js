const VALID_PATH = /^\/places\/spot-[a-z0-9-]{1,70}\/[a-f0-9]{64}(?:-320)?\.webp$/;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function servePlacePhoto(request, env, ctx, cache = caches.default) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  if (!VALID_PATH.test(url.pathname)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  // Ignore tracking queries: immutable object identity is the content hash.
  url.search = '';
  const cacheKey = new Request(url.href, { method: 'GET' });
  let response = await cache.match(cacheKey);
  const cacheStatus = response ? 'HIT' : 'MISS';
  if (!response) {
    const object = await env.PLACE_PHOTOS.get(url.pathname.slice(1));
    if (!object || !('body' in object)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const headers = new Headers({ 'Content-Type': 'image/webp', 'Cache-Control': CACHE_CONTROL,
      'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', ETag: object.httpEtag });
    headers.set('Content-Length', String(object.size));
    response = new Response(object.body, { headers });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  const headers = new Headers(response.headers);
  headers.set('X-CampusMate-Cache', cacheStatus);
  if (request.headers.get('If-None-Match')?.split(',').map((value) => value.trim()).includes(response.headers.get('ETag'))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : response.body, { headers });
}

export default { fetch: servePlacePhoto };
