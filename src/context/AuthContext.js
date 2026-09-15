import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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

const AuthContext = createContext(null);
const AUTH_READY_TIMEOUT_MS = 6000;

export function AuthProvider({ children }) {
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

    // Fast-boot: hydrate user session instantly from local cache if returning user
    getFastBootData().then((fastBoot) => {
      if (!active) return;
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
      clearTimeout(timeoutId);
      const authUser = authData?.user || null;
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
      const u = userData?.user || userData;
      setUser(u);
      if (u) {
        saveAccount(u);
        saveFastBootData({ user: u });
      }
    },
    logout: async () => {
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
      await signOutUser();
      if (activeUserId) {
        try {
          await clearOfflineDataForUser(activeUserId);
        } catch (error) {
          console.warn('[Offline] Unable to clear user cache during logout:', error);
        }
      }
      setUser(null);
    },
  }), [authError, isReady, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
