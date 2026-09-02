import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNewMessages,
  likeNotification,
  matchNotification,
  messageNotification,
} from './notificationLogic.js';

test('findNewMessages ignores reactions and finds appended messages', () => {
  const before = [{ id: 'm1', senderId: 'a', text: 'เดิม' }];
  const afterReaction = [{ id: 'm1', senderId: 'a', text: 'เดิม', reactions: { b: '❤️' } }];
  assert.deepEqual(findNewMessages(before, afterReaction), []);

  const appended = [...afterReaction, { id: 'm2', senderId: 'b', text: 'ใหม่' }];
  assert.deepEqual(findNewMessages(before, appended).map((message) => message.id), ['m2']);
});

test('notification payloads contain safe deep-link data', () => {
  const like = likeNotification({ nickname: 'เกม' }, 'u1');
  assert.equal(like.data.type, 'like');
  assert.equal(like.data.url, '/likes');

  const match = matchNotification({ name: 'พัท' }, 'c-a-b');
  assert.equal(match.data.conversationId, 'c-a-b');

  const message = messageNotification({ nickname: 'พัท' }, 'c-a-b', {
    id: 'm1',
    senderId: 'a',
    text: '  สวัสดี   วันนี้ไปวิ่งกันไหม  ',
  });
  assert.equal(message.body, 'สวัสดี วันนี้ไปวิ่งกันไหม');
  assert.equal(message.data.type, 'message');
});
