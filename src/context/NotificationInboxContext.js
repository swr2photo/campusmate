import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { clearPendingInboxReads, inboxCall, markInboxRead, visibleNotification, watchInbox, watchPendingInboxReads } from '../services/notificationInboxService';
import { mergeInboxSnapshot, overlayInboxReadReceipts, restoreInboxCache } from '../utils/notificationInboxCache';

const InboxContext = createContext(null);
export function NotificationInboxProvider({ children }) {
  const { user, isLoggedIn } = useAuth();
  const uid = isLoggedIn ? user?.id || user?.uid : null;
  const activeUid = useRef(uid); activeUid.current = uid;
  const [state, setState] = useState({ uid: null, rows: [], count: 0, loading: true });
  const [windowState, setWindowState] = useState({ uid: null, size: 30 });
  const pageSize = windowState.uid === uid ? windowState.size : 30;
  const [retryRevision, setRetryRevision] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [face, setFace] = useState({ uid: null, row: null });
  const [pendingReads, setPendingReads] = useState({ uid: null, receipts: [] });
  useEffect(() => {
    if (!uid) return undefined;
    const stop = watchPendingInboxReads(uid, receipts => {
      if (activeUid.current === uid) setPendingReads({ uid, receipts });
    });
    return () => {
      stop();
      if (activeUid.current !== uid) void clearPendingInboxReads(uid).catch(() => {});
    };
  }, [uid]);
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setExpiryTick(value => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setState(prev => prev.uid === uid ? prev : { uid, rows: [], count: 0, loading: !!uid });
    setFace(prev => prev.uid === uid ? prev : { uid, row: null });
    if (!uid) { setLoadingMore(false); return undefined; }
    const cacheKey = '@campusmate:inbox:v2:' + uid;
    let alive = true, stop = () => {};
    const start = cached => {
      if (!alive || activeUid.current !== uid) return;
      setState(prev => restoreInboxCache(prev, uid, cached));
      setFace(prev => prev.uid === uid && prev.serverSeen ? prev : { uid, row: cached?.face || (prev.uid === uid ? prev.row : null) });
      let cachedRows = Array.isArray(cached?.rows) ? cached.rows : [], cachedCount = Number(cached?.count) || 0, loadedRows = false, cachedFace = cached?.face || null;
      const saveCache = () => {
        if (loadedRows && alive) AsyncStorage.setItem(cacheKey, JSON.stringify({ rows: cachedRows.slice(0, 30), count: cachedCount, face: cachedFace })).catch(() => {});
      };
    // Expand one live query by 30 at a time. Older loaded rows also sync their
    // read state and new arrivals cannot leave a gap at page boundaries.
    stop = watchInbox(uid, (rows, cursor, hasMore, offline) => {
      if (!alive || activeUid.current !== uid) return;
      setState(prev => mergeInboxSnapshot(prev, uid, rows, hasMore, offline));
      setLoadingMore(false); loadedRows = true;
      if (!offline || rows.length) cachedRows = rows;
      if (!offline) saveCache();
    }, count => {
      if (alive && activeUid.current === uid) { cachedCount = count; saveCache(); setState(prev => ({ ...prev, count })); }
    }, error => {
      if (alive && activeUid.current === uid) { setLoadingMore(false); setState(prev => ({ ...prev, loading: false, error })); }
    }, (row, offline) => {
      if (alive && activeUid.current === uid) {
        cachedFace = row; setFace(prev => ({ uid, row, serverSeen: !offline || prev.serverSeen }));
        if (!offline) saveCache();
      }
    }, pageSize);
    };
    // Load disk history before attaching Firestore's initial memory-cache
    // snapshot, which can be empty after a cold offline launch.
    AsyncStorage.getItem(cacheKey).then(raw => {
      let cached = null; try { cached = raw ? JSON.parse(raw) : null; } catch {}
      start(cached);
    }).catch(() => start(null));
    return () => { alive = false; stop(); if (activeUid.current !== uid) AsyncStorage.removeItem(cacheKey).catch(() => {}); };
  }, [uid, retryRevision, pageSize]);
  const current = state.uid === uid ? state : { rows: [], count: 0, loading: !!uid };
  const rows = useMemo(() => {
    const all = current.rows.filter(visibleNotification);
    const merged = face.uid === uid && face.row?.status === 'required'
      ? [face.row, ...all.filter(row => row.id !== face.row.id)]
      : all.map(row => row.id === face.row?.id && face.uid === uid ? face.row : row);
    return overlayInboxReadReceipts(merged, pendingReads.uid === uid ? pendingReads.receipts : []);
  }, [current.rows, uid, face, expiryTick, pendingReads]);
  const markAll = async () => {
    let result;
    do { result = await inboxCall('markAllNotificationInboxRead', uid); } while (result.hasMore && activeUid.current === uid);
  };
  const loadMore = async () => {
    if (!uid || loadingMore || !current.hasMore) return;
    setLoadingMore(true); setWindowState({ uid, size: pageSize + 30 });
  };
  return <InboxContext.Provider value={{ ...current, uid, rows, loadingMore, loadMore, markAll,
    retry: () => setRetryRevision(value => value + 1), markRead: id => markInboxRead(uid, id) }}>{children}</InboxContext.Provider>;
}
export const useNotificationInbox = () => useContext(InboxContext) || { rows: [], count: 0, loading: false };
