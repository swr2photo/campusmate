#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { mediaProbeFetch } from './media-probe-fetch.mjs';

// Never print an object path or signed query: either can identify private media.
const input = process.argv[2] || process.env.CAMPUSMATE_MEDIA_PROBE_URL;
if (!input) {
  console.error('Usage: node scripts/check-r2-delivery.mjs <https-media-url>');
  process.exit(1);
}
let url;
try {
  url = new URL(input);
  if (url.protocol !== 'https:') throw new Error('HTTPS required');
} catch {
  console.error('A valid HTTPS media URL is required.');
  process.exit(1);
}

const samples = [];
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const started = performance.now();
  try {
    const response = await mediaProbeFetch(url, { signal: AbortSignal.timeout(20000) });
    const headersReceived = performance.now();
    let bytes = 0;
    for await (const chunk of response.body || []) {
      bytes += chunk.byteLength;
      if (bytes > 12 * 1024 * 1024) {
        throw new Error('Probe limited to media smaller than 12 MiB');
      }
    }
    samples.push({
      attempt,
      status: response.status,
      ttfbMs: Math.round(headersReceived - started),
      totalMs: Math.round(performance.now() - started),
      bytes,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      cacheStatus: response.headers.get('cf-cache-status'),
      workerCacheStatus: response.headers.get('x-campusmate-cache'),
      ageSeconds: response.headers.get('age'),
      hasEtag: Boolean(response.headers.get('etag')),
      edge: response.headers.get('cf-ray')?.split('-').at(-1) || null,
    });
  } catch (error) {
    // Fetch errors may contain the input URL; use only our own diagnostic text.
    samples.push({ attempt, error: error.name === 'TimeoutError' ? 'Request timed out' : 'Media request failed or exceeded probe limit' });
  }
}

const warnings = [];
if (url.hostname.endsWith('.r2.dev')) warnings.push('r2.dev is a development endpoint; use a custom domain for Cloudflare CDN cache.');
if (url.hostname.endsWith('.r2.cloudflarestorage.com')) warnings.push('The S3 endpoint is intended for object operations; serve images from a configured delivery domain.');
if (url.hostname.endsWith('.workers.dev')) warnings.push('Confirm the Worker delivery route uses a custom domain before relying on Cache API.');
if (samples.some((sample) => sample.status === 200 && !sample.cacheControl)) warnings.push('Successful response has no Cache-Control header.');
console.log(JSON.stringify({ host: url.hostname, samples, warnings }, null, 2));
if (samples.some((sample) => sample.error || sample.status < 200 || sample.status >= 300)) process.exitCode = 1;
