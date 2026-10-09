import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
function load(path) {
  const source = fs.readFileSync(path, 'utf8');
  const ast = babel.parseSync(source, { babelrc: false, configFile: false, parserOpts: { sourceType: 'module', plugins: ['jsx'] } });
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type) nodes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(ast);
  return { source, nodes, code: node => source.slice(node.start, node.end) };
}
function variable(file, name) {
  const node = file.nodes.find(n => n.type === 'VariableDeclarator' && n.id?.name === name);
  assert.ok(node, name);
  return file.code(node.init);
}
const quiet = { log() {}, warn() {}, error() {} };
for (const platform of ['js', 'ios.js']) {
  const file = load(`src/screens/MeetupScreen.${platform}`);
  function scheduleHarness(createParty) {
    let closed = false, spot = { name: 'Library', latitude: 7, longitude: 100 };
    const busy = [], messages = [];
    const context = vm.createContext({ console: quiet, scheduleSubmitLock: { current: false },
      setScheduleSubmitting: value => busy.push(value), pendingSpot: spot,
      schedDate: platform === 'js' ? '2026-10-10' : new Date('2026-10-10T00:00:00Z'),
      schedStart: platform === 'js' ? '14:00' : new Date('2026-10-10T14:00:00Z'),
      schedEnd: platform === 'js' ? '16:00' : new Date('2026-10-10T16:00:00Z'),
      maxPeople: '2', message: 'hello', maxPeopleState: { get: () => '2' }, messageState: { get: () => 'hello' },
      timeValueToMinutes: value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)),
      createParty, setScheduleModal: () => { closed = true; }, setShowSchedule: () => { closed = true; },
      setPendingSpot: value => { spot = value; }, setTimeout: fn => fn(), onToast: message => messages.push(message),
    });
    vm.runInContext('globalThis.confirm = ' + variable(file, 'confirmSchedule'), context);
    return { confirm: context.confirm, busy, messages, get closed() { return closed; }, get spot() { return spot; } };
  }
  test(`${platform}: rapid confirmation sends one request until completion`, async () => {
    let calls = 0, finish;
    const h = scheduleHarness(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const first = h.confirm();
    await h.confirm(); await h.confirm();
    assert.equal(calls, 1); assert.equal(h.closed, false);
    assert.deepEqual(h.busy, [true]);
    finish({ partyId: 'one' }); await first;
    assert.equal(h.closed, true); assert.equal(h.spot, null);
    assert.deepEqual(h.busy, [true, false]);
  });
  test(`${platform}: failure preserves the draft and releases the lock for retry`, async () => {
    let calls = 0;
    const h = scheduleHarness(async () => { if (++calls === 1) throw new Error('timeout'); return { partyId: 'one' }; });
    await h.confirm();
    assert.equal(h.closed, false); assert.equal(h.spot.name, 'Library'); assert.equal(h.messages[0], 'timeout');
    await h.confirm(); assert.equal(calls, 2); assert.equal(h.closed, true);
  });
}

const app = load('src/context/AppContext.js');
function likeHarness({ failure, result = {}, chatFailure, secure = false } = {}) {
  let hidden = ['other'];
  const context = vm.createContext({ console: quiet, user: { id: 'me' }, profile: {},
    secureDiscoveryConfigured: () => secure, recordSecureDiscoveryAction: async () => {
      if (failure) throw failure; return { status: 'accepted' };
    }, createConversation: async () => { if (chatFailure) throw chatFailure; return 'room'; },
    setOptimisticHiddenIds: fn => { hidden = fn(hidden); }, setRemovedUserIds: fn => fn(new Set()),
    acceptedIncomingLikes: [], activeConversations: [], removedUserIds: new Set(),
    runOrQueue: async () => { if (failure) throw failure; return result; }, saveDecision: () => {},
    ensureConversation: async () => { if (chatFailure) throw chatFailure; return 'room'; }, updateHiddenConversations: fn => fn([]),
  });
  vm.runInContext('globalThis.like = ' + variable(app, 'matchProfile'), context);
  return { like: () => context.like({ id: 'target' }), get hidden() { return Array.from(hidden); } };
}
test('rejected like restores only its own card', async () => {
  const h = likeHarness({ failure: new Error('permission-denied') });
  await assert.rejects(h.like()); assert.deepEqual(h.hidden, ['other']);
});
test('offline queued like stays hidden and tells its caller it is queued', async () => {
  const h = likeHarness({ result: { queued: true } });
  assert.equal((await h.like()).queued, true); assert.deepEqual(h.hidden, ['other', 'target']);
});
for (const secure of [false, true]) test(`committed like survives chat creation failure (secure=${secure})`, async () => {
  const error = new Error('chat failed'), h = likeHarness({ secure, result: { matched: true }, chatFailure: error });
  await assert.rejects(h.like()); assert.equal(error.discoveryActionCommitted, true);
  assert.deepEqual(h.hidden, ['other', 'target']);
});

const home = load('src/screens/HomeScreen.js');
for (const name of ['handleMatch', 'handleSuperLike']) test(`${name} reports queued and failed actions`, async () => {
  const call = home.nodes.find(n => n.type === 'VariableDeclarator' && n.id?.name === name).init;
  for (const queued of [true, false]) {
    const messages = [];
    const context = vm.createContext({ console: quiet, currentProfile: { id: 'target' }, actionInProgress: false,
      setActionInProgress: () => {}, matchProfile: async () => { if (!queued) throw new Error('failed'); return { queued: true }; },
      showToast: message => messages.push(message), router: { push() {} },
    });
    vm.runInContext('globalThis.press = ' + home.code(call.arguments[0]), context);
    await context.press();
    assert.match(messages[0], queued ? /จะส่งเมื่อ/ : /ไม่สำเร็จ/);
  }
});

test('conversation loading waits for a server snapshot or completed hydration; errors keep cached rows', () => {
  const effect = app.nodes.find(n => n.type === 'CallExpression' && n.callee?.name === 'useEffect'
    && app.code(n.arguments[0]).includes('unsubscribeConversation = subscribeToConversations'));
  let state, data, error, rows = [{ id: 'cached' }];
  const context = vm.createContext({ console: quiet, user: { id: 'me' }, isOnline: true, cacheHydratedUserId: 'me',
    setConversationInbox: next => { state = typeof next === 'function' ? next(state) : next; },
    runAfterInteractionsHelper: fn => { fn(); return { cancel() {} }; },
    subscribeToConversations: (_id, onData, onError) => { data = onData; error = onError; return () => {}; },
    isRetryableNetworkError: () => false, setDataError() {}, pendingSyncCountRef: { current: 0 },
    setConversations: fn => { rows = fn(rows); }, mergeConversationSnapshots: (_old, next) => next,
    retainLoadingConversations: (_old, next) => next,
  });
  vm.runInContext('globalThis.start = ' + app.code(effect.arguments[0]), context);
  const cleanup = context.start();
  data([], { fromCache: true }); assert.equal(state.ready, false);
  assert.equal(rows[0].id, 'cached');
  error(new Error('offline')); assert.equal(rows[0].id, 'cached'); assert.ok(state.error);
  data([], { fromCache: false, loadingConversationIds: ['room'] }); assert.equal(state.ready, false);
  data([{ id: 'cached' }], { fromCache: false, loadingConversationIds: [] }); assert.equal(state.ready, true);
  error(new Error('permission-denied')); assert.equal(rows[0].id, 'cached'); assert.ok(state.error);
  data([], { fromCache: false, loadingConversationIds: [] }); assert.equal(state.error, null); assert.equal(state.ready, true);
  assert.equal(rows.length, 0); // A confirmed server deletion still removes the cache.
  cleanup(); data([{ id: 'stale' }], {}); assert.equal(rows.length, 0);
});

function renderFunction(path, name, fixtures = {}) {
  const file = load(path);
  const node = file.nodes.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  assert.ok(node, name);
  const compiled = babel.transformSync(file.code(node), { filename: path, babelrc: false, configFile: false,
    presets: [[require('babel-preset-expo'), { jsxRuntime: 'classic', 'react-compiler': false }]] }).code;
  const context = vm.createContext({ React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    View: 'View', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', FeatureIcon: 'Icon',
    FormLabel: 'FormLabel', useTheme: () => ({ colors: { primary: '#2869C7', ink: '#25272B', inkMuted: '#6B7078' } }),
    getStyles: () => ({}), StyleSheet: { flatten: style => style }, ...fixtures,
  });
  vm.runInContext(compiled + '; globalThis.render = ' + name, context);
  return props => context.render(props);
}
test('loading save button retains its accessible name and busy/disabled state', () => {
  const render = renderFunction('src/components/ui.js', 'PrimaryButton');
  const button = render({ label: 'บันทึกโปรไฟล์', loading: true });
  assert.equal(button.props.accessibilityLabel, 'บันทึกโปรไฟล์');
  assert.equal(button.props.accessibilityState.busy, true); assert.equal(button.props.disabled, true);
});
test('chat status distinguishes loading, offline cache, errors/retry and confirmed empty', () => {
  const render = renderFunction('src/components/ConversationInboxStatus.js', 'ConversationInboxStatus');
  const inbox = { conversationsNetworkReady: true, conversationsOnline: true, isConversationsLoading: true };
  assert.equal(render({ inbox, empty: true }).props.accessibilityRole, 'progressbar');
  const retry = () => {};
  const failed = render({ inbox: { ...inbox, conversationsError: new Error('failed') }, retry });
  assert.equal(failed.children.at(-1).props.onPress, retry);
  const offline = render({ inbox: { ...inbox, conversationsOnline: false }, empty: false });
  assert.match(JSON.stringify(offline), /แสดงแชตที่บันทึกไว้/);
  const empty = render({ inbox: { ...inbox, isConversationsLoading: false }, empty: true });
  assert.match(JSON.stringify(empty), /ยังไม่มีแชต/);
  assert.equal(render({ inbox: { ...inbox, isConversationsLoading: false } }), null);
  assert.equal(render({ inbox: { ...inbox, isConversationsLoading: false }, empty: true, groupError: new Error('failed') }), null);
});

for (const path of ['src/context/AppContext.js', 'src/services/firestoreService.js', 'src/screens/MeetupScreen.js',
  'src/screens/MeetupScreen.ios.js', 'src/screens/HomeScreen.js', 'src/screens/ChatScreen.js', 'src/screens/ChatScreen.ios.js',
  'src/screens/ProfileScreen.js', 'src/components/ui.js', 'src/components/ConversationInboxStatus.js']) load(path);
