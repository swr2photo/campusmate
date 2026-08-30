import React from 'react';
import { router } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useAuth } from '../src/context/AuthContext';
import { useToast } from '../src/context/ToastContext';

export default function ProfileRoute() {
  const { logout } = useAuth();
  const { showToast } = useToast();

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <ProfileScreen
      onClose={close}
      onLogout={async () => {
        await logout();
        router.replace('/');
      }}
      onToast={showToast}
    />
  );
}
