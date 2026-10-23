import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Pressable } from './NativePressable';
import Text from './AppText';
import { GlassBackground, useLiquidGlass } from './LiquidGlassSurface';
import { motion, useTheme } from '../theme';

const HEIGHT = 44;
const PAD = 4;

/**
 * Two (or more) equal filter tabs in one horizontal track with a sliding pill,
 * e.g. ทั้งหมด / ยังไม่อ่าน. Always a single row: each tab takes an equal share.
 */
export default function FilterSegment({ tabs = [], activeTab, onChangeTab, style }) {
  const { colors, isDark } = useTheme();
  const glass = useLiquidGlass();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));
  const tabWidth = tabs.length ? (width - PAD * 2) / tabs.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    const target = index * tabWidth;
    x.set(reduceMotion || !tabWidth ? target : withSpring(target, motion.spring.snappy));
  }, [index, reduceMotion, tabWidth, x]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  if (!tabs.length) return null;
  return (
    <View
      accessibilityRole="tablist"
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: glass ? 'transparent' : isDark ? colors.surfaceContainerHigh : colors.surfaceContainerHigh }, style]}
    >
      <GlassBackground style={{ borderRadius: HEIGHT / 2 }} />
      {tabWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.pill, { width: tabWidth, backgroundColor: colors.primary }, pillStyle]} /> : null}
      {tabs.map((tab, position) => {
        const selected = position === index;
        const foreground = selected ? '#FFFFFF' : colors.inkMuted;
        const count = typeof tab.badgeCount === 'number' && tab.badgeCount > 0 ? (tab.badgeCount > 99 ? '99+' : String(tab.badgeCount)) : '';
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={count ? `${tab.label} ${count} รายการ` : tab.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync().catch(() => {});
              onChangeTab?.(tab.id);
            }}
            style={styles.button}
          >
            <Text numberOfLines={1} style={[styles.label, { color: foreground, fontWeight: selected ? '700' : '600' }]}>{tab.label}</Text>
            {count ? (
              <View style={[styles.badge, { backgroundColor: selected ? 'rgba(255,255,255,0.25)' : colors.primary }]}>
                <Text style={styles.badgeText}>{count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'center', height: HEIGHT, padding: PAD, borderRadius: HEIGHT / 2, overflow: 'hidden' },
  pill: { position: 'absolute', left: PAD, top: PAD, bottom: PAD, borderRadius: (HEIGHT - PAD * 2) / 2 },
  button: { flex: 1, height: HEIGHT - PAD * 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  label: { fontSize: 14, flexShrink: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
});
