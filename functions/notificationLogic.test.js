import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNewMessages,
  isNewPendingLike,
  likeNotification,
  matchNotification,
  messageNotification,
  callNotification,
} from './notificationLogic.js';

test('callNotification creates high-priority call alert payload', () => {
  const avatarUrl = 'https://firebasestorage.googleapis.com/v0/b/app/o/avatar.jpg';
  const voiceCall = callNotification(
    { name: 'พัท', avatarUri: avatarUrl },
    { id: 'call-1', callerId: 'u1', callType: 'voice', conversationId: 'c1' }
  );
  assert.equal(voiceCall.title, 'สายเรียกเข้า (โทรด้วยเสียง) 📞');
  assert.equal(voiceCall.data.type, 'incoming_call');
  assert.equal(voiceCall.data.callId, 'call-1');
  assert.equal(voiceCall.data.callType, 'voice');
  assert.equal(voiceCall.channelId, 'calls');
  assert.equal(voiceCall.priority, 'high');

  const videoCall = callNotification(
    { name: 'อ้อม', avatarUri: avatarUrl },
    { id: 'call-2', callerId: 'u2', callType: 'video', conversationId: 'c2' }
  );
  assert.equal(videoCall.title, 'สายเรียกเข้า (วิดีโอคอล) 📹');
  assert.equal(videoCall.data.callType, 'video');
});


test('findNewMessages ignores reactions and finds appended messages', () => {
  const before = [{ id: 'm1', senderId: 'a', text: 'เดิม' }];
  const afterReaction = [{ id: 'm1', senderId: 'a', text: 'เดิม', reactions: { b: '❤️' } }];
  assert.deepEqual(findNewMessages(before, afterReaction), []);

  const appended = [...afterReaction, { id: 'm2', senderId: 'b', text: 'ใหม่' }];
  assert.deepEqual(findNewMessages(before, appended).map((message) => message.id), ['m2']);
});

test('notification payloads contain safe deep-link data and message preview', () => {
  const avatarUrl = 'https://firebasestorage.googleapis.com/v0/b/app/o/avatar.jpg?alt=media';
  const like = likeNotification({ nickname: 'เกม', avatarUri: avatarUrl }, 'u1');
  assert.equal(like.data.type, 'like');
  assert.equal(like.data.url, '/likes');
  assert.equal(like.avatarUri, avatarUrl);

  const match = matchNotification({ name: 'พัท', avatarUri: avatarUrl }, 'c-a-b');
  assert.equal(match.data.conversationId, 'c-a-b');
  assert.equal(match.avatarUri, avatarUrl);

  const message = messageNotification({ nickname: 'พัท', avatarUri: avatarUrl }, 'c-a-b', {
    id: 'm1',
    senderId: 'a',
    text: '  สวัสดี วันนี้ไปวิ่งกันไหม  ',
  });
  assert.equal(message.body, 'สวัสดี วันนี้ไปวิ่งกันไหม');
  assert.equal(message.data.type, 'message');
  assert.equal(message.avatarUri, avatarUrl);
  assert.equal(message.mediaUrl, null);
});

test('messageNotification falls back to generic text when preview is missing', () => {
  const message = messageNotification({ nickname: 'ผู้ส่ง' }, 'c-a-b', {
    id: 'm-empty',
    senderId: 'a',
  });
  assert.equal(message.body, 'มีข้อความใหม่');
});

test('pending likes notify on create and when a previous decision is reopened', () => {
  assert.equal(isNewPendingLike(null, { type: 'like', status: 'pending' }), true);
  assert.equal(isNewPendingLike({ type: 'skip', status: 'pending' }, { type: 'like', status: 'pending' }), true);
  assert.equal(isNewPendingLike({ type: 'like', status: 'rejected' }, { type: 'like', status: 'pending' }), true);
  assert.equal(isNewPendingLike({ type: 'like', status: 'pending' }, { type: 'like', status: 'pending' }), false);
  assert.equal(isNewPendingLike({ type: 'like', status: 'pending' }, { type: 'like', status: 'accepted' }), false);
});
