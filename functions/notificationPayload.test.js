import assert from 'node:assert/strict';
import test from 'node:test';
import { extractBackgroundNotificationData } from '../src/services/notificationPayload.js';

test('extracts FCM data from a RemoteMessage-shaped task payload', () => {
  const data = extractBackgroundNotificationData({
    messageId: 'fcm-1',
    data: {
      type: 'message',
      conversationId: 'c-a-b',
      notificationAvatarUri: 'https://cdn.example.com/a.jpg',
      senderName: 'พัท',
    },
    notification: null,
  });
  assert.equal(data.type, 'message');
  assert.equal(data.conversationId, 'c-a-b');
  assert.equal(data.notificationAvatarUri, 'https://cdn.example.com/a.jpg');
});

test('extracts FCM data from the JobService { notification } wrap', () => {
  const data = extractBackgroundNotificationData({
    notification: {
      messageId: 'fcm-2',
      data: {
        type: 'message',
        conversationId: 'c-a-b',
        dataString: JSON.stringify({ notificationBody: 'สวัสดี' }),
      },
    },
  });
  assert.equal(data.type, 'message');
  assert.equal(data.notificationBody, 'สวัสดี');
});

test('accepts an already-unwrapped FCM data map', () => {
  const data = extractBackgroundNotificationData({
    type: 'message',
    conversationId: 'c-a-b',
  });
  assert.equal(data.type, 'message');
  assert.equal(data.conversationId, 'c-a-b');
});
