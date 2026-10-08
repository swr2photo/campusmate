import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { inboxCall, markInboxRead, visibleNotification, watchInbox } from '../services/notificationInboxService';

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
    AsyncStorage.getItem(cacheKey).then(raw => {
      if (activeUid.current !== uid || !raw) return;
      const cached = JSON.parse(raw);
      setState(prev => prev.uid === uid && prev.loading ? { ...prev, rows: cached.rows || [], count: cached.count || 0, offline: true } : prev);
    }).catch(() => {});
    let cachedRows = [], cachedCount = 0, loadedRows = false;
    const saveCache = () => {
      if (loadedRows) AsyncStorage.setItem(cacheKey, JSON.stringify({ rows: cachedRows.slice(0, 30), count: cachedCount })).catch(() => {});
    };
    // Expand one live query by 30 at a time. Older loaded rows also sync their
    // read state and new arrivals cannot leave a gap at page boundaries.
    const stop = watchInbox(uid, (rows, cursor, hasMore, offline) => {
      if (activeUid.current !== uid) return;
      setState(prev => ({ ...prev, uid, rows, hasMore, offline, loading: false, error: null }));
      setLoadingMore(false); loadedRows = true; cachedRows = rows; if (!offline) saveCache();
    }, count => {
      if (activeUid.current === uid) { cachedCount = count; saveCache(); setState(prev => ({ ...prev, count })); }
    }, error => {
      if (activeUid.current === uid) { setLoadingMore(false); setState(prev => ({ ...prev, loading: false, error })); }
    }, row => { if (activeUid.current === uid) setFace({ uid, row }); }, pageSize);
    return () => { stop(); if (activeUid.current !== uid) AsyncStorage.removeItem(cacheKey).catch(() => {}); };
  }, [uid, retryRevision, pageSize]);
  const current = state.uid === uid ? state : { rows: [], count: 0, loading: !!uid };
  const rows = useMemo(() => {
    const all = current.rows.filter(visibleNotification);
    if (face.uid === uid && face.row?.status === 'required') return [face.row, ...all.filter(row => row.id !== face.row.id)];
    return all.map(row => row.id === face.row?.id && face.uid === uid ? face.row : row);
  }, [current.rows, uid, face, expiryTick]);
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
