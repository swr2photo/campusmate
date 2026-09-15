import React from 'react';
import { Redirect } from 'expo-router';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/context/AuthContext';
import { useApp } from '../src/context/AppContext';
import AppSplashScreen from '../src/components/AppSplashScreen';

export default function LoginRoute() {
  const { isLoggedIn, login, isReady } = useAuth();
  const { profile } = useApp();

  if (isLoggedIn) {
    if (profile?.isNewUser) return <Redirect href="/setup" />;
    return <Redirect href="/home" />;
  }

  if (!isReady) {
    return <AppSplashScreen />;
  }

  return <LoginScreen onLoginSuccess={login} />;
}

