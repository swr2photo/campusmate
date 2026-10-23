import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import FeatureIcon from './FeatureIcon';
import { motion as motionTokens } from '../theme';

// Material 3 navigation bar item: the active indicator pill grows out from
// the icon and the icon plays a short gesture of its own when selected.
const GESTURES = {
  bounce: (v) => ({ transform: [{ translateY: -4 * v }, { scale: 1 + v * 0.08 }] }),
  beat: (v) => ({ transform: [{ scale: 1 + v * 0.22 }] }),
  wiggle: (v) => ({ transform: [{ rotate: `${v * 14}deg` }] }),
  flip: (v) => ({ transform: [{ perspective: 200 }, { rotateY: `${v * 180}deg` }] }),
  none: () => ({}),
};

export default function AnimatedTabIcon({ focused, color, indicatorColor, iconName, size = 22, gesture = 'bounce', children }) {
  const reduceMotion = useReducedMotion();
  const indicator = useSharedValue(focused ? 1 : 0);
  const kick = useSharedValue(0);
  const first = useRef(true);

  useEffect(() => {
    const target = focused ? 1 : 0;
    if (reduceMotion || first.current) {
      first.current = false;
      indicator.set(target);
      return;
    }
    indicator.set(withSpring(target, motionTokens.spring.snappy));
    if (focused && gesture !== 'none') {
      kick.set(withSequence(
        withTiming(gesture === 'wiggle' ? -1 : 1, { duration: 120 }),
        withSpring(0, motionTokens.spring.bouncy),
      ));
    }
  }, [focused, gesture, indicator, kick, reduceMotion]);

  const pillStyle = useAnimatedStyle(() => ({ opacity: indicator.get(), transform: [{ scaleX: 0.4 + indicator.get() * 0.6 }] }));
  const iconStyle = useAnimatedStyle(() => (GESTURES[gesture] || GESTURES.none)(kick.get()));

  return (
    <View style={styles.slot}>
      <Animated.View style={[styles.pill, { backgroundColor: indicatorColor }, pillStyle]} />
      <Animated.View style={iconStyle}>
        {children || <FeatureIcon color={color} name={iconName} size={size} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { width: 64, height: 32, alignItems: 'center', justifyContent: 'center' },
  pill: { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
});
