import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './NativePressable';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { RUST_BACKEND, publicRpc, rpc, rustUid } from '../services/rust/backend';
import { liveQuery } from '../services/rust/events';
import { clearLocalIncident, setNetworkOnline, setServiceNotice, setServiceRefresher, useServiceStatus } from '../services/serviceStatusService';
import { useTheme } from '../theme';

const MASCOT = require('../../assets/mascot/connection-error.png');
// While a notice is up the app checks this often, so it reopens on its own.
const RECHECK_MS = 20_000;
const FLOAT = Easing.inOut(Easing.sin);

const COPY = {
  maintenance: {
    title: 'กำลังปิดปรับปรุงระบบ',
    message: 'CampusMate ปิดปรับปรุงชั่วคราวเพื่อให้ใช้งานได้ดีขึ้น กรุณากลับมาใหม่อีกครั้ง',
    icon: 'wrench.and.screwdriver.fill',
  },
  incident: {
    title: 'ระบบขัดข้องชั่วคราว',
    message: 'ทีมงานกำลังแก้ไข ข้อมูลของคุณปลอดภัย แอปจะกลับมาใช้งานได้เองเมื่อระบบพร้อม',
    icon: 'exclamationmark.triangle.fill',
  },
  local: {
    title: 'เชื่อมต่อระบบไม่ได้ชั่วคราว',
    message: 'เซิร์ฟเวอร์ตอบกลับผิดปกติหลายครั้ง แอปจะลองเชื่อมต่อใหม่ให้อัตโนมัติ',
    icon: 'icloud.slash.fill',
  },
};

function formatEnd(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return today ? `วันนี้ ${time} น.` : `${date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${time} น.`;
}

function checkStatus() {
  // Signed-in admins are let through by the server and told so here.
  return rustUid() ? rpc('getServiceStatus') : publicRpc('getServiceStatus');
}

/**
 * Keeps the server's maintenance/incident notice current and, while one is
 * in force, covers the app with it. The server refuses app requests in that
 * time anyway; this is what people see instead of failing screens.
 */
export default function MaintenanceGate() {
  const { notice, local } = useServiceStatus();
  const query = useRef(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);

  const refresh = useCallback(async () => {
    if (!RUST_BACKEND) return;
    setChecking(true);
    try {
      const result = await checkStatus();
      setServiceNotice(result?.notice || null);
      clearLocalIncident();
    } catch {
      // A failed check keeps whatever is shown; the outcome was counted.
    } finally {
      setChecking(false);
      setCheckedAt(new Date());
    }
  }, []);

  useEffect(() => {
    if (!RUST_BACKEND) return undefined;
    setServiceRefresher(refresh);
    query.current = liveQuery('config', checkStatus, (result) => setServiceNotice(result?.notice || null), () => {});
    const net = NetInfo.addEventListener((info) => setNetworkOnline(info.isConnected !== false && info.isInternetReachable !== false));
    const app = AppState.addEventListener('change', (next) => { if (next === 'active') void refresh(); });
    return () => {
      setServiceRefresher(null);
      query.current?.();
      net();
      app.remove();
    };
  }, [refresh]);

  const shown = notice || local;
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setInterval(() => { void refresh(); }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [refresh, shown]);

  if (!RUST_BACKEND || !shown) return null;
  const copy = notice ? COPY[notice.kind] || COPY.incident : COPY.local;
  return (
    <MaintenanceScreen
      checkedAt={checkedAt}
      checking={checking}
      endsAt={notice?.endsAt ? formatEnd(notice.endsAt) : null}
      icon={copy.icon}
      message={notice?.message || copy.message}
      onRetry={refresh}
      title={notice?.title || copy.title}
    />
  );
}

function MaintenanceScreen({ title, message, icon, endsAt, checking, checkedAt, onRetry }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const float = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    float.set(withRepeat(withTiming(1, { duration: 2600, easing: FLOAT }), -1, true));
    pulse.set(withRepeat(withTiming(1, { duration: 1400, easing: FLOAT }), -1, true));
  }, [float, pulse, reduceMotion]);
  const mascotStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -8 * float.get() }, { rotate: `${(float.get() - 0.5) * 4}deg` }] }));
  const shadowStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: 1 - 0.12 * float.get() }], opacity: 0.18 - 0.06 * float.get() }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * pulse.get(), transform: [{ scale: 0.8 + 0.3 * pulse.get() }] }));

  return (
    <Animated.View
      accessibilityViewIsModal
      entering={reduceMotion ? undefined : FadeIn.duration(260)}
      style={[StyleSheet.absoluteFill, styles.overlay]}
    >
      <LinearGradient
        colors={isDark ? ['#0B1020', '#111A30', '#15121C'] : ['#F5FAFF', '#EAF2FF', '#F6F1FF']}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.content, { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
        <View style={styles.art}>
          <Animated.View style={[styles.mascotShadow, shadowStyle]} />
          <Animated.View style={mascotStyle}>
            <Image accessibilityIgnoresInvertColors contentFit="contain" source={MASCOT} style={styles.mascot} />
          </Animated.View>
        </View>

        <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(141,185,255,0.16)' : 'rgba(47,111,228,0.1)' }]}>
          <FeatureIcon color={isDark ? '#8DB9FF' : '#2F6FE4'} name={icon} size={14} />
          <Text style={[styles.badgeText, { color: isDark ? '#8DB9FF' : '#2456B8' }]}>CampusMate</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.message, { color: colors.inkMuted }]}>{message}</Text>
        {endsAt ? (
          <View style={[styles.eta, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <FeatureIcon color={colors.primary} name="clock.fill" size={16} />
            <Text style={[styles.etaText, { color: colors.ink }]}>คาดว่าจะกลับมาใช้งานได้ {endsAt}</Text>
          </View>
        ) : null}

        <View style={styles.spacer} />
        <View accessibilityLiveRegion="polite" style={styles.status}>
          <Animated.View style={[styles.dot, { backgroundColor: colors.primary }, dotStyle]} />
          <Text style={[styles.statusText, { color: colors.inkMuted }]}>
            {checking ? 'กำลังตรวจสอบสถานะ…' : `ตรวจสอบอัตโนมัติทุก 20 วินาที${checkedAt ? ` · ล่าสุด ${checkedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.` : ''}`}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="ตรวจสอบสถานะอีกครั้ง"
          accessibilityRole="button"
          accessibilityState={{ busy: checking }}
          disabled={checking}
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, { backgroundColor: colors.primary, opacity: pressed || checking ? 0.8 : 1 }]}
        >
          {checking ? <ActivityIndicator color="#FFFFFF" /> : <FeatureIcon color="#FFFFFF" name="arrow.clockwise" size={16} />}
          <Text style={styles.retryText}>ตรวจสอบอีกครั้ง</Text>
        </Pressable>
        <View style={styles.safe}>
          <FeatureIcon color={colors.inkMuted} name="lock.fill" size={12} />
          <Text style={[styles.safeText, { color: colors.inkMuted }]}>ข้อมูลและแชตของคุณยังปลอดภัย</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 900, elevation: 900 },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 28, width: '100%', maxWidth: 520, alignSelf: 'center' },
  art: { alignItems: 'center', justifyContent: 'flex-end', height: 210, marginBottom: 12 },
  mascot: { width: 190, height: 190 },
  mascotShadow: { position: 'absolute', bottom: 0, width: 120, height: 14, borderRadius: 7, backgroundColor: '#000' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 12 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 8 },
  eta: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, marginTop: 18 },
  etaText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  spacer: { flex: 1, minHeight: 24 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  retry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: 26, alignSelf: 'stretch' },
  retryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  safe: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  safeText: { fontSize: 12, fontWeight: '600' },
});
