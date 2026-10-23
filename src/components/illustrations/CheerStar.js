import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import FeatureIcon from '../FeatureIcon';
import { MASCOT_COLORS } from './Mascot';

/** A smiling cartoon star that wiggles to cheer the person on. */
export default function CheerStar({ size = 48, color = '#FFC23D' }) {
  const reduceMotion = useReducedMotion();
  const wiggle = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    wiggle.set(withRepeat(withSequence(
      withTiming(-9, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      withTiming(9, { duration: 520, easing: Easing.inOut(Easing.sin) }),
    ), -1, true));
    return () => cancelAnimation(wiggle);
  }, [reduceMotion, wiggle]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${wiggle.get()}deg` }, { scale: 1 + Math.abs(wiggle.get()) / 180 }] }));
  const eye = Math.max(3, size * 0.09);
  const smile = size * 0.2;
  const line = Math.max(1.5, size * 0.045);
  return (
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[{ width: size, height: size }, animated]}>
      <FeatureIcon name="star.fill" size={size} color={color} />
      <View style={[StyleSheet.absoluteFill, styles.face, { paddingTop: size * 0.12 }]}>
        <View style={[styles.eyes, { gap: size * 0.14 }]}>
          <View style={{ width: eye, height: eye * 1.2, borderRadius: eye, backgroundColor: MASCOT_COLORS.outline }} />
          <View style={{ width: eye, height: eye * 1.2, borderRadius: eye, backgroundColor: MASCOT_COLORS.outline }} />
        </View>
        <View style={{ width: smile, height: smile / 2, overflow: 'hidden', marginTop: size * 0.02 }}>
          <View style={{ width: smile, height: smile, borderRadius: smile / 2, borderWidth: line, borderColor: MASCOT_COLORS.outline, marginTop: -smile / 2 }} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center' },
  eyes: { flexDirection: 'row' },
});
