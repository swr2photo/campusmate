import assert from 'node:assert/strict';
import test from 'node:test';
import { messageNotification } from './notificationLogic.js';
import {
  ANDROID_MESSAGING_NOTIFICATION_MODE,
  buildExpoPushMessage,
  stringifyPushData,
} from './pushMessage.js';

const avatarUrl = 'https://cdn.example.com/avatars/pat.jpg';
const expoPushToken = 'ExponentPushToken[test-token]';

function messageNotif() {
  return messageNotification(
    { nickname: 'พัท', avatarUri: avatarUrl },
    'c-a-b',
    { id: 'm1', senderId: 'a', text: 'สวัสดี' }
  );
}

test('stringifyPushData drops empty values and stringifies the rest', () => {
  assert.deepEqual(
    stringifyPushData({ type: 'message', avatarUri: null, count: 3, empty: '' }),
    { type: 'message', count: '3' }
  );
});

test('Android messaging-style clients get a visible chat payload plus enriched data', () => {
  const notification = messageNotif();
  notification.badge = 4;
  const message = buildExpoPushMessage({
    expoPushToken,
    platform: 'android',
    notificationMode: ANDROID_MESSAGING_NOTIFICATION_MODE,
  }, notification);

  assert.equal(message.title, 'พัท');
  assert.equal(message.body, 'สวัสดี');
  assert.equal(message.sound, 'default');
  assert.equal(message.channelId, 'messages');
  assert.deepEqual(message.richContent, { image: avatarUrl });
  assert.equal(message.contentAvailable, true);
  assert.equal(message.collapseId, 'c-a-b');
  assert.equal(message.badge, 4);
  assert.equal(message.data.type, 'message');
  assert.equal(message.data.conversationId, 'c-a-b');
  assert.equal(message.data.senderName, 'พัท');
  assert.equal(message.data.avatarUri, avatarUrl);
  assert.equal(message.data.notificationAvatarUri, avatarUrl);
  assert.equal(message.data.notificationTitle, 'พัท');
  assert.equal(message.data.notificationBody, 'สวัสดี');
  assert.equal(message.data.notificationBadge, '4');
});

test('older Android clients still receive a visible Expo notification', () => {
  const notification = messageNotif();
  const message = buildExpoPushMessage({
    expoPushToken,
    platform: 'android',
  }, notification);

  assert.equal(message.title, 'พัท');
  assert.equal(message.body, 'สวัสดี');
  assert.equal(message.sound, 'default');
  assert.equal(message.channelId, 'messages');
  assert.equal(message.contentAvailable, undefined);
  assert.deepEqual(message.richContent, { image: avatarUrl });
});

test('iOS and non-message Android notifications are unchanged', () => {
  const notification = messageNotif();
  const iosMessage = buildExpoPushMessage({
    expoPushToken,
    platform: 'ios',
    notificationMode: ANDROID_MESSAGING_NOTIFICATION_MODE,
  }, notification);
  assert.equal(iosMessage.title, 'พัท');
  assert.equal(iosMessage.body, 'สวัสดี');

  const like = buildExpoPushMessage({
    expoPushToken,
    platform: 'android',
    notificationMode: ANDROID_MESSAGING_NOTIFICATION_MODE,
  }, {
    title: 'มีคนกดใจคุณ 💜',
    body: 'พัท สนใจทำกิจกรรมกับคุณ',
    channelId: 'social',
    avatarUri: avatarUrl,
    data: { type: 'like', profileId: 'u1', avatarUri: avatarUrl },
  });
  assert.equal(like.title, 'มีคนกดใจคุณ 💜');
  assert.equal(like.data.type, 'like');
  assert.deepEqual(like.richContent, { image: avatarUrl });
});
