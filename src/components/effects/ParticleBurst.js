import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import FeatureIcon from '../FeatureIcon';

const COUNT = 10;

function Particle({ index, icon, color, distance }) {
  const t = useSharedValue(0);
  const angle = (Math.PI * 2 * index) / COUNT + (index % 2 ? 0.25 : -0.15);
  const reach = distance * (0.7 + (index % 3) * 0.18);
  useEffect(() => {
    t.set(withDelay(index * 12, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) })));
  }, [index, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.get(),
    transform: [
      { translateX: Math.cos(angle) * reach * t.get() },
      { translateY: Math.sin(angle) * reach * t.get() - 10 * t.get() },
      { scale: 0.5 + t.get() * 0.7 },
      { rotate: `${t.get() * 120 * (index % 2 ? 1 : -1)}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.particle, style]}>
      <FeatureIcon name={index % 3 === 0 ? 'sparkle' : icon} size={index % 3 === 0 ? 10 : 13} color={index % 3 === 0 ? '#FFC23D' : color} />
    </Animated.View>
  );
}

/**
 * Burst of little hearts and stars from the centre of its parent. Bump
 * `burstKey` to fire again. Purely decorative and skipped with Reduce Motion.
 */
export default function ParticleBurst({ burstKey = 0, icon = 'heart.fill', color = '#FF5A7A', distance = 46 }) {
  const reduceMotion = useReducedMotion();
  const [visibleKey, setVisibleKey] = useState(0);
  useEffect(() => {
    if (!burstKey || reduceMotion) return undefined;
    setVisibleKey(burstKey);
    const timer = setTimeout(() => setVisibleKey(0), 800);
    return () => clearTimeout(timer);
  }, [burstKey, reduceMotion]);
  if (!visibleKey) return null;
  return (
    <View key={visibleKey} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.host}>
      {Array.from({ length: COUNT }, (_, index) => <Particle key={index} index={index} icon={icon} color={color} distance={distance} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  particle: { position: 'absolute' },
});
