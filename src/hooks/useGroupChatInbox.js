import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeGroupChats, subscribeGroupReads } from '../services/partyService';

// Retain this session's group rows when a tab unmounts and opens again. The
// owner key prevents another signed-in account from seeing cached metadata.
let inboxCache = null;

export default function useGroupChatInbox(userId, search = '', unreadOnly = false) {
  const hasCache = inboxCache?.ownerId === userId;
  const [groups, setGroups] = useState(() => (hasCache ? inboxCache.groups : []));
  const [reads, setReads] = useState(() => (hasCache ? inboxCache.reads : {}));
  const [loading, setLoading] = useState(() => (hasCache ? false : Boolean(userId)));
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const subscription = useRef(null);
  const ownerRef = useRef(userId);
  useEffect(() => {
    let active = true;
    if (ownerRef.current !== userId) {
      ownerRef.current = userId;
      inboxCache = null;
      setGroups([]); setReads({});
      setLoading(Boolean(userId));
    } else if (!inboxCache || retry > 0) {
      setLoading(Boolean(userId));
    }
    setError(null); setHasMore(false); setLoadingMore(false);
    if (!userId) return undefined;
    const off = subscribeGroupChats(userId, (items, page) => {
      if (!active) return;
      inboxCache = { ownerId: userId, groups: items, reads: inboxCache?.ownerId === userId ? inboxCache.reads : {} };
      setGroups((prev) => (prev.length === 0 && items.length === 0 ? prev : items));
      setHasMore(page.hasMore); setLoading(false); setLoadingMore(false);
    }, (reason) => { if (active) { setError(reason); setLoading(false); setLoadingMore(false); } });
    subscription.current = off;
    return () => { active = false; off(); subscription.current = null; };
  }, [userId, retry]);
  const visibleGroups = ownerRef.current === userId ? groups : [];
  const groupIds = visibleGroups.map((group) => group.id).sort().join('|');
  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const off = subscribeGroupReads(userId, value => {
      if (!active) return;
      if (inboxCache?.ownerId === userId) inboxCache = { ...inboxCache, reads: value };
      setReads(value);
    }, setError, visibleGroups.map((group) => group.id));
    return () => { active = false; off(); };
  }, [userId, groupIds, retry]);
  const items = useMemo(() => visibleGroups.map((group) => ({
    ...group, kind: 'group',
    unread: Boolean(group.lastMessageAt && group.lastMessageSenderId !== userId
      && (group.lastMessageAt.toMillis?.() || 0) > (reads[group.id]?.lastReadMessageAt?.toMillis?.() || 0)),
  })).filter((group) => (!unreadOnly || group.unread)
    && (!search.trim() || (group.title || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [visibleGroups, reads, userId, search, unreadOnly]);
  return { items, loading, error, hasMore, loadingMore,
    loadMore: () => { if (hasMore && !loadingMore) { setLoadingMore(true); subscription.current?.loadMore(); } },
    retry: () => setRetry((old) => old + 1) };
}
