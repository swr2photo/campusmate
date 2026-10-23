import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoRecycleExpiredSkipsIfPoolExhausted } from './autoRecycleSkips.js';

test('skipped profiles are never returned to discovery on a timer', async () => {
  const result = await autoRecycleExpiredSkipsIfPoolExhausted({
    db: { collection() { throw new Error('discovery must not be scanned'); } },
    uid: 'viewer',
    now: () => 1_700_000_000_000,
  });
  assert.deepEqual(result, { recycledIds: [], poolExhausted: false, nextRecycleAt: null });
});
