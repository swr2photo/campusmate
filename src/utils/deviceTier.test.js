import test from 'node:test';
import assert from 'node:assert/strict';

// Test pure logic calculation without react-native mock
test('deviceTier exports correct tier constants', async () => {
  // Mock react-native
  const { DeviceTier } = await import('./deviceTier.js');
  assert.equal(DeviceTier.LOW, 'low');
  assert.equal(DeviceTier.MID, 'mid');
  assert.equal(DeviceTier.HIGH, 'high');
});
