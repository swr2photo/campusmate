import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { signOutUser, subscribeToAuthChanges } from '../services/authService';
import { saveAccount } from '../services/accountStorage';
import AppSplashScreen from '../components/AppSplashScreen';

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
      await signOutUser();
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
