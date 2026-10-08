import Text from './AppText';
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { radius, spacing, type, useTheme } from '../theme';
import { Card, PrimaryButton } from './ui';

const defaultErrorImage = require('../../assets/mascot/connection-error.png');
const defaultEmptyImage = require('../../assets/mascot/likes-waiting.png');

export default function StorysetStateView({
  type: stateType = 'empty', // 'empty' | 'error'
  image,
  title,
  description,
  actionLabel,
  actionIcon = 'arrow.clockwise',
  onAction,
  actionLoading = false,
  style,
}) {
  const { colors, isDark } = useTheme();

  const resolvedImage = image || (stateType === 'error' ? defaultErrorImage : defaultEmptyImage);
  const resolvedTitle = title || (stateType === 'error' ? 'โหลดข้อมูลไม่สำเร็จ' : 'ยังไม่มีคนกดใจใหม่');
  const resolvedDescription = description || (
    stateType === 'error'
      ? 'การเชื่อมต่อขัดข้อง หรืออินเทอร์เน็ตอาจไม่เสถียร กรุณาลองใหม่อีกครั้ง'
      : 'เมื่อมีเพื่อนในมหาวิทยาลัยสนใจกิจกรรมเดียวกับคุณ รายการจะแสดงที่นี่'
  );

  return (
    <Card style={[styles.card, { backgroundColor: colors.card, borderColor: 'transparent' }, style]}>
      {/* Original CampusMate PNG illustration with alpha. */}
      <View style={styles.imageContainer}>
        <Image
          source={resolvedImage}
          resizeMode="contain"
          style={styles.illustration}
          accessibilityLabel={`ภาพประกอบ ${resolvedTitle}`}
        />
      </View>

      {/* Typography */}
      <Text style={[styles.title, { color: colors.ink }]}>{resolvedTitle}</Text>
      <Text style={[styles.description, { color: colors.inkMuted }]}>{resolvedDescription}</Text>

      {/* Action button */}
      {onAction && actionLabel ? (
        <View style={styles.actionContainer}>
          <PrimaryButton
            iconName={actionIcon}
            label={actionLabel}
            loading={actionLoading}
            onPress={onAction}
            style={[
              styles.actionButton,
              stateType === 'error' && { backgroundColor: isDark ? colors.primary : colors.primaryDark },
            ]}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    position: 'relative',
  },
  glowBubble: {
    borderRadius: 140,
    height: 180,
    opacity: 0.6,
    position: 'absolute',
    top: 20,
    width: 180,
  },
  imageContainer: {
    alignItems: 'center',
    height: 190,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: '100%',
  },
  illustration: {
    borderRadius: radius.md,
    height: '100%',
    maxWidth: 240,
    width: '100%',
  },
  title: {
    fontSize: type.title,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  description: {
    fontSize: type.caption,
    lineHeight: 20,
    maxWidth: 280,
    textAlign: 'center',
  },
  actionContainer: {
    marginTop: spacing.lg,
    width: '100%',
    maxWidth: 220,
  },
  actionButton: {
    borderRadius: radius.pill,
    minHeight: 46,
  },
});
