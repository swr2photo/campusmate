import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// Deterministic bar profile so the resting wave still looks like music.
const PROFILE = [0.35, 0.6, 0.9, 0.55, 0.75, 1, 0.65, 0.45, 0.8, 0.95, 0.5, 0.7, 0.4, 0.85, 0.6, 0.3, 0.7, 0.5, 0.9, 0.45];

function Bar({ clock, index, height, width, color, still }) {
  const level = PROFILE[index % PROFILE.length];
  const style = useAnimatedStyle(() => {
    if (still) return { height: Math.max(width, height * level) };
    const phase = clock.get() * Math.PI * 2 + index * 0.75;
    const swing = 0.35 + 0.65 * Math.abs(Math.sin(phase * (0.8 + level * 0.6)));
    return { height: Math.max(width, height * level * swing) };
  });
  return <Animated.View style={[{ width, borderRadius: width / 2, backgroundColor: color }, style]} />;
}

/** Animated equaliser bars for the music step; decorative only. */
export default function SoundWave({ bars = 18, height = 36, barWidth = 4, gap = 4, color = '#1DB954', playing = true, style }) {
  const reduceMotion = useReducedMotion();
  const still = reduceMotion || !playing;
  const clock = useSharedValue(0);
  useEffect(() => {
    if (still) return undefined;
    clock.set(0);
    clock.set(withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear }), -1));
    return () => cancelAnimation(clock);
  }, [clock, still]);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.row, { height, gap }, style]}>
      {Array.from({ length: bars }, (_, index) => (
        <Bar key={index} clock={clock} index={index} height={height} width={barWidth} color={color} still={still} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
