import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), babel = require('@babel/core');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
const code = babel.transformSync(readFileSync('src/screens/SettingsDetailScreen.js', 'utf8'), { configFile: false, babelrc: false,
  plugins: [presetRequire('@babel/plugin-transform-react-jsx'), presetRequire('@babel/plugin-transform-modules-commonjs')] }).code;
const preferenceDefaults = { theme: 'system', autoplay: 'wifi', showOnlineStatus: true, muteAutoplayVideo: true, publicUsername: 'alice', notifications: { push: true, team: true } };
function fixture(section, extra = {}) {
  const changes = [], states = [], calls = [];
  const primitives = Object.fromEntries(['SettingsDescription', 'SettingsFrame', 'SettingsGroup', 'SettingsRow', 'SettingsSection', 'SettingsToggle'].map(name => [name, name]));
  primitives.useSettingsPalette = () => ({ text: '#fff', muted: '#aaa' });
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect() {}, useRef: value => ({ current: value }), useState: initial => [typeof initial === 'function' ? initial() : initial, value => states.push(value)] };
  const modules = {
    react,
    'react-native': { View: 'View', AppState: {}, StyleSheet: { create: value => value }, Linking: { openSettings: async () => calls.push('system-settings') } },
    'expo-image': { Image: { clearMemoryCache: async () => { calls.push('memory'); return true; }, clearDiskCache: async () => { calls.push('disk'); return true; } } },
    'expo-router': { useLocalSearchParams: () => ({ section }), router: { back() {}, push: target => calls.push(target) } },
    '../components/AppText': { __esModule: true, default: 'Text', AppTextInput: 'TextInput' },
    '../components/settings-primitives': primitives,
    '../context/PreferencesContext': { usePreferences: () => ({ preferences: preferenceDefaults, ready: true, serverReady: true,
      capabilities: { presence: true, push: true, team: true, publicUsername: true }, updatePreferences: async patch => changes.push(patch), ...extra.preferences }) },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'owner', email: 'owner@example.test' } }) },
    '../context/ConfirmContext': { useConfirm: () => ({ confirm: async () => extra.confirm !== false }) },
    '../context/AppTourContext': { useAppTour: () => ({}) },
    '../content/legalDocuments': { LEGAL_CONTACT: { supportEmail: 'team@example.test' } },
    '../services/notificationService': { registerForPushNotificationsAsync: async () => true, getPushPermissionStatusAsync: async () => 'granted',
      unregisterPushNotificationsAsync: async () => calls.push('unregister'), ...extra.notifications },
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})(name => modules[name] || {}, module, module.exports);
  const tree = module.exports.default();
  const all = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(all)];
  return { nodes: all(tree), changes, states, calls };
}

test('notifications menu contains only actual push and in-app announcement channels', () => {
  const f = fixture('notifications'); const rows = f.nodes.filter(node => node.type === 'SettingsRow');
  assert.deepEqual(rows.map(row => row.props.label), ['การแจ้งเตือนบนเครื่อง', 'ประกาศจาก CampusMate']);
});
test('online visibility invokes the canonical account setting and locks without server readiness', async () => {
  const f = fixture('activity'); const toggle = f.nodes.find(node => node.type === 'SettingsToggle');
  assert.equal(toggle.props.disabled, false); await toggle.props.onValueChange(false);
  assert.equal(JSON.stringify(f.changes), '[{"showOnlineStatus":false}]');
  const locked = fixture('activity', { preferences: { serverReady: false } });
  assert.equal(locked.nodes.find(node => node.type === 'SettingsToggle').props.disabled, true);
});
test('all autoplay choices and mute have working account save handlers', async () => {
  for (const mode of ['always', 'wifi', 'never']) {
    const f = fixture('autoplay'); const rows = f.nodes.filter(node => node.type === 'SettingsRow');
    await rows[['always', 'wifi', 'never'].indexOf(mode)].props.onPress();
    assert.equal(f.changes[0].autoplay, mode);
  }
  const f = fixture('autoplay'); await f.nodes.find(node => node.type === 'SettingsToggle').props.onValueChange(false);
  assert.equal(f.changes[0].muteAutoplayVideo, false);
});
test('denied device permission does not claim push was enabled or save a fake choice', async () => {
  const f = fixture('push', { notifications: { getPushPermissionStatusAsync: async () => 'denied' } });
  await f.nodes.find(node => node.type === 'SettingsToggle').props.onValueChange(true);
  assert.equal(f.changes.length, 0); assert.ok(f.states.some(value => typeof value === 'string' && value.includes('อนุญาต')));
});
test('turning off push saves the account setting before unregistering the device', async () => {
  const events = [];
  const f = fixture('push', { preferences: { updatePreferences: async patch => events.push(['save', patch.notifications.push]) },
    notifications: { unregisterPushNotificationsAsync: async () => events.push(['unregister']) } });
  await f.nodes.find(node => node.type === 'SettingsToggle').props.onValueChange(false);
  assert.deepEqual(events, [['save', false], ['unregister']]);
});
test('server failures remain visible; the screen does not declare a successful save', async () => {
  const f = fixture('activity', { preferences: { updatePreferences: async () => { throw Error('offline'); } } });
  await f.nodes.find(node => node.type === 'SettingsToggle').props.onValueChange(false);
  assert.ok(f.states.includes('offline')); assert.equal(f.changes.length, 0);
});
test('clear cache runs only after confirmation and clears real image caches', async () => {
  const f = fixture('cookies'); await f.nodes.find(node => node.props.label === 'ล้างแคชรูปภาพ').props.onPress();
  assert.deepEqual(f.calls, ['memory', 'disk']);
  const cancelled = fixture('cookies', { confirm: false }); await cancelled.nodes.find(node => node.props.label === 'ล้างแคชรูปภาพ').props.onPress();
  assert.equal(cancelled.calls.length, 0);
});

test('Rust image retries reuse the persisted nonce/ciphertext and reject a packet for another account', async () => {
  const source = readFileSync('src/services/firestoreService.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false });
  const names = ['rustSendMessage', 'buildRustMessage', 'rustMessageMeta'];
  const declarations = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id?.name));
  assert.equal(declarations.length, 3);
  const requests = []; let encryptions = 0;
  const context = { ensureConversationEncryption: async () => ({ conversationKey: new Uint8Array(32) }), normalizeMessageId: id => id,
    encryptMessageRecord: () => { encryptions++; throw Error('must reuse the persisted packet'); },
    rpc: async (_method, packet) => { requests.push(packet); return { created: true }; } };
  const send = vm.runInNewContext(`${declarations.map(node => source.slice(node.start, node.end)).join('\n')}\nrustSendMessage`, context);
  const encryptedRecord = { id: 'image-id', senderId: 'me', encrypted: true, encryptionVersion: 1, nonce: 'fixed', ciphertext: 'same-packet', viewMode: 'once' };
  const options = { clientMessageId: 'image-id', clientSentAt: 1000, mediaType: 'image', mediaUrl: 'https://media/image', viewMode: 'once', encryptedRecord };
  await send('room', 'me', '[รูปภาพ]', options); await send('room', 'me', '[รูปภาพ]', options);
  assert.equal(encryptions, 0); assert.equal(JSON.stringify(requests[0]), JSON.stringify(requests[1]));
  await assert.rejects(send('room', 'other', '[รูปภาพ]', options), /บัญชี/);
  assert.equal(requests.length, 2);
});
