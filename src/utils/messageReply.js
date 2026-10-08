import { isProtectedViewMode } from './chatVideoPolicy.js';

export function replyLabel(reply) {
  if (!reply) return '';
  if (reply.mediaType === 'video') return 'วิดีโอ';
  if (reply.mediaType === 'track' || reply.trackId || reply.trackName) return 'เพลง';
  if (reply.mediaType === 'audio' || reply.audioUrl || reply.text === '[ข้อความเสียง]') {
    const seconds = Math.max(0, Math.round(reply.audioDuration || 0));
    return `ข้อความเสียง${seconds ? ` ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''}`;
  }
  if (reply.text === '[GIF]' || reply.text?.toUpperCase() === '[GIF]' || reply.mediaType === 'gif') return 'GIF';
  if (
    reply.mediaType === 'image'
    || reply.mediaUrl
    || reply.mediaUrls?.length
    || reply.text?.startsWith('[รูปภาพ')
  ) {
    return 'รูปภาพ';
  }
  return reply.text || '';
}

export function createReplySnapshot(reply) {
  if (!reply?.id) return null;

  const isVideo = reply.mediaType === 'video';
  const isAudio = reply.mediaType === 'audio' || Boolean(reply.audioUrl);
  const isTrack = reply.mediaType === 'track' || Boolean(reply.trackId);
  const isGif = reply.mediaType === 'gif' || reply.text === '[GIF]' || reply.text?.toUpperCase() === '[GIF]';
  const isImage = !isVideo && !isAudio && !isTrack && (
    reply.mediaType === 'image'
    || isGif
    || Boolean(reply.mediaUrl)
    || Boolean(reply.mediaUrls?.length)
    || Boolean(reply.text?.startsWith('[รูปภาพ'))
  );

  const snapshot = {
    id: String(reply.id),
    senderId: String(reply.senderId || '').slice(0, 128),
    text: String(replyLabel(reply) || reply.text || '').slice(0, 240),
  };

  if (isVideo) {
    snapshot.mediaType = 'video';
    snapshot.text = 'วิดีโอ';
    if (reply.videoMode === 'once' || reply.videoMode === 'replay' || reply.videoMode === 'chat') {
      snapshot.videoMode = reply.videoMode;
    }
    // Persist URL only for non-protected videos. once/replay stay URL-free in
    // the stored reply; resolveMessageReply rehydrates from the original for UI.
    if (!isProtectedViewMode(reply.videoMode) && typeof reply.mediaUrl === 'string' && reply.mediaUrl) {
      snapshot.mediaUrl = reply.mediaUrl;
    }
    return snapshot;
  }

  if (isAudio) {
    snapshot.mediaType = 'audio';
    const mediaUrl = reply.audioUrl || reply.mediaUrl;
    if (typeof mediaUrl === 'string' && mediaUrl) snapshot.mediaUrl = mediaUrl;
    if (Number.isFinite(reply.audioDuration)) snapshot.audioDuration = reply.audioDuration;
    return snapshot;
  }

  if (isTrack) {
    snapshot.mediaType = 'track';
    snapshot.text = 'เพลง';
    return snapshot;
  }

  if (isImage) {
    snapshot.mediaType = isGif ? 'gif' : 'image';
    snapshot.text = isGif ? 'GIF' : 'รูปภาพ';
    if (reply.viewMode === 'once' || reply.viewMode === 'replay' || reply.viewMode === 'chat') {
      snapshot.viewMode = reply.viewMode;
    }
    const mediaUrl = reply.mediaUrl || reply.mediaUrls?.[0];
    if (typeof mediaUrl === 'string' && mediaUrl) snapshot.mediaUrl = mediaUrl;
    return snapshot;
  }

  return snapshot;
}

export function resolveMessageReply(message, messagesById) {
  if (!message.replyTo) return message;
  const original = messagesById.get(message.replyTo.id || message.replyTo.messageId);
  if (!original) return message;

  const fromOriginal = createReplySnapshot(original) || {};
  const stored = message.replyTo || {};

  // Prefer live original media for the preview so protected video/image replies
  // still show a blurred frame even when the stored snapshot omitted the URL.
  const mediaUrl = original.mediaUrl || original.mediaUrls?.[0] || original.audioUrl
    || stored.mediaUrl || stored.mediaUrls?.[0];

  return {
    ...message,
    replyTo: {
      ...fromOriginal,
      ...stored,
      id: stored.id || fromOriginal.id,
      mediaType: original.mediaType || stored.mediaType || fromOriginal.mediaType,
      mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : undefined,
      viewMode: original.viewMode || stored.viewMode || fromOriginal.viewMode,
      videoMode: original.videoMode || stored.videoMode || fromOriginal.videoMode,
      audioDuration: original.audioDuration ?? stored.audioDuration ?? fromOriginal.audioDuration,
      text: replyLabel({ ...fromOriginal, ...stored, ...original }) || stored.text || fromOriginal.text,
    },
  };
}
