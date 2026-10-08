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
  const previous = Array.isArray(beforeMessages) ? beforeMessages : [];
  const current = Array.isArray(afterMessages) ? afterMessages : [];
  const previousKeys = new Set(previous.map(messageKey));
  return current.filter((message) => !previousKeys.has(messageKey(message)));
}

export function isNewPendingLike(beforeDecision, afterDecision) {
  if (afterDecision?.type !== 'like' || afterDecision?.status !== 'pending') return false;
  return !(beforeDecision?.type === 'like' && beforeDecision?.status === 'pending');
}

export function profileName(profile = {}) {
  const safeProfile = profile || {};
  return String(safeProfile.nickname || safeProfile.name || 'เพื่อนใหม่')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'เพื่อนใหม่';
}

export function profileAvatarUri(profile = {}) {
  const uri = profile?.avatarUri || profile?.photoURL || profile?.photoUrl || profile?.photos?.[0];
  if (typeof uri === 'string' && (uri.startsWith('http://') || uri.startsWith('https://'))) {
    return uri;
  }
  return null;
}

export function likeNotification(senderProfile, senderId) {
  const senderName = profileName(senderProfile);
  const avatarUri = profileAvatarUri(senderProfile);
  return {
    title: 'มีคนกดใจคุณ 💜',
    body: `${senderName} สนใจทำกิจกรรมกับคุณ`,
    channelId: 'social',
    avatarUri,
    data: {
      type: 'like',
      profileId: senderId,
      avatarUri,
      url: '/likes',
    },
  };
}

export function privateLikeNotification() {
  return { title: 'มีคนกดใจคุณ', body: 'เปิด CampusMate เพื่อดูจำนวนคนที่ถูกใจคุณ', channelId: 'social',
    data: { type: 'like', url: '/likes' } };
}

export function matchNotification(otherProfile, conversationId) {
  const otherName = profileName(otherProfile);
  const avatarUri = profileAvatarUri(otherProfile);
  return {
    title: 'แมตช์ใหม่! 🎉',
    body: `คุณกับ ${otherName} แมตช์กันแล้ว เริ่มคุยกันได้เลย`,
    channelId: 'social',
    avatarUri,
    data: {
      type: 'match',
      conversationId,
      avatarUri,
      url: `/chat-room?chatId=${encodeURIComponent(conversationId)}`,
    },
  };
}

export function messageNotification(senderProfile, conversationId, message) {
  const senderName = profileName(senderProfile);
  const avatarUri = profileAvatarUri(senderProfile);
  const rawText = String(message?.text || message?.preview || '').trim();
  const bodyText = rawText
    ? rawText.slice(0, 200)
    : (message?.mediaType === 'image'
      ? 'ส่งรูปภาพ'
      : (message?.mediaType === 'track' ? 'ส่งเพลง' : 'มีข้อความใหม่'));
  const mediaUrl = message?.mediaType === 'image' && typeof message?.mediaUrl === 'string' ? message.mediaUrl : null;

  return {
    title: senderName,
    body: bodyText,
    channelId: 'messages',
    threadId: conversationId,
    avatarUri,
    mediaUrl,
    data: {
      type: 'message',
      conversationId,
      messageId: String(message?.id || ''),
      senderId: String(message?.senderId || ''),
      senderName,
      avatarUri,
      mediaUrl,
      url: `/chat-room?chatId=${encodeURIComponent(conversationId)}`,
    },
  };
}

export function callNotification(callerProfile, call) {
  const callerName = profileName(callerProfile);
  const avatarUri = profileAvatarUri(callerProfile);
  const isVoice = call?.callType === 'voice';
  const callTitle = isVoice ? 'สายเรียกเข้า (โทรด้วยเสียง) 📞' : 'สายเรียกเข้า (วิดีโอคอล) 📹';
  const bodyText = `${callerName} กำลังโทรหาคุณ...`;

  return {
    title: callTitle,
    body: bodyText,
    channelId: 'calls',
    priority: 'high',
    avatarUri,
    data: {
      type: 'incoming_call',
      callId: String(call?.id || ''),
      callerId: String(call?.callerId || ''),
      callerName,
      callerAvatar: avatarUri || '',
      callType: call?.callType || 'voice',
      conversationId: String(call?.conversationId || ''),
      url: call?.conversationId ? `/chat-room?chatId=${encodeURIComponent(call.conversationId)}` : '/',
    },
  };
}

