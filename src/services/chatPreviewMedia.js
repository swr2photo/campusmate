import { getOrFetchConversationKey, peekCachedConversationKey } from './chatEncryptionService';
import { getDecryptedMediaUri } from './chatMediaService';
import { isEncryptedMediaUrl } from '../utils/imagePolicy';
import { prefetchRemoteImage } from '../utils/useRemoteImage';

const pendingPreviews = new Map();

export function getPreviewImageUrls(messages, limit = 2) {
  const urls = [];
  for (const message of (messages || []).slice(-8).reverse()) {
    // Never pre-open disappearing media or deleted messages.
    if (message.viewMode === 'once' || message.viewMode === 'replay' || message.deleted || message.isDeleted || message.decryptionFailed) continue;
    if (message.mediaType && !['image', 'gif'].includes(message.mediaType)) continue;
    if (message.audioUrl) continue;
    for (const url of [message.mediaUrl, ...(Array.isArray(message.mediaUrls) ? message.mediaUrls : [])]) {
      if (typeof url === 'string' && /^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
      if (urls.length >= limit) return urls;
    }
  }
  return urls;
}

// Begin during the long-press delay. The display path shares pending media
// downloads and the native cache, and this does not mark messages as read.
export async function warmChatPreviewMedia(conversation, userId) {
  if (!conversation?.id || !userId) return;
  const urls = getPreviewImageUrls(conversation.messages);
  if (!urls.length) return;
  const identity = JSON.stringify([userId, conversation.id, urls]);
  if (pendingPreviews.has(identity)) return pendingPreviews.get(identity);
  const pending = (async () => {
    const key = urls.some(isEncryptedMediaUrl)
      ? (peekCachedConversationKey(conversation.id, userId) || await getOrFetchConversationKey(conversation.id, userId))
      : null;
    await Promise.allSettled(urls.map((url) => isEncryptedMediaUrl(url)
      ? getDecryptedMediaUri(url, { conversationKey: key })
      : prefetchRemoteImage(url)));
  })();
  pendingPreviews.set(identity, pending);
  try { await pending; }
  finally { if (pendingPreviews.get(identity) === pending) pendingPreviews.delete(identity); }
}
