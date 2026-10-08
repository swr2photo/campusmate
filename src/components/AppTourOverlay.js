import Text from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Dimensions, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import { useAppTour } from '../context/AppTourContext';
import { useTheme } from '../theme';

/**
 * Coach-mark overlay for the first-run tour (state lives in AppTourContext).
 * Dims the screen with four rectangles around the measured target, draws a ring around it
 * and shows a tooltip card. Targets that cannot be measured fall back to a centered card
 * (or are skipped when the step is optional), so the tour never hangs.
 */
const HOLE_PADDING = 6;
const MEASURE_ATTEMPTS = 8;

function measureNode(node) {
  return new Promise((resolve) => {
    if (!node?.measureInWindow) { resolve(null); return; }
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 500);
    try {
      node.measureInWindow((x, y, width, height) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve([x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null);
      });
    } catch {
      settled = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function measureTarget(entry, root, size) {
  if (!entry?.node) return null;
  const [target, origin] = await Promise.all([measureNode(entry.node), measureNode(root)]);
  if (!target || target.width < 2 || target.height < 2) return null;
  const x = target.x - (origin?.x || 0);
  const y = target.y - (origin?.y || 0);
  // Off screen (inactive tab, scrolled away, detached): not usable.
  if (y + target.height < 8 || y > size.height - 8 || x + target.width < 8 || x > size.width - 8) return null;
  return { x, y, width: target.width, height: target.height };
}

function paddedHole(rect, size, insets) {
  const left = Math.max(6, rect.x - HOLE_PADDING);
  const right = Math.min(size.width - 6, rect.x + rect.width + HOLE_PADDING);
  const top = Math.max(Math.max(2, insets.top - 4), rect.y - HOLE_PADDING);
  let bottom = Math.min(size.height - 2, rect.y + rect.height + HOLE_PADDING);
  // Very tall targets: keep the top part so the card still has room.
  if (bottom - top > size.height * 0.48) bottom = top + size.height * 0.48;
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

export default function AppTourOverlay() {
  const tour = useAppTour();
  if (!tour.active || !tour.run) return null;
  return <TourOverlay tour={tour} />;
}

function TourOverlay({ tour }) {
  const { run, registry, goToStep, finishTour } = tour;
  const { index, steps } = run;
  const step = steps[index];
  const total = steps.length;
  const isLast = index === total - 1;
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const rootRef = useRef(null);
  const [size, setSize] = useState(() => Dimensions.get('window'));
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [hole, setHole] = useState(null);
  const [ready, setReady] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);
  const directionRef = useRef(1);
  const fade = useRef(new Animated.Value(0)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const hx = useRef(new Animated.Value(size.width / 2)).current;
  const hy = useRef(new Animated.Value(size.height / 2)).current;
  const hw = useRef(new Animated.Value(0)).current;
  const hh = useRef(new Animated.Value(0)).current;

  const close = useCallback(() => {
    Animated.timing(fade, { duration: 180, easing: Easing.in(Easing.quad), toValue: 0, useNativeDriver: true }).start(() => {
      finishTour();
      if (pathnameRef.current !== '/home') router.navigate('/home');
    });
  }, [fade, finishTour]);

  const next = useCallback(() => {
    directionRef.current = 1;
    if (isLast) close();
    else goToStep(index + 1);
  }, [close, goToStep, index, isLast]);

  const back = useCallback(() => {
    if (index === 0) return;
    directionRef.current = -1;
    goToStep(index - 1);
  }, [goToStep, index]);

  useEffect(() => {
    Animated.timing(fade, { duration: 220, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [back]);

  // Per step: go to the step's tab, scroll the target into view, measure it.
  useEffect(() => {
    let cancelled = false;
    const timers = [];
    const wait = (ms) => new Promise((resolve) => { timers.push(setTimeout(resolve, ms)); });
    setReady(false);
    cardFade.setValue(0);
    (async () => {
      try {
        let navigated = false;
        if (step.route && pathnameRef.current !== step.route) {
          router.navigate(step.route);
          navigated = true;
        }
        await wait(navigated ? 480 : 90);
        let measured = null;
        if (step.target) {
          const entry = registry?.get(step.target);
          if (entry?.ensureVisible) {
            entry.ensureVisible();
            await wait(380);
          }
          for (let attempt = 0; attempt < MEASURE_ATTEMPTS && !cancelled && !measured; attempt += 1) {
            measured = await measureTarget(registry?.get(step.target), rootRef.current, sizeRef.current);
            if (!measured) await wait(150);
          }
        }
        if (cancelled) return;
        if (!measured && step.target && step.optional) {
          const target = index + directionRef.current;
          if (target >= total) close();
          else goToStep(Math.max(0, target));
          return;
        }
        setHole(measured ? paddedHole(measured, sizeRef.current, insets) : null);
        setReady(true);
      } catch {
        if (!cancelled) { setHole(null); setReady(true); }
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, size.width, size.height]);

  useEffect(() => {
    if (!ready) return;
    const targetHole = hole || { x: size.width / 2, y: size.height / 2, w: 0, h: 0 };
    const timing = (value, toValue) => Animated.timing(value, { duration: 280, easing: Easing.out(Easing.cubic), toValue, useNativeDriver: false });
    Animated.parallel([
      timing(hx, targetHole.x),
      timing(hy, targetHole.y),
      timing(hw, targetHole.w),
      timing(hh, targetHole.h),
      timing(ring, hole ? 1 : 0),
    ]).start();
    Animated.timing(cardFade, { delay: 140, duration: 200, toValue: 1, useNativeDriver: true }).start();
  }, [cardFade, hh, hole, hw, hx, hy, ready, ring, size.height, size.width]);

  const dim = isDark ? 'rgba(0, 0, 0, 0.74)' : 'rgba(9, 18, 34, 0.68)';
  const cardWidth = Math.min(size.width - 32, 420);
  const cardLeft = (size.width - cardWidth) / 2;
  const margin = 16;
  const gap = 14;
  let cardTop = (size.height - cardHeight) / 2;
  let arrow = null;
  if (hole) {
    const below = size.height - insets.bottom - margin - (hole.y + hole.h);
    const above = hole.y - insets.top - margin;
    if (below >= cardHeight + gap) {
      cardTop = hole.y + hole.h + gap;
      arrow = 'up';
    } else if (above >= cardHeight + gap) {
      cardTop = hole.y - gap - cardHeight;
      arrow = 'down';
    } else {
      cardTop = below >= above ? size.height - insets.bottom - margin - cardHeight : insets.top + margin;
    }
  }
  const arrowLeft = hole ? Math.min(Math.max(hole.x + hole.w / 2 - cardLeft - 8, 22), cardWidth - 38) : 0;
  const primaryBg = isDark ? colors.primaryDark || colors.primary : colors.primary;
  const showCard = ready && cardHeight > 0;

  const content = (
    <View
      collapsable={false}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width && height && (width !== size.width || height !== size.height)) setSize({ width, height });
      }}
      onStartShouldSetResponder={() => true}
      ref={rootRef}
      style={StyleSheet.absoluteFill}
    >
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Animated.View style={[styles.dim, { backgroundColor: dim, height: hy, left: 0, right: 0, top: 0 }]} />
      <Animated.View style={[styles.dim, { backgroundColor: dim, bottom: 0, left: 0, right: 0, top: Animated.add(hy, hh) }]} />
      <Animated.View style={[styles.dim, { backgroundColor: dim, height: hh, left: 0, top: hy, width: hx }]} />
      <Animated.View style={[styles.dim, { backgroundColor: dim, height: hh, left: Animated.add(hx, hw), right: 0, top: hy }]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: isDark ? colors.primary : '#FFFFFF', height: hh, left: hx, opacity: ring, top: hy, width: hw }]}
      />
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityViewIsModal
        onLayout={(event) => {
          const height = Math.round(event.nativeEvent.layout.height);
          if (height && Math.abs(height - cardHeight) > 1) setCardHeight(height);
        }}
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: isDark ? colors.line : 'rgba(16, 32, 58, 0.06)',
            left: cardLeft,
            opacity: showCard ? cardFade : 0,
            top: Math.max(insets.top + 8, cardTop),
            transform: [{ translateY: cardFade.interpolate({ inputRange: [0, 1], outputRange: [arrow === 'down' ? -8 : 8, 0] }) }],
            width: cardWidth,
          },
        ]}
      >
        {arrow ? (
          <View style={[styles.arrow, arrow === 'up' ? styles.arrowUp : styles.arrowDown, { backgroundColor: colors.card, left: arrowLeft }]} />
        ) : null}
        <View style={styles.metaRow}>
          <View style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.chipText, { color: colors.primary }]}>{`${index + 1}/${total}`}</Text>
          </View>
          {step.tab ? (
            <View style={[styles.chip, { backgroundColor: isDark ? colors.surfaceRaised : '#F1F5FA' }]}>
              <Text numberOfLines={1} style={[styles.chipText, { color: colors.inkMuted }]}>{`แท็บ ${step.tab}`}</Text>
            </View>
          ) : null}
          <View style={styles.flex} />
          {!isLast ? (
            <Pressable accessibilityLabel="ข้ามการแนะนำ" accessibilityRole="button" hitSlop={10} onPress={close} style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
              <Text style={[styles.skipText, { color: colors.inkMuted }]}>ข้าม</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          {step.icon ? (
            <View style={[styles.iconBadge, { backgroundColor: colors.primarySoft }]}>
              <FeatureIcon color={colors.primary} name={step.icon} size={18} />
            </View>
          ) : null}
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{step.title}</Text>
        </View>
        <Text style={[styles.body, { color: colors.inkMuted }]}>{step.body}</Text>
        <View style={styles.dots}>
          {steps.map((item, dotIndex) => (
            <View
              key={item.id}
              style={[
                styles.dot,
                { backgroundColor: dotIndex === index ? colors.primary : colors.line },
                dotIndex === index && styles.dotActive,
              ]}
            />
          ))}
        </View>
        <View style={styles.buttons}>
          {index > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={back}
              style={({ pressed }) => [styles.button, styles.buttonSecondary, { backgroundColor: colors.primarySoft }, pressed && styles.pressed]}
            >
              <Text style={[styles.buttonText, { color: colors.primary }]}>ย้อนกลับ</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={next}
            style={({ pressed }) => [styles.button, styles.buttonPrimary, { backgroundColor: primaryBg }, pressed && styles.pressed]}
          >
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
              {isLast ? 'เริ่มใช้งาน' : index === 0 ? 'เริ่มเลย' : 'ถัดไป'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay>
        <View style={StyleSheet.absoluteFill}>{content}</View>
      </FullWindowOverlay>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  ring: {
    borderRadius: 16,
    borderWidth: 2,
    position: 'absolute',
  },
  card: {
    borderCurve: 'continuous',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 18,
    paddingBottom: 16,
    paddingHorizontal: 18,
    paddingTop: 14,
    position: 'absolute',
    shadowColor: '#0B1424',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
  },
  arrow: {
    height: 16,
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    width: 16,
  },
  arrowUp: { top: -7 },
  arrowDown: { bottom: -7 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: '800', lineHeight: 18 },
  flex: { flex: 1 },
  skip: { paddingHorizontal: 4, paddingVertical: 4 },
  skipText: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 12 },
  iconBadge: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', lineHeight: 27 },
  body: { fontSize: 15, lineHeight: 24, marginTop: 8 },
  dots: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 14 },
  dot: { borderRadius: 3, height: 6, width: 6 },
  dotActive: { width: 18 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: { alignItems: 'center', borderCurve: 'continuous', borderRadius: 14, justifyContent: 'center', minHeight: 46, paddingHorizontal: 16 },
  buttonPrimary: { flex: 1 },
  buttonSecondary: { minWidth: 104 },
  buttonText: { fontSize: 15, fontWeight: '800', lineHeight: 22 },
  pressed: { opacity: 0.82 },
});
