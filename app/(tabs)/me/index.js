import React from 'react';
import { Stack } from 'expo-router';
import ProfileHubScreen from '../../../src/screens/ProfileHubScreen';
import { useToast } from '../../../src/context/ToastContext';

export default function MeRoute() {
  const { showToast } = useToast();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          title: 'โปรไฟล์',
        }}
      />
      <ProfileHubScreen onToast={showToast} />
    </>
  );
}
