import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetPath = require.resolve('babel-preset-expo');
const plugin = name => require.resolve(name, { paths: [presetPath] });
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useCallback: callback => callback,
};
function load(file, imports, globals = {}) {
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, babelrc: false, configFile: false,
    plugins: [
      [plugin('@babel/plugin-transform-typescript'), { isTSX: true, allExtensions: true }],
      plugin('@babel/plugin-transform-react-jsx'),
      plugin('@babel/plugin-transform-modules-commonjs'),
    ],
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals,
    require: id => {
      if (id === 'react') return React;
      assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
      return imports[id];
    },
  }, { filename: file });
  return module.exports;
}
function bridge({ available = true, registrationFails = false } = {}) {
  const registrations = [], modifierCalls = [];
  const exports = load('modules/campus-landmarks/src/CampusLandmarksView.ios.tsx', {
    '@expo/ui': { Host: 'Host' },
    '@expo/ui/swift-ui/modifiers': { createViewModifierEventListener: modifiers => {
      modifierCalls.push(modifiers);
      return { onGlobalEvent: 'modifier-listener' };
    } },
    expo: {
      requireOptionalNativeModule: () => available === null ? null : { isSupported: () => available },
      requireNativeView: (...args) => {
        registrations.push(args);
        if (registrationFails) throw new Error('Older binary');
        return 'NativePlaces';
      },
    },
    'react-native': { StyleSheet: { create: value => value } },
    './CampusLandmarksFallback': 'Fallback',
  });
  return { ...exports, registrations, modifierCalls };
}

test('Expo Go and unsupported clients show fallback without registering a native view', () => {
  for (const available of [null, false]) {
    const api = bridge({ available });
    assert.equal(api.isCampusLandmarksAvailable(), false);
    assert.equal(api.default({ storageScope: 'device:guest' }).type, 'Fallback');
    assert.equal(api.registrations.length, 0);
  }
});

test('failed view registration in an old binary preserves a usable fallback', () => {
  const api = bridge({ registrationFails: true });
  assert.equal(api.isCampusLandmarksAvailable(), false);
  assert.equal(api.default({ storageScope: 'guest' }).type, 'Fallback');
});

test('native bridge forwards props and normalizes Swift events', () => {
  const api = bridge();
  let closed = 0, selected, counts;
  const tree = api.default({ storageScope: 'user:a', title: 'สถานที่', backendURL: 'https://example.test',
    colorScheme: 'dark', onClose: () => closed++, onSelectPlace: value => { selected = value; },
    onLibraryChange: value => { counts = value; },
  });
  assert.equal(api.isCampusLandmarksAvailable(), true);
  assert.deepEqual(api.registrations, [['CampusLandmarks', 'CampusLandmarksView']]);
  assert.equal(tree.type, 'Host');
  assert.equal(tree.props.colorScheme, 'dark');
  const native = tree.props.children[0];
  assert.equal(native.props.storageScope, 'user:a');
  assert.equal(native.props.backendURL, 'https://example.test');
  native.props.onClose({ nativeEvent: {} });
  const place = { id: 1001, name: 'Sahara', latitude: 23.9, longitude: 10.3 };
  native.props.onSelectPlace({ nativeEvent: place });
  native.props.onLibraryChange({ nativeEvent: { favoriteCount: 2, collectionCount: 1 } });
  assert.equal(closed, 1);
  assert.equal(selected, place);
  assert.equal(counts.favoriteCount, 2);
  assert.equal(counts.collectionCount, 1);
  assert.equal(api.modifierCalls.length, 0);
});

test('custom SwiftUI view keeps Expo modifier event plumbing', () => {
  const api = bridge();
  const modifiers = [{ $type: 'onAppear' }];
  const tree = api.default({ storageScope: 'user:a', modifiers });
  assert.equal(api.modifierCalls[0], modifiers);
  assert.equal(tree.props.children[0].props.onGlobalEvent, 'modifier-listener');
});

test('Android and web entry never import Expo SwiftUI or register a native view', () => {
  const api = load('modules/campus-landmarks/src/CampusLandmarksView.tsx', {
    './CampusLandmarksFallback': 'Fallback',
  });
  assert.equal(api.isCampusLandmarksAvailable(), false);
  assert.equal(api.default, 'Fallback');
});

test('account changes remount native state and close handles normal navigation and direct entry', () => {
  let user = { id: 'a' }, canGoBack = true, backCalls = 0, replacement, toast;
  const screen = load('src/screens/LandmarksScreen.js', {
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { Stack: { Screen: 'StackScreen' }, useRouter: () => ({
      canGoBack: () => canGoBack, back: () => backCalls++, replace: path => { replacement = path; },
    }) },
    '../../modules/campus-landmarks': { CampusLandmarksView: 'Places' },
    '../context/AuthContext': { useAuth: () => ({ user }) },
    '../context/ToastContext': { useToast: () => ({ showToast: message => { toast = message; } }) },
    '../theme': { useTheme: () => ({ colors: { canvas: '#fff', primary: '#06f' }, isDark: false }) },
  }, { process: { env: {} } });
  const first = screen.default().props.children[1];
  assert.equal(first.props.storageScope, 'user:a');
  assert.equal(first.props.syncEnabled, false);
  first.props.onSelectPlace({ name: 'Test place', latitude: 13.7563, longitude: 100.5018 });
  assert.equal(toast, 'Test place · พิกัด: 13.7563, 100.5018');
  first.props.onClose();
  assert.equal(backCalls, 1);
  user = { id: 'b' };
  const second = screen.default().props.children[1];
  assert.equal(second.props.storageScope, 'user:b');
  assert.notEqual(second.props.key, first.props.key);
  canGoBack = false;
  second.props.onClose();
  assert.equal(replacement, '/(tabs)/meetup');
  user = null;
  assert.equal(screen.default().props.children[1].props.storageScope, 'device:guest');
});
