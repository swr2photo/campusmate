import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { membershipManagement } from '../src/utils/membershipManagement.js';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const source = readFileSync('src/screens/ChatRoomScreen.js', 'utf8');
const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
let scrollDeclaration, resetEffect, changeCallback;
babel.traverse(ast, {
  VariableDeclarator(path) {
    if (path.node.id.name === 'scrollToLatest') scrollDeclaration = path.parentPath.node;
    if (path.node.id.name === 'handleTextInputChange') changeCallback = path.node.init.arguments[0];
  },
  CallExpression(path) {
    if (path.node.callee.name === 'useEffect' && source.slice(path.node.start, path.node.end).includes("setInputText('')")) resetEffect = path.node;
  },
});
const sameDeps = (a, b) => Boolean(a && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));

test('Android typing survives list anchoring and re-renders; changing rooms clears the draft once', () => {
  assert.ok(scrollDeclaration && resetEffect && changeCallback);
  const state = { draft: '', anchored: false, resets: 0 };
  const timers = [], scrolls = [];
  let callback, callbackDeps, effectDeps, cleanup;
  const context = vm.createContext({
    isListAnchoredRef: { current: false }, isListAnchored: false,
    isNearBottomRef: { current: true }, bottomAnchoredRef: { current: false },
    initialMessagesReadyRef: { current: false }, lastSeenMessageIdRef: { current: null },
    allMessageTimesTimerRef: { current: null },
    listRef: { current: { scrollToEnd: options => scrolls.push(options) } },
    setInputText: value => { state.draft = value; },
    setIsListAnchored: value => { state.anchored = value; },
    setReplyingTo() {}, setSending() {}, setShowAllMessageTimes() {}, setShowScrollBottom() {}, setNewMessagesBelow() {},
    requestAnimationFrame: fn => fn(), setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    useCallback: (fn, deps) => {
      if (!sameDeps(callbackDeps, deps)) { callback = fn; callbackDeps = deps; }
      return callback;
    },
    useEffect: (fn, deps) => {
      if (sameDeps(effectDeps, deps)) return;
      cleanup?.(); effectDeps = deps; state.resets++; cleanup = fn();
    },
  });
  function render(id) {
    context.chat = { id };
    context.isListAnchored = state.anchored;
    context.isListAnchoredRef.current = state.anchored;
    return vm.runInContext(`(() => { ${source.slice(scrollDeclaration.start, scrollDeclaration.end)}; ${source.slice(resetEffect.start, resetEffect.end)}; return scrollToLatest; })()`, context);
  }
  const firstScroll = render('room-a');
  vm.runInContext(`(${source.slice(changeCallback.start, changeCallback.end)})('สวัสดีครับ abc 🙂')`, context);
  timers.shift()();
  assert.equal(state.anchored, true);
  for (let i = 0; i < 10; i++) assert.equal(render('room-a'), firstScroll);
  assert.equal(state.draft, 'สวัสดีครับ abc 🙂');
  assert.equal(state.resets, 1);
  firstScroll(true);
  assert.equal(scrolls.at(-1).animated, true, 'the stable callback still reads current anchoring state');
  render('room-b');
  assert.equal(state.draft, '');
  assert.equal(state.resets, 2);
});

const orientationSource = readFileSync('src/utils/screenOrientation.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const enumSource = readFileSync('node_modules/expo-screen-orientation/src/ScreenOrientation.types.ts', 'utf8');
const orientationLockEnum = enumSource.match(/enum OrientationLock\s*\{([\s\S]*?)\n\}/)[1];
const portraitUp = Number(orientationLockEnum.match(/PORTRAIT_UP\s*=\s*(\d+)/)[1]);
async function orientation({ os = 'android', pad = false, installed = true, reject = false } = {}) {
  const locks = [];
  const lockAsync = async value => { locks.push(value); if (reject) throw Error('unavailable activity'); };
  const context = vm.createContext({
    Platform: { OS: os, isPad: pad },
    requireOptionalNativeModule: () => installed ? { lockAsync } : null,
    require: name => { assert.equal(name, 'expo-screen-orientation'); return { lockAsync, OrientationLock: { PORTRAIT_UP: portraitUp } }; },
  });
  await vm.runInContext(`${orientationSource}; enforcePhonePortraitLock()`, context);
  return locks;
}
test('portrait locking uses the SDK portrait enum, never the numeric ALL value', async () => {
  assert.notEqual(portraitUp, 1);
  assert.deepEqual(await orientation(), [portraitUp]);
  assert.deepEqual(await orientation({ os: 'ios' }), [portraitUp]);
  assert.deepEqual(await orientation({ os: 'ios', pad: true }), []);
  assert.deepEqual(await orientation({ os: 'web' }), []);
  assert.deepEqual(await orientation({ installed: false }), []);
  assert.deepEqual(await orientation({ reject: true }), [portraitUp]);
});

test('portrait preference is reapplied on foreground in production and development', () => {
  const rootSource = readFileSync('app/_layout.js', 'utf8');
  const rootAst = babel.parseSync(rootSource, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let effect;
  babel.traverse(rootAst, { CallExpression(path) {
    if (path.node.callee.property?.name === 'useEffect' && rootSource.slice(path.node.start, path.node.end).includes('enforcePhonePortraitLock')) effect = path.node.arguments[0];
  } });
  assert.ok(effect);
  for (const dev of [true, false]) {
    let locks = 0, onState, removed = false;
    const context = vm.createContext({
      __DEV__: dev, enforcePhonePortraitLock: () => { locks++; }, requireOptionalNativeModule: () => null,
      AppState: { addEventListener: (_event, fn) => { onState = fn; return { remove: () => { removed = true; } }; } },
    });
    const cleanup = vm.runInContext(`(${rootSource.slice(effect.start, effect.end)})()`, context);
    assert.equal(locks, 1); onState('background'); assert.equal(locks, 1);
    onState('active'); assert.equal(locks, 2); cleanup(); assert.equal(removed, true);
  }
});

test('admin grants, expired and unsupported store records do not expose subscription management', () => {
  const now = 100000;
  const paid = { source: 'revenuecat', entitlementId: 'campusmate_plus', verifiedAt: 1, activeUntil: now + 1000, store: 'play_store', managementUrl: 'https://play.google.com/store/account/subscriptions' };
  assert.equal(membershipManagement(paid, now).store, 'play_store');
  assert.equal(membershipManagement({ ...paid, store: 'APP_STORE', managementUrl: 'https://apps.apple.com/account/subscriptions' }, now).store, 'app_store');
  for (const record of [null, {}, { ...paid, activeUntil: now - 1 }, { ...paid, store: null }, { ...paid, store: 'promotional' }, { ...paid, source: 'admin' }, { ...paid, store: 'app_store' }]) {
    assert.equal(membershipManagement(record, now), null);
  }
});
