import React from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useToast } from '../src/context/ToastContext';

export default function ProfileRoute() {
  const { showToast } = useToast();
  const { section } = useLocalSearchParams();
  const closeGuardRef = React.useRef(null);

  return (
    <>
      <Stack.Screen options={{ title: 'แก้ไขโปรไฟล์' }} />
      <ProfileScreen
        initialSection={section || 'basic'}
        onCloseGuardReady={(handler) => {
          closeGuardRef.current = handler;
        }}
        onClose={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/me');
        }}
        onToast={showToast}
      />
    </>
  );
}
