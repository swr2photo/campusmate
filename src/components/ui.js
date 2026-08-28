import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, shadow, spacing, type } from '../theme';

export function Avatar({ emoji = '🙂', color = colors.primarySoft, size = 52, online = false }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={{ fontSize: size * 0.48 }}>{emoji}</Text>
      {online && <View style={[styles.onlineDot, { width: size * 0.22, height: size * 0.22, borderRadius: size * 0.11 }]} />}
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, icon, active = false, color = colors.primary, onPress, style }) {
  const content = (
    <View style={[styles.chip, active && { backgroundColor: color, borderColor: color }, style]}>
      {!!icon && <Text style={styles.chipIcon}>{icon}</Text>}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export function PrimaryButton({ label, icon, onPress, style, disabled = false, loading = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, style, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {loading ? <ActivityIndicator color={colors.card} /> : <Text style={styles.primaryButtonText}>{icon ? `${icon}  ` : ''}{label}</Text>}
    </Pressable>
  );
}

export function OutlineButton({ label, icon, onPress, style, danger = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.outlineButton, danger && styles.outlineDanger, style, pressed && styles.pressed]}
    >
      <Text style={[styles.outlineButtonText, danger && styles.outlineDangerText]}>{icon ? `${icon}  ` : ''}{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ title, subtitle, action, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
      {!!action && <Pressable onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable>}
    </View>
  );
}

export const styles = StyleSheet.create({
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
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  chipIcon: { fontSize: 14, marginRight: 5 },
  chipText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '700' },
  chipTextActive: { color: colors.card },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.xl,
  },
  primaryButtonText: { color: colors.card, fontSize: type.body, fontWeight: '800' },
  outlineButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.xl,
  },
  outlineButtonText: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  outlineDanger: { backgroundColor: colors.dangerSoft, borderColor: '#F7CACA' },
  outlineDangerText: { color: colors.danger },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionHeaderText: { flex: 1 },
  sectionTitle: { color: colors.ink, fontSize: type.section, fontWeight: '800' },
  sectionSubtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 3 },
  sectionAction: { color: colors.primary, fontSize: type.caption, fontWeight: '800' },
});

