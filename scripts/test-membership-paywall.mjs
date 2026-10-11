import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const source = readFileSync(new URL('../src/screens/MembershipScreen.js', import.meta.url), 'utf8');
const code = babel.transformSync(source.replace(/^import[^\n]+\n/gm, '').replace('export default function', 'function'), {
  filename: 'MembershipScreen.js', babelrc: false, configFile: false, compact: false, minified: false,
  presets: [[require('babel-preset-expo'), { jsxRuntime: 'classic', 'react-compiler': false }]],
}).code;
const plansSource = readFileSync(new URL('../src/data/plans.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const plansContext = vm.createContext({});
vm.runInContext(plansSource + '; globalThis.benefits = PLUS_BENEFITS;', plansContext);
const monthly = { identifier: '$rc_monthly', packageType: 'MONTHLY', product: { priceString: '฿149.00' } };
const annual = { identifier: '$rc_annual', packageType: 'ANNUAL', product: { priceString: '฿999.00', pricePerMonthString: '฿83.25' } };
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides = {}, options = {}) {
  const calls = { purchases: [], restores: 0, routes: [], urls: [] };
  const membership = {
    ready: true, configured: true, plus: false, busy: false, error: '', packages: [monthly, annual],
    purchase: async entry => { calls.purchases.push(entry); },
    restore: async () => { calls.restores++; }, ...overrides,
  };
  let cursor = 0;
  const slots = [];
  const state = { width: 390, height: 844, fontScale: 1, ...options.dimensions };
  function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  }
  function useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  }
  const context = vm.createContext({
    require,
    React: { createElement: (type, props, ...children) => {
      const resolved = { ...props, children: children.flat(Infinity).filter(child => child !== false && child != null) };
      return typeof type === 'function' ? type(resolved) : { type, props: resolved, children: resolved.children };
    } },
    useState, useRef, useEffect() {}, useWindowDimensions: () => state, useIsFocused: () => true,
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    FeatureIcon: 'FeatureIcon', StatusBar: 'StatusBar', Stack: { Screen: 'StackScreen' },
    StyleSheet: { create: styles => styles },
    useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
    useMembership: () => membership, useMembershipPackageAutoload: () => ({ offline: Boolean(options.offline) }),
    PLUS_BENEFITS: plansContext.benefits,
    Linking: { openURL: async url => { calls.urls.push(url); if (options.linkError) throw new Error('failed'); } },
    router: { canGoBack: () => !options.directEntry, back: () => calls.routes.push('back'), replace: route => calls.routes.push(route), push: route => calls.routes.push(route) },
    process: { env: { EXPO_OS: 'android' } },
  });
  vm.runInContext(code + '; globalThis.render = MembershipScreen;', context);
  function render() { cursor = 0; return context.render(); }
  return { membership, calls, render };
}
function nodes(tree) {
  return typeof tree !== 'object' || tree === null ? [] : [tree, ...tree.children.flatMap(nodes)];
}
const button = (tree, prefix) => nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith(prefix));
const text = tree => typeof tree === 'string' ? tree : typeof tree === 'object' && tree ? tree.children.map(text).join('') : '';
const purchaseButton = tree => button(tree, 'ดำเนินการต่อ');

test('choosing an annual card charges its full store price and uses the current package object after refresh', async () => {
  const h = harness();
  button(h.render(), '1 ปี,').props.onPress();
  let tree = h.render();
  assert.equal(button(tree, '1 ปี,').props.accessibilityState.checked, true);
  assert.equal(purchaseButton(tree).props.accessibilityLabel, 'ดำเนินการต่อ · รวม ฿999.00');
  assert.match(text(tree), /฿83.25\/เดือน/);
  const refreshedAnnual = { ...annual, product: { priceString: '฿1,099.00' } };
  h.membership.packages = [monthly, refreshedAnnual];
  tree = h.render();
  assert.match(purchaseButton(tree).props.accessibilityLabel, /฿1,099.00/);
  purchaseButton(tree).props.onPress();
  await flush();
  assert.equal(h.calls.purchases[0], refreshedAnnual);
});

test('swiping plans and scrolling benefits keep the fixed summary and purchase in sync', async () => {
  const h = harness();
  let tree = h.render();
  const carousel = nodes(tree).find(node => node.props.horizontal);
  carousel.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: Math.round(390 * 0.73) + 12 } } });
  tree = h.render();
  nodes(tree).find(node => node.props.onLayout && node.props.style?.gap === 18).props.onLayout({ nativeEvent: { layout: { y: 171, height: 282 } } });
  nodes(tree).find(node => node.props.onScroll).props.onScroll({ nativeEvent: { contentOffset: { y: 500 } } });
  tree = h.render();
  assert.equal(purchaseButton(tree).props.accessibilityLabel, 'ดำเนินการต่อ 1 ปี รวม ฿999.00');
  assert.match(text(tree), /ทั้งหมด ฿999.00/);
  purchaseButton(tree).props.onPress();
  await flush();
  assert.equal(h.calls.purchases[0], annual);
});

test('rapid purchase and restore taps send only one store action; failure allows retry with the same plan', async () => {
  let reject, attempts = 0;
  const h = harness({ purchase: () => { attempts++; return new Promise((_resolve, fail) => { reject = fail; }); } });
  const cta = purchaseButton(h.render());
  cta.props.onPress(); cta.props.onPress();
  nodes(h.render()).find(node => node.type === 'Pressable' && text(node) === 'คืนค่าการซื้อ').props.onPress();
  assert.equal(attempts, 1); assert.equal(h.calls.restores, 0);
  reject(new Error('store unavailable')); await flush();
  cta.props.onPress(); assert.equal(attempts, 2);
  reject(new Error('cancelled')); await flush();
});

for (const state of [
  { ready: false }, { busy: true }, { configured: false }, { packages: [] },
]) test(`purchase stays disabled for ${Object.keys(state)[0]}`, () => {
  const h = harness(state);
  const tree = h.render();
  const cta = nodes(tree).filter(node => node.type === 'Pressable').at(-1);
  assert.equal(cta.props.disabled, true);
  cta.props.onPress(); assert.equal(h.calls.purchases.length, 0);
  if (state.busy) assert.equal(cta.props.accessibilityState.busy, true);
});

test('offline packages show a waiting state with no fabricated prices', () => {
  const h = harness({ packages: [] }, { offline: true });
  const tree = h.render();
  assert.match(text(tree), /รอการเชื่อมต่ออินเทอร์เน็ต/);
  assert.doesNotMatch(text(tree), /฿/);
  assert.equal(nodes(tree).some(node => node.props.accessibilityRole === 'progressbar'), true);
});

test('existing admins retain permanent access and a direct-entry close has a fallback', () => {
  const h = harness({ plus: true, isAdmin: true, activeUntil: 0 }, { directEntry: true });
  const tree = h.render();
  assert.match(text(tree), /สิทธิ์ผู้ดูแลระบบ \(สิทธิ์พิเศษถาวร\)/);
  assert.doesNotMatch(text(tree), /Invalid Date|2513|เลือกแพ็กเกจ/);
  assert.equal(purchaseButton(tree), undefined);
  button(tree, 'ปิดหน้าสมัครสมาชิก').props.onPress();
  assert.deepEqual(h.calls.routes, ['/(tabs)/me']);
});

test('active subscribers can manage their membership and recover from a failed store link', async () => {
  const h = harness({ plus: true, activeUntil: 1792000000000, managementUrl: 'https://play.google.com/store/account/subscriptions' }, { linkError: true });
  button(h.render(), 'จัดการสมาชิกในสโตร์').props.onPress();
  await flush();
  assert.equal(h.calls.urls.length, 1);
  assert.match(text(h.render()), /เปิดหน้าจัดการสมาชิกไม่ได้/);
});

test('all real Plus benefits and legal/restore actions remain reachable on short screens', () => {
  const h = harness({}, { dimensions: { height: 390, width: 844, fontScale: 1.5 } });
  const tree = h.render();
  for (const benefit of plansContext.benefits) assert.ok(text(tree).includes(benefit.label));
  assert.match(text(tree), /เรียกเก็บเงินอัตโนมัติ ยกเลิกได้ทุกเมื่อ/);
  const legal = nodes(tree).find(node => node.type === 'Pressable' && text(node) === 'เงื่อนไขการใช้งาน');
  legal.props.onPress(); assert.deepEqual(h.calls.routes, ['/terms']);
});
