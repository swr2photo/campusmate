import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real client service with native/Firebase boundaries stubbed.
const source = readFileSync(new URL('../src/services/imageModerationService.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export async function/g, 'async function');
function service(data, { offline = false, image = 'jpeg' } = {}) {
  const context = vm.createContext({
    console: { warn() {} },
    ImageManipulator: { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async () => ({ base64: image }) },
    requireFirebase: () => ({ app: {} }), getFunctions: () => ({}),
    httpsCallable: () => async () => {
      if (offline) throw new Error('offline');
      return { data };
    },
  });
  vm.runInContext(source, context);
  return context.verifyImageSafety;
}
test('client accepts completed scan', async () => {
  assert.equal(await service({ status: 'allowed', isSafe: true, policyVersion: 2 })('file://photo.jpg'), true);
});
test('client preserves violation category', async () => {
  await assert.rejects(service({ status: 'blocked', isSafe: false, reason: 'adult', policyVersion: 2 })('file://photo.jpg'),
    err => err.isModerationViolation === true && err.reason === 'adult' && !err.isModerationUnavailable);
});
for (const data of [undefined, {}, { isSafe: true, moderationSkipped: true }, { status: 'unavailable', isSafe: null, policyVersion: 2 }, { isSafe: false, reason: 'excessive_skin_exposure' }]) {
  test(`client treats failed or legacy scan as unavailable ${JSON.stringify(data)}`, async () => {
    await assert.rejects(service(data)('file://photo.jpg'), err => err.isModerationUnavailable === true && !err.isModerationViolation);
  });
}
test('offline failure is retryable, not a content violation', async () => {
  await assert.rejects(service(null, { offline: true })('file://photo.jpg'), err => err.isModerationUnavailable === true && !err.isModerationViolation);
});
test('failed image preparation does not silently allow upload', async () => {
  await assert.rejects(service(null, { image: null })('file://photo.jpg'), err => err.isModerationUnavailable === true);
});
