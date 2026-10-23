import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url), babel = require('@babel/core');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
function utility(file, modules = {}) {
  const code = babel.transformSync(readFileSync(file, 'utf8'), { configFile: false, babelrc: false, plugins: [presetRequire('@babel/plugin-transform-modules-commonjs')] }).code;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date })((name) => modules[name], module, module.exports);
  return module.exports;
}
const policy = utility('src/utils/chatVideoPolicy.js');
const preview = utility('src/utils/chatPreviewText.js', { './chatVideoPolicy': policy });
const ui = utility('src/utils/inboxPresentation.js', { './chatPreviewText': preview });

test('multiple unread messages retain the real last-message snippet and count separately', () => {
  const conversation = { messages: [{ id: 'm', senderId: 'peer', text: 'เจอกันที่ห้องสมุด' }], unreadCounts: { me: 12 } };
  assert.equal(ui.latestChatSnippet(conversation, 'me'), 'เจอกันที่ห้องสมุด');
  assert.equal(ui.chatUnreadState(conversation, 'me').count, 12);
});
test('a manual unread reminder is independent of the actual message count and peer settings', () => {
  const conversation = { unreadCounts: { me: 0, peer: 5 }, participantSettings: { me: { markedUnread: true, isPinned: true }, peer: { markedUnread: false } } };
  assert.equal(ui.chatUnreadState(conversation, 'me').count, 0);
  assert.equal(ui.chatUnreadState(conversation, 'me').unread, true);
  assert.equal(ui.chatMemberSettings(conversation, 'peer').isPinned, undefined);
});
test('notification previews use only the exact authorized decrypted message, without claiming the viewer sent it', () => {
  const row = { type: 'message', title: 'เพื่อน', body: 'คุณมีข้อความใหม่', target: { conversationId: 'c', messageId: 'm1' } };
  const conversations = [{ id: 'c', messages: [{ id: 'm1', senderId: 'peer', text: 'ข้อความแรก' }, { id: 'm2', text: 'ข้อความล่าสุด' }] }];
  assert.equal(ui.notificationPresentation(row, conversations).body, 'ข้อความแรก');
  assert.equal(ui.notificationPresentation({ ...row, target: { conversationId: 'c', messageId: 'missing' } }, conversations).body, row.body);
  assert.equal(ui.notificationPresentation({ ...row, target: { conversationId: 'c' } }, conversations).body, row.body);
  assert.equal(ui.notificationPresentation(row, [{ ...conversations[0], active: false }]).body, row.body);
});
test('media notifications and failed sends show useful text, not encrypted payload markers', () => {
  assert.equal(ui.latestChatSnippet({ messages: [{ mediaType: 'track', trackName: 'Song' }] }), 'เพลง · Song');
  assert.equal(ui.latestChatSnippet({ messages: [{ sendStatus: 'failed', text: 'hello' }] }, 'me'), 'ส่งไม่สำเร็จ');
  assert.equal(ui.latestChatSnippet({ lastMessage: '[ข้อความที่เข้ารหัส]' }), 'เปิดแชตเพื่ออ่านข้อความ');
});
test('a newer encrypted message never reuses the old cached snippet', () => {
  assert.equal(ui.latestChatSnippet({ lastMessageId: 'new', lastMessage: 'ข้อความที่เข้ารหัส', messages: [{ id: 'old', text: 'ข้อความก่อนหน้า' }] }), 'เปิดแชตเพื่ออ่านข้อความ');
});

const readNow = Date.parse('2026-10-22T12:00:00Z');
function readConversation(readAt, overrides = {}) {
  return { id: 'chat', participants: ['me', 'peer'], lastMessageId: 'm', lastMessageSenderId: 'me',
    lastMessageAt: readAt - 1000, readReceipts: { peer: readAt },
    messages: [{ id: 'm', senderId: 'me', text: 'ข้อความล่าสุด' }], ...overrides };
}
test('inbox read status covers moments, minutes, hours, days, months and years', () => {
  for (const [elapsed, expected] of [
    [0, 'อ่านแล้วเมื่อสักครู่'], [59999, 'อ่านแล้วเมื่อสักครู่'], [60000, 'อ่านแล้วเมื่อ 1 นาทีที่แล้ว'],
    [5 * 60000, 'อ่านแล้วเมื่อ 5 นาทีที่แล้ว'], [3600000, 'อ่านแล้วเมื่อ 1 ชั่วโมงที่แล้ว'],
    [2 * 86400000, 'อ่านแล้วเมื่อ 2 วันที่แล้ว'], [90 * 86400000, 'อ่านแล้วเมื่อ 3 เดือนที่แล้ว'],
    [2 * 365 * 86400000, 'อ่านแล้วเมื่อ 2 ปีที่แล้ว'],
  ]) assert.equal(ui.chatReadStatus(readConversation(readNow - elapsed), 'me', readNow), expected);
});

test('only a peer receipt covering the latest successfully sent message proves read', () => {
  const room = readConversation(readNow - 60000);
  assert.equal(ui.chatReadStatus(room, 'me', readNow), 'อ่านแล้วเมื่อ 1 นาทีที่แล้ว');
  for (const changed of [
    { readReceipts: {} }, { readReceipts: { me: readNow } }, { readReceipts: { peer: room.lastMessageAt - 1 } },
    { lastMessageSenderId: 'peer' }, { lastMessageSenderId: null, lastMessageId: 'new' },
    { kind: 'group' }, { participants: ['me', 'peer', 'third'] },
    { messages: [{ ...room.messages[0], pendingSync: true }] },
    { messages: [{ ...room.messages[0], sendStatus: 'failed' }] },
    { messages: [...room.messages, { id: 'pending', senderId: 'me', pendingSync: true }] },
  ]) assert.equal(ui.chatReadStatus({ ...room, unreadCounts: { peer: 0 }, updatedAt: readNow, ...changed }, 'me', readNow), '');
});

test('read timestamps support actual server formats and do not invent an updatedAt receipt', () => {
  const readAt = readNow - 120000;
  for (const timestamp of [new Date(readAt), readAt, readAt / 1000, new Date(readAt).toISOString(),
    { seconds: readAt / 1000 }, { _seconds: readAt / 1000 }, { toDate: () => new Date(readAt) }]) {
    assert.equal(ui.chatReadStatus(readConversation(readAt, { readReceipts: { peer: timestamp } }), 'me', readNow), 'อ่านแล้วเมื่อ 2 นาทีที่แล้ว');
  }
  for (const bad of [null, 'invalid', {}, { toDate: () => { throw Error('bad timestamp'); } }]) {
    assert.equal(ui.chatReadStatus(readConversation(readAt, { readReceipts: { peer: bad }, updatedAt: readNow }), 'me', readNow), '');
  }
});

function inboxRenderSignature() {
  const source = readFileSync('src/services/firestoreService.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  const fn = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'conversationRenderSignature');
  assert.ok(fn);
  return vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, { toMillis: value => Number(value) || 0 });
}

test('receipt-only updates invalidate the inbox cache while equivalent map order stays stable', () => {
  const signature = inboxRenderSignature();
  const room = readConversation(readNow - 60000, { readReceipts: { me: 1, peer: 2 } });
  assert.equal(signature(room), signature({ ...room, readReceipts: { peer: 2, me: 1 } }));
  assert.notEqual(signature(room), signature({ ...room, readReceipts: { me: 1, peer: 3 } }));
});

test('remote pin and unread-reminder updates invalidate the inbox cache without a new message', () => {
  const signature = inboxRenderSignature();
  const room = readConversation(readNow - 60000, { participantSettings: { me: { isPinned: false, markedUnread: false } } });
  for (const setting of ['isPinned', 'markedUnread']) {
    const updated = { ...room, participantSettings: { me: { [setting]: true } } };
    assert.notEqual(signature(room), signature(updated));
    assert.notEqual(signature({ ...room, mySettings: {} }), signature({ ...room, mySettings: { [setting]: true } }));
    const reset = { ...updated, participantSettings: { me: { [setting]: false } } };
    assert.equal(signature(room), signature(reset));
  }
  assert.equal(signature({ ...room, participantSettings: { me: { isPinned: true, markedUnread: true }, peer: {} } }),
    signature({ ...room, participantSettings: { peer: {}, me: { markedUnread: true, isPinned: true } } }));
});

test('the actual inbox row retains the snippet and renders the peer read status', () => {
  const source = readFileSync('src/screens/ChatScreen.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let fn;
  babel.traverse(ast, { FunctionExpression(path) { if (path.node.id?.name === 'ConversationRow') fn = path.node; } });
  const code = babel.transformSync(`(${source.slice(fn.start, fn.end)})`, { configFile: false, babelrc: false, plugins: [presetRequire('@babel/plugin-transform-react-jsx')] }).code;
  const render = vm.runInNewContext(code, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    ...ui, chatReadStatus: (room, uid) => ui.chatReadStatus(room, uid, readNow),
    useChatPresence: () => ({ isOnline: false }),
    presenceStatus: value => value?.visible ? (value.isOnline ? 'online' : 'offline') : null,
    useTheme: () => ({ colors: {}, isDark: true }), useState: () => [0, () => {}], useEffect() {}, useRef: current => ({ current }),
    styles: {}, View: 'View', Text: 'Text', Pressable: 'Pressable', FeatureIcon: 'FeatureIcon',
    SwipeableConversationRow: 'SwipeableConversationRow', IosLikeAvatar: 'IosLikeAvatar', AvatarStatusRing: 'AvatarStatusRing',
  });
  const tree = render({ conversation: { ...readConversation(readNow - 120000), name: 'เพื่อน' }, currentUserId: 'me' });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.props?.children || []).flat(Infinity).flatMap(nodes)];
  const text = nodes(tree).filter(node => node.type === 'Text').flatMap(node => node.props.children);
  assert.ok(text.includes('คุณ: ข้อความล่าสุด'));
  assert.ok(text.includes('อ่านแล้วเมื่อ 2 นาทีที่แล้ว'));
  assert.match(nodes(tree).find(node => node.type === 'Pressable').props.accessibilityLabel, /อ่านแล้วเมื่อ 2 นาทีที่แล้ว/);
});

function action(name, mocks) {
  const source = readFileSync('src/context/AppContext.js', 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let fn;
  babel.traverse(ast, { VariableDeclarator(p) { if (p.node.id.name === name) fn = p.node.init; } });
  assert.ok(fn, name);
  return vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, mocks);
}
test('a rejected pin update never changes the visible inbox or silently queues an unsupported server setting', async () => {
  let renders = 0, queued = 0;
  const save = action('updateChatSettingsInChat', { user: { id: 'me' }, updateChatSettings: async () => { throw Error('unavailable'); }, setConversations: () => renders++, runOrQueue: () => queued++ });
  await assert.rejects(save('c', { isPinned: true }), /unavailable/);
  assert.equal(renders, 0);
  assert.equal(queued, 0);
});
test('a confirmed pin preserves messages, counts and peer settings', async () => {
  let rows = [{ id: 'c', messages: [{ id: 'm' }], unreadCounts: { me: 0, peer: 2 }, participantSettings: { peer: { isMuted: true } } }];
  const save = action('updateChatSettingsInChat', { user: { id: 'me' }, updateChatSettings: async () => true, setConversations: fn => { rows = fn(rows); } });
  await save('c', { isPinned: true });
  assert.equal(rows[0].participantSettings.me.isPinned, true);
  assert.equal(rows[0].participantSettings.peer.isMuted, true);
  assert.equal(rows[0].unreadCounts.peer, 2);
  assert.equal(rows[0].messages.length, 1);
});

test('markAsRead clears markedUnread reminder even when unread count is 0', async () => {
  let rows = [{
    id: 'c',
    unreadCounts: { me: 0 },
    participantSettings: { me: { markedUnread: true } },
    mySettings: { markedUnread: true },
  }];
  let queued = 0;
  const mark = action('markAsRead', {
    user: { id: 'me' },
    setConversations: (fn) => { rows = fn(rows); },
    runOrQueue: async () => { queued++; },
    markConversationAsRead: async () => {},
  });
  await mark('c');
  assert.equal(rows[0].participantSettings.me.markedUnread, false);
  assert.equal(rows[0].mySettings.markedUnread, false);
  assert.equal(rows[0].unreadCounts.me, 0);
  assert.equal(rows[0].unread, false);
  assert.equal(queued, 1);
  assert.equal(ui.chatUnreadState(rows[0], 'me').unread, false);
});

test('opening a marked unread conversation invokes markAsRead and ChatRoomScreen clears unread state', () => {
  const chatScreenSource = readFileSync('src/screens/ChatScreen.js', 'utf8');
  assert.ok(chatScreenSource.includes('if (chatUnreadState(conversation, currentUserId).unread)'));
  assert.ok(chatScreenSource.includes('void markAsRead(conversation.id);'));

  const androidSource = readFileSync('src/screens/ChatRoomScreen.js', 'utf8');
  const iosSource = readFileSync('src/screens/ChatRoomScreen.ios.js', 'utf8');
  for (const src of [androidSource, iosSource]) {
    assert.ok(src.includes('isMarkedUnread = myChatSettings.markedUnread === true'));
    assert.ok(src.includes('(!activeUnreadCount && !isMarkedUnread) || !chat?.id'));
  }
});
