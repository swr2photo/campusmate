import React from 'react';
import { Redirect } from 'expo-router';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/context/AuthContext';
import { useAppProfile } from '../src/context/AppContext';
import AppSplashScreen from '../src/components/AppSplashScreen';

export default function LoginRoute() {
  const { isLoggedIn, login, isReady } = useAuth();
  const { profile } = useAppProfile();

  if (isLoggedIn) {
    // Routing depends on isNewUser, so hold here rather than guessing a target
    // while the profile is still hydrating.
    if (!profile) return <AppSplashScreen />;
    if (profile.isNewUser) return <Redirect href="/setup" />;
    return <Redirect href="/home" />;
  }

  if (!isReady) {
    return <AppSplashScreen />;
  }

  return <LoginScreen onLoginSuccess={login} />;
}

