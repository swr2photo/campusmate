import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const run = (...args) => spawnSync(process.execPath, ['scripts/set-version-config.mjs', ...args], { encoding: 'utf8' });
test('version config defaults to an unpublished local proposal with zero writes', () => {
  const result = run('2.1.8', '2.1.8', '--platform', 'android', '--latest-build', '78', '--min-build', '78');
  assert.equal(result.status, 0); assert.match(result.stdout, /"apply":false/);
  assert.match(result.stdout, /"storePublished":false/); assert.match(result.stdout, /0 Firestore writes/);
});
test('invalid publication and unreachable minimums fail before any apply', () => {
  for (const args of [
    ['2.1.8', '--published', '--apply'],
    ['2.1.8', '--platform', 'ios', '--play-store-published', '--latest-build', '2', '--apply'],
    ['2.1.8', '3.0.0', '--latest-build', '78', '--apply'],
    ['2.1.8', '--latest-build', '78', '--min-build', '79', '--apply'],
    ['2.1.8', '--platform', 'ios', '--latest-build', '2', '--published', '--app-store-url', 'https://play.google.com/store', '--apply'],
  ]) {
    const result = run(...args); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /Applied/);
  }
});
