import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { Mascot } from '../illustrations';
import { useResponsiveSize } from '../../hooks/useResponsiveSize';
import { useTheme } from '../../theme';

/** A heart that floats up from the bottom of the banner and fades out. */
function RisingHeart({ index, height }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    t.set(withDelay(index * 520, withRepeat(withTiming(1, { duration: 2600 + (index % 3) * 500, easing: Easing.out(Easing.quad) }), -1)));
    return () => cancelAnimation(t);
  }, [index, reduceMotion, t]);
  const style = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.5 : Math.sin(t.get() * Math.PI),
    transform: [
      { translateY: -t.get() * height * 0.85 },
      { translateX: Math.sin(t.get() * Math.PI * 2 + index) * 8 },
      { scale: 0.7 + t.get() * 0.5 },
    ],
  }));
  return (
    <Animated.View style={[styles.heart, { left: `${12 + ((index * 23) % 70)}%`, bottom: 4 }, style]}>
      <FeatureIcon name="heart.fill" size={10 + (index % 3) * 4} color={index % 2 ? '#FF8FB1' : '#FFFFFF'} />
    </Animated.View>
  );
}

/**
 * Likes summary: who liked you and how many share real chemistry (music or
 * activities in common), with the mascot and hearts drifting up.
 */
export default function LikesHeroBanner({ likedCount = 0, chemistryCount = 0, locked = false }) {
  const { isDark } = useTheme();
  const { bannerHeight } = useResponsiveSize();
  const height = Math.round(bannerHeight * 1.35);
  return (
    <View style={[styles.banner, { minHeight: height }]}>
      <LinearGradient colors={isDark ? ['#4A1E3A', '#2A1530'] : ['#FF8FB1', '#FFB38A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 6 }, (_, index) => <RisingHeart key={index} index={index} height={height} />)}
      </View>
      <View style={styles.mascot}>
        <Mascot size={Math.round(height * 0.42)} pose="jump" mood="happy" />
      </View>
      <View style={styles.copy}>
        <Text style={styles.kicker}>ความสนใจที่ส่งถึงคุณ</Text>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{likedCount}</Text>
            <Text numberOfLines={1} style={styles.statLabel}>คนถูกใจคุณ</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{locked ? '?' : chemistryCount}</Text>
            <Text numberOfLines={1} style={styles.statLabel}>เคมีตรงกัน</Text>
          </View>
        </View>
        <Text numberOfLines={2} style={styles.note}>{locked ? 'ปลดล็อก Plus เพื่อดูว่าใครเคมีตรงกับคุณ' : 'ดูจากเพลงและกิจกรรมที่ชอบเหมือนกัน'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', borderRadius: 26, borderCurve: 'continuous', overflow: 'hidden', paddingRight: 16, paddingVertical: 10, marginBottom: 12 },
  heart: { position: 'absolute' },
  mascot: { marginBottom: -10 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  kicker: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stat: { minWidth: 0 },
  statValue: { color: '#FFFFFF', fontSize: 24, lineHeight: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLabel: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '700' },
  divider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.35)' },
  note: { color: 'rgba(255,255,255,0.88)', fontSize: 11, lineHeight: 16 },
});
