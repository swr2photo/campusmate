import React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';
import AppText from '../../../src/components/AppText';

export default function HomeLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: Platform.OS === 'android',
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.canvas },
        headerTitle: ({ children }) => (
          <AppText style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>
            {children}
          </AppText>
        ),
        headerTitleStyle: { color: colors.ink, fontWeight: 'normal', fontFamily: 'NotoSansThai_700Bold', fontSize: 18 },
        headerLeft: () => null,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}
