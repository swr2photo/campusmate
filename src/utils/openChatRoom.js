import { router } from 'expo-router';

/**
 * Open a conversation without stacking or replaying old chat-room screens.
 *
 * Stacked `push` + `navigate` was causing a "loop" through previous chats
 * before the target appeared. This always leaves at most one chat-room above
 * the chat tab.
 */
export function openChatRoom(chatId, options = {}) {
  const id = String(chatId || '');
  if (!id) return;

  const params = options.entryAnimation
    ? { chatId: id, entryAnimation: options.entryAnimation }
    : { chatId: id };

  const pathname = String(options.pathname || '');
  const onChatRoom = pathname.includes('chat-room');
  const currentChatId = String(options.currentChatId || '');

  if (onChatRoom && currentChatId === id) return;

  if (onChatRoom) {
    // Swap in place — never pop through older chat-room entries.
    router.replace({ pathname: '/chat-room', params });
    return;
  }

  // Drop leftover chat-room (or other) screens above the tabs so a later
  // open cannot animate through them.
  if (typeof router.canDismiss === 'function' && router.canDismiss()) {
    try {
      router.dismissTo('/(tabs)/chat');
    } catch (_) {
      try {
        while (router.canDismiss()) router.dismiss(1);
      } catch (__) {
        // ignore
      }
    }
  }

  router.push({ pathname: '/chat-room', params });
}
