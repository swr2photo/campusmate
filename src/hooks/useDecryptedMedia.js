import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { getDecryptedMediaUri, getSyncCachedMediaUri } from '../services/chatMediaService';
import { getOrFetchConversationKey } from '../services/chatEncryptionService';
import { firebaseApp } from '../services/dbService';

/**
 * Hook to retrieve and decrypt chat media (image / audio) on-device.
 *
 * @param {string|null} mediaUrl - Remote URL (encrypted .enc or legacy unencrypted)
 * @param {object} options
 * @param {string} options.conversationId - Active conversation ID
 * @param {string} [options.currentUserId] - Current authenticated user ID
 * @param {Uint8Array|null} [options.conversationKey] - Pre-fetched 32-byte symmetric key
 * @param {'image'|'audio'} [options.mediaType='image'] - Media type
 * @returns {{ uri: string|null, loading: boolean, error: Error|null }}
 */
export function useDecryptedMedia(mediaUrl, { conversationId, currentUserId, conversationKey = null, mediaType = 'image' } = {}) {
  const isLocal = Boolean(
    !mediaUrl
    || mediaUrl.startsWith('file://')
    || mediaUrl.startsWith('content://')
    || mediaUrl.startsWith('data:')
  );

  const syncCached = getSyncCachedMediaUri(mediaUrl, mediaType, conversationKey);
  const initialUri = syncCached || (isLocal ? mediaUrl : null);
  const identity = `${currentUserId || ''}:${conversationId || ''}:${mediaType}:${mediaUrl || ''}:${conversationKey ? Array.from(conversationKey).join(',') : ''}`;
  const [uri, setUri] = useState(() => initialUri);
  const [resolvedIdentity, setResolvedIdentity] = useState(identity);
  const [loading, setLoading] = useState(() => Boolean(mediaUrl && !initialUri));
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let isMounted = true;

    if (!mediaUrl) {
      setError(null);
      setUri(null);
      setResolvedIdentity(identity);
      setLoading(false);
      return;
    }

    const currentSync = getSyncCachedMediaUri(mediaUrl, mediaType, conversationKey);
    if (currentSync || isLocal) {
      setError(null);
      setUri(currentSync || mediaUrl);
      setResolvedIdentity(identity);
      setLoading(false);
      return;
    }

    setLoading(true);
    setUri(null);
    setResolvedIdentity(identity);
    setError(null);

    async function resolveMedia() {
      try {
        let key = conversationKey;
        if (!key && conversationId) {
          let resolvedUid = currentUserId;
          if (!resolvedUid && firebaseApp) {
            try {
              resolvedUid = getAuth(firebaseApp)?.currentUser?.uid;
            } catch (_) {}
          }
          if (resolvedUid) {
            key = await getOrFetchConversationKey(conversationId, resolvedUid);
          }
        }

        const resolvedUri = await getDecryptedMediaUri(mediaUrl, {
          conversationKey: key,
          mediaType,
        });

        if (isMounted) {
          if (resolvedUri) {
            setUri(resolvedUri);
            setError(null);
          } else {
            setError(new Error('Cannot decrypt media'));
          }
        }
      } catch (err) {
        if (isMounted) {
          console.warn('[useDecryptedMedia] Failed to decrypt media:', err?.message || err);
          setError(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    resolveMedia();

    return () => {
      isMounted = false;
    };
  }, [mediaUrl, conversationId, currentUserId, conversationKey, mediaType, isLocal, attempt]);

  return {
    uri: resolvedIdentity === identity ? uri : initialUri,
    loading: resolvedIdentity === identity ? loading : Boolean(mediaUrl && !initialUri),
    error: resolvedIdentity === identity ? error : null,
    retry,
  };
}
