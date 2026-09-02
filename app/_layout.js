import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '../src/context/AppContext';
import { AuthProvider } from '../src/context/AuthContext';
import { ToastProvider } from '../src/context/ToastContext';
import { useTheme } from '../src/theme';
import OfflineBanner from '../src/components/OfflineBanner';
import NotificationManager from '../src/components/NotificationManager';

const IPAD_ASPECT_RATIO = 9 / 16;

function IPadAspectFrame({ backgroundColor, children }) {
  const { height, width } = useWindowDimensions();
  const isIPad = Platform.OS === 'ios' && Platform.isPad;

  if (!isIPad) return children;

  const frameWidth = Math.min(width, height * IPAD_ASPECT_RATIO);
  const frameHeight = Math.min(height, width / IPAD_ASPECT_RATIO);

  return (
    <View style={[styles.ipadCanvas, { backgroundColor }]}>
      <View style={[styles.ipadFrameShadow, { height: frameHeight, width: frameWidth }]}>
        <View style={[styles.ipadFrame, { backgroundColor }]}>
          {children}
        </View>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const { colors, isDark } = useTheme();

  return (
    <AuthProvider>
      <AppProvider>
        <ToastProvider>
          <StatusBar style={isDark ? "light" : "dark"} />
          <IPadAspectFrame backgroundColor={colors.canvas}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="profile" options={{ presentation: 'formSheet' }} />
              <Stack.Screen name="likes" options={{ presentation: 'card' }} />
              <Stack.Screen name="discover-profile" options={{ animation: 'slide_from_right', headerShown: false, gestureEnabled: false }} />
              <Stack.Screen name="chat-room" options={{ animation: 'slide_from_right', headerShown: false, gestureEnabled: true }} />
            </Stack>
            <OfflineBanner />
            <NotificationManager />
          </IPadAspectFrame>
        </ToastProvider>
      </AppProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  ipadCanvas: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  ipadFrameShadow: {
    shadowColor: '#000000',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  ipadFrame: {
    flex: 1,
    overflow: 'hidden',
  },
});
