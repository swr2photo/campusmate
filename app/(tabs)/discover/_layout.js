import React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

export default function DiscoverLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.canvas },
        headerTitleStyle: { color: colors.ink, fontWeight: 'normal' , fontFamily: 'NotoSansThai_600SemiBold', fontSize: 18 },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}
