import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeGroupChats, subscribeGroupReads } from '../services/partyService';

export default function useGroupChatInbox(userId, search = '', unreadOnly = false) {
  const [groups, setGroups] = useState([]);
  const [reads, setReads] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const subscription = useRef(null);
  useEffect(() => {
    let active = true;
    setGroups([]); setReads({}); setError(null); setLoading(Boolean(userId)); setHasMore(false); setLoadingMore(false);
    if (!userId) return undefined;
    const off = subscribeGroupChats(userId, (items, page) => {
      if (!active) return;
      setGroups(items); setHasMore(page.hasMore); setLoading(false); setLoadingMore(false);
    }, (reason) => { if (active) { setError(reason); setLoading(false); setLoadingMore(false); } });
    subscription.current = off;
    return () => { active = false; off(); subscription.current = null; };
  }, [userId, retry]);
  const groupIds = groups.map((group) => group.id).sort().join('|');
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeGroupReads(userId, setReads, setError, groups.map((group) => group.id));
  }, [userId, groupIds, retry]);
  const items = useMemo(() => groups.map((group) => ({
    ...group, kind: 'group',
    unread: Boolean(group.lastMessageAt && group.lastMessageSenderId !== userId
      && (group.lastMessageAt.toMillis?.() || 0) > (reads[group.id]?.lastReadMessageAt?.toMillis?.() || 0)),
  })).filter((group) => (!unreadOnly || group.unread)
    && (!search.trim() || (group.title || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [groups, reads, userId, search, unreadOnly]);
  return { items, loading, error, hasMore, loadingMore,
    loadMore: () => { if (hasMore && !loadingMore) { setLoadingMore(true); subscription.current?.loadMore(); } },
    retry: () => setRetry((old) => old + 1) };
}
