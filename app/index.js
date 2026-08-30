import React from 'react';
import { Redirect } from 'expo-router';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/context/AuthContext';
import { useApp } from '../src/context/AppContext';

export default function LoginRoute() {
  const { isLoggedIn, login } = useAuth();
  const { profile } = useApp();

  if (isLoggedIn) {
    if (profile?.isNewUser) return <Redirect href="/setup" />;
    if (profile) return <Redirect href="/home" />;
  }
  
  return <LoginScreen onLoginSuccess={login} />;
}

