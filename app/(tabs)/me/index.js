import React from 'react';
import { router, Stack } from 'expo-router';
import ProfileSettingsScreen from '../../../src/screens/ProfileSettingsScreen';
import { useAuth } from '../../../src/context/AuthContext';
import { useToast } from '../../../src/context/ToastContext';

export default function MeRoute() {
  const { logout } = useAuth();
  const { showToast } = useToast();

  return (
    <>
      <Stack.Screen options={{ headerRight: () => null, title: 'โปรไฟล์และการตั้งค่า' }} />
      <ProfileSettingsScreen
        onLogout={async () => {
          await logout();
          router.replace('/');
        }}
        onToast={showToast}
      />
    </>
  );
}
