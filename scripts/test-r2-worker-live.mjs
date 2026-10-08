#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { createR2WorkerUpload } from '../functions/r2UploadTicket.js';
import { mediaProbeFetch } from './media-probe-fetch.mjs';
const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');
const domain = 'https://media.getcampusmate.app';
const objectKey = `chat_media/cdn-probe/${randomUUID()}.enc`;
const ticket = createR2WorkerUpload({ domain, secret: process.env.R2_UPLOAD_SIGNING_KEY, objectKey });
const key = randomBytes(32);
const nonce = randomBytes(24);
const plaintext = randomBytes(1024);
const encrypted = Buffer.concat([nonce, Buffer.from(nacl.secretbox(plaintext, nonce, key))]);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const request = (url, options = {}) => mediaProbeFetch(url, { ...options, signal: AbortSignal.timeout(20000) });
assert.equal((await request(ticket.uploadUrl, { method: 'PUT', headers: { 'Cache-Control': 'no-store' }, body: encrypted })).status, 403);
assert.equal((await request(`${domain}/users/probe/avatar.jpg`)).status, 404);
const upload = await request(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: encrypted });
if (upload.status !== 201) {
  const errorText = (await upload.text()).slice(0, 1024);
  console.log(JSON.stringify({ host: new URL(domain).hostname, status: upload.status, server: upload.headers.get('server'), edge: upload.headers.get('cf-ray')?.split('-').at(-1), cacheControl: upload.headers.get('cache-control'), cacheStatus: upload.headers.get('cf-cache-status'), responseDate: upload.headers.get('date'), localDate: new Date().toUTCString(), permissionRejected: errorText.includes('Upload permission is invalid or expired'), originRejected: errorText.includes('Origin not allowed'), htmlResponse: errorText.includes('<html') }));
}
assert.equal(upload.status, 201);
assert.equal((await request(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: encrypted })).status, 409);
const samples = [];
for (let attempt = 1; attempt <= 3; attempt++) {
  const started = performance.now();
  const response = await request(ticket.downloadUrl);
  const ttfbMs = Math.round(performance.now() - started);
  if (response.status !== 200) console.log(JSON.stringify({ host: new URL(domain).hostname, status: response.status, headers: Object.fromEntries(['content-range', 'content-length', 'x-campusmate-cache', 'cf-cache-status', 'x-campusmate-revision'].map((name) => [name, response.headers.get(name)])) }));
  assert.equal(response.status, 200);
  const data = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(data), digest(encrypted));
  assert.deepEqual(Buffer.from(nacl.secretbox.open(data.subarray(24), data.subarray(0, 24), key)), plaintext);
  samples.push({ attempt, ttfbMs, bytes: data.length, cache: response.headers.get('x-campusmate-cache'), edge: response.headers.get('cf-ray')?.split('-').at(-1) });
}
assert.ok(samples.some((sample) => sample.cache === 'HIT'), 'Repeated download must hit edge cache');
console.log(JSON.stringify({ host: new URL(domain).hostname, unsignedUploadRejected: true, plaintextRouteRejected: true, immutableOverwriteRejected: true, ciphertextUnchangedAndDecryptable: true, samples }, null, 2));
