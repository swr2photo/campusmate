import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Pressable } from './NativePressable';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { GlassBackground, GlassIconButton, useLiquidGlass, useSheetGlassTint, withAlpha } from './LiquidGlassSurface';
import { project, rubberband } from '../utils/motion';
import { useTheme } from '../theme';

const DANGER = '#E5484D';
const SHEET_RADIUS = 28;

/** Switch rows save on change; the parent's setting arrives back as `value`. */
function ToggleRow({ icon, tint, label, description, value, onChange, palette, divider }) {
  // Optimistic: flip at once, then follow the saved value when it arrives.
  const [current, setCurrent] = useState(value);
  useEffect(() => { setCurrent(value); }, [value]);
  const toggle = (next) => {
    setCurrent(next);
    Haptics.selectionAsync().catch(() => {});
    onChange?.(next);
  };
  return (
    <View style={[styles.row, divider && { borderBottomWidth: 1, borderBottomColor: palette.line }]}>
      <View style={[styles.iconTile, { backgroundColor: withAlpha(tint, palette.isDark ? 0.22 : 0.14) }]}>
        <FeatureIcon name={icon} size={17} color={tint} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
        {description ? <Text style={[styles.rowDescription, { color: palette.muted }]}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        ios_backgroundColor={palette.track}
        trackColor={{ false: palette.track, true: palette.accent }}
        thumbColor="#FFFFFF"
        value={current}
        onValueChange={toggle}
      />
    </View>
  );
}

function ActionRow({ icon, tint, label, onPress, palette, divider, danger = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: withAlpha(danger ? DANGER : palette.text, 0.08) }}
      style={({ pressed }) => [styles.row, divider && { borderBottomWidth: 1, borderBottomColor: palette.line }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.iconTile, { backgroundColor: withAlpha(tint, palette.isDark ? 0.22 : 0.12) }]}>
        <FeatureIcon name={icon} size={17} color={tint} />
      </View>
      <Text numberOfLines={2} style={[styles.rowLabel, styles.rowCopy, { color: danger ? DANGER : palette.text }]}>{label}</Text>
      {danger ? null : <FeatureIcon name="chevron.right" size={15} color={palette.muted} />}
    </Pressable>
  );
}

/**
 * Per-conversation settings. No "Done" button: switches save as they change,
 * and the sheet closes by swiping down, tapping outside or the close button.
 */
export default function ChatSettingsSheet({
  chat,
  isMuted,
  isOpen,
  onClose,
  onNavigateMeetup,
  onNavigateProfile,
  onRemoveConversation,
  onBlockUser,
  onReportUser,
  onToggleMute,
  onTogglePinnedMeetup,
  partnerMeetup,
  showPinnedMeetup,
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();
  const palette = useMemo(() => ({
    isDark,
    text: colors.ink,
    muted: colors.inkMuted,
    line: colors.line,
    accent: colors.primary,
    track: isDark ? '#3A3F4B' : '#CBD5E1',
    // Grouped rows sit on one quiet surface; no tinted danger card.
    group: glass ? withAlpha('#FFFFFF', isDark ? 0.08 : 0.72) : (isDark ? colors.surfaceContainerHigh : colors.surfaceContainerLow),
  }), [colors, glass, isDark]);

  const translateY = useSharedValue(600);
  const fade = useSharedValue(0);
  const sheetHeight = useSharedValue(600);
  const dragStart = useSharedValue(0);
  const closing = useSharedValue(0);
  const pendingAction = useRef(null);

  const finishClose = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    closing.set(0);
    onClose?.();
    if (typeof action === 'function') setTimeout(action, 80);
  }, [closing, onClose]);

  const close = useCallback((action) => {
    if (closing.get()) return;
    closing.set(1);
    pendingAction.current = typeof action === 'function' ? action : null;
    translateY.set(withSpring(Math.max(sheetHeight.get(), 400), { duration: 300, dampingRatio: 1, overshootClamping: true }, (finished) => {
      if (finished) scheduleOnRN(finishClose);
    }));
    fade.set(withTiming(0, { duration: 180 }));
  }, [closing, fade, finishClose, sheetHeight, translateY]);

  useEffect(() => {
    if (!isOpen) return;
    closing.set(0);
    pendingAction.current = null;
    translateY.set(600);
    fade.set(0);
    translateY.set(withSpring(0, { duration: 420, dampingRatio: 0.82 }));
    fade.set(withTiming(1, { duration: 180 }));
  }, [closing, fade, isOpen, translateY]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onStart(() => { dragStart.set(translateY.get()); })
    .onUpdate((event) => {
      const next = dragStart.get() + event.translationY;
      translateY.set(next >= 0 ? next : rubberband(next, Math.max(sheetHeight.get(), 1)));
    })
    .onEnd((event) => {
      const height = Math.max(sheetHeight.get(), 1);
      const projected = translateY.get() + project(event.velocityY);
      if ((projected > height * 0.35 || event.velocityY > 800) && !closing.get()) {
        closing.set(1);
        translateY.set(withSpring(height, { duration: 300, dampingRatio: 1, velocity: event.velocityY, overshootClamping: true }, (finished) => {
          if (finished) scheduleOnRN(finishClose);
        }));
        fade.set(withTiming(0, { duration: 180 }));
      } else {
        translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: event.velocityY }));
      }
    }), [closing, dragStart, fade, finishClose, sheetHeight, translateY]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
  const name = chat?.name || 'เพื่อน';
  const hasSafety = Boolean(onReportUser || onBlockUser || onRemoveConversation);
  const safetyRows = [
    onReportUser ? { key: 'report', icon: 'exclamationmark.bubble', label: 'รายงานผู้ใช้นี้', action: onReportUser } : null,
    onBlockUser ? { key: 'block', icon: 'nosign', label: 'บล็อกผู้ใช้นี้', action: onBlockUser } : null,
    onRemoveConversation ? { key: 'remove', icon: 'trash', label: 'ยกเลิกการจับคู่และลบห้องสนทนา', action: onRemoveConversation } : null,
  ].filter(Boolean);

  return (
    <Modal animationType="none" transparent visible={isOpen} statusBarTranslucent onRequestClose={() => close()}>
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.host}>
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
            <Pressable accessibilityRole="button" accessibilityLabel="ปิดการตั้งค่าห้องสนทนา" onPress={() => close()} style={styles.flex} />
          </Reanimated.View>

          <Reanimated.View
            accessibilityViewIsModal
            onLayout={(event) => { const height = event.nativeEvent?.layout?.height; if (height) sheetHeight.set(height); }}
            style={[styles.sheet, { backgroundColor: glass ? 'transparent' : colors.card, paddingBottom: Math.max(insets.bottom, 16) }, sheetStyle]}
          >
            <GlassBackground style={styles.sheetGlass} tintColor={glassTint} />
            <GestureDetector gesture={pan}>
              <View>
                <View style={styles.handleArea}>
                  <View style={[styles.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.16)' }]} />
                </View>
                <View style={styles.header}>
                  <View style={styles.rowCopy}>
                    <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>ตั้งค่าห้องสนทนา</Text>
                    <Text style={[styles.subtitle, { color: palette.muted }]}>ใช้เฉพาะแชตกับ {name} · เปลี่ยนแล้วบันทึกให้ทันที</Text>
                  </View>
                  <GlassIconButton
                    accessibilityLabel="ปิด"
                    fallbackBackgroundColor={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'}
                    icon="xmark"
                    iconColor={palette.muted}
                    iconSize={15}
                    onPress={() => close()}
                    size={Platform.OS === 'android' ? 48 : 40}
                  />
                </View>
              </View>
            </GestureDetector>

            <ScrollView bounces={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={[styles.group, { backgroundColor: palette.group }]}>
                <ToggleRow
                  icon="mappin.and.ellipse"
                  tint={colors.primary}
                  label="แสดงจุดนัดหมายด้านบน"
                  description={showPinnedMeetup ? 'เห็นสถานที่และเวลานัดไว้บนสุดของแชต' : 'ซ่อนไว้ ให้มีพื้นที่อ่านข้อความมากขึ้น'}
                  value={Boolean(showPinnedMeetup)}
                  onChange={onTogglePinnedMeetup}
                  palette={palette}
                  divider
                />
                <ToggleRow
                  icon="bell.slash.fill"
                  tint={colors.amber}
                  label="ปิดการแจ้งเตือนแชตนี้"
                  description={isMuted ? 'ข้อความใหม่จะเข้ามาเงียบ ๆ' : 'รับการแจ้งเตือนตามปกติ'}
                  value={Boolean(isMuted)}
                  onChange={onToggleMute}
                  palette={palette}
                />
              </View>

              <View style={[styles.group, { backgroundColor: palette.group }]}>
                <ActionRow icon="person.crop.circle" tint={colors.primary} label={`ดูโปรไฟล์ของ ${name}`} onPress={() => close(onNavigateProfile)} palette={palette} divider={Boolean(partnerMeetup)} />
                {partnerMeetup ? (
                  <ActionRow icon="map.fill" tint={colors.green} label={`ดูจุดนัดหมาย (${partnerMeetup.name})`} onPress={() => close(onNavigateMeetup)} palette={palette} />
                ) : null}
              </View>

              {hasSafety ? (
                <>
                  <Text style={[styles.groupLabel, { color: palette.muted }]}>ความปลอดภัย</Text>
                  <View style={[styles.group, { backgroundColor: palette.group }]}>
                    {safetyRows.map((row, index) => (
                      <ActionRow key={row.key} danger icon={row.icon} tint={DANGER} label={row.label} onPress={() => close(row.action)} palette={palette} divider={index < safetyRows.length - 1} />
                    ))}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </Reanimated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  host: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderCurve: 'continuous',
    maxHeight: '88%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetGlass: { borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 2.5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  group: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden' },
  groupLabel: { fontSize: 13, fontWeight: '700', paddingHorizontal: 6, marginTop: 4, marginBottom: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  rowDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  iconTile: { width: 32, height: 32, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
