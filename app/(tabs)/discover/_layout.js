import React from 'react';
import { Stack } from 'expo-router';

export default function DiscoverLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerTransparent: true,
        headerBlurEffect: 'prominent',
        headerShadowVisible: false,
      }}
    />
  );
}
