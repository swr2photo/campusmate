import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '../NativePressable';
import { useTheme } from '../../theme';

const OPEN_SPRING = { damping: 22, stiffness: 240, mass: 0.9 };
const CLOSE_MS = 220;
const CLOSE_EASING = Easing.in(Easing.cubic);
// A drag this far, or this fast, dismisses the sheet.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/**
 * Bottom sheet that slides up over the app. `dismissible={false}` removes
 * every way to close it (backdrop, drag, Android back) for blocking prompts.
 * `onDismissed` runs once the closing animation has finished and the sheet's
 * Modal is gone, so a follow-up Modal never opens on top of it.
 */
export default function SlideUpSheet({ visible, onClose, onDismissed, dismissible = true, accessibilityLabel, children }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const offset = useSharedValue(height);
  const fade = useSharedValue(0);
  const dismissed = useRef(onDismissed);
  dismissed.current = onDismissed;
  const finish = () => { setMounted(false); dismissed.current?.(); };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      fade.set(0);
      fade.set(withTiming(1, { duration: reduceMotion ? 160 : 240 }));
      // Reduce Motion: the panel fades in place instead of sliding.
      offset.set(reduceMotion ? 0 : height);
      if (!reduceMotion) offset.set(withSpring(0, OPEN_SPRING));
      return;
    }
    if (!mounted) return;
    const done = (finished) => { if (finished) scheduleOnRN(finish); };
    fade.set(withTiming(0, { duration: CLOSE_MS }));
    offset.set(withTiming(reduceMotion ? 0 : height, { duration: CLOSE_MS, easing: CLOSE_EASING }, done));
    // `mounted` changes only through this effect and the close callback.
  }, [visible]);

  const drag = Gesture.Pan()
    .enabled(dismissible)
    .activeOffsetY(8)
    .onUpdate((event) => { offset.set(Math.max(0, event.translationY)); })
    .onEnd((event) => {
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) scheduleOnRN(onClose);
      else offset.set(withSpring(0, OPEN_SPRING));
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }], opacity: reduceMotion ? fade.get() : 1 }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  if (!mounted) return null;

  return (
    <Modal animationType="none" onRequestClose={dismissible ? onClose : () => {}} statusBarTranslucent transparent visible>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          {/* Screen readers close with escape (iOS) or back (Android) instead. */}
          <Pressable
            accessibilityElementsHidden
            disabled={!dismissible}
            importantForAccessibility="no"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none" style={styles.dock}>
          <Animated.View
            accessibilityLabel={accessibilityLabel}
            accessibilityViewIsModal
            onAccessibilityEscape={dismissible ? onClose : undefined}
            style={[styles.panel, {
              backgroundColor: isDark ? colors.surfaceContainerHigh || colors.card : colors.card,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: height - insets.top - 24,
            }, panelStyle]}
          >
            <GestureDetector gesture={drag}>
              <View accessible={false} style={styles.handleArea}>
                <View style={[styles.handle, { backgroundColor: colors.outlineVariant || colors.line }]} />
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(8,10,16,0.5)' },
  dock: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, borderCurve: 'continuous', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 24,
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  handle: { width: 40, height: 5, borderRadius: 3 },
});
