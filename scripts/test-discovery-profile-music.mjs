import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { formatDiscoveryWait, getProfilePhotos, getDiscoverySummary, getUniqueProfileTracks } from '../src/utils/discoveryPresentation.js';
import { canUseTrackPreview, getPlaybackRange, isReliablePreviewUrl, pickItunesPreview, previewFitsProviderClip, spotifyListenUrl } from '../src/utils/trackPlayback.js';

const require = createRequire(import.meta.url), babel = require('@babel/core');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
function functionCode(file, name) {
  const source = readFileSync(file, 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  const node = ast.program.body.map(n => n.declaration || n).find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node, name);
  return babel.transformSync(source.slice(node.start, node.end), { configFile: false, babelrc: false, plugins: [presetRequire('@babel/plugin-transform-react-jsx')] }).code;
}
const React = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
function harness(file, name, mocks) {
  let cursor = 0, pending = [];
  const slots = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const context = vm.createContext({ React, NativeCard: 'NativeCard', NativeAnimatedCard: 'NativeAnimatedCard', setTimeout, clearTimeout, ...mocks,
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; pending.push(() => { slots[i].cleanup = fn(); }); } },
  });
  vm.runInContext(functionCode(file, name) + `;globalThis.component = ${name};`, context);
  return { context, render(props) { cursor = 0; const tree = context.component(props); const run = pending; pending = []; run.forEach(fn => fn()); return tree; }, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree, label) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.props?.accessibilityLabel === label) return tree;
  for (const child of (tree.props?.children || []).flat(Infinity)) { const result = find(child, label); if (result) return result; }
  return null;
}
function findType(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === type) return tree;
  for (const child of (tree.props?.children || []).flat(Infinity)) { const result = findType(child, type); if (result) return result; }
  return null;
}

test('floating iOS controls use native glass with a finite 48-point frame and an accessible label', () => {
  const modifier = name => (...args) => ({ name, args });
  const h = harness('src/screens/DiscoverProfileScreen.ios.js', 'FloatingProfileControl', {
    Host: 'Host', Button: 'NativeButton', buttonStyle: modifier('style'), buttonBorderShape: modifier('shape'), controlSize: modifier('size'),
    labelStyle: modifier('label'), frame: modifier('frame'), foregroundStyle: modifier('foreground'), tint: modifier('tint'), disabled: modifier('disabled'),
  });
  let presses = 0;
  const props = { label: 'เมนูโปรไฟล์', icon: 'ellipsis', onPress: () => presses++, palette: {}, colorScheme: 'dark' };
  let tree = h.render(props), button = findType(tree, 'NativeButton');
  assert.equal(tree.props.style.width, 48); assert.equal(tree.props.style.height, 48);
  assert.equal(button.props.label, props.label); assert.equal(button.props.systemImage, 'ellipsis');
  assert.equal(button.props.modifiers.find(value => value.name === 'style').args[0], 'glass');
  button.props.onPress(); assert.equal(presses, 1);
  tree = h.render({ ...props, disabled: true }); button = findType(tree, 'NativeButton');
  assert.equal(button.props.modifiers.find(value => value.name === 'disabled').args[0], true);
  h.close();
});

test('a custom native safety trigger opens the same report flow', () => {
  let buttons;
  const h = harness('src/components/ProfileSafetyActions.js', 'ProfileSafetyActions', {
    useAppActions: () => ({ reportContent() {}, blockUser() {} }), useConfirm: () => ({ confirm() {} }), useToast: () => ({ showToast() {} }), useTheme: () => ({ colors: {} }),
    Platform: { OS: 'android' }, Alert: { alert: (_title, _message, options) => { buttons = options; } }, Pressable: 'Pressable', FeatureIcon: 'Icon', ReportModal: 'ReportModal',
  });
  const props = { profile: { id: 'target', name: 'Test' }, renderTrigger: trigger => React.createElement('NativeTrigger', trigger) };
  let tree = h.render(props);
  const trigger = findType(tree, 'NativeTrigger');
  assert.equal(trigger.props.disabled, false); assert.match(trigger.props.label, /Test/);
  trigger.props.onPress(); buttons.find(button => button.text === 'รายงานโปรไฟล์').onPress();
  tree = h.render(props); assert.equal(findType(tree, 'ReportModal').props.isOpen, true);
  h.close();
});

test('returning from a profile recreates the iOS photo host while keeping the same candidate and cache source', () => {
  const source = readFileSync('src/screens/HomeScreen.ios.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let focus;
  const modifiers = {};
  babel.traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== '@expo/ui/swift-ui/modifiers') return;
      for (const specifier of path.node.specifiers) modifiers[specifier.local.name] = (...args) => ({ modifier: specifier.local.name, args });
    },
    CallExpression(path) {
      if (path.node.callee.name === 'useFocusEffect' && source.slice(path.node.start, path.node.end).includes('setPhotoMountEpoch')) focus = path.node.arguments[0].arguments[0];
    },
  });
  assert.ok(focus);
  let epoch = 0;
  const requestMore = { current: true };
  const resume = vm.runInNewContext(`(${source.slice(focus.start, focus.end)})`, {
    hasRequestedMoreForThisEmptyState: requestMore, setPhotoMountEpoch: fn => { epoch = fn(epoch); },
  });
  const h = harness('src/screens/HomeScreen.ios.js', 'ProfileCard', {
    ...modifiers, shapes: { rectangle: () => ({}) }, cardShape: {},
    usePalette: () => ({}), useColorScheme: () => 'dark', useWindowDimensions: () => ({ width: 430 }),
    ZStack: 'ZStack', VStack: 'VStack', HStack: 'HStack', Spacer: 'Spacer', Button: 'Button', Text: 'Text', Image: 'Image',
    RNHostView: 'RNHostView', ProfilePhotoCarousel: 'Carousel', View: 'View', MaskedView: 'Mask', LinearGradient: 'Gradient', BlurView: 'Blur',
    Pressable: 'Pressable', RNText: 'RNText', FeatureIcon: 'Icon', StyleSheet: { absoluteFill: {} },
    font: () => ({}), getActivityLabel: () => '', formatDistance: () => '',
  });
  const candidate = { id: 'same-profile', name: 'Test', gallery: ['https://cdn.example/gallery.jpg'] };
  let opened = 0, rewound = 0;
  const render = () => h.render({ candidate, photoMountEpoch: epoch, onPress: () => opened++, onRewind: () => rewound++ });
  const firstTree = render();
  const initial = findType(firstTree, 'RNHostView');
  const outerFrame = firstTree.props.modifiers.find(modifier => modifier.modifier === 'frame');
  assert.equal(outerFrame.args[0].width, 390);
  assert.equal(outerFrame.args[0].height, 520); // Must be finite under a SwiftUI ScrollView.
  assert.equal(initial.props.matchContents, true);
  const measuredRoot = initial.props.children[0];
  assert.equal(measuredRoot.type, 'View'); assert.equal(measuredRoot.props.collapsable, false);
  assert.equal(measuredRoot.props.style.width, 390); assert.equal(measuredRoot.props.style.height, 520);
  assert.equal(findType(render(), 'RNHostView').props.key, initial.props.key);
  resume(); // Back from details without destroying the HomeScreen.
  const returned = findType(render(), 'RNHostView');
  assert.notEqual(returned.props.key, initial.props.key);
  assert.equal(findType(returned, 'Carousel').props.profile, candidate);
  assert.equal(returned.props.style.width, 390); assert.equal(returned.props.style.height, 520);
  const carousel = findType(returned, 'Carousel');
  assert.equal(carousel.props.tapToChangePhotos, false);
  assert.equal(carousel.props.swipePhotos, true);
  assert.equal(carousel.props.footerBlurHeight, 239);
  const content = carousel.props.children[0];
  assert.equal(content.props.pointerEvents, 'box-none');
  assert.equal(content.props.children[0].props.pointerEvents, 'none'); // Name/summary allow taps through.
  carousel.props.onPress(); assert.equal(opened, 1);
  find(returned, 'ดูรายละเอียดโปรไฟล์เต็มของ Test').props.onPress(); assert.equal(opened, 2);
  find(returned, 'ย้อนกลับไปยังคนที่กดไม่เลือกไว้').props.onPress({ stopPropagation() {} });
  assert.equal(rewound, 1); assert.equal(opened, 2);
  const firstReturnKey = returned.props.key;
  resume();
  assert.notEqual(findType(render(), 'RNHostView').props.key, firstReturnKey);
  h.close();
});

test('five-minute countdown rounds up, never becomes negative, and uses an absolute deadline', () => {
  assert.equal(formatDiscoveryWait(300000, 0), '05:00');
  assert.equal(formatDiscoveryWait(300000, 60100), '04:00');
  assert.equal(formatDiscoveryWait(300000, 299999), '00:01');
  assert.equal(formatDiscoveryWait(300000, 400000), '00:00');
});
test('public gallery merges with the avatar once, versions only the avatar, and accepts a missing avatar', () => {
  const request = (uri, version) => version ? `${uri}?v=${version}` : uri;
  // A gallery can contain the main photo too; deduplicate the request URLs.
  assert.deepEqual(getProfilePhotos({ avatarUri: 'main', avatarRevision: 2, gallery: ['main', 'other', null] }, request), ['main?v=2', 'other']);
  assert.deepEqual(getProfilePhotos({ gallery: ['visible'] }, request), ['visible']);
  assert.deepEqual(getProfilePhotos({}), []);
});
test('photo carousel supports invisible tap zones and accessibility actions, keeps its page after rotation, and clamps a shrinking gallery', () => {
  const styles = { indicatorsRow: 'row', indicatorBar: 'bar', indicatorBarActive: 'active', indicatorBarInactive: 'inactive' };
  const h = harness('src/components/ProfilePhotoCarousel.js', 'PhotoSet', { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', Photo: 'Photo', FeatureIcon: 'Icon', LinearGradient: 'Gradient', styles, StyleSheet: { absoluteFill: {} } });
  const props = { photos: ['main', 'gallery'], profile: { id: 'one' }, width: 320, height: 400, interactive: true, footerBlurHeight: 100 };
  let tree = h.render(props);
  assert.equal(find(tree, 'รูปก่อนหน้า').props.disabled, true);
  assert.equal(find(tree, 'รูปถัดไป').props.disabled, false);
  assert.equal(find(tree, 'รูปถัดไป').props.children.length, 0);
  assert.equal(find(tree, 'รูปก่อนหน้า').props.children.length, 0);
  const scroller = find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี');
  assert.ok(scroller);
  assert.equal(scroller.props.horizontal, true);
  assert.equal(scroller.props.pagingEnabled, true);
  const pages = scroller.props.children.flat();
  assert.equal(pages.length, 2);
  assert.equal(pages[0].props.children[0].props.uri, 'main');
  assert.equal(pages[1].props.children[0].props.uri, 'gallery');
  assert.ok(pages.every(page => page.props.children[0].props.footerBlurHeight === 100));
  const positions = [];
  scroller.props.ref.current = { scrollTo: args => positions.push(args.x) };
  let stopped = false;
  find(tree, 'รูปถัดไป').props.onPress({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true); assert.equal(positions.at(-1), 320);
  tree = h.render(props);
  assert.equal(find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี').props.accessibilityValue.text, 'รูป 2 จาก 2');
  assert.equal(find(tree, 'รูปถัดไป').props.disabled, true);
  const dots = tree.props.children[2].props.children.flat();
  assert.equal(dots[1].props.style.join(','), 'bar,active');
  tree = h.render({ ...props, width: 500 });
  assert.equal(positions.at(-1), 500);
  find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
  tree = h.render(props);
  assert.equal(find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี').props.accessibilityValue.text, 'รูป 1 จาก 2');
  tree = h.render({ ...props, photos: ['main'] });
  assert.equal(tree.props.children[2], null);
  assert.equal(find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี').props.scrollEnabled, false);
  tree = h.render({ ...props, swipePhotos: false });
  assert.equal(find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี').props.scrollEnabled, false);
  assert.ok(find(tree, 'รูปถัดไป'));
  let opened = 0;
  tree = h.render({ ...props, tapToChangePhotos: false, onPress: () => opened++ });
  assert.equal(find(tree, 'รูปถัดไป'), null);
  assert.equal(find(tree, 'รูปก่อนหน้า'), null);
  const direct = find(tree, 'เลื่อนดูรูปโปรไฟล์และแกลเลอรี');
  assert.equal(direct.props.scrollEnabled, true);
  direct.props.children.flat()[0].props.onPress(); assert.equal(opened, 1);
  assert.equal(direct.props.accessibilityActions.length, 2);
});
test('a measured photo offers retry above its navigation target and a successful load removes the error overlay', () => {
  let revealSpinner;
  const h = harness('src/components/ProfilePhotoCarousel.js', 'Photo', { View: 'View', Pressable: 'Pressable', Text: 'Text', CachedImage: 'CachedImage', FeatureIcon: 'Icon', ActivityIndicator: 'Spinner', styles: {}, StyleSheet: { absoluteFill: {} }, setTimeout: callback => { revealSpinner = callback; return 1; }, clearTimeout() {} });
  let opened = 0, stopped = false;
  const props = { uri: 'https://example.test/photo', identity: 'profile:0:1', width: 390, height: 520, onPress: () => opened++ };
  let tree = h.render(props);
  assert.equal(tree.props.children[3], null); // A cache hit should not flash a spinner.
  revealSpinner(); tree = h.render(props);
  assert.ok(tree.props.children[3]); // Slow loading is visible even with explicit dimensions.
  tree.props.children[0].props.onError(); tree = h.render(props);
  const retry = find(tree, 'ลองโหลดรูปอีกครั้ง');
  assert.equal(retry.props.accessibilityRole, 'button');
  retry.props.onPress({ stopPropagation: () => { stopped = true; } }); tree = h.render(props);
  assert.equal(stopped, true); assert.equal(opened, 0);
  assert.equal(tree.props.children[0].props.key, 1);
  tree.props.children[0].props.onLoad(); tree = h.render(props);
  assert.equal(tree.props.children[3], null);
  find(tree, 'ดูรายละเอียดโปรไฟล์').props.onPress(); assert.equal(opened, 1);
  assert.equal(tree.props.children[0].props.source.uri, props.uri);
  h.close();
});
test('a single photo resets load state when the source or profile changes without changing its frame', () => {
  const h = harness('src/components/ProfilePhotoCarousel.js', 'StillPhoto', {
    View: 'View', Photo: 'Photo', StyleSheet: { absoluteFill: {} },
  });
  const props = { profile: { id: 'a' }, photos: ['photo-a'], width: 390, height: 520, onPress() {} };
  const first = h.render(props).props.children[0];
  const unchanged = h.render(props).props.children[0];
  assert.equal(unchanged.props.key, first.props.key);
  assert.equal(first.props.onPress, props.onPress);
  for (const next of [{ ...props, photos: ['photo-b'] }, { ...props, profile: { id: 'b' } }]) {
    const photo = h.render(next).props.children[0];
    assert.notEqual(photo.props.key, first.props.key);
    assert.equal(photo.props.width, 390); assert.equal(photo.props.height, 520);
  }
  h.close();
});
test('each photo keeps one noninteractive blurred footer using the same image and crop, including during loading', () => {
  for (const uri of ['main-photo', 'gallery-photo']) {
    const h = harness('src/components/ProfilePhotoCarousel.js', 'Photo', {
      View: 'View', Pressable: 'Pressable', Text: 'Text', CachedImage: 'CachedImage',
      MaskedView: 'Mask', LinearGradient: 'Gradient', FeatureIcon: 'Icon', ActivityIndicator: 'Spinner', styles: {}, StyleSheet: { absoluteFill: {} },
    });
    const props = { uri, width: 390, height: 680, footerBlurHeight: 163 };
    let tree = h.render(props);
    assert.equal(tree.props.children[1].props.pointerEvents, 'none'); // Eager blur cannot obstruct loading/retry.
    tree.props.children[0].props.onLoad(); tree = h.render(props);
    const footer = tree.props.children[1];
    assert.equal(footer.type, 'Mask'); assert.equal(footer.props.pointerEvents, 'none');
    assert.equal(footer.props.style.height, 163); assert.equal(footer.props.style.bottom, 0);
    const image = footer.props.children[0];
    assert.equal(image.props.source.uri, uri); assert.equal(image.props.blurRadius, 44);
    assert.equal(footer.props.children[1].props.pointerEvents, 'none');
    assert.equal(footer.props.children[1].props.colors.at(-1), 'rgba(8,12,20,0.9)');
    assert.equal(image.props.contentFit, tree.props.children[0].props.contentFit);
    assert.equal(image.props.style.height, 680); assert.equal(image.props.style.width, 390);
    assert.equal(h.render({ ...props, footerBlurHeight: 0 }).props.children[1], null);
    h.close();
  }
});
test('skipped profiles are not timed back into the deck', () => {
  const run = harness('src/hooks/useDiscoveryCooldown.js', 'useDiscoveryCooldown', {});
  const result = run.render();
  assert.equal(result.waiting, false);
  assert.equal(result.timeLeft, '');
  run.close();
});
test('later song passages require full audio and invalid starts never silently play from zero', () => {
  assert.equal(canUseTrackPreview({ previewUrl: 'https://audio.example/preview.m4a', previewStartMs: 0, previewEndMs: 30000 }), true);
  assert.equal(canUseTrackPreview({ previewUrl: 'https://audio.example/preview.m4a', youtubeVideoId: 'abc', previewStartMs: 0, previewEndMs: 15000 }), true);
  assert.equal(canUseTrackPreview({ previewUrl: 'https://audio.example/preview.m4a', previewStartMs: 60000, previewEndMs: 90000 }), false);
  assert.equal(canUseTrackPreview({ previewUrl: 'https://p.scdn.co/mp3-preview/slow', previewStartMs: 0, previewEndMs: 15000 }), true);
  assert.equal(isReliablePreviewUrl('https://p.scdn.co/mp3-preview/slow'), false);
  assert.equal(isReliablePreviewUrl('https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a'), true);
  assert.equal(getPlaybackRange(60000, 90000, 30), null);
  assert.deepEqual(getPlaybackRange(12000, 42000, 30), { start: 12, end: 30 });
  assert.deepEqual(getPlaybackRange(60000, 90000, 180), { start: 60, end: 90 });
});
test('a direct preview matches the same song and refuses a different one', () => {
  const track = { name: 'ขอแค่นี้', artists: 'PUN, Someone', durationMs: 219000 };
  const hit = pickItunesPreview(track, [
    { trackName: 'Other', artistName: 'PUN', previewUrl: 'https://audio.example/other.m4a', trackTimeMillis: 200000 },
    { trackName: 'ขอแค่นี้ (Forever)', artistName: 'PUN', previewUrl: 'https://audio.example/right.m4a', trackTimeMillis: 219048 },
  ]);
  assert.equal(hit.previewUrl, 'https://audio.example/right.m4a');
  assert.equal(pickItunesPreview(track, [{ trackName: 'Unrelated', artistName: 'X', previewUrl: 'https://audio.example/no.m4a' }]), null);
  assert.equal(pickItunesPreview({ name: 'Song', artists: 'A' }, [{ trackName: 'Song', artistName: 'B', previewUrl: 'https://audio.example/wrong-artist.m4a' }]), null);
  assert.equal(previewFitsProviderClip(0, 30000), true);
  assert.equal(previewFitsProviderClip(60000, 90000), false);
  assert.equal(spotifyListenUrl({ externalUrl: 'https://open.spotify.com/track/abc' }), 'https://open.spotify.com/track/abc');
  assert.equal(spotifyListenUrl({ id: '1234567890123456789012' }), 'https://open.spotify.com/track/1234567890123456789012');
  assert.match(spotifyListenUrl({ name: 'Song', artists: 'A' }), /open\.spotify\.com\/search/);
});
test('native playback awaits the selected seek and cancellation prevents late playback', async () => {
  for (const cancel of [false, true]) {
    let finishSeek, plays = 0, sought;
    const player = { pause() {}, play() { plays++; }, seekTo: seconds => { sought = seconds; return new Promise(resolve => { finishSeek = resolve; }); } };
    const h = harness('src/components/TrackPreviewButton.js', 'NativePreview', { useAudioPlayer: () => player, useAudioPlayerStatus: () => ({ isLoaded: true, duration: 30 }), ensureAudioPlaybackMode: async () => {}, getPlaybackRange });
    h.render({ track: { previewUrl: 'audio', previewStartMs: 12000, previewEndMs: 25000 }, onStop() {}, onReady() {} });
    await tick(); assert.equal(sought, 12); assert.equal(plays, 0);
    if (cancel) h.close(); finishSeek(); await tick(); assert.equal(plays, cancel ? 0 : 1);
    if (!cancel) h.close();
  }
});
test('a passage outside the preview still plays the in-app clip instead of opening a music store', async () => {
  const h = harness('src/components/TrackPreviewButton.js', 'PreviewButton', {
    stopCurrentPreview: null, canUseTrackPreview, previewFitsProviderClip, isReliablePreviewUrl, ensureAudioPlaybackMode: async () => {},
    AppState: { addEventListener: () => ({ remove() {} }) }, Alert: { alert() {} }, Pressable: 'Pressable', FeatureIcon: 'Icon', ActivityIndicator: 'Spinner', NativePreview: 'NativePreview', styles: {}, setTimeout: () => 1, clearTimeout() {},
  });
  const props = { track: { name: 'First', artists: 'A', previewUrl: 'https://audio.example/preview.m4a', previewStartMs: 60000, previewEndMs: 90000, externalUrl: 'https://music.apple.com/th/album/song' } };
  let tree = h.render(props);
  tree.props.children[0].props.onPress();
  await tick();
  tree = h.render(props);
  assert.equal(tree.props.children[0].props.accessibilityState.busy, true);
  assert.equal(tree.props.children[1].type, 'NativePreview');
  assert.equal(tree.props.children[1].props.track.previewUrl, 'https://audio.example/preview.m4a');
  assert.equal(tree.props.children[1].props.track.previewStartMs, 0);
  h.close();
});

test('only a server-confirmed recycle clears detail-screen session skips on both platforms', () => {
  for (const file of ['src/screens/DiscoverProfileScreen.js', 'src/screens/DiscoverProfileScreen.ios.js']) {
    const source = readFileSync(file, 'utf8');
    const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
    let effect;
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee?.name === 'useEffect' && source.slice(node.start, node.end).includes('!discoveryRecycledProfileIds?.length')) effect = node.arguments[0];
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
    }
    walk(ast); assert.ok(effect, file);
    let excluded = ['recycled', 'still-pending', 'liked'];
    const context = vm.createContext({ discoveryRecycledProfileIds: [], setSessionExcludedIds: fn => { excluded = fn(excluded); } });
    const run = vm.runInContext(`(${source.slice(effect.start, effect.end)})`, context);
    run(); assert.deepEqual(excluded, ['recycled', 'still-pending', 'liked']);
    context.discoveryRecycledProfileIds = ['recycled']; run();
    assert.deepEqual(excluded, ['still-pending', 'liked']);
  }
});

test('profile details start collapsed, show activity/availability, and do not render a second photo gallery', () => {
  const androidSource = readFileSync('src/screens/DiscoverProfileScreen.js', 'utf8');
  const iosSource = readFileSync('src/screens/DiscoverProfileScreen.ios.js', 'utf8');
  const homeAndroidSource = readFileSync('src/screens/HomeScreen.js', 'utf8');
  const homeIosSource = readFileSync('src/screens/HomeScreen.ios.js', 'utf8');

  assert.match(androidSource, /const \[detailsExpanded, setDetailsExpanded\] = useState\(false\)/);
  assert.match(androidSource, /setDetailsExpanded\(false\)/);
  assert.match(androidSource, /ดูรายละเอียดทั้งหมด/);
  assert.match(androidSource, /กิจกรรมที่ชอบ/);
  assert.doesNotMatch(androidSource, /กิจกรรมและเวลาที่สะดวก/);
  assert.doesNotMatch(androidSource, /โปรไฟล์ที่ข้ามจะกลับมา/);
  assert.doesNotMatch(androidSource, /galleryImages\.map/);

  assert.match(iosSource, /const \[detailsExpanded, setDetailsExpanded\] = useState\(false\)/);
  assert.match(iosSource, /setDetailsExpanded\(false\)/);
  assert.match(iosSource, /import \{ ProfileCardView, getStyles as getProfileCardStyles \} from '\.\/DiscoverProfileScreen\.js'/);
  assert.match(iosSource, /<ProfileCardView fullScreen candidate=\{candidate\}/);
  assert.doesNotMatch(iosSource, /galleryImages\.map/);
  assert.match(iosSource, /cardHeight=\{cardViewportHeight\}/);
  assert.match(iosSource, /buttonStyle\('glass'\)/);

  assert.match(homeAndroidSource, /ดูรายละเอียดโปรไฟล์ของ/);
  assert.match(homeIosSource, /ดูรายละเอียดโปรไฟล์เต็มของ/);
  assert.match(homeIosSource, /style=\{\{ width: cardWidth, height: cardHeight \}\}/);
});

test('compatibility never fabricates a score and deduplicated songs preserve their saved passage', () => {
  assert.equal(getDiscoverySummary({}).score, null);
  assert.equal(getDiscoverySummary({ compatibility: 'not-a-score' }).score, null);
  assert.equal(getDiscoverySummary({ compatibility: ' ' }).score, null);
  assert.equal(getDiscoverySummary({ compatibility: false }).score, null);
  assert.equal(getDiscoverySummary({ compatibility: 101 }).score, null);
  assert.equal(getDiscoverySummary({ compatibility: 0 }).score, 0);
  assert.equal(getDiscoverySummary({ compatibility: '81.2', matchReasons: [' ', 'ชอบวิ่งเหมือนกัน'] }).score, 81);
  assert.equal(getDiscoverySummary({ matchReasons: ['ชอบวิ่งเหมือนกัน', null] }).reason, 'ชอบวิ่งเหมือนกัน');
  const track = { id: 'one', name: 'Song', previewStartMs: 60000, previewEndMs: 85000 };
  assert.deepEqual(getUniqueProfileTracks([track, { ...track }, null, { id: 'missing-title' }]), [track]);
});

test('reports prevent double submission, close after success, and preserve input after failure for retry', async () => {
  let complete, calls = 0, closed = 0, failed = true;
  const h = harness('src/components/ReportModal.js', 'ReportModal', {
    REPORT_REASONS: [{ id: 'other', label: 'อื่น ๆ', icon: 'ellipsis' }],
    Modal: 'Modal', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', ActivityIndicator: 'Spinner', FeatureIcon: 'Icon', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, StyleSheet: { absoluteFill: {} }, styles: {}, showAlert() {},
    useLiquidGlass: () => false, useSheetGlassTint: () => undefined, GlassBackground: 'GlassBackground', GlassIconButton: 'GlassIconButton',
  });
  const props = { isOpen: true, onClose: () => closed++, onSubmit: () => { calls++; return new Promise((resolve, reject) => { complete = () => failed ? reject(new Error('offline')) : resolve(); }); } };
  const walk = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of (node.props?.children || []).flat(Infinity)) { const result = walk(child, predicate); if (result) return result; }
    return null;
  };
  let tree = h.render(props);
  walk(tree, node => node.type === 'TextInput').props.onChangeText('keep this draft');
  tree = h.render(props);
  const first = find(tree, 'ส่งรายงาน').props.onPress();
  const duplicate = find(tree, 'ส่งรายงาน').props.onPress();
  assert.equal(calls, 1); complete(); await Promise.all([first, duplicate]);
  tree = h.render(props);
  assert.equal(closed, 0); assert.equal(walk(tree, node => node.type === 'TextInput').props.value, 'keep this draft');
  failed = false; const retry = find(tree, 'ส่งรายงาน').props.onPress(); complete(); await retry;
  assert.equal(calls, 2); assert.equal(closed, 1);
  h.close();
});

test('discovery banner distinguishes loading, error, waiting and actual candidate data', () => {
  const h = harness('src/screens/HomeScreen.js', 'DailyPickBanner', {
    useTheme: () => ({ colors: {}, isDark: false }), getDiscoverySummary,
    Pressable: 'Pressable', View: 'View', Text: 'Text', LinearGradient: 'Gradient', FeatureIcon: 'Icon', styles: {}, StyleSheet: { absoluteFill: {} },
  });
  for (const state of ['loading', 'error']) {
    const tree = h.render({ candidate: null, state });
    assert.doesNotMatch(JSON.stringify(tree), /ยังไม่มีคนที่ตรงกัน/);
    assert.match(tree.props.accessibilityLabel, state === 'loading' ? /กำลังค้นหา/ : /ยังโหลด/);
  }
  assert.match(h.render({ candidate: null, state: 'empty' }).props.accessibilityLabel, /ยังไม่มีคำแนะนำในหมวดนี้/);
  assert.doesNotMatch(JSON.stringify(h.render({ candidate: null, state: 'empty' })), /โปรไฟล์ที่ข้ามจะกลับมา/);
  const candidate = h.render({ candidate: { name: 'Test' }, state: 'card' });
  assert.doesNotMatch(JSON.stringify(candidate), /98%|ตรงกับตาราง/);
  h.close();
});

test('profile safety can report before matching and blocks only after confirmation and server completion', async () => {
  for (const accepted of [false, true]) {
    let buttons, complete, blockCalls = 0, closed = 0;
    const h = harness('src/components/ProfileSafetyActions.js', 'ProfileSafetyActions', {
      useAppActions: () => ({ reportContent() {}, blockUser: () => { blockCalls++; return new Promise(resolve => { complete = resolve; }); } }),
      useConfirm: () => ({ confirm: async () => accepted }), useToast: () => ({ showToast() {} }), useTheme: () => ({ colors: {} }),
      Platform: { OS: 'android' }, Alert: { alert: (_title, _body, options) => { buttons = options; } },
      Pressable: 'Pressable', FeatureIcon: 'Icon', ReportModal: 'ReportModal',
    });
    const props = { profile: { id: 'target', name: 'Test' }, onBlocked: () => closed++ };
    let tree = h.render(props);
    find(tree, 'รายงานหรือบล็อก Test').props.onPress();
    buttons.find(button => button.text === 'รายงานโปรไฟล์').onPress();
    tree = h.render(props); assert.equal(tree.props.children[1].props.isOpen, true); assert.equal(blockCalls, 0);
    buttons.find(button => button.text === 'บล็อกผู้ใช้').onPress(); await tick();
    assert.equal(blockCalls, accepted ? 1 : 0); assert.equal(closed, 0);
    if (accepted) { complete(); await tick(); assert.equal(closed, 1); }
    h.close();
  }
});

test('music errors remain available to the row without a blocking alert', async () => {
  let alerts = 0, latest;
  const h = harness('src/components/TrackPreviewButton.js', 'PreviewButton', {
    stopCurrentPreview: null, canUseTrackPreview, previewFitsProviderClip, isReliablePreviewUrl, spotifyListenUrl, ensureAudioPlaybackMode: async () => {},
    AppState: { addEventListener: () => ({ remove() {} }) }, Alert: { alert: () => alerts++ }, Pressable: 'Pressable', FeatureIcon: 'Icon', ActivityIndicator: 'Spinner', NativePreview: 'NativePreview', YouTubePreview: 'YouTubePreview', styles: {}, setTimeout: () => 1, clearTimeout() {},
  });
  const props = { track: { name: 'Song', id: 'one' }, onStatusChange: value => { latest = value; } };
  let tree = h.render(props); tree.props.children[0].props.onPress(); await tick(); tree = h.render(props);
  assert.equal(alerts, 0); assert.equal(latest.active, false); assert.match(latest.error, /ไม่พบเสียงตัวอย่าง/);
  assert.match(tree.props.children[0].props.accessibilityLabel, /Song.*ลองอีกครั้ง/);
  h.close();
});


