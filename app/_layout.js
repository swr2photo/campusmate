import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '../src/context/AppContext';
import { AuthProvider } from '../src/context/AuthContext';
import { ToastProvider } from '../src/context/ToastContext';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  const { colors, isDark } = useTheme();

  return (
    <AuthProvider>
      <AppProvider>
        <ToastProvider>
          <StatusBar style={isDark ? "light" : "dark"} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="profile" options={{ presentation: 'formSheet' }} />
            <Stack.Screen name="likes" options={{ presentation: 'card' }} />
            <Stack.Screen name="discover-profile" options={{ animation: 'slide_from_right', headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="chat-room" options={{ animation: 'slide_from_right', headerShown: false, gestureEnabled: true }} />
          </Stack>
        </ToastProvider>
      </AppProvider>
    </AuthProvider>
  );
}
