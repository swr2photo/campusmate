import Text from './AppText';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppActions, useAppSync } from '../context/AppContext';
import FeatureIcon from './FeatureIcon';
import LiquidGlassView from './LiquidGlassView';
import { radius, shadow, spacing, type, useTheme } from '../theme';

export default function OfflineBanner() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { syncNow } = useAppActions();
  const {
    isOnline,
    isSyncing,
    lastSyncError,
    pendingSyncCount,
  } = useAppSync();

  if (isOnline && (!isSyncing || pendingSyncCount === 0) && pendingSyncCount === 0 && !lastSyncError) return null;

  let icon = 'wifi.slash';
  let label = 'ออฟไลน์ · กำลังแสดงข้อมูลล่าสุดในเครื่อง';
  let glassTint = isDark ? 'rgba(216, 144, 27, 0.42)' : 'rgba(216, 144, 27, 0.35)';
  let canRetry = false;

  if (isOnline && isSyncing && pendingSyncCount > 0) {
    icon = 'arrow.triangle.2.circlepath';
    label = `กำลังซิงก์ ${pendingSyncCount} รายการ`;
    glassTint = isDark ? 'rgba(40, 105, 199, 0.42)' : 'rgba(40, 105, 199, 0.35)';
  } else if (isOnline && pendingSyncCount > 0) {
    icon = 'arrow.triangle.2.circlepath';
    label = `รอซิงก์ ${pendingSyncCount} รายการ · แตะเพื่อลองใหม่`;
    glassTint = isDark ? 'rgba(244, 124, 107, 0.42)' : 'rgba(244, 124, 107, 0.35)';
    canRetry = true;
  } else if (isOnline && lastSyncError) {
    icon = 'exclamationmark.triangle.fill';
    label = 'บางรายการซิงก์ไม่สำเร็จ · แตะเพื่อลองใหม่';
    glassTint = isDark ? 'rgba(214, 84, 84, 0.42)' : 'rgba(214, 84, 84, 0.35)';
    canRetry = true;
  } else if (pendingSyncCount > 0) {
    label = `ออฟไลน์ · เก็บไว้รอส่ง ${pendingSyncCount} รายการ`;
  }

  const content = (
    <LiquidGlassView
      glassEffectStyle="regular"
      style={[
        styles.banner,
        {
          backgroundColor: glassTint,
          top: insets.top + spacing.sm,
        },
      ]}
    >
      <View style={styles.innerRow}>
        <FeatureIcon color="#FFFFFF" name={icon} size={16} />
        <Text numberOfLines={2} style={styles.text}>{label}</Text>
      </View>
    </LiquidGlassView>
  );

  if (!canRetry) return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{content}</View>;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable accessibilityRole="button" onPress={() => void syncNow()} style={({ pressed }) => [pressed && styles.pressed]}>
        {content}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    maxWidth: '92%',
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    position: 'absolute',
    ...shadow.card,
  },
  innerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  text: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: type.caption,
    fontWeight: '900',
    textAlign: 'center',
  },
  pressed: { opacity: 0.8 },
});
