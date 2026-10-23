import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Pressable } from './NativePressable';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { withAlpha } from './LiquidGlassSurface';
import { motion, useTheme } from '../theme';

// Compact one-line chip. Idle chips share one neutral surface so the grid
// reads calmly; a selected chip lights up in its category colour, bounces and
// swaps its glyph for a round "sticker" badge (a non-colour selection cue).
export default function ProfileActivityChip({ category, selected, onPress }) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReducedMotion();
  const accent = category.color || colors.primary;
  const scale = useSharedValue(1);
  const badge = useSharedValue(selected ? 1 : 0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (reduceMotion) {
      badge.set(selected ? 1 : 0);
      return;
    }
    badge.set(selected ? withSpring(1, motion.spring.bouncy) : withTiming(0, { duration: motion.duration.fast }));
    if (selected) scale.set(withSequence(withTiming(0.92, { duration: 70 }), withSpring(1, motion.spring.bouncy)));
  }, [badge, reduceMotion, scale, selected]);

  const chipStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.4 + badge.get() * 0.6 }, { rotate: `${(1 - badge.get()) * -40}deg` }] }));

  const pressIn = () => { if (!reduceMotion) scale.set(withTiming(0.95, { duration: 90 })); };
  const pressOut = () => { if (!reduceMotion) scale.set(withSpring(1, motion.spring.snappy)); };

  return (
    <Animated.View style={chipStyle}>
      <Pressable
        nativeGestureSurface
        hitSlop={5}
        accessibilityRole="checkbox"
        accessibilityLabel={category.label}
        accessibilityState={{ checked: selected }}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        android_ripple={{ color: withAlpha(accent, 0.18), borderless: false }}
        style={[styles.chip, {
          backgroundColor: selected ? withAlpha(accent, isDark ? 0.34 : 0.16) : colors.chipIdle,
          borderColor: selected ? withAlpha(accent, isDark ? 0.9 : 0.7) : 'transparent',
          paddingLeft: selected ? 4 : 12,
        }]}
      >
        {selected ? (
          <Animated.View style={[styles.badge, { backgroundColor: accent }, badgeStyle]}>
            <FeatureIcon name={category.symbol} size={15} color="#FFFFFF" />
          </Animated.View>
        ) : (
          <View style={styles.glyph}><FeatureIcon name={category.symbol} size={16} color={colors.inkMuted} /></View>
        )}
        <Text numberOfLines={1} style={[styles.label, { color: selected ? colors.ink : colors.inkMuted, fontWeight: selected ? '700' : '600' }]}>
          {category.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', alignItems: 'center', flexDirection: 'row', gap: 7, maxWidth: '100%', height: 38, minWidth: 48, paddingRight: 14, borderRadius: 19, borderCurve: 'continuous', borderWidth: 1.5, overflow: 'hidden' },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: 18, alignItems: 'center' },
  label: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
