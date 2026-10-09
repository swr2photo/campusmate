import { NotificationInboxProvider } from '../src/context/NotificationInboxContext';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/context/AppContext';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { MembershipProvider } from '../src/context/MembershipContext';
import { ConfirmProvider } from '../src/context/ConfirmContext';
import { ToastProvider } from '../src/context/ToastContext';
import { CallProvider } from '../src/context/CallContext';
import { createNavigationTheme, useTheme } from '../src/theme';
import { useIconFontsReady } from '../src/hooks/useIconFonts';
import OfflineBanner from '../src/components/OfflineBanner';
import NotificationManager from '../src/components/NotificationManager';
import AppUpdateModal from '../src/components/AppUpdateModal';
import AppSplashScreen from '../src/components/AppSplashScreen';
import AppErrorBoundary from '../src/components/AppErrorBoundary';
import AppAlertHost from '../src/components/AppAlertHost';
import InAppNotificationHost from '../src/components/InAppNotificationBanner';
import AppTourOverlay from '../src/components/AppTourOverlay';
import PlusUpsellHost from '../src/components/PlusUpsellSheet';
import { AppTourProvider } from '../src/context/AppTourContext';

function ColdBootGuard({ children }) {
  const { isReady } = useAuth();
  const iconFontsReady = useIconFontsReady();
  const booting = !iconFontsReady || !isReady;
  return (
    <View style={{ flex: 1 }}>
      {children}
      {booting ? (
        <View pointerEvents="auto" style={StyleSheet.absoluteFill}>
          <AppSplashScreen />
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const { colors, isDark } = useTheme();
  const navigationTheme = createNavigationTheme(isDark ? DarkTheme : DefaultTheme, colors);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardProvider>
    <AuthProvider>
      <MembershipProvider>
      <AppProvider>
      <NotificationInboxProvider>
        <CallProvider>
          <ToastProvider>
            <ConfirmProvider>
            <SafeAreaProvider>
              <AppTourProvider>
              <ThemeProvider value={navigationTheme}>
              <StatusBar style={isDark ? 'light' : 'dark'} />
              <ColdBootGuard>
                <AppErrorBoundary>
                  <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      headerShadowVisible: false,
                      headerBackButtonDisplayMode: 'minimal',
                      headerBackTitle: 'ย้อนกลับ',
                      headerTintColor: colors.ink,
                      headerStyle: { backgroundColor: colors.canvas },
                      headerTitleStyle: { color: colors.ink, fontFamily: 'NotoSansThai_600SemiBold', fontSize: 18 },
                      contentStyle: { backgroundColor: colors.canvas },
                      animation: 'slide_from_right',
                    }}
                  >
                    <Stack.Screen name="index" options={{ animation: 'none' }} />
                    <Stack.Screen name="verify-campus-email" options={{ animation: 'fade', headerShown: false }} />
                    <Stack.Screen
                      name="setup"
                      options={{
                        headerShown: true,
                        title: 'สร้างโปรไฟล์',
                        headerBackVisible: false,
                        gestureEnabled: false,
                      }}
                    />
                    <Stack.Screen name="(tabs)" options={{ animation: 'none', title: 'หน้าหลัก' }} />
                    <Stack.Screen name="profile" options={{ headerShown: true, title: 'แก้ไขโปรไฟล์' }} />
                    <Stack.Screen name="profile-settings" options={{ headerShown: false }} />
                    <Stack.Screen name="membership" options={{ headerShown: true, title: 'CampusMate Plus' }} />
                    <Stack.Screen name="likes" options={{ headerShown: true, title: 'ถูกใจ' }} />
                    <Stack.Screen name="notifications" options={{ headerShown: true, title: 'แจ้งเตือน' }} />
                    <Stack.Screen name="appointments" options={{ headerShown: true, title: 'ประวัติการนัดหมาย' }} />
                    <Stack.Screen name="party-finder" options={{ headerShown: true, title: 'หาตี้ใน ม.อ.' }} />
                    <Stack.Screen
                      name="discover-profile"
                      options={{ animation: 'slide_from_right', headerShown: false, gestureEnabled: true }}
                    />
                    <Stack.Screen
                      name="chat-room"
                      options={({ route }) => ({
                        animation: route?.params?.entryAnimation === 'popup' ? 'none' : 'slide_from_right',
                        headerShown: false,
                        gestureEnabled: true,
                      })}
                    />
                    <Stack.Screen name="group-chat" options={{ animation: 'slide_from_right', headerShown: false }} />
                    <Stack.Screen
                      name="matching-filters"
                      options={Platform.OS === 'ios' ? {
                        presentation: 'formSheet',
                        sheetAllowedDetents: [0.92],
                        sheetCornerRadius: 24,
                        sheetGrabberVisible: true,
                        headerShown: false,
                        contentStyle: { backgroundColor: colors.canvas },
                      } : {
                        presentation: 'transparentModal',
                        animation: 'none',
                        headerShown: false,
                        gestureEnabled: false,
                        contentStyle: { backgroundColor: 'transparent' },
                      }}
                    />
                    <Stack.Screen name="about" options={{ headerShown: true, title: 'เกี่ยวกับ CampusMate' }} />
                    <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                    <Stack.Screen name="legal-notice" options={{ headerShown: true, title: 'ข้อกำหนดทางกฎหมาย' }} />
                    <Stack.Screen name="terms" options={{ headerShown: true, title: 'เงื่อนไขการให้บริการ' }} />
                    <Stack.Screen name="privacy-policy" options={{ headerShown: true, title: 'นโยบายความเป็นส่วนตัว' }} />
                    <Stack.Screen name="community-guidelines" options={{ headerShown: true, title: 'นโยบายชุมชนและความปลอดภัย' }} />
                    <Stack.Screen name="profile-visibility" options={{ headerShown: true, title: 'การแสดงโปรไฟล์' }} />
                  </Stack>
                  </View>
                </AppErrorBoundary>
                <OfflineBanner />
                <NotificationManager />
                <AppUpdateModal />
              </ColdBootGuard>
              <AppTourOverlay />
              <PlusUpsellHost />

              <InAppNotificationHost />
              <AppAlertHost />
              </ThemeProvider>
              </AppTourProvider>
            </SafeAreaProvider>
            </ConfirmProvider>
          </ToastProvider>
        </CallProvider>
      </NotificationInboxProvider>
      </AppProvider>
      </MembershipProvider>
    </AuthProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
