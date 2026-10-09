import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = fs.readFileSync('src/components/NotificationManager.js', 'utf8');
const ast = require('@babel/core').parseSync(source, { configFile: false, babelrc: false, sourceType: 'module', parserOpts: { plugins: ['jsx'] } });
let received, open;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id?.name === 'openNotification') open = node;
  if (node.type === 'CallExpression' && node.callee?.property?.name === 'addNotificationReceivedListener') received = node.arguments[0];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(ast);
assert.ok(received && open, 'Exercise the actual foreground receipt and tap handlers');

function handlers(chatId = '') {
  const reads = [], banners = [], routes = [];
  const context = vm.createContext({
    markPushInboxRead: async id => { if (id) reads.push(id); },
    routeRef: { current: { chatId } },
    showInAppNotification: banner => banners.push(banner),
    shouldSkipDuplicateOpen: () => false,
    openChatRoomFromNotification: id => routes.push(id),
    router: { push: route => routes.push(route) },
  });
  vm.runInContext(source.slice(open.start, open.end) + '\n'
    + 'globalThis.dispatchNotification = data => openNotification(data);\n'
    + 'globalThis.receive = ' + source.slice(received.start, received.end) + ';', context);
  return { receive: context.receive, reads, banners, routes };
}

for (const type of ['message', 'group_message', 'party_request', 'like', 'match', 'admin_announcement', 'moderation_warning']) {
  test(`foreground ${type} remains unread until its banner is pressed`, () => {
    const h = handlers();
    h.receive({ request: { content: { title: 'CampusMate', body: 'New notification', data: {
      type, notificationId: 'notice-1', conversationId: 'room-1', partyId: 'party-1', route: '/home',
    } } } });
    assert.deepEqual(h.reads, []);
    assert.equal(h.banners.length, 1);
    h.banners[0].onPress();
    assert.deepEqual(h.reads, ['notice-1']);
    assert.equal(h.routes.length, 1);
  });
}

test('suppressing a banner for an open chat does not count as reading inbox history', () => {
  const h = handlers('room-1');
  h.receive({ request: { content: { data: { type: 'message', notificationId: 'notice-1', conversationId: 'room-1' } } } });
  assert.equal(h.banners.length, 0);
  assert.deepEqual(h.reads, []);
});

const restrictionSource = fs.readFileSync('src/context/AuthContext.js', 'utf8');
const restrictionAst = require('@babel/core').parseSync(restrictionSource, { configFile: false, babelrc: false, sourceType: 'module', parserOpts: { plugins: ['jsx'] } });
const restrictionPresses = [];
function findRestrictionPresses(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ObjectProperty' && node.key?.name === 'onPress') {
    const callback = restrictionSource.slice(node.value.start, node.value.end);
    if (callback.includes('notice.notificationId')) restrictionPresses.push(callback);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(findRestrictionPresses);
    else if (value && typeof value === 'object') findRestrictionPresses(value);
  }
}
findRestrictionPresses(restrictionAst);
test('restriction announcement tap and warning acknowledgement mark the matching inbox record', () => {
  assert.equal(restrictionPresses.length, 2);
  for (const callback of restrictionPresses) {
    const reads = [], context = vm.createContext({
      notice: { notificationId: 'notice-1', route: '/home' },
      markPushInboxRead: async id => reads.push(id), showingNotice: true,
      showNextNotice: () => {}, router: { push: () => {} },
    });
    vm.runInContext('globalThis.press = ' + callback + ';', context);
    assert.deepEqual(reads, []);
    context.press();
    assert.deepEqual(reads, ['notice-1']);
  }
});
