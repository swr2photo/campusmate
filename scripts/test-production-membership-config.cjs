const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
function config(env = {}) {
  const context = { module: { exports: {} }, process: { env }, require: name => {
    assert.equal(name, './app.json');
    return JSON.parse(fs.readFileSync('app.json', 'utf8'));
  } };
  vm.runInNewContext(fs.readFileSync('app.config.js', 'utf8'), context);
  return context.module.exports;
}
test('Android release remains enabled when the build does not load .env', () => {
  const extra = config().extra;
  assert.equal(extra.plusBackendEnabled, true);
  assert.equal(extra.secureDiscoveryEnabled, true);
  assert.match(extra.revenueCatAndroidKey, /^goog_/);
});
test('explicit deployment switches and keys still override release defaults', () => {
  const extra = config({ CAMPUSMATE_PLUS_BACKEND_ENABLED: 'false',
    CAMPUSMATE_SECURE_DISCOVERY_ENABLED: 'false', EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: 'goog_fixture' }).extra;
  assert.equal(extra.plusBackendEnabled, false);
  assert.equal(extra.secureDiscoveryEnabled, false);
  assert.equal(extra.revenueCatAndroidKey, 'goog_fixture');
});
test('EAS production uses the enabled membership and discovery APIs', () => {
  const env = JSON.parse(fs.readFileSync('eas.json', 'utf8')).build.production.env;
  assert.equal(env.CAMPUSMATE_PLUS_BACKEND_ENABLED, 'true');
  assert.equal(env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED, 'true');
});
