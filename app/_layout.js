import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider } from '../src/context/AppContext';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { ToastProvider } from '../src/context/ToastContext';
import { CallProvider } from '../src/context/CallContext';
import { useTheme } from '../src/theme';
import OfflineBanner from '../src/components/OfflineBanner';
import NotificationManager from '../src/components/NotificationManager';
import AppUpdateModal from '../src/components/AppUpdateModal';
import AppSplashScreen from '../src/components/AppSplashScreen';

const IPHONE_BASE_WIDTH = 390;
const IPHONE_BASE_HEIGHT = 844;

function IPadAspectFrame({ backgroundColor, children }) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isZoomed, setIsZoomed] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const isIPad = Platform.OS === 'ios' && Platform.isPad && width > 430;

  // คำนวณสเกลสูงสุดที่จะไม่ล้นจอเด็ดขาด ทั้งแนวตั้งและแนวนอน (หักระยะขอบ 32pt)
  const availableWidth = width - 32;
  const availableHeight = height - 32;
  const maxFitScale = Math.min(
    availableWidth / IPHONE_BASE_WIDTH,
    availableHeight / IPHONE_BASE_HEIGHT
  );

  const isLandscape = width > height;
  // โหมด 1x: แนวตั้งขนาด iPhone 1:1, แนวนอนปรับสเกลให้สมดุลสวยงาม
  const scale1x = isLandscape ? Math.min(1.0, maxFitScale * 0.85) : 1.0;
  // โหมด 2x: ขยายเต็มความสูงของจอในแนวนั้น ๆ พอดี ไม่เกินขอบจอ
  const scale2x = maxFitScale;

  // ปรับสเกลอัตโนมัติทันทีที่มีการหมุนจอ (เปลี่ยนแนวตั้ง / แนวนอน)
  useEffect(() => {
    if (!isIPad) return;
    const targetScale = isZoomed ? scale2x : scale1x;
    Animated.spring(scaleAnim, {
      toValue: targetScale,
      useNativeDriver: true,
      friction: 8,
      tension: 65,
    }).start();
  }, [width, height, isZoomed, scale1x, scale2x, isIPad]);

  if (!isIPad) return children;

  const toggleScale = () => {
    setIsZoomed((prev) => !prev);
  };

  return (
    <View style={[styles.ipadCanvas, { backgroundColor: '#0B0D14' }]}>
      <Animated.View
        style={[
          styles.ipadFrameShadow,
          {
            height: IPHONE_BASE_HEIGHT,
            width: IPHONE_BASE_WIDTH,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <View
          style={[
            styles.ipadFrame,
            {
              backgroundColor,
            },
          ]}
        >
          {children}
        </View>
      </Animated.View>

      {/* Floating 1x / 2x Zoom Control Button (Apple iPad Native Style) */}
      <Pressable
        onPress={toggleScale}
        style={({ pressed }) => [
          styles.zoomButton,
          {
            bottom: Math.max(20, insets.bottom + 12),
            right: Math.max(20, insets.right + 12),
          },
          pressed && styles.zoomButtonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={isZoomed ? 'ย่อขนาดหน้าจอ 1x' : 'ขยายหน้าจอ 2x'}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.zoomButtonText}>{isZoomed ? '1x' : '2x'}</Text>
      </Pressable>
    </View>
  );
}

function ColdBootGuard({ children }) {
  const { isReady } = useAuth();

  // Only auth has to resolve before routing is safe. Profile hydration is held
  // by the destination route instead, so the router and the route chunk load
  // while the profile is still being read.
  if (!isReady) {
    return <AppSplashScreen />;
  }

  return children;
}

export default function RootLayout() {
  const { colors, isDark } = useTheme();

  return (
    <AuthProvider>
      <AppProvider>
        <CallProvider>
          <ToastProvider>
            <SafeAreaProvider>
              <IPadAspectFrame backgroundColor={colors.canvas}>
                <StatusBar style={isDark ? 'light' : 'dark'} />
                <ColdBootGuard>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: colors.canvas },
                      animation: 'slide_from_right',
                    }}
                  >
                    <Stack.Screen name="index" options={{ animation: 'none' }} />
                    <Stack.Screen name="setup" />
                    <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
                    <Stack.Screen name="profile" options={{ animation: 'slide_from_right', headerShown: false }} />
                    <Stack.Screen name="likes" options={{ presentation: 'card' }} />
                    <Stack.Screen name="appointments" options={{ animation: 'slide_from_right', headerShown: false }} />
                    <Stack.Screen name="discover-profile" options={{ animation: 'slide_from_right', headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen
                      name="chat-room"
                      options={({ route }) => ({
                        animation: route?.params?.entryAnimation === 'popup' ? 'none' : 'slide_from_right',
                        headerShown: false,
                        gestureEnabled: true,
                      })}
                    />
                  </Stack>
                  <OfflineBanner />
                  <NotificationManager />
                  <AppUpdateModal />
                </ColdBootGuard>
              </IPadAspectFrame>
            </SafeAreaProvider>
          </ToastProvider>
        </CallProvider>
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
  },
  ipadFrame: {
    flex: 1,
    overflow: 'hidden',
  },
  zoomButton: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    minWidth: 46,
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(24, 26, 36, 0.9)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 9999,
  },
  zoomButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.85,
  },
  zoomButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
