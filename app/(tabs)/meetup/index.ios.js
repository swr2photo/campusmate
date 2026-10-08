import React from 'react';
import { Stack } from 'expo-router';
import MeetupScreen from '../../../src/screens/MeetupScreen.ios';
import { useToast } from '../../../src/context/ToastContext';

export default function MeetupRoute() {
  const { showToast } = useToast();

  return (
    <>
      <Stack.Screen options={{ title: 'กิจกรรม' }} />
      <MeetupScreen onToast={showToast} />
    </>
  );
}
