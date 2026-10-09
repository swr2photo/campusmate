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
    marginTop: spacing.xs,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    position: 'relative',
  },
  glowBubble: {
    borderRadius: 140,
    height: 140,
    opacity: 0.5,
    position: 'absolute',
    top: 10,
    width: 140,
  },
  imageContainer: {
    alignItems: 'center',
    height: 115,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: '100%',
  },
  illustration: {
    borderRadius: radius.md,
    height: '100%',
    maxWidth: 160,
    width: '100%',
  },
  title: {
    fontSize: type.headline,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  description: {
    fontSize: type.caption,
    lineHeight: 18,
    maxWidth: 290,
    textAlign: 'center',
  },
  actionContainer: {
    marginTop: spacing.md,
    width: 'auto',
    minWidth: 210,
    maxWidth: 300,
    alignSelf: 'center',
  },
  actionButton: {
    borderRadius: radius.pill,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
  },
});
