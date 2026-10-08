import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
function fixture(platform = 'android') {
  const storage = new Map(), opened = [], listeners = [];
  const config = { platforms: { android: { storePublished: true, latestVersion: '2.1.7', latestBuild: '80' } } };
  const context = vm.createContext({ console, Date, BigInt,
    Platform: { OS: platform }, Application: { nativeApplicationVersion: '2.1.7', nativeBuildVersion: '77' },
    Constants: { appOwnership: 'standalone', expoConfig: { version: '99.0.0', android: { versionCode: 9999 } } },
    AsyncStorage: { getItem: async (key) => storage.get(key), multiSet: async (entries) => entries.forEach(([key, value]) => storage.set(key, value)) },
    requireFirebase: () => ({ db: {} }), doc: () => 'version',
    getDoc: async () => ({ exists: () => true, data: () => config }),
    onSnapshot: (_doc, next) => { listeners.push(next); return () => {}; },
    Linking: { canOpenURL: async () => true, openURL: async (url) => opened.push(url) },
  });
  const source = read('src/utils/versionUpdatePolicy.js') + '\n' + read('src/services/versionCheckService.js');
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export \{.*\} from .*;\n/gm, '')
    .replace(/export (?=(?:async )?function|const)/g, '')
    + '\nglobalThis.api = { checkAppUpdate, snoozeUpdate, getCurrentAppVersion, getCurrentAppBuild, openAppStore, subscribeAppUpdate, evaluateVersionPolicy };', context);
  return { ...context.api, context, config, storage, opened, listeners };
}

test('installed native version and build win over newer OTA values; Expo Go never prompts', async () => {
  const f = fixture();
  assert.equal(f.getCurrentAppVersion(), '2.1.7'); assert.equal(f.getCurrentAppBuild(), '77');
  assert.equal((await f.checkAppUpdate()).needsUpdate, true);
  f.context.Application.nativeApplicationVersion = null;
  assert.equal(f.getCurrentAppVersion(), '');
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
  f.context.Constants.appOwnership = 'expo';
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
});

test('a published minimum Android build forces an update even when the version is unchanged and snoozed', async () => {
  const f = fixture();
  f.config.platforms.android.minBuild = '80';
  await f.snoozeUpdate('android:2.1.7:80');
  const result = await f.checkAppUpdate();
  assert.equal(result.needsUpdate, true); assert.equal(result.isForce, true);
  f.context.Application.nativeBuildVersion = '80';
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
});

test('snooze applies only to its platform/version/build and never hides the next build', async () => {
  const f = fixture();
  await f.snoozeUpdate('android:2.1.7:80');
  assert.equal((await f.checkAppUpdate()).snoozed, true);
  assert.equal((await f.checkAppUpdate({ ignoreSnooze: true })).needsUpdate, true);
  f.config.platforms.android.latestBuild = '81';
  assert.equal((await f.checkAppUpdate()).needsUpdate, true);
  f.storage.set('@campusmate:update_snooze_meta', JSON.stringify({ at: Date.now(), latestVersion: '2.1.7' }));
  assert.equal((await f.checkAppUpdate()).needsUpdate, true);
});

test('iOS requires its own published release and App Store destination; Play publication cannot unlock it', async () => {
  const f = fixture('ios');
  Object.assign(f.config, { latestVersion: '3.0.0', forceUpdate: true, playStorePublished: true });
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
  f.config.platforms.ios = { storePublished: true, latestVersion: '2.1.7', latestBuild: '77.2', minBuild: '77.1', appStoreUrl: 'https://apps.apple.com/app/id123456' };
  const result = await f.checkAppUpdate();
  assert.equal(result.needsUpdate, true); assert.equal(result.isForce, true);
  await f.openAppStore(result.appStoreUrl, result.appStoreUrl);
  assert.deepEqual(f.opened, ['https://apps.apple.com/app/id123456']);
  delete f.config.platforms.ios.appStoreUrl;
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
  await f.openAppStore();
  assert.equal(f.opened.length, 1);
});

test('unpublished releases, unreachable minimums and missing build values cannot lock a client', async () => {
  const f = fixture(), entry = f.config.platforms.android;
  Object.assign(entry, { storePublished: false, forceUpdate: true, minBuild: '80' });
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
  entry.storePublished = true; entry.minBuild = '81';
  assert.equal((await f.checkAppUpdate()).invalidConfig, true);
  entry.minBuild = '80'; entry.minVersion = '3.0.0';
  assert.equal((await f.checkAppUpdate()).invalidConfig, true);
  delete entry.minVersion; entry.latestBuild = 'bad';
  assert.equal((await f.checkAppUpdate()).invalidConfig, true);
  entry.latestBuild = '80'; entry.forceUpdate = false; f.context.Application.nativeBuildVersion = null;
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
});

test('iOS version boundaries do not compare a reset CFBundleVersion against a previous version', async () => {
  const f = fixture('ios'); f.context.Application.nativeBuildVersion = '900';
  f.config.platforms.ios = { latestVersion: '2.1.8', latestBuild: '1', minVersion: '2.1.8', minBuild: '1', storePublished: true, appStoreUrl: 'https://apps.apple.com/app/id123' };
  assert.equal((await f.checkAppUpdate()).isForce, true);
  f.context.Application.nativeApplicationVersion = '2.1.8'; f.context.Application.nativeBuildVersion = '1';
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
});

test('explicit unpublished state wins over a stale platform legacy publication flag', async () => {
  const f = fixture();
  Object.assign(f.config.platforms.android, { storePublished: false, playStorePublished: true, minBuild: '80' });
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
});

test('an Android preview with a higher versionCode cannot be forced to download a lower versionCode', async () => {
  const f = fixture(); f.context.Application.nativeBuildVersion = '900';
  Object.assign(f.config.platforms.android, { latestVersion: '3.0.0', latestBuild: '80', minVersion: '3.0.0', forceUpdate: true });
  assert.equal((await f.checkAppUpdate()).needsUpdate, false);
});

test('a delayed optional result cannot replace a newer force-update snapshot', async () => {
  const f = fixture(), results = []; let finishRead;
  f.context.AsyncStorage.getItem = () => new Promise((resolve) => { finishRead = resolve; });
  const off = f.subscribeAppUpdate((result) => results.push(result));
  const pending = f.listeners[0]({ exists: () => true, data: () => f.config });
  f.config.platforms.android.minBuild = '80';
  await f.listeners[0]({ exists: () => true, data: () => f.config });
  finishRead(JSON.stringify({ at: Date.now(), updateKey: 'android:2.1.7:80' }));
  await pending;
  assert.equal(results.length, 1); assert.equal(results[0].isForce, true);
  off();
});
