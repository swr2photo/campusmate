import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const configPath = process.env.FLY_SMOKE_CONFIG;
if (!configPath) throw new Error('FLY_SMOKE_CONFIG is required');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const origin = 'http://127.0.0.1:4177';
const cookie = randomBytes(32).toString('hex');
const dist = resolve(root, 'dist');

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.headers.host !== '127.0.0.1:4177') return reply(res, 403, { error: 'HOST_FORBIDDEN' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  if (!req.url.startsWith('/api/')) {
    if (req.url === '/') res.setHeader('Set-Cookie', `smoke=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
    try {
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(dist + sep)) return reply(res, 403, { error: 'PATH_FORBIDDEN' });
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      return res.end(await readFile(file));
    } catch { return reply(res, 404, { error: 'NOT_FOUND' }); }
  }
  const actualCookie = (req.headers.cookie || '').split('; ').find(item => item.startsWith('smoke='))?.slice(6) || '';
  if (actualCookie.length !== cookie.length || !timingSafeEqual(Buffer.from(actualCookie), Buffer.from(cookie))) return reply(res, 403, { error: 'SESSION_REQUIRED' });
  if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reply(res, 403, { error: 'ORIGIN_FORBIDDEN' });
  const route = { '/api/create': '/session', '/api/complete': '/complete', '/api/cancel': '/cancel', '/api/check': '/check' }[req.url];
  if (!route) return reply(res, 404, { error: 'NOT_FOUND' });
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 1024) return reply(res, 413, { error: 'REQUEST_TOO_LARGE' }); }
    const options = JSON.parse(body || '{}');
    if (route === '/session' && options.consent !== true) return reply(res, 400, { error: 'CONSENT_REQUIRED' });
    const response = await fetch(`http://127.0.0.1:4178${route}`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(options), signal: AbortSignal.timeout(60000),
    });
    const result = await response.json();
    if (response.ok && (route === '/complete' || route === '/check')) {
      await writeFile(config.evidencePath, JSON.stringify(result, null, 2) + '\n');
    }
    reply(res, response.status, result);
  } catch { reply(res, 502, { error: 'FLY_PROBE_UNAVAILABLE' }); }
});
server.listen(4177, '127.0.0.1', () => console.log(`Liveness test ready: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); });
