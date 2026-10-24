import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { chatImageSize, chatTrackWidth, isGifMessage } from '../src/utils/chatMediaLayout.js';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };

// Execute the real render and handlers without mounting native UI or fetching media.
function render(file, name, props, extra = {}) {
  const source = readFileSync(file, 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  const fn = ast.program.body.map(n => n.declaration || n).find(n => n.id?.name === name);
  assert.ok(fn, name);
  const components = {};
  babel.traverse(ast, { JSXIdentifier(p) { if (/^[A-Z]/.test(p.node.name)) components[p.node.name] = p.node.name; } });
  const stylesNode = ast.program.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0]?.id?.name === 'styles');
  const code = babel.transformSync(source.slice(fn.start, fn.end), { configFile: false, babelrc: false, plugins: [presetRequire('@babel/plugin-transform-react-jsx')] }).code;
  const value = initial => ({ value: initial, interpolate: () => 1 });
  const context = vm.createContext({
    ...components, React, console,
    Animated: { Value: function(initial) { return value(initial); }, View: 'AnimatedView' },
    StyleSheet: { create: v => v, hairlineWidth: 0.5, absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
    Platform: { OS: 'ios' }, AppState: { currentState: 'active' },
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect() {},
    useMemo: fn => fn(), useCallback: fn => fn,
    useSharedValue: initial => ({ get: () => initial }), useAnimatedStyle: fn => fn(),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }), peekCachedConversationKey: () => null,
    useTheme: () => ({ isDark: true }), useLiquidGlass: () => true,
    useWindowDimensions: () => ({ width: 360, height: 800 }),
    useDecryptedMedia: () => ({ uri: 'file:///authorized-test-image' }),
    useChatPresence: () => ({ isOnline: false }),
    usePeerMediaView: () => null, useAppActions: () => ({}),
    isProtectedViewMode: mode => ['once', 'replay'].includes(mode),
    VIDEO_MODES: { once: 'ดูครั้งเดียว', replay: 'ดูซ้ำได้' },
    getQuickReactionsSync: () => ['❤️', '👍', '😂', '😮', '😢', '🔥'],
    getChatImageBubbleSize: () => ({ width: 220, height: 220 }), getCachedAspectRatio: () => null,
    formatTime: () => '12:00', chatImageSize, chatTrackWidth, isGifMessage, ...extra,
  });
  if (stylesNode) vm.runInContext(source.slice(stylesNode.start, stylesNode.end), context);
  vm.runInContext(`${code}; globalThis.rendered = ${name}(props);`, Object.assign(context, { props }));
  return context.rendered;
}
function all(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [ ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => all(child, type)) ];
}
const focus = (item, extra) => render('src/components/InstagramMessageOverlay.js', 'InstagramMessageOverlay', {
  isOpen: true, item: { id: 'sample', senderId: 'me', ...item }, currentUserId: 'me', currentConversationId: 'chat',
}, extra);

test('focused song is rendered above one root-sized backdrop, without a duplicate text caption', () => {
  const tree = focus({ mediaType: 'track', trackName: 'Song', text: '🎵 Song', albumArt: 'cover', artists: 'Artist', layout: { x: 90, y: 250, width: 220, height: 220 } });
  const root = all(tree, 'GestureHandlerRootView')[0];
  const [backdrop, touchLayer] = root.props.children;
  assert.equal(backdrop.type, 'AnimatedView');
  assert.equal(backdrop.props.pointerEvents, 'none');
  assert.equal(backdrop.props.style[0].bottom, 0);
  assert.equal(backdrop.props.style[0].top, 0);
  assert.equal(backdrop.props.style[1].transform, undefined);
  assert.equal(all(backdrop, 'BlurView').length, 1);
  const card = all(touchLayer, 'TrackShareCard')[0];
  assert.ok(card);
  // Music cards use the phone-size width (210/240/260), not the bubble layout.
  assert.equal(card.props.size, chatTrackWidth(360));
  assert.equal(card.props.name, 'Song');
  const focusedBubble = all(touchLayer, 'AnimatedView').find(n => all(n, 'TrackShareCard').length && n.props.style?.some?.(style => style?.paddingHorizontal === 0));
  assert.ok(focusedBubble, 'the copied card clears the text bubble horizontal/vertical padding');
  assert.equal(all(touchLayer, 'Text').some(n => n.props.children.includes('🎵 Song')), false);
  assert.equal(tree.props.presentationStyle, 'overFullScreen');
  assert.equal(tree.props.navigationBarTranslucent, true);
});

test('preview quick actions close the modal before acting and never open/read the room', () => {
  const calls = [], frames = [];
  const conversation = { id: 'c', name: 'Friend', messages: [] };
  const tree = render('src/components/ChatPreviewModal.js', 'ChatPreviewModal', {
    visible: true, conversation, currentUserId: 'me',
    onClose: () => calls.push('close'), onOpenChat: () => calls.push('open'),
    onMarkUnread: room => calls.push(`unread:${room.id}`), onTogglePin() {}, onDelete() {},
  }, {
    useTheme: () => ({ colors: { card: '#26221E', surfaceRaised: '#34302C', line: '#444', ink: '#fff' }, isDark: true }),
    useWindowDimensions: () => ({ width: 360, height: 640, fontScale: 1 }),
    useSheetGlassTint: () => '#222', toDate: () => null,
    chatMemberSettings: () => ({}), spacing: {}, type: {},
    requestAnimationFrame: fn => { frames.push(fn); },
  });
  const button = all(tree, 'Pressable').find(n => all(n, 'Text').some(t => t.props.children.includes('ทำเครื่องหมายว่ายังไม่อ่าน')));
  assert.ok(button);
  button.props.onPress();
  assert.deepEqual(calls, ['close']);
  frames.forEach(fn => fn());
  assert.deepEqual(calls, ['close', 'unread:c']);
  const list = all(tree, 'FlatList')[0];
  assert.equal(list.props.renderItem({ item: { id: 'gif', mediaType: 'gif' } }).props.isPreview, true);
  const dismiss = all(tree, 'Pressable').find(n => n.props.accessibilityLabel === 'แตะด้านนอกเพื่อปิดตัวอย่างแชต');
  assert.ok(dismiss);
  assert.equal(all(tree, 'Pressable').some(n => n.props.accessibilityLabel === 'ปิดตัวอย่างแชต'), false);
  dismiss.props.onPress();
  assert.deepEqual(calls, ['close', 'unread:c', 'close']);
});

test('focus uses an uninterrupted tonal backdrop when native glass is unavailable', () => {
  const tree = focus({ text: 'Hello' }, { useLiquidGlass: () => false });
  assert.equal(all(tree, 'BlurView').length, 0);
  assert.equal(all(tree, 'TrackShareCard').length, 0);
  assert.ok(all(tree, 'Text').some(n => n.props.children.includes('Hello')));
});

test('focusing a protected photo keeps the preview non-opening', () => {
  const tree = focus({ mediaType: 'image', mediaUrl: 'protected', viewMode: 'once', text: '[รูปภาพ]' });
  const photo = all(tree, 'ChatProtectedImageBubble')[0];
  assert.equal(photo.props.previewOnly, true);
});

test('a consumed once-only photo explains its state and cannot reopen or record another view', async () => {
  let calls = 0;
  const tree = render('src/components/ChatProtectedImageBubble.js', 'ChatProtectedImageBubble', {
    item: { id: 'once', mediaUrl: 'protected', viewMode: 'once' }, currentUserId: 'viewer', conversationId: 'chat',
  }, { usePeerMediaView: () => 123, ScreenCapture: { preventScreenCaptureAsync: async () => { calls++; } }, recordMediaView: async () => { calls++; } });
  const button = all(tree, 'Pressable')[0];
  assert.match(button.props.accessibilityLabel, /เปิดดูแล้ว.*ครั้งเดียว/);
  assert.doesNotMatch(button.props.accessibilityLabel, /แตะเพื่อดู/);
  await button.props.onPress();
  assert.equal(calls, 0);
});

test('long-pressing either protected-photo mode opens only the menu; a subsequent fresh tap still opens normally', async () => {
  for (const viewMode of ['once', 'replay']) {
    for (const mine of [true, false]) {
      const actions = [], selections = [];
      const tree = render('src/components/ChatProtectedImageBubble.js', 'ChatProtectedImageBubble', {
        item: { id: 'protected', mediaUrl: 'photo.enc', viewMode }, mine,
        conversationId: 'chat', currentUserId: 'viewer', onLongPress: (_event, details) => selections.push(details),
      }, {
        ScreenCapture: { preventScreenCaptureAsync: async () => actions.push('capture'), allowScreenCaptureAsync: async () => {} },
        recordMediaView: async () => actions.push('view'),
      });
      const button = all(tree, 'Pressable')[0];
      assert.equal(button.props.nativeGestureSurface, true, 'never mount a second SwiftUI button over the gesture');
      button.props.onPressIn();
      button.props.onLongPress({ nativeEvent: { pageX: 200, pageY: 400, locationX: 20, locationY: 30 }, stopPropagation() {} });
      await button.props.onPress();
      assert.equal(selections.length, 1);
      assert.equal(selections[0].layout.x, 180);
      assert.equal(selections[0].layout.y, 370);
      assert.equal(selections[0].layout.width, selections[0].layout.height);
      assert.deepEqual(actions, [], 'long press and its release must not record a view or open the viewer');
      button.props.onPressIn();
      await button.props.onPress();
      assert.deepEqual(actions, mine ? ['capture'] : ['capture', 'view']);
    }
  }
});

test('iOS and Android forward protected-card coordinates without waiting for another measurement', () => {
  for (const file of ['src/screens/ChatRoomScreen.ios.js', 'src/screens/ChatRoomScreen.js']) {
    const source = readFileSync(file, 'utf8');
    const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
    let fn;
    babel.traverse(ast, { VariableDeclarator(path) {
      if (path.node.id.name === 'handleLongPress') fn = path.node.init.type === 'CallExpression' ? path.node.init.arguments[0] : path.node.init;
    } });
    assert.ok(fn);
    const selected = [], details = { layout: { x: 10, y: 100, width: 198, height: 198 }, imageSize: { width: 198, height: 198 }, aspectRatio: 1 };
    const context = vm.createContext({
      item: { id: 'photo', viewMode: 'once' }, longPressAtRef: { current: 0 }, longPressRef: { current: false },
      lastTapAtRef: { current: 0 }, doubleTapTimerRef: { current: null },
      currentImageSizeRef: { current: { width: 100, height: 260 } }, currentRatioRef: { current: 0.5 },
      bubbleRef: { current: { measureInWindow() { throw Error('must not wait for another native measurement'); } } },
      onSelectMessage: value => selected.push(value), details,
    });
    vm.runInContext(`(${source.slice(fn.start, fn.end)})(undefined, details)`, context);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].layout, details.layout);
    assert.equal(selected[0].imageSize, details.imageSize);
  }
});

test('protected focus keeps a locked preview and skips the extra clipboard decode', () => {
  for (const viewMode of ['once', 'replay']) {
    const requests = [];
    const tree = focus({ mediaType: 'image', mediaUrl: 'photo.enc', viewMode, text: '[รูปภาพ]', imageSize: { width: 80, height: 260 } }, {
      useDecryptedMedia: url => { requests.push(url); return { uri: null }; },
      getCachedAspectRatio: () => { throw Error('protected square must not use the natural-photo dimensions'); },
    });
    assert.deepEqual(requests, [null]);
    assert.equal(all(tree, 'ChatProtectedImageBubble')[0].props.previewOnly, true);
    assert.equal(all(tree, 'DecryptedChatImage').length, 0);
    const menuLabels = all(tree, 'MenuRow').map(row => row.props.label);
    assert.equal(menuLabels.includes('คัดลอกรูปภาพ'), false);
    assert.equal(menuLabels.includes('บันทึกรูปภาพ'), false);
  }
});

test('protected photo has a finite square surface on small phones and cannot open from preview', async () => {
  for (const isPreview of [false, true]) {
    let opened = 0;
    const tree = render('src/components/ChatProtectedImageBubble.js', 'ChatProtectedImageBubble', {
      item: { id: 'once', mediaUrl: 'protected', viewMode: 'once' },
      currentUserId: 'viewer', conversationId: 'chat', previewOnly: true, isPreview,
    }, {
      useWindowDimensions: () => ({ width: 320, height: 640 }),
      ScreenCapture: { preventScreenCaptureAsync: async () => { opened++; } },
      recordMediaView: async () => { opened++; },
    });
    const geometry = tree.props.style[1];
    assert.equal(geometry.width, isPreview ? 140 : 176);
    assert.equal(geometry.height, geometry.width);
    const button = all(tree, 'Pressable')[0];
    assert.equal(button.props.disabled, true);
    await button.props.onPress();
    assert.equal(opened, 0);
  }
});

test('GIF preview keeps media metadata over the image without creating a text bubble', () => {
  const tree = render('src/components/DecryptedChatImage.js', 'DecryptedChatImage', {
    mediaUrl: 'https://example.invalid/test.gif', isPreview: true, isGif: true,
  }, { isRemoteImageUrl: () => true });
  assert.equal(tree.props.style[1].width, 140);
  assert.equal(tree.props.style[1].height, 140);
  const badge = all(tree, 'View').find(n => n.props.style?.position === 'absolute' && n.props.style?.left === 8);
  assert.ok(badge);
  assert.equal(badge.props.style.bottom, 8);
  assert.equal(all(badge, 'Text')[0].props.children[0], 'GIF');
  assert.equal(all(tree, 'Text').some(n => n.props.children.includes('[GIF]')), false);
});

test('native attachment menu opens on tap and selecting an item calls only its action', () => {
  const calls = [];
  const modifiers = Object.fromEntries(['accessibilityLabel', 'buttonStyle', 'frame', 'menuIndicator', 'menuStyle']
    .map(name => [name, value => ({ name, value })]));
  const tree = render('src/components/ChatAttachmentMenu.ios.js', 'ChatAttachmentMenu', {
    color: '#fff', onPhotos: () => calls.push('photos'), onCamera: () => calls.push('camera'),
    onGif: () => calls.push('gif'), onMusic: () => calls.push('music'),
  }, modifiers);
  assert.equal(tree.type, 'RNHostView', 'an RN bridge must separate the two SwiftUI hosts');
  const host = all(tree, 'Host')[0];
  assert.ok(host, 'menu presentation must have its own host');
  assert.equal(host.props.ignoreSafeArea, 'all', 'the small menu host must not apply keyboard avoidance a second time');
  assert.equal(all(host, 'TextField').length, 0, 'the active field stays in the composer host');
  const menu = all(host, 'Menu')[0];
  assert.ok(menu);
  assert.equal(menu.props.onPrimaryAction, undefined, 'a primary action would require holding to open');
  assert.equal(menu.props.label.type, 'Image', 'the label must not contain a competing button');
  assert.deepEqual(calls, [], 'rendering must not open any picker or request permission');
  all(tree, 'Button').find(n => n.props.label === 'GIF').props.onPress();
  assert.deepEqual(calls, ['gif']);
  const withoutMusic = render('src/components/ChatAttachmentMenu.ios.js', 'ChatAttachmentMenu', {}, modifiers);
  assert.equal(all(withoutMusic, 'Button').some(n => n.props.label === 'เพลง'), false);
});

test('selecting a native attachment closes other pickers and preserves the message draft', () => {
  const source = readFileSync('src/screens/ChatRoomScreen.ios.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let callback;
  babel.traverse(ast, { VariableDeclarator(path) {
    if (path.node.id.name === 'handleOpenAttachment') callback = path.node.init.arguments[0];
  } });
  assert.ok(callback);
  for (const allowed of [true, false]) {
    for (const target of ['photos', 'camera', 'gif', 'music']) {
      const calls = [], state = { photos: true, gif: true, music: true, camera: false, emoji: true };
      const context = vm.createContext({
        Keyboard: { dismiss: () => calls.push('dismiss') }, canUseSpotify: allowed,
        runTextFieldCommand: command => calls.push(command),
        setShowQuickEmoji: value => { state.emoji = value; },
        setIsMediaPickerOpen: value => { state.photos = value; },
        setIsGiphyPickerOpen: value => { state.gif = value; },
        setIsSpotifyPickerOpen: value => { state.music = value; },
        setCameraOpen: value => { state.camera = value; },
        target,
      });
      vm.runInContext(`(${source.slice(callback.start, callback.end)})(target)`, context);
      assert.deepEqual(calls, ['dismiss', 'blur'], 'no clear/setText command may erase the draft');
      assert.deepEqual(state, {
        photos: target === 'photos', camera: target === 'camera', gif: target === 'gif',
        music: target === 'music' && allowed, emoji: false,
      });
    }
  }
});

test('closing an attachment flow restores text field focus when previously typing', () => {
  const source = readFileSync('src/screens/ChatRoomScreen.ios.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let restoreCallback;
  babel.traverse(ast, { VariableDeclarator(path) {
    if (path.node.id.name === 'restoreTextFieldFocus') restoreCallback = path.node.init.arguments[0];
  } });
  assert.ok(restoreCallback);
  const calls = [];
  const context = vm.createContext({
    wasFocusedBeforeAttachmentRef: { current: true },
    runTextFieldCommand: command => { calls.push(command); return Promise.resolve(); },
    setTimeout: fn => fn(),
  });
  vm.runInContext(`(${source.slice(restoreCallback.start, restoreCallback.end)})()`, context);
  assert.deepEqual(calls, ['focus']);
  assert.equal(context.wasFocusedBeforeAttachmentRef.current, false);

  // Calling it when not previously typing should do nothing
  const calls2 = [];
  const context2 = vm.createContext({
    wasFocusedBeforeAttachmentRef: { current: false },
    runTextFieldCommand: command => { calls2.push(command); return Promise.resolve(); },
    setTimeout: fn => fn(),
  });
  vm.runInContext(`(${source.slice(restoreCallback.start, restoreCallback.end)})()`, context2);
  assert.deepEqual(calls2, []);
});

test('send button is inset within composer capsule and chat preview mounts SwiftUI Menu', () => {
  const iosChat = readFileSync('src/screens/ChatRoomScreen.ios.js', 'utf8');
  assert.match(iosChat, /frame\(\{\s*width:\s*36,\s*height:\s*36\s*\}\)/, 'send button is a compact 36pt frame');
  assert.match(iosChat, /frame\(\{\s*width:\s*44,\s*height:\s*44\s*\}\)/, 'header buttons are uniform 44x44 on iOS');
  assert.match(iosChat, /buttonBorderShape\('circle'\)/, 'send button has a circular shape to match input capsule');
  assert.match(iosChat, /controlSize\('small'\)/, 'send button uses small control size to prevent overflow');
  assert.match(iosChat, /hasText \? 36 : composerAccessoryWidth/, 'slot shrinks to 36pt while typing to stay within pill boundary');
  // The header floats on the content; no blurred slab sits under the status bar.
  assert.doesNotMatch(iosChat, /MaskedView/, 'no blur slab under the status bar');
  // Per-chat settings live in the shared sheet, in plain language.
  assert.match(iosChat, /<ChatSettingsSheet/);
  const settingsSheet = readFileSync('src/components/ChatSettingsSheet.js', 'utf8');
  assert.match(settingsSheet, /ใช้เฉพาะแชตกับ/);
  assert.doesNotMatch(settingsSheet + iosChat, /บันทึกการตั้งค่าเฉพาะบัญชีนี้ในฐานข้อมูล/);

  const sharedChat = readFileSync('src/screens/ChatRoomScreen.js', 'utf8');
  assert.match(sharedChat, /capsuleSendButton:\s*\{[\s\S]*?height:\s*36[\s\S]*?width:\s*36/, 'capsuleSendButton is 36x36 on shared platform fallback');
  assert.match(sharedChat, /headerCallBtn:\s*\{[\s\S]*?height:\s*44[\s\S]*?width:\s*44/, 'headerCallBtn is 44x44');
  assert.match(sharedChat, /backgroundColor:\s*'#2563EB'/, 'send button uses #2563EB');
  assert.match(sharedChat, /inputCapsule:\s*\{[\s\S]*?minHeight:\s*46[\s\S]*?maxHeight:\s*110[\s\S]*?borderRadius:\s*23[\s\S]*?flexDirection:\s*'row'[\s\S]*?alignItems:\s*'center'/);
  assert.match(sharedChat, /contentContainerStyle=\{\[styles\.messageList,\s*\{\s*paddingTop:\s*16,\s*paddingBottom:\s*16,\s*paddingHorizontal:\s*16\s*\}\]\}/);
  assert.match(sharedChat, /<ChatSettingsSheet/);
  assert.doesNotMatch(sharedChat, /บันทึกการตั้งค่าเฉพาะบัญชีนี้ในฐานข้อมูล/);
  assert.match(sharedChat, /e2eeBanner:\s*\{[\s\S]*?paddingHorizontal:\s*12[\s\S]*?paddingVertical:\s*6[\s\S]*?borderRadius:\s*14/);
  assert.match(sharedChat, /e2eeText:\s*\{[\s\S]*?color:\s*'#9CA3AF'[\s\S]*?fontSize:\s*12/);

  const trackCard = readFileSync('src/components/TrackShareCard.js', 'utf8');
  assert.doesNotMatch(trackCard, /SpinningDisc/, 'SpinningDisc vinyl graphic is removed');
  assert.match(trackCard, /height:\s*72/, 'track card height is 72');
  assert.match(trackCard, /borderRadius:\s*12/, 'cover art border radius is 12');
  assert.match(trackCard, /width:\s*52,\s*height:\s*52/, 'cover art is 52x52');

  const previewModal = readFileSync('src/components/ChatPreviewModal.js', 'utf8');
  assert.doesNotMatch(previewModal, /ChatPreviewNativeMenu/, 'redundant ChatPreviewNativeMenu is removed');
  assert.doesNotMatch(previewModal, /previewTopFade/, 'top fade gradient creating dark artifact is removed');
  assert.match(previewModal, /testID="PreviewHeader"[\s\S]*?เพื่อนใหม่/, 'header displays avatar and partner name');
  // One action list on both platforms: 48pt rows, a divider before the
  // destructive item, and red text/icon only for that item.
  assert.match(previewModal, /contextActions:\s*\{[\s\S]*?width:\s*'90%'[\s\S]*?maxWidth:\s*360[\s\S]*?borderRadius:\s*20/);
  assert.match(previewModal, /actionRow:\s*\{[\s\S]*?height:\s*48/);
  assert.match(previewModal, /actionDivider:\s*\{[\s\S]*?height:\s*1/);
  assert.match(previewModal, /actionLabel:\s*\{[\s\S]*?fontSize:\s*15/);
  assert.match(previewModal, /numberOfLines=\{1\}/);
  assert.match(previewModal, /item\.danger\s*\?\s*'#EF4444'/);
  assert.match(previewModal, /paddingHorizontal:\s*16/);

  // Preview cards: 60% of the screen, at most 225pt (shared helper).
  assert.match(trackCard, /chatTrackWidth\(/);
  assert.equal(chatTrackWidth(360, true), 216);
  assert.equal(chatTrackWidth(430, true), 225);

  const chatScreen = readFileSync('src/screens/ChatScreen.js', 'utf8');
  assert.match(chatScreen, /onMarkUnread=\{\(conversation\) => handleInboxSetting\(conversation, \{ markedUnread: true \}\)\}/);
  assert.match(chatScreen, /onTogglePin=\{\(conversation\) => handleInboxSetting\(conversation, \{ isPinned: chatMemberSettings\(conversation, currentUserId\)\.isPinned !== true \}\)\}/);
});


