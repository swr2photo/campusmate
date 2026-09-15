export function replyLabel(reply) {
  if (!reply) return '';
  if (reply.mediaType === 'video') return 'วิดีโอ';
  if (reply.mediaType === 'audio' || reply.audioUrl || reply.text === '[ข้อความเสียง]') {
    const seconds = Math.max(0, Math.round(reply.audioDuration || 0));
    return `ข้อความเสียง${seconds ? ` ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''}`;
  }
  if (reply.text === '[GIF]' || reply.text?.toUpperCase() === '[GIF]') return 'GIF';
  if (reply.mediaType === 'image' || reply.mediaUrl || reply.mediaUrls?.length || reply.text?.startsWith('[รูปภาพ')) return reply.text && !reply.text.startsWith('[รูปภาพ') && reply.text !== '[GIF]' ? reply.text : 'รูปภาพ';
  return reply.text || '';
}
export function createReplySnapshot(reply) {
  if (!reply?.id) return null;
  const snapshot = { id: String(reply.id), senderId: String(reply.senderId || '').slice(0, 128), text: String(reply.text || replyLabel(reply)).slice(0, 240) };
  // A reply must never copy the protected video URL into another message.
  if (reply.mediaType === 'video') return { ...snapshot, mediaType: 'video', text: 'วิดีโอ' };
  const audio = reply.mediaType === 'audio' || Boolean(reply.audioUrl);
  const mediaUrl = reply.audioUrl || reply.mediaUrl || reply.mediaUrls?.[0];
  if (typeof mediaUrl === 'string' && mediaUrl) { snapshot.mediaUrl = mediaUrl; snapshot.mediaType = audio ? 'audio' : 'image'; }
  if (audio && Number.isFinite(reply.audioDuration)) snapshot.audioDuration = reply.audioDuration;
  return snapshot;
}

export function resolveMessageReply(message, messagesById) {
  if (!message.replyTo) return message;
  const original = messagesById.get(message.replyTo.id || message.replyTo.messageId);
  return original ? { ...message, replyTo: { ...createReplySnapshot(original), ...message.replyTo } } : message;
}
