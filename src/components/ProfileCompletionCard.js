import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { Pressable } from './NativePressable';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { CheerStar } from './illustrations';
import { useResponsiveSize } from '../hooks/useResponsiveSize';
import { motion, useTheme } from '../theme';

const GRADIENT = ['#FF9F7A', '#FFC23D', '#45D1A1'];

function headline(percent) {
  if (percent >= 90) return 'อีกนิดเดียวก็ครบแล้ว!';
  if (percent >= 60) return 'มาได้ไกลแล้ว เก่งมาก';
  if (percent >= 30) return 'เริ่มต้นได้ดีเลย';
  return 'มาเติมโปรไฟล์กันเถอะ';
}

/**
 * Friendly progress card replacing the old red "fill in your profile" banner.
 * `nextStep` is a short, specific suggestion (e.g. "เพิ่มรูปอีก 2 รูป").
 */
export default function ProfileCompletionCard({ percent, nextStep, onPress }) {
  const { colors, isDark } = useTheme();
  const { card, font } = useResponsiveSize();
  const reduceMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const fill = useSharedValue(0);
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  useEffect(() => {
    if (!trackWidth) return;
    const target = (trackWidth * clamped) / 100;
    fill.set(reduceMotion ? target : withDelay(150, withSpring(target, motion.spring.gentle)));
  }, [clamped, fill, reduceMotion, trackWidth]);

  const fillStyle = useAnimatedStyle(() => ({ width: Math.max(fill.get(), 10) }));

  return (
    <Pressable
      nativeCardSurface
      accessibilityRole="button"
      accessibilityLabel={`โปรไฟล์ครบ ${clamped} เปอร์เซ็นต์ ${nextStep || ''} แตะเพื่อเติมข้อมูล`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderRadius: card.radius, padding: card.padding, borderColor: isDark ? colors.line : 'transparent' }, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.header}>
        <View style={[styles.starHalo, { backgroundColor: isDark ? 'rgba(255,194,61,0.14)' : '#FFF6DF' }]}>
          <CheerStar size={34} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink, fontSize: font.body + 1 }]} numberOfLines={2}>{headline(clamped)}</Text>
          {nextStep ? <Text style={[styles.subtitle, { color: colors.inkMuted }]} numberOfLines={2}>{nextStep}</Text> : null}
        </View>
        <Text style={[styles.percent, { color: colors.ink }]}>{clamped}%</Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)}
        style={[styles.track, { backgroundColor: colors.surfaceContainerHigh || colors.surfaceRaised }]}
      >
        <Animated.View style={[styles.fill, fillStyle]}>
          <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.accentText }]}>เติมข้อมูลต่อ</Text>
        <FeatureIcon name="chevron.right" size={14} color={colors.accentText} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  starHalo: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: '700', lineHeight: 24 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  percent: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, overflow: 'hidden' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minHeight: 20 },
  footerText: { fontSize: 13, fontWeight: '700' },
});
