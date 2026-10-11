import Text from './AppText';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { radius, shadow, spacing, type, useTheme } from '../theme';

export function Avatar({ emoji = '🙂', color, size = 52, online = false }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const bgColor = color || colors.primarySoft;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous', backgroundColor: bgColor }]}>
      <Text style={{ fontSize: size * 0.48 }}>{emoji}</Text>
      {online && <View style={[styles.onlineDot, { width: size * 0.22, height: size * 0.22, borderRadius: size * 0.11 }]} />}
    </View>
  );
}

export function Card({ children, style }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, icon, iconName, active = false, color, onPress, style }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const activeColor = color || colors.primary;
  const content = (
    <View style={[styles.chip, active && { backgroundColor: activeColor, borderColor: activeColor }, style]}>
      {iconName ? (
        <FeatureIcon color={active ? colors.onPrimary : activeColor} name={iconName} size={16} style={styles.chipIcon} />
      ) : (!!icon && <Text style={styles.chipIcon}>{icon}</Text>)}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress}>{content}</Pressable> : content;
}

export function PrimaryButton({ label, icon, iconName, onPress, style, disabled = false, loading = false, compact = false, numberOfLines = 1 }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const isCompact = compact || StyleSheet.flatten(style)?.minHeight <= 40;
  const resolvedIcon = iconName || icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, isCompact && styles.compactPrimaryButton, style, { minHeight: Math.max(isCompact ? 44 : 48, StyleSheet.flatten(style)?.minHeight || 0), minWidth: 44 }, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {loading ? <ActivityIndicator color={colors.onPrimary} /> : (
        <View style={styles.buttonContent}>
          {resolvedIcon ? <FeatureIcon color={colors.onPrimary} name={resolvedIcon} size={18} style={styles.buttonIcon} /> : null}
          <Text
            numberOfLines={numberOfLines}
            style={[styles.primaryButtonText, isCompact && styles.compactButtonText]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function OutlineButton({ label, icon, iconName, onPress, style, danger = false, disabled = false, compact = false, numberOfLines = 1 }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const isCompact = compact || StyleSheet.flatten(style)?.minHeight <= 40;
  const resolvedIcon = iconName || icon;
  const buttonColor = danger ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.outlineButton, isCompact && styles.compactOutlineButton, danger && styles.outlineDanger, style, { minHeight: Math.max(isCompact ? 44 : 48, StyleSheet.flatten(style)?.minHeight || 0), minWidth: 44 }, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.buttonContent}>
        {resolvedIcon ? <FeatureIcon color={buttonColor} name={resolvedIcon} size={18} style={styles.buttonIcon} /> : null}
        <Text
          numberOfLines={numberOfLines}
          style={[styles.outlineButtonText, isCompact && styles.compactButtonText, danger && styles.outlineDangerText]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function SectionTitle({ title, subtitle, action, onAction }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
      {!!action && <Pressable accessibilityRole="button" onPress={onAction} style={styles.sectionActionTarget}><Text style={styles.sectionAction}>{action}</Text></Pressable>}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.card,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  chipIcon: { fontSize: 14, marginRight: 5 },
  chipText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '700', flexShrink: 1 },
  chipTextActive: { color: colors.onPrimary },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
  },
  compactPrimaryButton: { borderRadius: 12, minHeight: 44, paddingHorizontal: 8 },
  buttonContent: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', maxWidth: '100%' },
  buttonIcon: { flexShrink: 0 },
  primaryButtonText: { color: colors.onPrimary, fontSize: type.body, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  outlineButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
  },
  compactOutlineButton: { borderRadius: 12, minHeight: 44, paddingHorizontal: 8 },
  outlineButtonText: { color: colors.ink, flexShrink: 1, fontSize: type.body, fontWeight: '600' },
  compactButtonText: { fontSize: type.caption, lineHeight: 16 },
  outlineDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  outlineDangerText: { color: colors.danger },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionHeaderText: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  sectionTitle: { color: colors.ink, fontSize: type.section, fontWeight: '800' },
  sectionSubtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 3 },
  sectionAction: { color: colors.primary, fontSize: type.caption, fontWeight: '800' },
  sectionActionTarget: { minHeight: 44, minWidth: 44, justifyContent: 'center', flexShrink: 1 },
});

// `colors` is one of two module-level palettes, so this caches to two entries.
const styleCache = new WeakMap();

export const getStyles = (colors) => {
  let styles = styleCache.get(colors);
  if (!styles) {
    styles = createStyles(colors);
    styleCache.set(colors, styles);
  }
  return styles;
};
