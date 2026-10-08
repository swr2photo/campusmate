import React from 'react';
import { router, Stack } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen.ios';
import { useToast } from '../src/context/ToastContext';

export default function ProfileRoute() {
  const { showToast } = useToast();

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/me');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'แก้ไขโปรไฟล์' }} />
      <ProfileScreen
        onClose={close}
        onToast={showToast}
        showHeader={false}
      />
    </>
  );
}
