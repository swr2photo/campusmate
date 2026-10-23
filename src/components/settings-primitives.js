import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Host, Switch } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';
import { GlassBackground, GlassIconButton, useLiquidGlass, withAlpha } from './LiquidGlassSurface';
import ScrollFadeEdges from './ScrollFadeEdges';

export const SETTINGS_RED = '#FF453A';

export function useSettingsPalette() {
  const { isDark } = useTheme();
  return {
    isDark,
    canvas: isDark ? '#000000' : '#F5F3F1',
    header: isDark ? '#0D0C0B' : '#F5F3F1',
    card: isDark ? '#171411' : '#FFFFFF',
    text: isDark ? '#FAF9F7' : '#181614',
    muted: isDark ? '#BCB8B4' : '#77716C',
    line: isDark ? '#302C28' : '#E7E3DF',
    button: isDark ? '#2A2724' : '#E6E1DD',
  };
}

export function SettingsFrame({ title, children, detail = false, busy = false, error, onClose, footer, scrollRef }) {
  const palette = useSettingsPalette();
  const insets = useSafeAreaInsets();
  const glass = useLiquidGlass();
  const close = onClose || (() => router.canGoBack() ? router.back() : router.replace('/me'));
  return (
    <View style={[styles.frame, { backgroundColor: palette.canvas }]}>
      <View style={[styles.header, { backgroundColor: palette.header, paddingTop: insets.top + 12, borderBottomColor: palette.line }]}>
        {detail ? (
          <GlassIconButton
            accessibilityLabel="กลับ"
            disabled={busy}
            fallbackBackgroundColor={palette.button}
            hitSlop={8}
            icon="chevron.left"
            iconColor={palette.text}
            iconSize={23}
            onPress={close}
            size={45}
          />
        ) : <View style={styles.headerButton} />}
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: palette.text }]}>{title}</Text>
        {detail ? <View style={styles.headerButton} /> : (
          <Pressable accessibilityLabel="เสร็จสิ้นการตั้งค่า" accessibilityRole="button" disabled={busy} hitSlop={8} onPress={close} style={({ pressed }) => [styles.headerButton, { backgroundColor: glass ? 'transparent' : palette.text }, pressed && styles.pressed]}>
            {/* iOS 26 prominent bar button: glass tinted with the button's own fill. */}
            <GlassBackground style={{ borderRadius: 24 }} tintColor={palette.text} />
            {busy ? <ActivityIndicator color={palette.canvas} /> : <FeatureIcon name="checkmark" size={29} weight="bold" color={palette.canvas} />}
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {error ? <Text accessibilityRole="alert" selectable style={styles.error}>{error}</Text> : null}
          {children}
          {footer}
        </ScrollView>
        <ScrollFadeEdges color={palette.canvas} bottomSize={Math.max(24, insets.bottom)} />
      </View>
    </View>
  );
}

export function SettingsSection({ title, badge, children, style }) {
  const palette = useSettingsPalette();
  return (
    <View style={[styles.section, style]}>
      {title ? <View style={styles.sectionHeading}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>{badge ? <SettingsBadge>{badge}</SettingsBadge> : null}</View> : null}
      {children}
    </View>
  );
}

export function SettingsBadge({ children }) {
  return <View style={styles.badge}><Text style={styles.badgeText}>{children}</Text></View>;
}

export function SettingsGroup({ children, style }) {
  const palette = useSettingsPalette();
  return <NativeCard style={[styles.group, { backgroundColor: palette.card }, style]}>{children}</NativeCard>;
}

export function SettingsDescription({ children, style }) {
  const palette = useSettingsPalette();
  return <Text style={[styles.description, { color: palette.muted }, style]}>{children}</Text>;
}

// Leading icon: iOS Settings-style filled tile, Material 3 tonal circle on Android.
function SettingsIcon({ name, color }) {
  if (Platform.OS === 'ios') {
    return <View style={[styles.iconTile, { backgroundColor: color }]}><FeatureIcon name={name} size={17} color="#FFFFFF" /></View>;
  }
  return <View style={[styles.iconCircle, { backgroundColor: withAlpha(color, 0.16) }]}><FeatureIcon name={name} size={20} color={color} /></View>;
}

export function SettingsRow({ label, description, value, onPress, last = false, selected, badge, disabled = false, busy = false, danger = false, centered = false, icon, iconColor = '#2869C7', children }) {
  const palette = useSettingsPalette();
  const selection = typeof selected === 'boolean';
  const inner = (
    <>
      {icon ? <SettingsIcon name={icon} color={danger ? SETTINGS_RED : iconColor} /> : null}
      <View style={[styles.rowCopy, centered && { alignItems: 'center' }]}>
        <View style={styles.labelLine}>
          <Text style={[styles.label, { color: danger ? SETTINGS_RED : palette.text }]}>{label}</Text>
          {badge ? <SettingsBadge>{badge}</SettingsBadge> : null}
        </View>
        {description ? <Text style={[styles.rowDescription, { color: palette.muted }]}>{description}</Text> : null}
      </View>
      {value ? <Text numberOfLines={2} style={[styles.value, { color: palette.muted }]}>{value}</Text> : null}
      {children}
      {busy ? <ActivityIndicator color={SETTINGS_RED} /> : selection ? (
        <View style={styles.checkSpace}>{selected ? <FeatureIcon name="checkmark" color={SETTINGS_RED} size={27} weight="bold" /> : null}</View>
      ) : onPress && !centered ? <FeatureIcon name="chevron.right" color={palette.muted} size={16} /> : null}
    </>
  );
  const rowStyle = [styles.row, !last && { borderBottomColor: palette.line, borderBottomWidth: StyleSheet.hairlineWidth }, (disabled || busy) && { opacity: 0.55 }];
  return onPress ? (
    <Pressable accessibilityLabel={label} accessibilityRole={selection ? 'radio' : 'button'} accessibilityState={{ checked: selection ? selected : undefined, disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}>{inner}</Pressable>
  ) : <View style={rowStyle}>{inner}</View>;
}

export function SettingsToggle({ label, value, onValueChange, disabled = false, busy = false, last = true }) {
  const palette = useSettingsPalette();
  return (
    <SettingsRow label={label} last={last} busy={busy}>
      {!busy ? <Host accessible accessibilityLabel={label} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} colorScheme={palette.isDark ? 'dark' : 'light'} seedColor={SETTINGS_RED} style={styles.switchHost} matchContents>
        <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
      </Host> : null}
    </SettingsRow>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  body: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 45, height: 45, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 21, fontWeight: '500' },
  // 20 between grouped cards keeps sections distinct without a cluttered feel.
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, gap: 20 },
  section: { gap: 8 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingHorizontal: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', opacity: 0.85 },
  group: { borderRadius: 24, borderCurve: 'continuous', paddingHorizontal: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12 },
  rowCopy: { flex: 1, minWidth: 0 },
  labelLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  label: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  rowDescription: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  value: { fontSize: 15, maxWidth: '45%', textAlign: 'right' },
  iconTile: { width: 30, height: 30, borderRadius: 8, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  checkSpace: { width: 29, alignItems: 'center' },
  description: { fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  switchHost: { width: 60, minHeight: 34, flexShrink: 0 },
  badge: { backgroundColor: SETTINGS_RED, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { color: '#130F0C', fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  error: { color: SETTINGS_RED, fontSize: 14, lineHeight: 22, paddingHorizontal: 20 },
});
