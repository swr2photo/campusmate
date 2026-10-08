import Text from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Dimensions, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname } from 'expo-router';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import { useAuth } from '../context/AuthContext';
import { useAppProfile } from '../context/AppContext';
import { useCall } from '../context/CallContext';
import { useMembership } from '../context/MembershipContext';
import { isMainTabPath, useAppTour } from '../context/AppTourContext';
import { PLAN_FREE, PLUS_BENEFITS } from '../data/plans';
import { hasPendingAlerts, subscribeAlerts } from '../utils/appAlert';
import { useAnyOverlayActive, useOverlayGate } from '../utils/overlayGate';
import { useTheme } from '../theme';
import { project, rubberband } from '../utils/motion';

/**
 * CampusMate Plus upsell bottom sheet.
 *
 * Shown once per app entry (cold start, or returning to the foreground after at least
 * RESUME_GAP_MS in the background) while the plan is known to be free, on the main tabs,
 * after the first-run tour and when no alert / other startup overlay / call is on screen.
 * Closing hides it for this entry only; "ไม่ต้องแสดงอีกวันนี้" hides it until local midnight
 * (stored per user id). Plus members never see it.
 */
export const RESUME_GAP_MS = 30 * 60 * 1000;
const SHOW_DELAY_MS = 1500;
// Right after a Plus period ends the client briefly reads 'free' while the store renewal syncs.
const RENEWAL_GRACE_MS = 2 * 60 * 1000;
const SNOOZE_PREFIX = '@campusmate:plus_upsell_snooze_v1:';
const OVERLAY_KEY = 'plusUpsell';

export function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Counts "app entries": 1 at cold start, +1 when the app comes back after a long background. */
function useAppEntry() {
  const [entry, setEntry] = useState(1);
  const backgroundAt = useRef(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundAt.current = Date.now();
      } else if (state === 'active') {
        const since = backgroundAt.current;
        backgroundAt.current = null;
        if (since && Date.now() - since >= RESUME_GAP_MS) setEntry((value) => value + 1);
      }
    });
    return () => sub.remove();
  }, []);
  return entry;
}

export default function PlusUpsellHost() {
  const { user, isLoggedIn } = useAuth();
  const { profile } = useAppProfile();
  const { isCallActive } = useCall();
  const membership = useMembership();
  const tour = useAppTour();
  const pathname = usePathname();
  const uid = isLoggedIn ? (user?.id || user?.uid || null) : null;
  const entry = useAppEntry();
  const alertsPending = useSyncExternalStore(subscribeAlerts, hasPendingAlerts, hasPendingAlerts);
  const otherOverlay = useAnyOverlayActive(OVERLAY_KEY);
  const [snooze, setSnooze] = useState({ uid: null, date: null, loaded: false });
  const [visible, setVisible] = useState(false);
  const consumed = useRef({ uid: null, entry: 0 });

  useEffect(() => {
    if (!uid) { setSnooze({ uid: null, date: null, loaded: false }); return undefined; }
    let live = true;
    setSnooze({ uid, date: null, loaded: false });
    AsyncStorage.getItem(SNOOZE_PREFIX + uid)
      .then((value) => { if (live) setSnooze({ uid, date: value || null, loaded: true }); })
      .catch(() => { if (live) setSnooze({ uid, date: null, loaded: true }); });
    return () => { live = false; };
  }, [uid]);

  const isFree = membership.configured && membership.status === PLAN_FREE;
  const activeUntil = membership.activeUntil || 0;
  const [renewalWait, setRenewalWait] = useState(false);
  useEffect(() => {
    const remaining = activeUntil + RENEWAL_GRACE_MS - Date.now();
    if (!isFree || !activeUntil || remaining <= 0 || remaining > RENEWAL_GRACE_MS) {
      setRenewalWait(false);
      return undefined;
    }
    setRenewalWait(true);
    const timer = setTimeout(() => setRenewalWait(false), remaining + 50);
    return () => clearTimeout(timer);
  }, [activeUntil, isFree]);
  const snoozedToday = snooze.uid === uid && snooze.date === localDateKey();
  const eligible = Boolean(uid) && isFree && !renewalWait && isMainTabPath(pathname)
    && Boolean(profile) && profile?.id === uid && !profile?.isNewUser
    && snooze.loaded && snooze.uid === uid && !snoozedToday
    && tour.status === 'done' && !tour.active
    && !alertsPending && !otherOverlay && !isCallActive;
  const pendingEntry = consumed.current.uid !== uid || consumed.current.entry < entry;

  useEffect(() => {
    if (!eligible || !pendingEntry || visible) return undefined;
    const timer = setTimeout(() => {
      consumed.current = { uid, entry };
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, entry, pendingEntry, uid, visible]);

  // Became Plus, signed out, or left the main tabs (e.g. a notification opened a chat): hide.
  const stillAllowed = Boolean(uid) && isFree && isMainTabPath(pathname) && !tour.active && !isCallActive;
  useEffect(() => {
    if (visible && !stillAllowed) setVisible(false);
  }, [stillAllowed, visible]);

  const snoozeToday = useCallback(() => {
    if (!uid) return;
    const date = localDateKey();
    setSnooze({ uid, date, loaded: true });
    void AsyncStorage.setItem(SNOOZE_PREFIX + uid, date).catch(() => {});
  }, [uid]);

  return (
    <PlusUpsellSheet
      onClose={() => setVisible(false)}
      onOpenPlans={() => {
        setVisible(false);
        router.push('/membership');
      }}
      onSnoozeToday={() => {
        snoozeToday();
        setVisible(false);
      }}
      visible={visible}
    />
  );
}

const OPEN_SPRING = { duration: 460, dampingRatio: 0.86 };
const SETTLE_SPRING = { duration: 340, dampingRatio: 0.82 };

export function PlusUpsellSheet({ visible, onClose, onOpenPlans, onSnoozeToday }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const offscreen = Dimensions.get('window').height;
  const sheetHeight = useSharedValue(offscreen);
  const translateY = useSharedValue(offscreen);
  const dragStart = useSharedValue(0);
  const pendingAction = useRef(null);
  useOverlayGate(OVERLAY_KEY, mounted || visible);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = useCallback(() => { onCloseRef.current?.(); }, []);
  const finishClose = useCallback(() => {
    setMounted(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      cancelAnimation(translateY);
      translateY.set(sheetHeight.get());
      translateY.set(withSpring(0, OPEN_SPRING));
    } else if (mounted) {
      cancelAnimation(translateY);
      translateY.set(withTiming(sheetHeight.get(), { duration: 230, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(finishClose);
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The whole sheet follows the finger (down freely, up with a rubber band).
  // Release past ~30% of its height, a projected fling past half of it, or a fast
  // downward flick closes it; anything else springs back open.
  const pan = useMemo(() => Gesture.Pan()
    .enabled(Boolean(visible))
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onStart(() => {
      cancelAnimation(translateY);
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      const next = dragStart.get() + event.translationY;
      translateY.set(next >= 0 ? next : rubberband(next, 320));
    })
    .onEnd((event) => {
      const height = sheetHeight.get();
      const position = translateY.get();
      const projected = position + project(event.velocityY);
      if (position > height * 0.3 || projected > height * 0.55 || event.velocityY > 1100) {
        scheduleOnRN(requestClose);
      } else {
        translateY.set(withSpring(0, { ...SETTLE_SPRING, velocity: event.velocityY }));
      }
    }), [dragStart, requestClose, sheetHeight, translateY, visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, sheetHeight.get()], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted && !visible) return null;

  const primaryBg = isDark ? colors.primaryDark || colors.primary : colors.primary;
  const sheet = (
    <GestureHandlerRootView style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.62)' : 'rgba(12, 22, 40, 0.5)' }, backdropStyle]}
      />
      <Pressable
        accessibilityElementsHidden
        disabled={!visible}
        importantForAccessibility="no"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          onLayout={(event) => { sheetHeight.set(event.nativeEvent.layout.height + 40); }}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: isDark ? colors.line : 'rgba(16, 32, 58, 0.06)',
              paddingBottom: Math.max(insets.bottom, 12) + 12,
            },
            sheetStyle,
          ]}
        >
          <View accessibilityHint="ลากลงเพื่อปิด" style={styles.grabberArea}>
            <View style={[styles.grabber, { backgroundColor: colors.line }]} />
          </View>
          <View style={[styles.hero, { backgroundColor: colors.primarySoft }]}>
            <View style={[styles.heroBadge, { backgroundColor: primaryBg }]}>
              <FeatureIcon color={colors.onPrimary} name="sparkles" size={26} />
            </View>
            <View style={styles.heroCopy}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>CampusMate Plus</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>เลือกเพื่อนและกิจกรรมได้ตรงใจยิ่งขึ้น</Text>
            </View>
          </View>
          <View style={styles.benefits}>
            {PLUS_BENEFITS.map(({ feature, icon, label }) => (
              <View key={feature} style={styles.benefitRow}>
                <View style={[styles.benefitIcon, { backgroundColor: colors.primarySoft }]}>
                  <FeatureIcon color={colors.primary} name={icon} size={17} />
                </View>
                <Text style={[styles.benefitText, { color: colors.ink }]}>{label}</Text>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              pendingAction.current = onOpenPlans;
              onClose?.();
            }}
            style={({ pressed }) => [styles.cta, { backgroundColor: primaryBg }, pressed && styles.pressed]}
          >
            <Text style={[styles.ctaText, { color: colors.onPrimary }]}>ดูแพ็กเกจสมาชิก</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            onPress={onSnoozeToday}
            style={({ pressed }) => [styles.snooze, pressed && styles.pressed]}
          >
            <Text style={[styles.snoozeText, { color: colors.inkMuted }]}>ไม่ต้องแสดงอีกวันนี้</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay>
        {sheet}
      </FullWindowOverlay>
    );
  }
  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={() => { if (visible) onClose?.(); }}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted || Boolean(visible)}
    >
      {sheet}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  grabberArea: { alignItems: 'center', marginHorizontal: -20, marginTop: -10, paddingBottom: 6, paddingTop: 10 },
  sheet: {
    alignSelf: 'center',
    borderCurve: 'continuous',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 24,
    maxWidth: 560,
    paddingHorizontal: 20,
    paddingTop: 10,
    shadowColor: '#0B1424',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  grabber: { borderRadius: 3, height: 5, width: 42 },
  hero: { alignItems: 'center', borderCurve: 'continuous', borderRadius: 22, flexDirection: 'row', gap: 14, marginTop: 18, padding: 16 },
  heroBadge: { alignItems: 'center', borderRadius: 26, height: 52, justifyContent: 'center', width: 52 },
  heroCopy: { flex: 1 },
  title: { fontSize: 21, fontWeight: '800', lineHeight: 30 },
  subtitle: { fontSize: 14, lineHeight: 22, marginTop: 2 },
  benefits: { gap: 12, marginTop: 18, paddingHorizontal: 2 },
  benefitRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  benefitIcon: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  benefitText: { flex: 1, fontSize: 15, lineHeight: 23 },
  cta: { alignItems: 'center', borderCurve: 'continuous', borderRadius: 16, justifyContent: 'center', marginTop: 22, minHeight: 52, paddingHorizontal: 16 },
  ctaText: { fontSize: 16, fontWeight: '800', lineHeight: 23 },
  snooze: { alignItems: 'center', alignSelf: 'center', marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  snoozeText: { fontSize: 14, fontWeight: '700', lineHeight: 21 },
  pressed: { opacity: 0.82 },
});
