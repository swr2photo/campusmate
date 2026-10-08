import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const { expo } = JSON.parse(read('app.json'));
const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const strings = read('android/app/src/main/res/values/strings.xml');
const colors = read('android/app/src/main/res/values/colors.xml');

// Android is checked in and maintained manually; iOS is generated from app.json.
assert.ok(!existsSync(path.join(root, 'ios')), 'An ios/ project exists; add an iOS config check before disabling Expo Doctor');

function capture(source, pattern, field) {
  const value = source.match(pattern)?.[1];
  assert.ok(value !== undefined, `Missing native config field: ${field}`);
  return value;
}

const actual = {
  name: capture(strings, /<string name="app_name">([^<]+)<\/string>/, 'name'),
  package: capture(gradle, /\bapplicationId\s+['"]([^'"]+)['"]/, 'android.package'),
  version: capture(gradle, /\bversionName\s+['"]([^'"]+)['"]/, 'version'),
  versionCode: Number(capture(gradle, /\bversionCode\s+(\d+)/, 'android.versionCode')),
  runtimeVersion: capture(strings, /<string name="expo_runtime_version">([^<]+)<\/string>/, 'runtimeVersion'),
  scheme: capture(manifest, /<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?<data android:scheme="([^"]+)"\s*\/>/, 'scheme'),
  orientation: capture(manifest, /android:screenOrientation="([^"]+)"/, 'orientation'),
  userInterfaceStyle: capture(strings, /<string name="expo_system_ui_user_interface_style"[^>]*>([^<]+)<\/string>/, 'userInterfaceStyle'),
  updatesUrl: capture(manifest, /android:name="expo\.modules\.updates\.EXPO_UPDATE_URL" android:value="([^"]+)"/, 'updates.url'),
  iconBackground: capture(colors, /<color name="iconBackground">([^<]+)<\/color>/, 'android.adaptiveIcon.backgroundColor'),
  notificationColor: capture(colors, /<color name="notification_icon_color">([^<]+)<\/color>/, 'expo-notifications.color'),
  notificationChannel: capture(manifest, /android:name="com\.google\.firebase\.messaging\.default_notification_channel_id" android:value="([^"]+)"/, 'expo-notifications.defaultChannel'),
};

const notificationPlugin = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications')?.[1];
const expected = {
  name: expo.name,
  package: expo.android.package,
  version: expo.version,
  versionCode: expo.android.versionCode,
  runtimeVersion: expo.runtimeVersion,
  scheme: expo.scheme,
  orientation: expo.orientation === 'default' ? 'unspecified' : expo.orientation,
  userInterfaceStyle: expo.userInterfaceStyle,
  updatesUrl: expo.updates.url,
  iconBackground: expo.android.adaptiveIcon.backgroundColor,
  notificationColor: notificationPlugin?.color,
  notificationChannel: notificationPlugin?.defaultChannel,
};

for (const [field, expectedValue] of Object.entries(expected)) {
  assert.ok(expectedValue !== undefined, `Missing app.json field: ${field}`);
  assert.equal(actual[field], expectedValue, `${field} differs between app.json and Android native files`);
}

const permissionTags = manifest.match(/<uses-permission\b[^>]*\/>/g) || [];
for (const permission of expo.android.permissions || []) {
  const tag = permissionTags.find((item) => item.includes(`android:name="${permission}"`));
  assert.ok(tag && !tag.includes('tools:node="remove"'), `Android permission is missing: ${permission}`);
}
for (const permission of expo.android.blockedPermissions || []) {
  const tag = permissionTags.find((item) => item.includes(`android:name="${permission}"`));
  assert.ok(tag?.includes('tools:node="remove"'), `Android permission is not blocked: ${permission}`);
}

console.log(`Android native config matches app.json (${Object.keys(expected).length} fields, ${expo.android.permissions.length} permissions).`);
