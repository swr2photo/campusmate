import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as policy from '../src/components/native-base-policy.js';

const require = createRequire(import.meta.url), babel = require('@babel/core');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};
const element = (type, props = {}, ...children) => ({ type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } });
const context = { Provider: 'GestureContext', value: false };
function harness(file) {
  let cursor = 0, effects = [], inside = false;
  const slots = [];
  const React = { createElement: element, Fragment: Symbol.for('react.fragment'),
    forwardRef: fn => fn, createContext: () => context,
    useContext: () => inside, useColorScheme: () => 'dark',
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useImperativeHandle(ref, fn) { if (ref) ref.current = fn(); },
    Children: { map: (children, fn) => [children].flat(Infinity).filter(child => child !== null && child !== undefined).map(fn) },
    isValidElement: child => Boolean(child && typeof child === 'object' && child.type),
    cloneElement: (child, props, ...children) => element(child.type, { ...child.props, ...props }, ...(children.length ? children : [child.props.children])),
  };
  const modifiers = new Proxy({}, { get: (_, name) => name === '__esModule' ? true : (...args) => ({ type: name, args }) });
  const native = { View: 'View', Pressable: 'GesturePressable', TouchableOpacity: 'GestureOpacity', TouchableHighlight: 'GestureHighlight', TouchableWithoutFeedback: 'GestureWithoutFeedback',
    StyleSheet: { flatten, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } }, useColorScheme: () => 'dark' };
  const swift = Object.fromEntries(['Button', 'Host', 'Rectangle', 'UnevenRoundedRectangle', 'HStack', 'ProgressView', 'Text', 'Image', 'TextField'].map(name => [name, `Swift${name}`]));
  swift.useNativeState = initial => {
    const ref = React.useRef();
    return ref.current ||= { value: initial, get() { return this.value; }, set(value) { this.value = value; } };
  };
  modifiers.shapes = undefined;
  const imports = {
    react: React, 'react-native': native,
    '@expo/ui/swift-ui': swift,
    '@expo/ui/swift-ui/modifiers': new Proxy(modifiers, { get: (target, key) => key === 'shapes' ? { rectangle: () => 'rectangle' } : target[key] }),
    './native-base-policy': policy,
    './NativeInteractionContext': { __esModule: true, default: context },
    './NativeCard': { __esModule: true, default: 'NativeCard', NativeCardBackground: 'NativeCardBackground' },
    './NativeButton.js': { __esModule: true, default: 'GestureButton' },
    '../theme': { useTheme: () => ({ colors: { primary: '#2869C7', ink: '#FFFFFF', inkMuted: '#ABABAB' }, isDark: true }) },
  };
  const source = readFileSync(file, 'utf8');
  const code = babel.transformSync(source, { configFile: false, babelrc: false,
    plugins: [presetRequire('@babel/plugin-transform-react-jsx'), presetRequire('@babel/plugin-transform-modules-commonjs')] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(imports[name], `Unexpected import ${name}`); return imports[name];
  } });
  return { React, exports: module.exports, setInside: value => { inside = value; },
    render(name, props, ref) { cursor = 0; effects = []; const result = module.exports[name](props, ref); effects.forEach(fn => fn()); return result; } };
}
function walk(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = walk(child, type); if (found) return found; }
  return null;
}
function modifier(node, name) { return node.props.modifiers.find(item => item.type === name)?.args; }
const layout = (width, height) => ({ nativeEvent: { layout: { width, height } } });

test('only finite nonzero bounds can mount native content; opaque content surfaces retain their real color', () => {
  for (const pair of [[0, 44], [44, 0], [-1, 44], [Infinity, 44], [44, NaN]]) assert.equal(policy.nativeBounds({ width: pair[0], height: pair[1] }), null);
  assert.deepEqual(policy.nativeBounds({ width: 320, height: 44 }), { width: 320, height: 44 });
  assert.equal(policy.nativeSurfaceColor({ backgroundColor: '#ABCDEF' }), '#ABCDEF');
  assert.equal(policy.nativeSurfaceColor({ backgroundColor: 'transparent' }), null);
});

test('button labels use visible text and explicit labels without exposing image URLs', () => {
  const children = element('View', {}, element('FeatureIcon', { name: 'heart.fill' }), element('Text', {}, 'ถูกใจ'));
  assert.equal(policy.actionLabel(children), 'ถูกใจ');
  assert.equal(policy.actionLabel(children, 'บันทึก'), 'บันทึก');
  assert.equal(policy.actionLabel(element('Image', { source: { uri: 'https://private.example/secret' } })), 'ดูรูปภาพ');
});

test('recording, long presses, render children, nested controls, and unknown custom content retain the gesture owner', () => {
  for (const props of [{ onPressIn() {} }, { onPressOut() {} }, { onLongPress() {} }, { onTouchMove() {} }, { nativeGestureSurface: true }, { accessible: false }, { onAccessibilityAction() {} }, { accessibilityActions: [{ name: 'increment' }] }]) assert.equal(policy.needsGestureResponder(props, element('Text', {}, 'Hello')), true);
  assert.equal(policy.needsGestureResponder({}, () => null), true);
  assert.equal(policy.needsGestureResponder({}, element('View', {}, element('Pressable', { onPress() {} }))), true);
  assert.equal(policy.needsGestureResponder({}, element(function TrackPreviewButton() {})), true);
  assert.equal(policy.needsGestureResponder({}, element('View', {}, element('Text', {}, 'Hello'))), false);
});

test('native action preserves the measured Yoga content and ref, mounts a native Button, and dispatches its event once', () => {
  const h = harness('src/components/NativePressable.ios.js');
  let calls = 0, measured = 0, received;
  const ref = {}, child = element('Text', {}, 'บันทึก');
  const props = { children: child, onPress: event => { calls++; received = event; }, onLayout: () => measured++, style: { width: 160, height: 48 } };
  let tree = h.render('Pressable', props, ref);
  assert.equal(tree.props.ref, ref); assert.equal(walk(tree, 'SwiftButton'), null);
  tree.props.onLayout(layout(160, 48)); tree = h.render('Pressable', props, ref);
  const button = walk(tree, 'SwiftButton'); assert.ok(button); assert.equal(measured, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(modifier(button, 'frame')[0])), { width: 160, height: 48 });
  assert.equal(modifier(button, 'accessibilityLabel')[0], 'บันทึก');
  const touch = { nativeEvent: { pageX: 41, pageY: 24 }, stopPropagation() {} };
  tree.props.onTouchEnd(touch); button.props.onPress();
  assert.equal(calls, 1); assert.equal(received, touch);
  assert.equal(walk(tree, 'Text').props.accessibilityElementsHidden, true);
});

test('native action honors disabled and busy states, including programmatic callback invocation', () => {
  for (const state of [{ disabled: true }, { accessibilityState: { busy: true } }]) {
    const h = harness('src/components/NativePressable.ios.js'); let calls = 0;
    const props = { children: element('Text', {}, 'ส่ง'), onPress: () => calls++, ...state };
    h.render('Pressable', props).props.onLayout(layout(80, 44));
    const button = walk(h.render('Pressable', props), 'SwiftButton');
    assert.equal(modifier(button, 'disabled')[0], true); button.props.onPress(); assert.equal(calls, 0);
  }
});

test('native actions preserve VoiceOver link traits, selection/expanded values, and explicit value labels', () => {
  assert.equal(policy.actionAccessibilityValue({ accessibilityState: { checked: false } }), 'ยังไม่เลือก');
  assert.equal(policy.actionAccessibilityValue({ accessibilityState: { checked: 'mixed' } }), 'เลือกบางส่วน');
  assert.equal(policy.actionAccessibilityValue({ accessibilityState: { expanded: false } }), 'ย่ออยู่');
  assert.equal(policy.actionAccessibilityValue({ accessibilityState: { expanded: true }, accessibilityValue: { text: 'รายละเอียดทั้งหมด' } }), 'รายละเอียดทั้งหมด');
  const h = harness('src/components/NativePressable.ios.js');
  const props = { onPress() {}, accessibilityRole: 'link', accessibilityState: { expanded: true }, children: element('Text', {}, 'ข้อมูลเพิ่มเติม') };
  h.render('Pressable', props).props.onLayout(layout(180, 44));
  const button = walk(h.render('Pressable', props), 'SwiftButton');
  assert.equal(modifier(button, 'accessibilityAddTraits')[0][0], 'isLink');
  assert.equal(modifier(button, 'accessibilityRemoveTraits')[0][0], 'isButton');
  assert.equal(modifier(button, 'accessibilityValue')[0], 'ขยายแล้ว');
});

test('nested/gesture actions keep their original responder and callbacks; no native overlay steals nested taps', () => {
  const h = harness('src/components/NativePressable.ios.js');
  const onPress = () => {}, onLongPress = () => {};
  let tree = h.render('Pressable', { onPress, onLongPress, children: element('Text', {}, 'hold') });
  assert.equal(tree.type, 'GesturePressable'); assert.equal(tree.props.onPress, onPress); assert.equal(tree.props.onLongPress, onLongPress);
  assert.equal(walk(tree, 'SwiftButton'), null);
  h.setInside(true); tree = h.render('Pressable', { onPress, children: element('Text', {}, 'nested') });
  assert.equal(tree.type, 'GesturePressable'); assert.equal(walk(tree, 'SwiftButton'), null);
});

test('nativeGestureSurface force uses React Native gesture surface for modal dialogs and overlays', () => {
  const h = harness('src/components/NativePressable.ios.js');
  const onPress = () => {};
  const tree = h.render('Pressable', { nativeGestureSurface: true, onPress, children: element('Text', {}, 'ยืนยันออกจากระบบ') });
  assert.equal(tree.type, 'GesturePressable');
  assert.equal(tree.props.onPress, onPress);
  assert.equal(walk(tree, 'SwiftButton'), null);
});

test('compound touchable cards render a native background without replacing their responder or pressed child function', () => {
  const h = harness('src/components/NativePressable.ios.js');
  let pressed;
  const props = { nativeCardSurface: true, onPress() {}, style: state => ({ backgroundColor: state.pressed ? '#111111' : '#FFFFFF' }),
    children: state => { pressed = state.pressed; return element('Text', {}, 'Card'); } };
  const tree = h.render('Pressable', props);
  assert.equal(tree.type, 'GesturePressable');
  const children = tree.props.children({ pressed: true });
  assert.equal(pressed, true); assert.equal(walk(children, 'NativeCardBackground').props.style.backgroundColor, '#111111');
});

test('native card uses a finite opaque SwiftUI surface and keeps photo/content identity across layout changes', () => {
  const h = harness('src/components/NativeCard.ios.js');
  const photo = element('Photo', { source: 'real-photo' });
  const props = { style: { borderRadius: 24, borderTopLeftRadius: 0, backgroundColor: '#222222' }, children: photo };
  let tree = h.render('default', props);
  assert.equal(walk(tree, 'Photo'), photo); assert.equal(walk(tree, 'SwiftHost'), null);
  tree.props.onLayout(layout(390, 720)); tree = h.render('default', props);
  const shape = walk(tree, 'SwiftUnevenRoundedRectangle'); assert.ok(shape);
  assert.equal(shape.props.topLeadingRadius, 0); assert.equal(shape.props.bottomTrailingRadius, 24);
  assert.equal(modifier(shape, 'foregroundStyle')[0], '#222222'); assert.equal(walk(tree, 'Photo'), photo);
  tree.props.onLayout(layout(700, 390)); tree = h.render('default', props);
  assert.equal(modifier(walk(tree, 'SwiftUnevenRoundedRectangle'), 'frame')[0].width, 700);
  assert.equal(walk(tree, 'Photo'), photo);
});

test('native text buttons use SwiftUI roles, labels, loading state and intrinsic chip sizing', () => {
  const h = harness('src/components/NativeButton.ios.js');
  let tree = h.render('default', { label: 'ลบ', role: 'destructive', loading: true, style: { width: 200 } });
  const button = walk(tree, 'SwiftButton');
  assert.equal(button.props.role, 'destructive'); assert.equal(modifier(button, 'disabled')[0], true); assert.ok(walk(tree, 'SwiftProgressView'));
  tree = h.render('default', { label: 'คาเฟ่', selected: true, style: { alignSelf: 'flex-start' } });
  assert.equal(walk(tree, 'SwiftHost').props.matchContents, true);
  assert.equal(modifier(walk(tree, 'SwiftButton'), 'frame')[0].maxWidth, undefined);
  assert.equal(modifier(walk(tree, 'SwiftButton'), 'accessibilityAddTraits')[0][0], 'isSelected');
  tree = h.render('default', { label: 'ปิด', icon: 'xmark', iconOnly: true, style: { width: 24, height: 24 } });
  const iconFrame = modifier(walk(tree, 'SwiftButton'), 'frame')[0];
  assert.equal(iconFrame.width, 44); assert.equal(iconFrame.height, 44);
  h.setInside(true); assert.equal(h.render('default', { label: 'nested' }).type, 'GestureButton');
});

test('Android/web adapter passes through original props/ref and strips iOS-only options', () => {
  const h = harness('src/components/NativePressable.js'), ref = {};
  const style = () => ({ opacity: 0.5 }), onPress = () => {}, children = element('Text', {}, 'Continue');
  const tree = h.render('Pressable', { children, onPress, style, android_ripple: { color: 'red' }, nativeCardSurface: true, nativeButtonStyle: 'glass' }, ref);
  assert.equal(tree.type, 'GesturePressable'); assert.equal(tree.props.style, style); assert.equal(tree.props.onPress, onPress);
  assert.equal(tree.props.children, children); assert.equal(tree.props.ref, ref);
  assert.equal(tree.props.nativeCardSurface, undefined); assert.equal(tree.props.nativeButtonStyle, undefined);
});

test('native search keeps controlled text, clear callbacks and the imperative focus/blur contract', () => {
  const h = harness('src/components/SearchField.ios.js'), ref = {};
  const changes = []; let clears = 0, focus = 0, blur = 0;
  const props = { value: 'เพื่อน', onChangeText: text => changes.push(text), onClear: () => clears++ };
  let tree = h.render('default', props, ref);
  const field = walk(tree, 'SwiftTextField');
  assert.equal(field.props.text.get(), 'เพื่อน');
  field.props.ref.current = { focus: () => focus++, blur: () => blur++ };
  ref.current.focus(); ref.current.blur(); assert.equal(focus, 1); assert.equal(blur, 1);
  ref.current.clear(); assert.equal(field.props.text.get(), ''); assert.equal(clears, 1); assert.deepEqual(changes, ['']);
  tree = h.render('default', { ...props, value: 'ใหม่' }, ref);
  assert.equal(walk(tree, 'SwiftTextField').props.text.get(), 'ใหม่');
  assert.equal(modifier(walk(tree, 'SwiftTextField'), 'submitLabel')[0], 'search');
});

test('iOS compact toolbar uses native glass controls and preserves its original actions', () => {
  const h = harness('src/components/LiquidGlassCompactToolbar.ios.js');
  let calls = 0;
  const tree = h.render('default', { query: 'Library', onPressSearch: () => calls++, onClearSearch() {}, onOpenMap() {}, onCreateParty() {} });
  const host = walk(tree, 'SwiftHost'); assert.ok(host);
  const row = walk(tree, 'SwiftHStack');
  const buttons = row.props.children.flat(Infinity).filter(child => child?.type === 'SwiftButton');
  assert.equal(buttons.length, 4); buttons[0].props.onPress(); assert.equal(calls, 1);
  for (const button of buttons) assert.equal(modifier(button, 'buttonStyle')[0], 'glass');
  assert.doesNotMatch(readFileSync('src/components/LiquidGlassCompactToolbar.ios.js', 'utf8'), /BlurView|LinearGradient|rimColors/);
});

test('all client touchable imports use the platform base; iOS-only controls are not imported by shared fallbacks', () => {
  const files = execFileSync('rg', ['--files', 'src', 'app', 'modules', '-g', '*.js', '-g', '*.tsx', '-g', '*.ts', '-g', '!*.android.js', '-g', '!*.test.js'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const exceptions = /(?:^|[\\/])(?:NativePressable(?:\.ios)?|NativeButton)\.js$/;
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx', ...(/\.tsx?$/.test(file) ? ['typescript'] : [])] } });
    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration' || node.source.value !== 'react-native' || exceptions.test(file)) continue;
      assert.equal(node.specifiers.some(s => ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'].includes(s.imported?.name)), false, file);
    }
    checked++;
  }
  assert.ok(checked > 200);
  for (const file of ['src/components/NativePressable.js', 'src/components/NativeCard.js', 'src/components/NativeAnimatedCard.js', 'src/components/NativeButton.js']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /@expo\/ui\/swift-ui/, file);
  }
});
