import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Text from '../AppText';

const TICKS = 28;

const Tick = memo(function Tick({ index, progress, size, color, track }) {
  const angle = (index * 360) / TICKS;
  const style = useAnimatedStyle(() => ({ backgroundColor: index / TICKS < progress.get() ? color : track }));
  return (
    <Animated.View
      style={[styles.tick, {
        left: size / 2 - 1.25,
        top: size / 2 - 4,
        transform: [{ rotate: `${angle}deg` }, { translateY: -(size / 2 - 5) }],
      }, style]}
    />
  );
});

function scoreColor(score) {
  if (score >= 75) return '#34D399';
  if (score >= 50) return '#FFC23D';
  return '#7CB8FF';
}

/**
 * Compatibility as a segmented ring that fills up and counts to the score.
 * Renders nothing when there is no real score to show.
 */
export default function CompatibilityRing({ score, size = 56, label = 'เข้ากัน', onDark = true }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [shown, setShown] = useState(reduceMotion ? score : 0);
  useEffect(() => {
    if (score == null) return undefined;
    const target = Math.max(0, Math.min(100, score)) / 100;
    if (reduceMotion) { progress.set(target); setShown(score); return undefined; }
    progress.set(0);
    progress.set(withDelay(120, withTiming(target, { duration: 900, easing: Easing.out(Easing.cubic) })));
    const started = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / 1000);
      setShown(Math.round(score * (1 - Math.pow(1 - t, 3))));
      if (t >= 1) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [progress, reduceMotion, score]);
  if (score == null) return null;
  const color = scoreColor(score);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label} ${score} เปอร์เซ็นต์`}
      accessibilityValue={{ min: 0, max: 100, now: score }}
      style={[styles.ring, { width: size, height: size, backgroundColor: onDark ? 'rgba(10,14,24,0.55)' : 'rgba(255,255,255,0.9)' }]}
    >
      {Array.from({ length: TICKS }, (_, index) => (
        <Tick key={index} index={index} progress={progress} size={size} color={color} track={onDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)'} />
      ))}
      <Text style={[styles.value, { color: onDark ? '#FFFFFF' : '#1C1C22', fontSize: size * 0.27 }]}>{shown}%</Text>
      <Text style={[styles.label, { color: onDark ? 'rgba(255,255,255,0.75)' : '#5A6170', fontSize: Math.max(8, size * 0.15) }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', width: 2.5, height: 8, borderRadius: 1.25 },
  value: { fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 2 },
  label: { fontWeight: '700', marginTop: -2 },
});
