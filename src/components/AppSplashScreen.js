import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import LaunchScene from './launch/LaunchScene';
import { holdLaunch, useLaunchFinished } from './launch/launchState';
import { useTheme } from '../theme';

/**
 * Placeholder while a boot stage waits. During the cold start it only keeps
 * the launch overlay (LaunchOverlay) up, so the intro is never restarted
 * between stages; afterwards it shows the settled brand scene.
 */
export default function AppSplashScreen({ message }) {
  const finished = useLaunchFinished();
  const { colors, isDark } = useTheme();
  useEffect(() => {
    if (finished) {
      SplashScreen.hideAsync().catch(() => {});
      return undefined;
    }
    return holdLaunch();
  }, [finished]);
  if (!finished) return <View style={[styles.fill, { backgroundColor: colors.canvas }]} />;
  return <LaunchScene hint={message || 'กำลังเตรียมพื้นที่ของคุณ'} isDark={isDark} mode="settled" />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
