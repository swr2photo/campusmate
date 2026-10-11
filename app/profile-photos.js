import React, { useCallback } from 'react';
import { router, Stack } from 'expo-router';
import ProfilePhotosScreen from '../src/screens/ProfilePhotosScreen';

export default function ProfilePhotosRoute() {
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/me');
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ProfilePhotosScreen onClose={close} />
    </>
  );
}
