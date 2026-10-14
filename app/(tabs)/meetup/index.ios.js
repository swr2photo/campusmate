import React from 'react';
import { Stack } from 'expo-router';
import MeetupScreen from '../../../src/screens/MeetupScreen.ios';
import { useToast } from '../../../src/context/ToastContext';

export default function MeetupRoute() {
  const { showToast } = useToast();

  return (
    <>
      <Stack.Screen options={{ title: 'กิจกรรม', headerShown: true, headerTransparent: false, headerLargeTitle: false }} />
      <MeetupScreen onToast={showToast} />
    </>
  );
}
