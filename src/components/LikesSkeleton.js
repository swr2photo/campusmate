import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { radius, spacing, useTheme } from '../theme';
import { Card } from './ui';

export function SkeletonBox({
  width = '100%',
  height = 16,
  borderRadius = radius.sm,
  style,
}) {
  const { isDark } = useTheme();
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const baseColor = isDark
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(0, 0, 0, 0.08)';

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          borderCurve: 'continuous',
          backgroundColor: baseColor,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
}

export function LikeCardSkeleton() {
  const { colors } = useTheme();

  return (
    <Card style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      {/* Hero photo / avatar placeholder */}
      <View style={[styles.heroPlaceholder, { backgroundColor: colors.surfaceRaised }]}>
        <SkeletonBox width="100%" height="100%" borderRadius={0} />
      </View>

      {/* Profile Name & Faculty placeholder */}
      <View style={styles.heroCopy}>
        <SkeletonBox width="55%" height={22} borderRadius={6} />
        <SkeletonBox width="35%" height={14} borderRadius={4} style={{ marginTop: 8 }} />
      </View>

      {/* Body content placeholder */}
      <View style={styles.body}>
        {/* Quote Message placeholder */}
        <View style={[styles.messageBox, { backgroundColor: colors.surfaceRaised }]}>
          <SkeletonBox width={18} height={18} borderRadius={9} />
          <SkeletonBox width="80%" height={16} borderRadius={5} style={{ marginLeft: 8 }} />
        </View>

        {/* Chips row placeholder */}
        <View style={styles.chipsRow}>
          <SkeletonBox width={65} height={28} borderRadius={radius.pill} />
          <SkeletonBox width={85} height={28} borderRadius={radius.pill} />
          <SkeletonBox width={75} height={28} borderRadius={radius.pill} />
        </View>

        {/* Action Buttons placeholder */}
        <View style={styles.actionsRow}>
          <SkeletonBox style={{ flex: 1.15, height: 46 }} borderRadius={radius.pill} />
          <SkeletonBox style={{ flex: 1.05, height: 46, marginLeft: spacing.sm }} borderRadius={radius.pill} />
        </View>
      </View>
    </Card>
  );
}

export function LikesSkeletonList({ count = 3 }) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      {/* Summary Banner placeholder */}
      <View style={[styles.summaryBanner, { backgroundColor: colors.surfaceRaised }]}>
        <SkeletonBox width={44} height={44} borderRadius={22} style={{ marginRight: spacing.md }} />
        <View style={{ flex: 1 }}>
          <SkeletonBox width="60%" height={18} borderRadius={6} />
          <SkeletonBox width="85%" height={13} borderRadius={4} style={{ marginTop: 6 }} />
        </View>
      </View>

      {/* Render skeleton cards */}
      {Array.from({ length: count }).map((_, index) => (
        <LikeCardSkeleton key={`skeleton-${index}`} />
      ))}
    </View>
  );
}

export function HomeCardSkeleton() {
  const { colors } = useTheme();

  return (
    <Card style={[styles.homeCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <View style={[styles.homeHeroPlaceholder, { backgroundColor: colors.surfaceRaised }]}>
        <SkeletonBox width="100%" height="100%" borderRadius={0} />
      </View>
      <View style={styles.homeCopy}>
        <SkeletonBox width="50%" height={22} borderRadius={6} />
        <SkeletonBox width="75%" height={15} borderRadius={4} style={{ marginTop: 8 }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.xxxl,
  },
  summaryBanner: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    flexDirection: 'row',
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  card: {
    marginBottom: spacing.md,
    overflow: 'hidden',
    padding: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  homeCard: {
    borderCurve: 'continuous',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    padding: 0,
  },
  heroPlaceholder: {
    height: 180,
    overflow: 'hidden',
    width: '100%',
  },
  homeHeroPlaceholder: {
    height: 280,
    overflow: 'hidden',
    width: '100%',
  },
  homeCopy: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  heroCopy: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  body: {
    padding: spacing.lg,
  },
  messageBox: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.md,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
});
