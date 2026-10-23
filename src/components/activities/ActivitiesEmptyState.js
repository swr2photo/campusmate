import { Pressable } from '../NativePressable';
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { motion, radius, useTheme } from '../../theme';

/** No spots for the search or category; offers the way back when it helps. */
export default function ActivitiesEmptyState({ searching = false, onShowAll }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(motion.duration.base)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}
    >
      <Animated.View
        entering={reduceMotion ? undefined : ZoomIn.springify().damping(12).delay(80)}
        style={[styles.icon, { backgroundColor: colors.surfaceRaised }]}
      >
        <FeatureIcon color={colors.inkMuted} name="mappin.slash.circle.fill" size={34} />
      </Animated.View>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {searching ? 'ไม่พบสถานที่ที่ตรงกับการค้นหา' : 'ยังไม่มีสถานที่ในหมวดนี้'}
      </Text>
      <Text style={[styles.body, { color: colors.inkMuted }]}>
        {searching ? 'ลองค้นหาด้วยคำอื่น หรือล้างการค้นหา' : 'ลองเลือกหมวดกิจกรรมอื่นเพื่อดูสถานที่เพิ่มเติม'}
      </Text>
      {onShowAll ? (
        <Pressable
          accessibilityLabel="ดูสถานที่ทุกหมวด"
          accessibilityRole="button"
          onPress={onShowAll}
          style={({ pressed }) => [styles.action, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <FeatureIcon color="#FFFFFF" name="square.grid.2x2.fill" size={14} />
          <Text style={styles.actionText}>ดูทุกหมวด</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  icon: { alignItems: 'center', borderRadius: 32, height: 64, justifyContent: 'center', marginBottom: 4, width: 64 },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  action: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  actionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
