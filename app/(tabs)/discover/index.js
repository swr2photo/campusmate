import React from 'react';
import { router } from 'expo-router';
import HomeScreen from '../../../src/screens/HomeScreen';
import { useToast } from '../../../src/context/ToastContext';

import { Stack } from 'expo-router';

export default function DiscoverRoute() {
  const { showToast } = useToast();
  return (
    <>
      <Stack.Screen options={{ title: 'หาเพื่อน' }} />
      <HomeScreen onOpenLikes={() => router.push('/likes')} onToast={showToast} />
    </>
  );
}
