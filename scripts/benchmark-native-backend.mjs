#!/usr/bin/env node
// Discovery persists expiring cursor snapshots. Use a dedicated synthetic staging account.
import { performance } from 'node:perf_hooks';
import { normalizeRustOrigin } from '../src/services/rustBackendProtocol.mjs';

if (process.argv.includes('--help')) {
  console.log('Set NATIVE_BENCHMARK_ORIGIN, NATIVE_BENCHMARK_ACCESS_TOKEN and NATIVE_BENCHMARK_ALLOW=staging. Optional NATIVE_BENCHMARK_REQUESTS=20 (1..50), NATIVE_BENCHMARK_CONCURRENCY=2 (1..8). No token arguments are accepted.');
  process.exit(0);
}
if (process.argv.length !== 2 || process.env.NATIVE_BENCHMARK_ALLOW !== 'staging') {
  throw new Error('Use --help and explicitly select a staging workload');
}
const origin = normalizeRustOrigin(process.env.NATIVE_BENCHMARK_ORIGIN || '');
const token = process.env.NATIVE_BENCHMARK_ACCESS_TOKEN || '';
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('A native staging access token is required in the process environment');
const count = Number(process.env.NATIVE_BENCHMARK_REQUESTS || 20);
const concurrency = Number(process.env.NATIVE_BENCHMARK_CONCURRENCY || 2);
if (!Number.isInteger(count) || count < 1 || count > 50 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error('Workload is outside the allowed bounds');
}
const samples = [], statuses = {}, errors = {};
let next = 0;
const runStart = performance.now();
async function worker() {
  while (next < count) {
    next++;
    const start = performance.now();
    try {
      const response = await fetch(`${origin}/v1/discover`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: '{"filters":{}}',
      });
      statuses[response.status] = (statuses[response.status] || 0) + 1;
      // Consume transfer time while keeping all profiles out of logs.
      if (response.body) {
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > 2_000_000) throw new Error('response-limit');
        }
      }
      if (response.ok) samples.push(performance.now() - start);
    } catch (error) {
      const kind = error.name === 'TimeoutError' ? 'timeout' : 'network-or-response';
      errors[kind] = (errors[kind] || 0) + 1;
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsedSeconds = (performance.now() - runStart) / 1000;
samples.sort((a, b) => a - b);
const percentile = fraction => samples.length ? Math.round(samples[Math.ceil(samples.length * fraction) - 1] * 100) / 100 : null;
console.log(JSON.stringify({
  origin, requests: count, concurrency, successfulResponses: samples.length,
  successfulRequestsPerSecond: Math.round(samples.length / elapsedSeconds * 100) / 100,
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
  httpStatuses: statuses, errors,
  note: 'Synthetic staging first-page workload; excludes login/refresh. Does not establish production capacity or cold-start behavior. Rate limits and busy responses are reported, not hidden.',
}, null, 2));
if (samples.length !== count) process.exitCode = 1;
