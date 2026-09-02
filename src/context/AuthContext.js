import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { signOutUser, subscribeToAuthChanges } from '../services/authService';
import { saveAccount } from '../services/accountStorage';
import AppSplashScreen from '../components/AppSplashScreen';
import { clearOfflineDataForUser } from '../services/offlineStorage';
import { unregisterPushNotificationsAsync } from '../services/notificationService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    try {
      return subscribeToAuthChanges(
        (authData) => {
          const authUser = authData?.user || null;
          setUser(authUser);
          if (authUser) {
            saveAccount(authUser);
          }
          setAuthError(null);
          setIsReady(true);
        },
        (error) => {
          setAuthError(error);
          setIsReady(true);
        }
      );
    } catch (error) {
      setAuthError(error);
      setIsReady(true);
      return undefined;
    }
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
      }
    },
    logout: async () => {
      const activeUserId = user?.id;
      if (activeUserId) {
        try {
          await Promise.race([
            unregisterPushNotificationsAsync(activeUserId),
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

  if (!isReady) {
    return <AppSplashScreen message="กำลังเข้าสู่ระบบ..." />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
