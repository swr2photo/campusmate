import { useEffect, useState } from 'react';
import { createVideoPlayer } from 'expo-video';
import { getDecryptedMediaUri, getSyncCachedMediaUri } from '../services/chatMediaService';
import { getOrFetchConversationKey } from '../services/chatEncryptionService';

const POSTER_CACHE_LIMIT = 40;
const posterCache = new Map();
const posterPending = new Map();
let posterQueue = Promise.resolve();

function readPoster(mediaUrl) {
  if (!posterCache.has(mediaUrl)) return undefined;
  const poster = posterCache.get(mediaUrl);
  posterCache.delete(mediaUrl);
  posterCache.set(mediaUrl, poster);
  return poster;
}

function writePoster(mediaUrl, poster) {
  posterCache.set(mediaUrl, poster);
  while (posterCache.size > POSTER_CACHE_LIMIT) {
    posterCache.delete(posterCache.keys().next().value);
  }
}

function isLocalMedia(mediaUrl) {
  return Boolean(
    mediaUrl
    && (mediaUrl.startsWith('file://') || mediaUrl.startsWith('content://') || mediaUrl.startsWith('data:'))
  );
}

// A frame needs the decrypted file and a native player, so requests run one at
// a time: a screenful of video bubbles must not open a player each.
export function requestVideoPoster(mediaUrl, conversationId, currentUserId) {
  if (!mediaUrl) return Promise.resolve(null);
  const pending = posterPending.get(mediaUrl);
  if (pending) return pending;

  const job = posterQueue.then(async () => {
    const cached = readPoster(mediaUrl);
    if (cached !== undefined) return cached;
    let player = null;
    try {
      let uri = isLocalMedia(mediaUrl) ? mediaUrl : getSyncCachedMediaUri(mediaUrl, 'video');
      if (!uri) {
        let key = null;
        if (conversationId && currentUserId) {
          key = await getOrFetchConversationKey(conversationId, currentUserId);
        }
        uri = await getDecryptedMediaUri(mediaUrl, { conversationKey: key, mediaType: 'video' });
      }
      if (!uri) {
        writePoster(mediaUrl, null);
        return null;
      }
      player = createVideoPlayer(uri);
      player.muted = true;
      const frames = await player.generateThumbnailsAsync(0, { maxWidth: 480 });
      const poster = frames?.[0] || null;
      writePoster(mediaUrl, poster);
      return poster;
    } catch (_) {
      writePoster(mediaUrl, null);
      return null;
    } finally {
      try { player?.release?.(); } catch (_) {}
      posterPending.delete(mediaUrl);
    }
  });

  posterPending.set(mediaUrl, job);
  posterQueue = job.catch(() => {});
  return job;
}

export function useVideoPoster(mediaUrl, conversationId, currentUserId, enabled = true) {
  const [poster, setPoster] = useState(() => (mediaUrl ? readPoster(mediaUrl) ?? null : null));

  useEffect(() => {
    if (!mediaUrl || !enabled) return undefined;
    const cached = readPoster(mediaUrl);
    if (cached !== undefined) {
      setPoster(cached);
      return undefined;
    }
    let active = true;
    requestVideoPoster(mediaUrl, conversationId, currentUserId).then((next) => {
      if (active) setPoster(next);
    });
    return () => { active = false; };
  }, [mediaUrl, conversationId, currentUserId, enabled]);

  return poster;
}
