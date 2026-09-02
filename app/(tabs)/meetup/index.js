import React from 'react';
import MeetupScreen from '../../../src/screens/MeetupScreen';
import { useToast } from '../../../src/context/ToastContext';

import { Stack } from 'expo-router';

export default function MeetupRoute() {
  const { showToast } = useToast();
  return (
    <>
      <Stack.Screen options={{ title: 'กิจกรรม' }} />
      <MeetupScreen onToast={showToast} />
    </>
  );
}

