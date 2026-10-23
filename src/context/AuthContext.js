import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/dbService';
import { clearConversationKeyCache } from '../services/chatEncryptionService';
import { clearGroupKeyCache } from '../services/groupChatEncryption';
import { signOutUser, subscribeToAuthChanges } from '../services/authService';
import { saveAccount } from '../services/accountStorage';
import { clearOfflineDataForUser } from '../services/offlineStorage';
import { unregisterPushNotificationsAsync } from '../services/notificationService';
import {
  getFastBootData,
  getFastBootMemory,
  saveFastBootData,
  clearFastBootData,
} from '../services/fastBootService';
import { showAlert } from '../utils/appAlert';
import { router } from 'expo-router';
import { showInAppNotification } from '../components/InAppNotificationBanner';
import { markPushInboxRead } from '../services/notificationInboxService';
import { RUST_BACKEND, rpc } from '../services/rust/backend';
import { liveQuery } from '../services/rust/events';

const AuthContext = createContext(null);
const AUTH_READY_TIMEOUT_MS = 6000;

export function AuthProvider({ children }) {
  const authRevision = useRef(0);
  const sessionUserId = useRef(null);
  const [user, setUser] = useState(() => {
    const cached = getFastBootMemory();
    return cached?.user || null;
  });
  const [isReady, setIsReady] = useState(() => {
    const cached = getFastBootMemory();
    return Boolean(cached?.user);
  });
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let active = true;
    let unsubscribe;
    const bootRevision = authRevision.current;

    // Fast-boot: hydrate user session instantly from local cache if returning user
    getFastBootData().then((fastBoot) => {
      if (!active || authRevision.current !== bootRevision) return;
      if (fastBoot?.user) {
        setUser(fastBoot.user);
        setIsReady(true);
      }
    }).catch(() => {});

    const timeoutId = setTimeout(() => {
      if (!active) return;
      console.warn('[AuthContext] Firebase Auth initialization timed out; continuing to the sign-in screen.');
      setAuthError(new Error('Firebase Authentication initialization timed out'));
      setIsReady(true);
    }, AUTH_READY_TIMEOUT_MS);

    const resolveAuth = (authData) => {
      if (!active) return;
      authRevision.current += 1;
      clearTimeout(timeoutId);
      const authUser = authData?.user || null;
      if (sessionUserId.current !== authUser?.id) { clearConversationKeyCache(); clearGroupKeyCache(); }
      sessionUserId.current = authUser?.id;
      setUser(authUser);
      if (authUser) {
        saveAccount(authUser);
        saveFastBootData({ user: authUser });
      } else {
        clearFastBootData();
      }
      setAuthError(null);
      setIsReady(true);
    };

    const rejectAuth = (error) => {
      if (!active) return;
      authRevision.current += 1;
      clearTimeout(timeoutId);
      setAuthError(error);
      setIsReady(true);
    };

    try {
      unsubscribe = subscribeToAuthChanges(resolveAuth, rejectAuth);
    } catch (error) {
      rejectAuth(error);
    }

    return () => {
      active = false;
      clearTimeout(timeoutId);
      unsubscribe?.();
    };
  }, []);

  const value = useMemo(() => ({
    authError,
    isLoggedIn: Boolean(user),
    user,
    isReady,
    login: async (userData) => {
      authRevision.current += 1;
      const u = userData?.user || userData;
      if (sessionUserId.current !== u?.id) { clearConversationKeyCache(); clearGroupKeyCache(); }
      sessionUserId.current = u?.id;
      setUser(u);
      if (u) {
        saveAccount(u);
        saveFastBootData({ user: u });
      }
    },
    logout: async () => {
      authRevision.current += 1;
      clearConversationKeyCache();
      clearGroupKeyCache();
      const activeUserId = user?.id;
      await clearFastBootData();
      if (activeUserId) {
        try {
          const unregisterPromise = unregisterPushNotificationsAsync(activeUserId).catch((error) => {
            console.warn('[Notifications] Unable to disable this device during logout:', error);
            return false;
          });
          await Promise.race([
            unregisterPromise,
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ]);
        } catch (error) {
          console.warn('[Notifications] Unable to disable this device during logout:', error);
        }
      }
      try {
        await signOutUser();
      } catch (error) {
        console.warn('[Auth] Sign out error:', error);
      } finally {
        if (activeUserId) {
          try {
            await clearOfflineDataForUser(activeUserId);
          } catch (error) {
            console.warn('[Offline] Unable to clear user cache during logout:', error);
          }
        }
        setUser(null);
      }
    },
  }), [authError, isReady, user]);

  useEffect(() => {
    if (!db || !user?.id) return;
    let active = true, suspending = false, showingNotice = false;
    const shownNotices = new Set(), noticeQueue = [];
    const uid = user.id;

    // Helper to determine if a notice is old/stale (> 24 hours old)
    const isNoticeStale = (notice) => {
      if (!notice) return true;
      let timestamp = 0;
      if (notice.createdAt?.toMillis) {
        timestamp = notice.createdAt.toMillis();
      } else if (notice.createdAt?.seconds) {
        timestamp = notice.createdAt.seconds * 1000;
      } else if (notice.createdAt) {
        timestamp = new Date(notice.createdAt).getTime();
      }
      // If notice was created more than 24 hours ago, it has already passed
      if (timestamp > 0 && Date.now() - timestamp > 24 * 60 * 60 * 1000) {
        return true;
      }
      return false;
    };

    const showNextNotice = () => {
      if (!active || suspending || showingNotice || !noticeQueue.length) return;
      const notice = noticeQueue.shift();
      showingNotice = true;
      showAlert(notice.title, notice.message, [{ text: 'รับทราบ', onPress: () => {
        void markPushInboxRead(notice.notificationId).catch(() => {});
        showingNotice = false;
        showNextNotice();
      } }], {
        cancelable: true,
        icon: notice.kind === 'moderation_warning' ? 'shield-alert' : 'megaphone',
        tone: notice.kind === 'moderation_warning' ? 'warning' : 'info',
        onDismiss: () => {
          showingNotice = false;
          showNextNotice();
        },
      });
    };

    if (RUST_BACKEND) {
      // Suspension revokes the native session (the auth subscription signs
      // out). Announcements and warnings arrive through the inbox.
      const openAnnouncement = (item) => {
        void markPushInboxRead(item.notificationId).catch(() => {});
        if (item.route && ['/home', '/discover', '/meetup', '/me', '/chat', '/likes'].includes(item.route)) router.push(item.route);
      };
      const stop = liveQuery('notifications', () => rpc('listNotifications', { limit: 10 }), async (page) => {
        for (const row of page?.notifications || []) {
          const kind = row.type;
          if (!['admin_announcement', 'moderation_warning'].includes(kind) || row.readAt) continue;
          const notice = { id: row.id, notificationId: row.id, title: row.title, message: row.body, route: row.target?.route, createdAt: row.createdAt };
          if (!active || shownNotices.has(kind + ':' + notice.id) || isNoticeStale(notice)) continue;
          shownNotices.add(kind + ':' + notice.id);
          const storageKey = 'campusmate_' + kind + '_' + uid;
          const seen = await AsyncStorage.getItem(storageKey).catch(() => null);
          if (!active || seen === notice.id) continue;
          await AsyncStorage.setItem(storageKey, notice.id).catch(() => {});
          if (kind === 'admin_announcement') {
            showInAppNotification({
              title: notice.title || 'ประกาศจาก CampusMate', message: notice.message || '', type: 'admin_announcement',
              data: { route: notice.route, notificationId: notice.notificationId },
              onPress: () => openAnnouncement(notice),
            });
          } else {
            noticeQueue.push({ ...notice, kind, title: 'คำเตือนจากผู้ดูแล CampusMate', storageKey });
            showNextNotice();
          }
        }
      }, () => {});
      return () => { active = false; stop(); };
    }

    const unsubscribe = onSnapshot(doc(db, 'accountRestrictions', uid), { includeMetadataChanges: true }, async snapshot => {
      if (!active || !snapshot.exists()) return;
      const restriction = snapshot.data();
      if (restriction.suspended === true && !snapshot.metadata.fromCache && !suspending) {
        suspending = true;
        try { await value.logout(); } catch { setUser(null); }
        showAlert('บัญชีถูกระงับ', restriction.suspensionReason || 'กรุณาติดต่อผู้ดูแล CampusMate', { tone: 'danger' });
        return;
      }
      if (suspending) return;

      for (const [kind, notice] of [['moderation_warning', restriction.latestWarning], ['admin_announcement', restriction.latestAnnouncement]]) {
        if (!notice?.id || shownNotices.has(kind + ':' + notice.id)) continue;
        shownNotices.add(kind + ':' + notice.id);
        const storageKey = 'campusmate_' + kind + '_' + uid;

        // 1. If notice is stale (sent > 24 hours ago), mark as seen immediately and skip
        if (isNoticeStale(notice)) {
          void AsyncStorage.setItem(storageKey, notice.id).catch(() => {});
          continue;
        }

        try {
          const seen = await AsyncStorage.getItem(storageKey);
          if (!active || seen === notice.id) continue;

          // 2. Mark as seen immediately so it will never pop up again on restart
          await AsyncStorage.setItem(storageKey, notice.id).catch(() => {});

          // 3. For announcements: Use Instagram-style top drop-down banner instead of center modal
          if (kind === 'admin_announcement') {
            showInAppNotification({
              title: notice.title || 'ประกาศจาก CampusMate',
              message: notice.message || '',
              type: 'admin_announcement',
              data: { route: notice.route, notificationId: notice.notificationId },
              onPress: () => {
                void markPushInboxRead(notice.notificationId).catch(() => {});
                if (notice.route && ['/home', '/discover', '/meetup', '/me', '/chat', '/likes'].includes(notice.route)) {
                  router.push(notice.route);
                }
              },
            });
          } else {
            // Moderation warning
            noticeQueue.push({
              id: notice.id,
              notificationId: notice.notificationId,
              kind,
              message: notice.message,
              title: 'คำเตือนจากผู้ดูแล CampusMate',
              storageKey,
            });
            showNextNotice();
          }
        } catch { /* A later session can retry showing an unread notice. */ }
      }
    }, () => { /* Auth expiry and offline reconnect are handled by the auth subscription. */ });
    return () => { active = false; unsubscribe(); };
  }, [user?.id, value.logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
