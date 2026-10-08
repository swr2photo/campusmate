import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getExpoSdk } from './expoSdk.js';

test('getExpoSdk loads expo-server-sdk once and exposes validation plus a client', async () => {
  const first = await getExpoSdk();
  const second = await getExpoSdk();
  assert.equal(first, second);
  assert.equal(typeof first.Expo.isExpoPushToken, 'function');
  assert.equal(first.Expo.isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), true);
  assert.equal(first.Expo.isExpoPushToken('not-a-token'), false);
  for (const method of ['chunkPushNotifications', 'sendPushNotificationsAsync', 'getPushNotificationReceiptsAsync']) {
    assert.equal(typeof first.client[method], 'function', method);
  }
});

// Regression guard for "ReferenceError: Expo is not defined": index.js has no
// module-level Expo binding, so every top-level declaration that touches
// `Expo.` or `expo.` must obtain it from getExpoSdk() before first use.
test('index.js only uses Expo/expo after obtaining them from getExpoSdk()', () => {
  const lines = readFileSync(new URL('./index.js', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(!lines.some((line) => /^(import\s*\{[^}]*\bExpo\b|(const|let|var)\s+(Expo|expo)\b)/.test(line)),
    'unexpected module-level Expo binding; use getExpoSdk()');
  const blocks = [];
  lines.forEach((line, index) => {
    if (/^(export\s+)?(async\s+)?(const|let|function|class)\b/.test(line) || !blocks.length) {
      blocks.push({ start: index + 1, lines: [] });
    }
    blocks[blocks.length - 1].lines.push(line.replace(/\/\/.*$/, ''));
  });
  const offenders = [];
  let checked = 0;
  for (const block of blocks) {
    const body = block.lines.join('\n');
    const use = body.search(/\b(Expo|expo)\.[A-Za-z]/);
    if (use < 0) continue;
    checked += 1;
    const loader = body.search(/=\s*await\s+getExpoSdk\(\)/);
    if (loader < 0 || loader > use) offenders.push(`${block.lines[0].trim().slice(0, 60)} (line ${block.start})`);
  }
  assert.ok(checked >= 4, `expected push helpers to be scanned, saw ${checked}`);
  assert.deepEqual(offenders, []);
});
