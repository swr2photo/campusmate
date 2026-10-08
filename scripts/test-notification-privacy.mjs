import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync('src/services/notificationPrivacy.js', 'utf8')
  .replace(/export (?=(?:async )?function)/g, '')
  + '\nglobalThis.api = { dismissPendingLikeNotifications, isLegacyLikeIdentity };', context);
const { dismissPendingLikeNotifications, isLegacyLikeIdentity } = context.api;
const types = ['like', 'match', 'message', 'group_message', 'incoming_call'];

test('cleanup removes only pending likes from both displayed and scheduled providers', async () => {
  const removed = []; let lastResponseCleared = false;
  const expo = {
    getPresentedNotificationsAsync: async () => types.map((type) => ({ request: { identifier: `expo-${type}`, content: { data: { type } } } })),
    getAllScheduledNotificationsAsync: async () => types.map((type) => ({ identifier: `scheduled-${type}`, content: { data: { type } } })),
    dismissNotificationAsync: async (id) => removed.push(id), cancelScheduledNotificationAsync: async (id) => removed.push(id),
    getLastNotificationResponse: () => ({ notification: { request: { content: { data: { type: 'like', profileId: 'old-id' } } } } }),
    clearLastNotificationResponseAsync: async () => { lastResponseCleared = true; },
  };
  const notifee = {
    getDisplayedNotifications: async () => types.map((type) => ({ notification: { id: `notifee-${type}`, data: { type } } })),
    getTriggerNotifications: async () => types.map((type) => ({ notification: { id: `trigger-${type}`, data: { type } } })),
    cancelDisplayedNotification: async (id) => removed.push(id), cancelTriggerNotification: async (id) => removed.push(id),
  };
  assert.equal((await dismissPendingLikeNotifications(expo, notifee)).failures, 0);
  assert.deepEqual(removed, ['expo-like', 'scheduled-like', 'notifee-like', 'trigger-like']);
  assert.equal(lastResponseCleared, true);
});

test('one failed dismissal or provider does not skip remaining cleanup or clear a chat response', async () => {
  const removed = [];
  const expo = {
    getPresentedNotificationsAsync: async () => ['failed', 'remaining'].map((identifier) => ({ request: { identifier, content: { data: { type: 'like' } } } })),
    dismissNotificationAsync: async (id) => { if (id === 'failed') throw new Error('native failure'); removed.push(id); },
    getAllScheduledNotificationsAsync: async () => { throw new Error('not available'); }, cancelScheduledNotificationAsync: async () => {},
    getLastNotificationResponse: () => ({ notification: { request: { content: { data: { type: 'message' } } } } }),
    clearLastNotificationResponseAsync: async () => { throw new Error('chat response must remain'); },
  };
  const notifee = { getDisplayedNotifications: async () => [{ notification: { id: 'other-provider', data: { type: 'like' } } }],
    cancelDisplayedNotification: async (id) => removed.push(id) };
  assert.equal((await dismissPendingLikeNotifications(expo, notifee)).failures, 2);
  assert.deepEqual(removed, ['remaining', 'other-provider']);
  assert.equal((await dismissPendingLikeNotifications(null, null)).failures, 0);
});

test('legacy like identities are suppressed while generic count notices, matches, chats and calls remain valid', () => {
  for (const field of ['profileId', 'senderId', 'senderName', 'avatarUri', 'notificationAvatarUri']) {
    assert.equal(isLegacyLikeIdentity({ type: 'like', [field]: 'legacy' }), true);
    assert.equal(isLegacyLikeIdentity({ type: 'match', [field]: 'accepted' }), false);
    assert.equal(isLegacyLikeIdentity({ type: 'message', [field]: 'chat' }), false);
  }
  assert.equal(isLegacyLikeIdentity({ type: 'like', url: '/likes' }), false);
});
