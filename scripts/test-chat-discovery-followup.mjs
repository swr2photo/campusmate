import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { withTimeout } from '../src/utils/withTimeout.js';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const detailFiles = ['src/screens/DiscoverProfileScreen.js', 'src/screens/DiscoverProfileScreen.ios.js'];
function parsed(file) {
  const source = readFileSync(file, 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  return { source, ast };
}
function callback(file, name, context) {
  const { source, ast } = parsed(file);
  let found;
  babel.traverse(ast, { VariableDeclarator(path) { if (path.node.id.name === name) found = path.node.init.arguments[0]; } });
  assert.ok(found, name);
  return vm.runInNewContext(`(${source.slice(found.start, found.end)})`, context);
}

test('native chat layout never receives raw JSX text outside a text component', () => {
  const { ast } = parsed('src/screens/ChatRoomScreen.ios.js');
  const invalid = [];
  babel.traverse(ast, { JSXText(path) {
    if (!path.node.value.trim()) return;
    const parent = path.parentPath.node;
    const name = parent.openingElement?.name?.name;
    if (!['Text', 'RNText'].includes(name)) invalid.push(`${name || parent.type}: ${path.node.value.trim()}`);
  } });
  assert.deepEqual(invalid, []);
});

test('chat loading and loaded renders have the same top-level hook sequence on both platforms', () => {
  for (const file of ['src/screens/ChatRoomScreen.js', 'src/screens/ChatRoomScreen.ios.js']) {
    const { ast } = parsed(file);
    let guard, room, insetCalls = 0;
    babel.traverse(ast, { FunctionDeclaration(path) { if (path.node.id?.name === 'ChatRoomScreen') room = path; } });
    assert.ok(room, file);
    for (const node of room.node.body.body) {
      if (node.type === 'IfStatement' && node.test.type === 'UnaryExpression' && node.test.operator === '!' && node.test.argument.name === 'chat') guard = node;
    }
    assert.ok(guard, file);
    room.traverse({ CallExpression(path) {
      if (path.getFunctionParent()?.node !== room.node) return;
      const name = path.node.callee.name || path.node.callee.property?.name || '';
      if (!/^use[A-Z]/.test(name)) return;
      assert.ok(path.node.start < guard.start, `${file}: ${name} must run before the missing-room return`);
      if (name === 'useSafeAreaInsets') insetCalls++;
    } });
    assert.equal(insetCalls, 1);
  }
});

for (const file of detailFiles) test(`${file}: swipe decisions work only in the collapsed interactive card`, () => {
  for (const flags of [{}, { isViewOnly: true }, { processing: true }, { detailsExpanded: true }]) {
    let enabled, offset = 0, decision;
    const chain = { enabled(value) { enabled = value; return this; }, activeOffsetX() { return this; }, failOffsetY() { return this; }, onUpdate(fn) { this.update = fn; return this; }, onEnd(fn) { this.end = fn; return this; } };
    callback(file, 'panGesture', { Gesture: { Pan: () => chain }, isViewOnly: false, processing: false, detailsExpanded: false, ...flags,
      swipeLock: { get: () => 0 }, translateX: { get: () => offset, set: value => { offset = value; } },
      project: () => 0, scheduleOnRN: (fn, value) => fn(value), finishSwipe: value => { decision = value; },
    })();
    assert.equal(enabled, Object.keys(flags).length === 0);
    if (enabled) {
      chain.update({ translationX: 160 }); chain.end({ translationX: 160, velocityX: 0 }); assert.equal(decision, 'like');
      chain.update({ translationX: -160 }); chain.end({ translationX: -160, velocityX: 0 }); assert.equal(decision, 'skip');
    }
  }
});

test('collapsing details resets the scroll before removing content; opening waits for content layout', () => {
  for (const expanded of [false, true]) {
    const events = [], pending = { current: null };
    const toggle = callback(detailFiles[0], 'handleToggleDetails', {
      detailsExpanded: expanded, heroHeight: 600, detailsTopInset: 72, pendingDetailsScroll: pending,
      scrollRef: { current: { scrollTo: args => events.push(['scroll', args.y]) } },
      setDetailsExpanded: next => events.push(['expanded', next]), onDetailsExpandedChange: next => events.push(['parent', next]), setBioExpanded() {},
    });
    toggle();
    if (expanded) { assert.deepEqual(events[0], ['scroll', 0]); assert.deepEqual(events[1], ['expanded', false]); assert.equal(pending.current, null); }
    else { assert.deepEqual(events[0], ['expanded', true]); assert.equal(pending.current, 528); }
  }
});

test('opening a matched chat times out, unlocks retry, and ignores late navigation without submitting twice', async () => {
  let complete, calls = 0, opens = 0, warning;
  const lock = { current: false };
  const run = callback('src/screens/LikesScreen.js', 'handleOpenChat', {
    processingId: null, openingChatRef: lock, setProcessingId() {},
    ensureConversation: () => { calls++; return new Promise(resolve => { complete = resolve; }); },
    withTimeout: (operation, _milliseconds, message) => withTimeout(operation, 5, message), onOpenChat: () => opens++, onToast: message => { warning = message; }, console: { error() {} },
  });
  const first = run({ id: 'target' }); await run({ id: 'target' });
  await first; assert.equal(calls, 1); assert.equal(opens, 0); assert.equal(lock.current, false); assert.match(warning, /เปิดห้องแชต/);
  complete('late-room'); await new Promise(resolve => setImmediate(resolve)); assert.equal(opens, 0);
});

for (const file of detailFiles) test(`${file}: opening an existing match does not send a new activity invitation`, async () => {
  let route, opens = 0;
  const value = { get: () => 0, set() {} };
  const run = callback(file, 'handleDecision', {
    candidate: { id: 'target', name: 'Test' }, processing: false, isCandidateMatched: true,
    decisionInFlight: { current: false }, decisionCandidateId: { current: null }, decisionStarted: { current: false },
    setProcessing() {}, setSessionExcludedIds() {}, translateX: value, translateY: value, cardScale: value, cardOpacity: value,
    ensureConversation: async () => { opens++; return 'existing-room'; }, withTimeout,
    sendActivityInvite: () => { throw new Error('Opening must not send an invitation'); },
    router: { replace: next => { route = next; } }, onToast() {},
  });
  const first = run('like');
  const duplicate = run('like');
  await Promise.all([first, duplicate]);
  assert.equal(opens, 1); assert.equal(route.params.chatId, 'existing-room');
});
