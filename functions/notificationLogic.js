function toMillis(value) {
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  if (typeof value?._seconds === 'number') return value._seconds * 1000;
  return 0;
}

function messageKey(message) {
  if (message?.id) return `id:${message.id}`;
  return [
    message?.senderId || message?.sender || '',
    toMillis(message?.createdAt || message?.time),
    message?.text || '',
  ].join('|');
}

export function findNewMessages(beforeMessages = [], afterMessages = []) {
  const previousKeys = new Set(beforeMessages.map(messageKey));
  return afterMessages.filter((message) => !previousKeys.has(messageKey(message)));
}

export function profileName(profile = {}) {
  return String(profile.nickname || profile.name || 'เพื่อนใหม่').trim().slice(0, 80);
}

function previewText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return (normalized || 'ส่งข้อความถึงคุณ').slice(0, 140);
}

export function likeNotification(senderProfile, senderId) {
  const senderName = profileName(senderProfile);
  return {
    title: 'มีคนกดใจคุณ 💜',
    body: `${senderName} สนใจทำกิจกรรมกับคุณ`,
    channelId: 'social',
    data: {
      type: 'like',
      profileId: senderId,
      url: '/likes',
    },
  };
}

export function matchNotification(otherProfile, conversationId) {
  const otherName = profileName(otherProfile);
  return {
    title: 'แมตช์ใหม่! 🎉',
    body: `คุณกับ ${otherName} แมตช์กันแล้ว เริ่มคุยกันได้เลย`,
    channelId: 'social',
    data: {
      type: 'match',
      conversationId,
      url: `/chat-room?chatId=${encodeURIComponent(conversationId)}`,
    },
  };
}

export function messageNotification(senderProfile, conversationId, message) {
  return {
    title: profileName(senderProfile),
    body: previewText(message?.text),
    channelId: 'messages',
    threadId: conversationId,
    data: {
      type: 'message',
      conversationId,
      messageId: String(message?.id || ''),
      senderId: String(message?.senderId || ''),
      url: `/chat-room?chatId=${encodeURIComponent(conversationId)}`,
    },
  };
}
