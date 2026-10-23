import { Pressable } from '../NativePressable';
import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { motion, radius, useTheme } from '../../theme';

const EDGE = 24;

/**
 * Horizontally scrolling category filter. The selected pill slides between
 * chips; `bleed` lets the row run to the screen edges inside padded content.
 */
export default function ActivityCategoryChips({ categories, counts = {}, selected, onSelect, bleed = 0 }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef(null);
  const layouts = useRef({});
  const viewport = useRef({ x: 0, width: 0 });
  const placed = useRef(false);
  const x = useSharedValue(0);
  const width = useSharedValue(0);

  const moveTo = useCallback((id, animate) => {
    const layout = layouts.current[id];
    if (!layout) return;
    const spring = animate && placed.current && !reduceMotion;
    x.set(spring ? withSpring(layout.x, motion.spring.snappy) : layout.x);
    width.set(spring ? withSpring(layout.width, motion.spring.snappy) : layout.width);
    placed.current = true;
    // Bring a partly hidden chip fully into view.
    const left = bleed + layout.x;
    const right = left + layout.width;
    const { x: offset, width: visible } = viewport.current;
    if (!visible) return;
    if (left < offset + EDGE) scrollRef.current?.scrollTo({ x: Math.max(0, left - EDGE), animated: !reduceMotion });
    else if (right > offset + visible - EDGE) scrollRef.current?.scrollTo({ x: right - visible + EDGE, animated: !reduceMotion });
  }, [bleed, reduceMotion, width, x]);

  useEffect(() => { moveTo(selected, true); }, [moveTo, selected]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }], width: width.get() }));

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: bleed, paddingVertical: 4 }}
      horizontal
      onLayout={({ nativeEvent }) => { viewport.current.width = nativeEvent.layout.width; }}
      onScroll={({ nativeEvent }) => { viewport.current.x = nativeEvent.contentOffset.x; }}
      ref={scrollRef}
      scrollEventThrottle={32}
      showsHorizontalScrollIndicator={false}
      style={bleed ? { marginHorizontal: -bleed } : null}
    >
      <View style={styles.row}>
        <Animated.View pointerEvents="none" style={[styles.indicator, { backgroundColor: colors.primary }, indicator]} />
        {categories.map((category) => {
          const active = category.id === selected;
          const count = counts[category.id] ?? 0;
          return (
            <Pressable
              accessibilityLabel={`${category.label} ${count} แห่ง`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={{ top: 4, bottom: 4 }}
              key={category.id}
              onLayout={({ nativeEvent }) => {
                layouts.current[category.id] = nativeEvent.layout;
                if (active) moveTo(category.id, false);
              }}
              onPress={() => {
                if (active) return;
                Haptics.selectionAsync().catch(() => {});
                onSelect(category.id);
              }}
              style={[styles.chip, active
                ? { backgroundColor: 'transparent', borderColor: 'transparent' }
                : { backgroundColor: colors.card, borderColor: colors.line }]}
            >
              <FeatureIcon color={active ? '#FFFFFF' : category.color} name={category.icon} size={14} />
              <Text numberOfLines={1} style={[styles.label, { color: active ? '#FFFFFF' : colors.ink }]}>{category.label}</Text>
              <View style={[styles.count, { backgroundColor: active ? 'rgba(255,255,255,0.24)' : colors.surfaceRaised }]}>
                <Text style={[styles.countText, { color: active ? '#FFFFFF' : colors.inkMuted }]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  indicator: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: radius.pill },
  chip: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingLeft: 12,
    paddingRight: 6,
  },
  label: { fontSize: 14, fontWeight: '700' },
  count: { borderRadius: radius.pill, minWidth: 24, paddingHorizontal: 7, paddingVertical: 2, alignItems: 'center' },
  countText: { fontSize: 12, fontWeight: '800' },
});
