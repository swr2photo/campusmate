import React, { useEffect, useRef, useState } from 'react';
import { Appearance, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import LaunchScene from './LaunchScene';
import { finishLaunch, launchHolds, useLaunchFinished, useLaunchHolds } from './launchState';
import { useTheme } from '../../theme';

// Long enough for the logo and name to land before the app is revealed.
const MIN_INTRO_MS = 950;
// Boot stages hand over to one another; a short gap is not "ready".
const SETTLE_GAP_MS = 160;
const EXIT_MS = 460;
const HINT_AFTER_MS = 1500;
const EXIT_EASING = Easing.inOut(Easing.cubic);

/** The colour the native splash used, so the first JS frame matches it. */
function nativeSplashBackground() {
  const plugin = Constants.expoConfig?.plugins?.find((entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen');
  const options = plugin?.[1] || {};
  const dark = Appearance.getColorScheme() === 'dark';
  return (dark && options.dark?.backgroundColor) || options.backgroundColor || '#F5FAFF';
}

/**
 * Cold-start brand moment, mounted once above the whole app. Placeholders
 * (AppSplashScreen) hold it open; it leaves when nothing waits any more.
 */
export default function LaunchOverlay() {
  const { isDark } = useTheme();
  const reduceMotion = useReducedMotion();
  const finished = useLaunchFinished();
  const holds = useLaunchHolds();
  const exit = useSharedValue(0);
  const mountedAt = useRef(Date.now());
  const [fromColor] = useState(nativeSplashBackground);
  const [exiting, setExiting] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaiting(true), HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (finished || exiting || holds > 0) return undefined;
    const elapsed = Date.now() - mountedAt.current;
    const wait = Math.max(SETTLE_GAP_MS, (reduceMotion ? 0 : MIN_INTRO_MS) - elapsed);
    const timer = setTimeout(() => {
      // A later boot stage may have taken over in the meantime.
      if (launchHolds() > 0) return;
      setExiting(true);
      exit.set(withTiming(1, { duration: reduceMotion ? 220 : EXIT_MS, easing: EXIT_EASING }, (done) => {
        if (done) scheduleOnRN(finishLaunch);
      }));
    }, wait);
    return () => clearTimeout(timer);
  }, [exit, exiting, finished, holds, reduceMotion]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.get() }));
  if (finished) return null;
  return (
    <Animated.View
      accessibilityLabel="กำลังเปิด CampusMate"
      accessibilityViewIsModal
      // Our first frame is drawn: the native splash can go.
      onLayout={() => { SplashScreen.hideAsync().catch(() => {}); }}
      pointerEvents={exiting ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
    >
      <LaunchScene
        exit={exit}
        fromColor={fromColor}
        hint={waiting && !exiting ? 'กำลังเตรียมพื้นที่ของคุณ' : null}
        hintDelay={0}
        isDark={isDark}
        mode="intro"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
});
