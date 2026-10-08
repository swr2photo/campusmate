import Text from './AppText';
import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, Animated } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

const appIcon = require('../../assets/adaptive-icon.png');
const WAIT_HINT_DELAY_MS = 700;

export default function AppSplashScreen({ message }) {
  const [showWaitHint, setShowWaitHint] = useState(Boolean(message));

  // Animation values
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const hintOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});

    // Staggered entrance animation
    Animated.sequence([
      // 1. Logo zooms in with spring
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      // 2. Text fades in and slides up
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.spring(textTranslateY, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      // 3. Glow circles fade in
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (message) {
      setShowWaitHint(true);
      return undefined;
    }
    const timeoutId = setTimeout(() => {
      setShowWaitHint(true);
      Animated.timing(hintOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, WAIT_HINT_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [message]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" backgroundColor="#F7F7F8" />
      <Animated.View pointerEvents="none" style={[styles.topGlow, { opacity: glowOpacity }]} />
      <Animated.View pointerEvents="none" style={[styles.bottomGlow, { opacity: glowOpacity }]} />

      <View style={styles.brand}>
        <Animated.View style={{ transform: [{ scale: logoScale }], opacity: logoOpacity }}>
          <Image source={appIcon} style={styles.logo} resizeMode="contain" accessibilityLabel="โลโก้ CampusMate" />
        </Animated.View>
        <Animated.Text style={[styles.appName, { opacity: textOpacity, transform: [{ translateY: textTranslateY }] }]}>CampusMate</Animated.Text>
        <Animated.Text style={[styles.tagline, { opacity: textOpacity, transform: [{ translateY: textTranslateY }] }]}>เพื่อนใหม่ในรั้วมหาวิทยาลัย</Animated.Text>
      </View>

      {showWaitHint ? (
        <Animated.View style={[styles.waitHint, { opacity: hintOpacity }]} accessibilityRole="progressbar">
          <ActivityIndicator size="small" color="#2869C7" />
          <Text style={styles.loadingText}>{message || 'กำลังเตรียมพื้นที่ของคุณ'}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#F7F7F8',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  topGlow: {
    backgroundColor: '#E7F3FF',
    borderRadius: 220,
    height: 440,
    left: -190,
    position: 'absolute',
    top: -210,
    width: 440,
  },
  bottomGlow: {
    backgroundColor: '#EAF0FF',
    borderRadius: 190,
    bottom: -230,
    height: 380,
    position: 'absolute',
    right: -160,
    width: 380,
  },
  brand: {
    alignItems: 'center',
    paddingHorizontal: 24,
    transform: [{ translateY: -20 }],
    width: '100%',
  },
  logo: {
    height: 170,
    width: 170,
  },
  appName: {
    color: '#25272B',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.7,
    marginTop: 8,
  },
  tagline: {
    color: '#6B7078',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  waitHint: {
    alignItems: 'center',
    bottom: 64,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    left: 24,
    position: 'absolute',
    right: 24,
  },
  loadingText: {
    color: '#6B7078',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
