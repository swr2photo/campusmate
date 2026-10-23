import { chatPreviewText } from './chatPreviewText';

export function chatMemberSettings(conversation, uid) {
  return conversation?.participantSettings?.[uid] || conversation?.mySettings || {};
}

export function chatUnreadState(conversation, uid) {
  const raw = conversation?.unreadCounts?.[uid] ?? conversation?.unread;
  const count = typeof raw === 'boolean' ? 0 : Math.max(0, Number(raw) || 0);
  const marked = chatMemberSettings(conversation, uid).markedUnread === true;
  return { count, marked, unread: count > 0 || raw === true || marked };
}

export function latestChatSnippet(conversation, uid) {
  const message = conversation?.lastMessageId
    ? conversation.messages?.find(m => m.id === conversation.lastMessageId)
    : conversation?.messages?.at(-1);
  if (message?.sendStatus === 'failed') return 'ส่งไม่สำเร็จ';
  if (message?.pendingSync) return 'รอส่ง';
  const type = message?.mediaType || conversation?.lastMessageType;
  let snippet = type === 'track' ? `เพลง · ${message?.trackName || 'เพลงที่แชร์'}`
    : type === 'audio' ? 'ข้อความเสียง'
      : type === 'image' ? 'รูปภาพ'
        : type === 'gif' ? 'GIF'
          : chatPreviewText(message, conversation?.lastMessage || '');
  if (!snippet || ['[ข้อความที่เข้ารหัส]', 'ข้อความที่เข้ารหัส'].includes(snippet)) snippet = 'เปิดแชตเพื่ออ่านข้อความ';
  const mine = Boolean(uid) && (message?.senderId === uid || message?.sender === 'me' || conversation?.lastMessageSenderId === uid);
  return mine ? `คุณ: ${snippet}` : snippet;
}

function timestampMillis(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  try {
    if (typeof value.toDate === 'function') return timestampMillis(value.toDate());
    const seconds = value.seconds ?? value._seconds;
    const millis = seconds != null
      ? Number(seconds) * 1000 + Number(value.nanoseconds ?? value._nanoseconds ?? 0) / 1e6
      : value instanceof Date ? value.getTime()
        : typeof value === 'number' ? (value < 1e11 ? value * 1000 : value)
          : typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

// Receipt evidence belongs to the peer and must cover the latest sent message.
// Zero unread messages and conversation.updatedAt alone are not read receipts.
export function chatReadStatus(conversation, uid, now = Date.now()) {
  if (!uid || !conversation || conversation.kind === 'group' || conversation.participants?.length > 2) return '';
  const messages = conversation.messages || [];
  const message = conversation.lastMessageId
    ? messages.find(entry => entry.id === conversation.lastMessageId)
    : messages.at(-1);
  const latestCached = messages.at(-1);
  if (message?.pendingSync || message?.sendStatus === 'failed' || message?.unsent || message?.deletedAt
    || latestCached?.pendingSync || latestCached?.sendStatus === 'failed') return '';
  const senderId = conversation.lastMessageSenderId || message?.senderId || (message?.sender === 'me' ? uid : null);
  if (senderId !== uid) return '';
  const peerId = conversation.participants?.find(id => id !== uid)
    || (conversation.profileId !== uid ? conversation.profileId : null);
  if (!peerId) return '';
  const sentAt = timestampMillis(conversation.lastMessageAt) ?? timestampMillis(message?.createdAt || message?.time);
  const readAt = timestampMillis(conversation.readReceipts?.[peerId]);
  if (sentAt == null || readAt == null || readAt <= 0 || readAt < sentAt) return '';
  const elapsed = Math.max(0, now - readAt);
  if (elapsed < 60000) return 'อ่านแล้วเมื่อสักครู่';
  const units = [
    [365 * 86400000, 'ปี'], [30 * 86400000, 'เดือน'], [86400000, 'วัน'],
    [3600000, 'ชั่วโมง'], [60000, 'นาที'],
  ];
  const [duration, unit] = units.find(([duration]) => elapsed >= duration);
  return `อ่านแล้วเมื่อ ${Math.floor(elapsed / duration)} ${unit}ที่แล้ว`;
}

export function formatInboxTimestamp(value) {
  const date = value?.toDate?.() || (value?.seconds != null ? new Date(value.seconds * 1000) : value instanceof Date ? value : new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value));
  if (!value || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

// Only use an exact message already decrypted by the authorized inbox client.
// Never copy plaintext into the notification record or use an unrelated latest message.
export function notificationPresentation(row, conversations = []) {
  const title = row.senderName || row.title || 'CampusMate';
  if (row.type !== 'message') return { title, body: row.body || '' };
  if (!row.target?.conversationId || !row.target?.messageId) return { title, body: row.body || 'แตะเพื่อเปิดแชต' };
  const conversation = conversations.find(c => c.id === row.target?.conversationId && c.active !== false);
  const message = conversation?.messages?.find(m => m.id === row.target?.messageId);
  if (!message) return { title, body: row.body || 'แตะเพื่อเปิดแชต' };
  if (message.deletedAt || message.unsent) return { title, body: 'ข้อความถูกยกเลิกแล้ว' };
  return { title, body: latestChatSnippet({ messages: [message] }) };
}
