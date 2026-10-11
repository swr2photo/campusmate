import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Host, Switch } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

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
  const close = onClose || (() => router.canGoBack() ? router.back() : router.replace('/me'));
  return (
    <View style={[styles.frame, { backgroundColor: palette.canvas }]}>
      <View style={[styles.header, { backgroundColor: palette.header, paddingTop: insets.top + 12, borderBottomColor: palette.line }]}>
        {detail ? (
          <Pressable accessibilityLabel="กลับ" accessibilityRole="button" disabled={busy} hitSlop={8} onPress={close} style={({ pressed }) => [styles.headerButton, { backgroundColor: palette.button }, pressed && styles.pressed]}>
            <FeatureIcon name="chevron.left" size={23} color={palette.text} />
          </Pressable>
        ) : <View style={styles.headerButton} />}
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: palette.text }]}>{title}</Text>
        {detail ? <View style={styles.headerButton} /> : (
          <Pressable accessibilityLabel="เสร็จสิ้นการตั้งค่า" accessibilityRole="button" disabled={busy} hitSlop={8} onPress={close} style={({ pressed }) => [styles.headerButton, { backgroundColor: palette.text }, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={palette.canvas} /> : <FeatureIcon name="checkmark" size={29} weight="bold" color={palette.canvas} />}
          </Pressable>
        )}
      </View>
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
  return <View style={[styles.group, { backgroundColor: palette.card }, style]}>{children}</View>;
}

export function SettingsDescription({ children, style }) {
  const palette = useSettingsPalette();
  return <Text style={[styles.description, { color: palette.muted }, style]}>{children}</Text>;
}

export function SettingsRow({ label, description, value, onPress, last = false, selected, badge, disabled = false, busy = false, danger = false, centered = false, children }) {
  const palette = useSettingsPalette();
  const selection = typeof selected === 'boolean';
  const inner = (
    <>
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
      ) : onPress && !centered ? <FeatureIcon name="chevron.right" color={palette.text} size={21} /> : null}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 45, height: 45, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 21, fontWeight: '500' },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, gap: 28 },
  section: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingHorizontal: 20 },
  sectionTitle: { fontSize: 19, fontWeight: '500' },
  group: { borderRadius: 29, borderCurve: 'continuous', paddingHorizontal: 20, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 17 },
  rowCopy: { flex: 1, minWidth: 0 },
  labelLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  label: { fontSize: 19, fontWeight: '400' },
  rowDescription: { fontSize: 16, lineHeight: 25, marginTop: 3 },
  value: { fontSize: 16, maxWidth: '49%', textAlign: 'right' },
  checkSpace: { width: 29, alignItems: 'center' },
  description: { fontSize: 15, lineHeight: 25, paddingHorizontal: 20 },
  switchHost: { width: 60, minHeight: 34, flexShrink: 0 },
  badge: { backgroundColor: SETTINGS_RED, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { color: '#130F0C', fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  error: { color: SETTINGS_RED, fontSize: 14, lineHeight: 22, paddingHorizontal: 20 },
});
