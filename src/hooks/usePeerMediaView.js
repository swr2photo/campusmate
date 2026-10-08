import { useEffect, useState } from 'react';
import { watchMediaView } from '../services/chatVideoService';

export function usePeerMediaView(conversationId, messageId, viewerId, enabled = true) {
  const [viewedAt, setViewedAt] = useState(null);

  useEffect(() => {
    if (!enabled || !conversationId || !messageId || !viewerId) return undefined;
    return watchMediaView(conversationId, messageId, viewerId, (data) => {
      const raw = data?.viewedAt;
      if (typeof raw?.toDate === 'function') {
        setViewedAt(raw.toDate());
        return;
      }
      setViewedAt(raw instanceof Date ? raw : new Date());
    });
  }, [conversationId, enabled, messageId, viewerId]);

  return viewedAt;
}
