import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url), babel = require('@babel/core');
const file = 'src/screens/ProfilePhotosScreen.js';
function action(path, name, mocks) {
  const source = readFileSync(path, 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let found;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === name) found = node.init;
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  }
  walk(ast); assert.ok(found, name);
  const context = vm.createContext({ setProcessingIndex() {}, prefetchGalleryImage: () => null, ...mocks });
  vm.runInContext(`globalThis.action = ${source.slice(found.start, found.end)};`, context);
  return context.action;
}
function profileFixture(index = 1, extra = {}) {
  const events = [];
  let draft = { avatarUri: 'main', gallery: ['old', 'other'] };
  const session = { index, uri: 'file:///input.jpg', ownerId: 'owner', gallery: [...draft.gallery], replacement: false };
  const dependencies = { editingPhotoRef: { current: session }, processingRef: { current: false },
    profileIdRef: { current: 'owner' }, mountedRef: { current: true }, MAX_PROFILE_PHOTOS: 9,
    compressProfileImage: async () => 'file:///compressed.jpg',
    setProcessing: value => events.push(['processing', value]), setEditingPhoto: value => events.push(['editor', value]),
    setDraft: update => { draft = update(draft); }, closePhotoEditor: () => events.push(['cancel-unchanged']),
    verifyMainPhoto: async (...args) => events.push(['verify-main', ...args]), setTimeout: callback => { events.push(['dismiss-delay']); callback(); },
    ...extra };
  return { events, dependencies, session, draft: () => draft, run: action(file, 'applyEditedPhoto', dependencies) };
}
test('gallery edit updates only its draft slot; saving/upload and verification are deferred', async () => {
  const f = profileFixture(); await f.run('file:///rotated.jpg');
  assert.deepEqual(JSON.parse(JSON.stringify(f.draft())), { avatarUri: 'main', gallery: ['file:///compressed.jpg', 'other'] });
  assert.equal(f.events.some(event => event[0] === 'verify-main'), false);
  assert.equal(f.dependencies.editingPhotoRef.current, null);
});
test('main edits dismiss the editor before verifying; the published photo stays unchanged', async () => {
  const f = profileFixture(0); await f.run('file:///rotated.jpg');
  const close = f.events.findIndex(event => event[0] === 'editor' && event[1] === null);
  const verify = f.events.findIndex(event => event[0] === 'verify-main');
  assert.ok(close >= 0 && verify > close);
  assert.deepEqual(f.events[verify], ['verify-main', 'file:///compressed.jpg', ['old', 'other']]);
  assert.equal(f.dependencies.processingRef.current, false);
  assert.equal(f.draft().avatarUri, 'main');
});
test('a changed main-photo draft retries the save-and-verify path rather than closing as a gallery save', async () => {
  const events = [];
  const confirm = action(file, 'confirmPhotos', { dirty: true, draft: { avatarUri: 'edited', gallery: [] }, profile: { avatarUri: 'old' },
    setMayLeave: assert.fail, savePhotos: assert.fail, verifyMainPhoto: (...args) => events.push(args) });
  await confirm(); assert.deepEqual(events, [['edited', []]]);
});
test('remote editing input is downloaded with the current avatar revision and remains local until accepted', async () => {
  const events = [], processingRef = { current: false }, editingPhotoRef = { current: null };
  const open = action(file, 'openPhotoEditor', { profile: { id: 'owner', avatarRevision: 8 }, profileIdRef: { current: 'owner' },
    draft: { gallery: ['other'] }, savingRef: { current: false }, processingRef, editingPhotoRef, verificationVisible: false,
    mountedRef: { current: true }, MAX_PROFILE_IMAGE_SIZE_MB: 30, setProcessing() {}, setErrorMessage() {}, showToast: assert.fail,
    getImageRequestUri: (uri, revision) => `${uri}?cmv=${revision}`,
    FileSystem: { cacheDirectory: 'file:///cache/', downloadAsync: async (url, target) => {
      assert.equal(url, 'https://example.test/avatar.jpg?cmv=8'); assert.ok(target.startsWith('file:///cache/profile_edit_'));
      return { status: 200, uri: 'file:///cache/local.jpg' };
    } }, validateImageSize: async () => ({ valid: true }), setEditingPhoto: value => events.push(value),
  });
  await open(0, 'https://example.test/avatar.jpg');
  assert.equal(events[0].uri, 'file:///cache/local.jpg'); assert.equal(events[0].ownerId, 'owner');
  assert.equal(processingRef.current, false);
});
test('download failure leaves the draft intact and releases the editor preparation lock', async () => {
  let errors = 0; const processingRef = { current: false }, editingPhotoRef = { current: null };
  const open = action(file, 'openPhotoEditor', { profile: { id: 'owner' }, profileIdRef: { current: 'owner' },
    savingRef: { current: false }, processingRef, editingPhotoRef, verificationVisible: false, mountedRef: { current: true },
    setProcessing() {}, setErrorMessage() {}, showToast: () => errors++, getImageRequestUri: value => value,
    FileSystem: { cacheDirectory: 'file:///cache/', downloadAsync: async () => ({ status: 503 }) },
    setEditingPhoto: assert.fail,
  });
  await open(1, 'https://example.test/photo.jpg'); assert.equal(errors, 1); assert.equal(processingRef.current, false); assert.equal(editingPhotoRef.current, null);
});
test('accepting an unchanged existing photo does not reupload or revoke verification', async () => {
  const f = profileFixture(0, { compressProfileImage: assert.fail }); await f.run(f.session.uri);
  assert.deepEqual(f.events, [['cancel-unchanged']]);
});
test('failed editing keeps the original draft and releases the processing lock for retry', async () => {
  const f = profileFixture(1, { compressProfileImage: async () => { throw new Error('disk'); } });
  await assert.rejects(f.run('file:///rotated.jpg'), /disk/);
  assert.equal(f.draft().gallery[0], 'old'); assert.equal(f.dependencies.editingPhotoRef.current, f.session);
  assert.equal(f.dependencies.processingRef.current, false);
});
test('late editor output for a departed account cannot change the next account', async () => {
  let finish; const f = profileFixture(1, { compressProfileImage: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.run('file:///rotated.jpg'); f.dependencies.profileIdRef.current = 'next'; finish('file:///compressed.jpg'); await pending;
  assert.equal(f.draft().gallery[0], 'old'); assert.equal(f.events.some(event => event[0] === 'verify-main'), false);
});
test('picking a replacement opens the shared editor after releasing the picker lock', async () => {
  const processingRef = { current: false }, events = [];
  const pick = action(file, 'pickPhoto', { processingRef, savingRef: { current: false }, verificationVisible: false,
    Platform: { OS: 'android' }, MAX_PROFILE_IMAGE_SIZE_MB: 30, setProcessing() {}, setErrorMessage() {},
    ImagePicker: { requestMediaLibraryPermissionsAsync: async () => ({ granted: true }), launchImageLibraryAsync: async options => {
      assert.equal(options.allowsEditing, false); return { canceled: false, assets: [{ uri: 'file:///picked.jpg' }] };
    } }, validateImageSize: async () => ({ valid: true }), showPhotoPermission: assert.fail, showToast: assert.fail,
    openPhotoEditor: async (...args) => { assert.equal(processingRef.current, false); events.push(args); },
  });
  await pick(2); assert.deepEqual(events, [[2, 'file:///picked.jpg', true]]);
});
for (const path of ['src/components/ChatImageEditorModal.js', 'src/components/ChatImageEditorModal.ios.js']) {
  test(`${path}: latest active edit wins while other chat photo edits survive`, async () => {
    const values = [];
    const confirm = action(path, 'handleConfirmSend', { activeUri: 'current-edit', isProcessing: false,
      confirmingRef: { current: false }, selectedFilter: 'normal', urisList: ['a', 'b'], selectedIdx: 1,
      editedUrisMap: { current: { 0: 'edited-a', 1: 'stale-b' } }, caption: ' caption ',
      setIsProcessing() {}, setProcessingLabel() {}, onSend: (...args) => values.push(args), onClose() {},
      console, showAlert: assert.fail,
    });
    await confirm(); assert.deepEqual(Array.from(values[0][0]), ['edited-a', 'current-edit']); assert.equal(values[0][1], 'caption');
  });
  test(`${path}: duplicate confirmation is locked and a failed consumer is not closed or sent a fallback`, async () => {
    let reject, requests = 0, closes = 0, errors = 0;
    const confirmingRef = { current: false };
    const confirm = action(path, 'handleConfirmSend', { activeUri: 'edit', isProcessing: false, confirmingRef,
      selectedFilter: 'normal', urisList: ['edit'], selectedIdx: 0, editedUrisMap: { current: {} }, caption: '',
      setIsProcessing() {}, setProcessingLabel() {}, onSend: () => { requests++; return new Promise((_, fail) => { reject = fail; }); },
      onClose: () => closes++, console: { warn() {} }, showAlert: () => errors++,
    });
    const pending = confirm(); await confirm(); assert.equal(requests, 1);
    reject(new Error('save failed')); await pending;
    assert.equal(requests, 1); assert.equal(closes, 0); assert.equal(errors, 1); assert.equal(confirmingRef.current, false);
  });
}
test('the rendered photo screen has exactly three equal-flex slots per row', () => {
  const source = readFileSync(file, 'utf8');
  const expoRequire = createRequire(require.resolve('babel-preset-expo/package.json'));
  const code = babel.transformSync(source, { configFile: false, babelrc: false,
    plugins: [expoRequire.resolve('@babel/plugin-transform-react-jsx'), expoRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  const profile = { id: 'owner', avatarUri: 'main', gallery: ['one', 'two'] };
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: value => ({ current: value }), useEffect() {}, useCallback: value => value };
  const dependencies = { react: React, 'react-native': { ActivityIndicator: 'ActivityIndicator', Linking: {}, Platform: { OS: 'android' },
    Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 }, useWindowDimensions: () => ({ width: 360 }) },
    'expo-image': { Image: 'Image' }, 'expo-image-picker': {}, 'expo-file-system/legacy': {}, '@expo/ui': { Host: 'Host', RNHostView: 'RNHostView', BottomSheet: 'BottomSheet' },
    'expo-router': { useNavigation: () => ({}) }, 'expo-router/react-navigation': { usePreventRemove() {} },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../context/AppContext': { useAppProfile: () => ({ profile }), useAppActions: () => ({}) },
    '../context/ToastContext': { useToast: () => ({}) }, '../data/profilePhotos': { MAX_PROFILE_PHOTOS: 9 },
    '../theme': { useTheme: () => ({ colors: {}, isDark: false }) },
    '../utils/useRemoteImage': { getImageRequestUri: uri => uri },
  };
  const context = vm.createContext({ exports: {}, require: name => dependencies[name] || {}, clearTimeout, setTimeout });
  vm.runInContext(code, context); const tree = context.exports.default({ onClose() {} });
  const rows = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.style?.columnGap === 14) rows.push(node);
    node.props?.children?.forEach(walk);
  }
  walk(tree); assert.equal(rows.length, 3);
  for (const row of rows) { assert.equal(row.props.children.length, 3);
    for (const child of row.props.children) { const styles = child.props.style({ pressed: false });
      assert.equal(styles[0].flex, 1); assert.equal(styles[0].aspectRatio, 2 / 3);
    }
  }
});
