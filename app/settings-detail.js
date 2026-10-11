import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import SettingsDetailScreen from '../src/screens/SettingsDetailScreen';

export default function SettingsDetailRoute() {
  const { section } = useLocalSearchParams();
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <SettingsDetailScreen key={String(section || '')} section={Array.isArray(section) ? section[0] : section} />
  </>;
}
