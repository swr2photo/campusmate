import { Pressable } from './NativePressable';
import Text from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import FeatureIcon from './FeatureIcon';
import SlideUpSheet from './sheets/SlideUpSheet';
import { useOverlayGate } from '../utils/overlayGate';
import { checkAppUpdate, openAppStore, snoozeUpdate, subscribeAppUpdate } from '../services/versionCheckService';
import { useTheme } from '../theme';

const appIcon = require('../../assets/icon.png');
const MAX_NOTES = 8;

/** Release notes as list items: one per line, bullet marks removed. */
function noteLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_NOTES);
}

/**
 * New-version prompt from app_config/version. An optional update slides up
 * as a sheet that can wait; a forced one covers the app until it is updated.
 */
export default function AppUpdateModal() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [visible, setVisible] = useState(false);
  const snoozedVersionRef = useRef({ version: '', until: 0 });

  const applyResult = useCallback((result) => {
    if (
      result?.needsUpdate
      && !result.isForce
      && result.updateKey === snoozedVersionRef.current.version
      && Date.now() < snoozedVersionRef.current.until
    ) {
      return;
    }
    if (result?.needsUpdate) {
      setUpdateInfo(result);
      setVisible(true);
    } else {
      setUpdateInfo(null);
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let receivedSnapshot = false;
    const unsubscribe = subscribeAppUpdate((result) => {
      receivedSnapshot = true;
      applyResult(result);
    });

    // A single read covers startup only when the live listener never responds.
    const fallbackCheck = setTimeout(() => {
      if (receivedSnapshot) return;
      void checkAppUpdate().then((result) => {
        if (active && !receivedSnapshot) applyResult(result);
      }).catch(() => {});
    }, 4000);

    let previousAppState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && previousAppState !== 'active') {
        void checkAppUpdate().then((result) => {
          if (active) applyResult(result);
        }).catch(() => {});
      }
      previousAppState = nextAppState;
    });

    return () => {
      active = false;
      clearTimeout(fallbackCheck);
      unsubscribe?.();
      subscription?.remove?.();
    };
  }, [applyResult]);

  const handleUpdate = () => {
    if (!updateInfo) return;
    const targetUrl = Platform.OS === 'ios' ? updateInfo.appStoreUrl : updateInfo.playStoreUrl;
    openAppStore(targetUrl, Platform.OS === 'ios' ? updateInfo.appStoreUrl : updateInfo.playStoreWebUrl);
  };

  const handleLater = async () => {
    if (updateInfo?.isForce) return;
    // Ignore any update result that was already in flight before this write.
    snoozedVersionRef.current = { version: updateInfo?.updateKey || '', until: Date.now() + 60_000 };
    setVisible(false);
    await snoozeUpdate(updateInfo?.updateKey);
  };

  // Lets the first-run tour and the Plus upsell wait while the update prompt is open.
  useOverlayGate('appUpdate', visible && Boolean(updateInfo));

  if (!updateInfo) return null;
  const isForce = Boolean(updateInfo.isForce);
  const content = <UpdateContent forced={isForce} info={updateInfo} onLater={handleLater} onUpdate={handleUpdate} />;

  if (!isForce) {
    return (
      <SlideUpSheet accessibilityLabel="มีเวอร์ชันใหม่ของ CampusMate" onClose={handleLater} visible={visible}>
        <ScrollView bounces={false} contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>{content}</ScrollView>
      </SlideUpSheet>
    );
  }
  return <ForcedUpdate visible={visible}>{content}</ForcedUpdate>;
}

function ForcedUpdate({ visible, children }) {
  const { isDark } = useTheme();
  return (
    <Modal animationType="fade" onRequestClose={() => {}} presentationStyle="fullScreen" statusBarTranslucent visible={visible}>
      <LinearGradient colors={isDark ? ['#0B1020', '#111A30', '#15121C'] : ['#F5FAFF', '#EAF2FF', '#F6F1FF']} style={styles.fill}>
        <SafeAreaView style={styles.fill}>
          <ScrollView contentContainerStyle={styles.forcedScroll} showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}

function UpdateContent({ info, forced, onUpdate, onLater }) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReducedMotion();
  const notes = noteLines(info.releaseNotes);
  const storeLabel = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
  const enter = (delay) => (reduceMotion ? undefined : FadeInDown.delay(delay).duration(320));
  return (
    <View style={styles.body}>
      <Animated.View entering={reduceMotion ? undefined : ZoomIn.springify().damping(12)} style={styles.iconWrap}>
        <View style={[styles.iconGlow, { shadowColor: isDark ? '#3D7BFF' : '#2F6FE4' }]} />
        <Image accessibilityLabel="โลโก้ CampusMate" contentFit="contain" source={appIcon} style={styles.icon} />
        <View style={styles.newBadge}>
          <FeatureIcon color="#FFFFFF" name="sparkles" size={11} />
          <Text style={styles.newBadgeText}>ใหม่</Text>
        </View>
      </Animated.View>

      <Animated.View entering={enter(80)} style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{info.title || 'อัปเดตใหม่พร้อมแล้ว'}</Text>
        <View
          accessibilityLabel={`จากเวอร์ชัน ${info.currentVersion || 'ปัจจุบัน'} เป็นเวอร์ชัน ${info.latestVersion}`}
          accessible
          style={styles.versions}
        >
          <View style={[styles.chip, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={[styles.chipText, { color: colors.inkMuted }]}>v{info.currentVersion || '—'}</Text>
          </View>
          <FeatureIcon color={colors.inkMuted} name="arrow.right" size={14} />
          <View style={[styles.chip, { backgroundColor: colors.primary }]}>
            <Text style={[styles.chipText, { color: '#FFFFFF' }]}>v{info.latestVersion}{info.latestBuild ? ` (${info.latestBuild})` : ''}</Text>
          </View>
        </View>
        <Text style={[styles.message, { color: colors.inkMuted }]}>
          {info.message || `อัปเดตผ่าน ${storeLabel} เพื่อใช้ฟีเจอร์ล่าสุดและการแก้ไขปัญหา`}
        </Text>
      </Animated.View>

      {notes.length ? (
        <View style={[styles.notes, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : colors.canvas, borderColor: colors.line }]}>
          <Text style={[styles.notesLabel, { color: colors.ink }]}>มีอะไรใหม่</Text>
          {notes.map((line, index) => (
            <Animated.View entering={enter(160 + index * 60)} key={`${index}:${line}`} style={styles.noteRow}>
              <View style={[styles.noteCheck, { backgroundColor: '#0B7A55' }]}>
                <FeatureIcon color="#FFFFFF" name="checkmark" size={10} />
              </View>
              <Text style={[styles.noteText, { color: colors.ink }]}>{line}</Text>
            </Animated.View>
          ))}
        </View>
      ) : null}

      {forced ? (
        <View style={[styles.force, { backgroundColor: isDark ? 'rgba(255,200,89,0.12)' : '#FFF6E5' }]}>
          <FeatureIcon color={isDark ? '#FFC859' : '#9A5B00'} name="lock.fill" size={14} />
          <Text style={[styles.forceText, { color: isDark ? '#FFC859' : '#7A4800' }]}>เวอร์ชันที่ติดตั้งอยู่ใช้งานต่อไม่ได้ กรุณาอัปเดตเพื่อใช้งานต่อ</Text>
        </View>
      ) : null}

      <Animated.View entering={enter(240)} style={styles.actions}>
        <Pressable
          accessibilityLabel={`อัปเดตแอปผ่าน ${storeLabel}`}
          accessibilityRole="button"
          onPress={onUpdate}
          style={({ pressed }) => [styles.update, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <FeatureIcon color="#FFFFFF" name="arrow.down.app.fill" size={17} />
          <Text style={styles.updateText}>อัปเดตผ่าน {storeLabel}</Text>
        </Pressable>
        {!forced ? (
          <Pressable accessibilityLabel="เตือนฉันภายหลัง" accessibilityRole="button" onPress={onLater} style={({ pressed }) => [styles.later, pressed && { opacity: 0.7 }]}>
            <Text style={[styles.laterText, { color: colors.inkMuted }]}>ไว้ทีหลัง</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheetScroll: { paddingBottom: 4 },
  forcedScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  body: { alignItems: 'center', paddingHorizontal: 22, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
  iconWrap: { width: 96, height: 96, marginTop: 4 },
  iconGlow: {
    position: 'absolute', top: 10, left: 10, right: 10, bottom: 10, borderRadius: 24, backgroundColor: '#2F6FE4',
    shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  icon: { width: 96, height: 96 },
  newBadge: {
    position: 'absolute', top: -4, right: -10, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E5484D', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 2, borderColor: '#FFFFFF',
  },
  newBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  copy: { alignItems: 'center', gap: 10, width: '100%' },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  versions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: '800' },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  notes: { alignSelf: 'stretch', borderRadius: 20, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  notesLabel: { fontSize: 14, fontWeight: '800' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteCheck: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21 },
  force: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  forceText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  actions: { alignSelf: 'stretch', gap: 4 },
  update: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderRadius: 27 },
  updateText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  later: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 15, fontWeight: '700' },
});
