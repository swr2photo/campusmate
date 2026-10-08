import https from 'node:https';
import { Readable } from 'node:stream';

// Diagnostic resolver for networks that retain stale negative DNS. TLS still
// verifies the certificate and SNI against the original hostname.
const addresses = new Map();
export async function mediaProbeFetch(input, options = {}) {
  const url = new URL(input);
  if (process.env.CAMPUSMATE_PROBE_DOH !== 'true') return fetch(url, options);
  if (url.protocol !== 'https:' || !['images.getcampusmate.app', 'media.getcampusmate.app'].includes(url.hostname)) throw new Error('Diagnostic resolver is limited to CampusMate media domains');
  if (!addresses.has(url.hostname)) {
    const response = await fetch(`https://dns.google/resolve?name=${url.hostname}&type=A`, { signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    const address = result.Answer?.find((answer) => answer.type === 1)?.data;
    if (result.Status !== 0 || !address) throw new Error('Public DNS resolution failed');
    addresses.set(url.hostname, address);
  }
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: options.method || 'GET', headers: options.headers,
      signal: options.signal, lookup: (_hostname, lookupOptions, callback) => {
        const address = addresses.get(url.hostname);
        callback(null, lookupOptions.all ? [{ address, family: 4 }] : address, lookupOptions.all ? undefined : 4);
      } }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      const empty = options.method === 'HEAD' || [204, 304].includes(incoming.statusCode);
      resolve(new Response(empty ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers }));
      if (empty) incoming.resume();
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
