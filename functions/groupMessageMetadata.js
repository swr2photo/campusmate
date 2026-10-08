export function newerGroupMessage(chat, message, messageId) {
  const incoming = message.createdAt?.toMillis?.() || 0;
  const previous = chat.lastMessageAt?.toMillis?.() || 0;
  if (!incoming || incoming < previous) return null;
  if (incoming === previous && String(messageId) <= String(chat.lastMessageId || '')) return null;
  return {
    lastMessageAt: message.createdAt, lastMessageId: messageId,
    lastMessageSenderId: message.senderId,
    lastMessageType: message.type === 'image' ? 'image' : 'text',
    updatedAt: message.createdAt,
  };
}
