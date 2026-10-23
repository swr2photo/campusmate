import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import FeatureIcon from '../FeatureIcon';
import Mascot, { MASCOT_COLORS } from './Mascot';
import { motion, useTheme } from '../../theme';

// Small illustrated scenes built around the mascot. All are decorative
// (hidden from screen readers): the copy next to them carries the meaning.

function hidden(style) {
  return { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', pointerEvents: 'none', style };
}

/** A small icon that drifts up and down; static under Reduce Motion. */
function Floaty({ name, color, size, delay = 0, distance = 6, style }) {
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    y.set(withDelay(delay, withRepeat(withSequence(
      withTiming(-distance, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
    ), -1)));
    return () => cancelAnimation(y);
  }, [delay, distance, reduceMotion, y]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View style={[styles.abs, style, animated]}>
      <FeatureIcon name={name} size={size} color={color} />
    </Animated.View>
  );
}

/** Round badge that springs in once, e.g. a check mark on success. */
function PopBadge({ icon, color, size, style }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) { scale.set(1); return undefined; }
    scale.set(withDelay(180, withSpring(1, motion.spring.bouncy)));
    return () => cancelAnimation(scale);
  }, [reduceMotion, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={[styles.abs, styles.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: Math.max(2, size * 0.07), borderColor: MASCOT_COLORS.white }, style, animated]}>
      <FeatureIcon name={icon} size={Math.round(size * 0.52)} color={MASCOT_COLORS.white} />
    </Animated.View>
  );
}

/** Step 1 of first-run setup: the mascot waves in a graduation cap. */
export function WelcomeScene({ size = 150 }) {
  const { colors } = useTheme();
  const body = size * 0.62;
  return (
    <View {...hidden({ width: size * 1.35, height: size * 1.12, alignItems: 'center', justifyContent: 'flex-end' })}>
      <View style={[styles.abs, { width: size * 1.05, height: size * 1.05, borderRadius: size, backgroundColor: colors.primarySoft, top: size * 0.02 }]} />
      <Floaty name="sparkles" color={colors.amber} size={Math.round(size * 0.16)} style={{ left: size * 0.08, top: size * 0.16 }} />
      <Floaty name="star.fill" color={colors.coral} size={Math.round(size * 0.11)} delay={400} style={{ right: size * 0.1, top: size * 0.08 }} />
      <Floaty name="heart.fill" color={MASCOT_COLORS.tuft} size={Math.round(size * 0.12)} delay={800} style={{ right: size * 0.04, top: size * 0.5 }} />
      <Mascot size={body} pose="wave" accessory="cap" />
    </View>
  );
}

/** Empty main-photo tile: the mascot strikes a pose inside a viewfinder. */
export function PhotoPoseScene({ size = 120, color }) {
  const { colors } = useTheme();
  const accent = color || colors.primary;
  const corner = Math.max(14, size * 0.16);
  const line = Math.max(2, Math.round(size * 0.025));
  const frame = { position: 'absolute', width: corner, height: corner, borderColor: accent };
  return (
    <View {...hidden({ width: size, height: size, alignItems: 'center', justifyContent: 'center' })}>
      <View style={[frame, { top: 0, left: 0, borderTopWidth: line, borderLeftWidth: line, borderTopLeftRadius: corner / 2 }]} />
      <View style={[frame, { top: 0, right: 0, borderTopWidth: line, borderRightWidth: line, borderTopRightRadius: corner / 2 }]} />
      <View style={[frame, { bottom: 0, left: 0, borderBottomWidth: line, borderLeftWidth: line, borderBottomLeftRadius: corner / 2 }]} />
      <View style={[frame, { bottom: 0, right: 0, borderBottomWidth: line, borderRightWidth: line, borderBottomRightRadius: corner / 2 }]} />
      <Floaty name="sparkles" color={colors.amber} size={Math.round(size * 0.16)} style={{ right: size * 0.14, top: size * 0.12 }} />
      <Mascot size={size * 0.5} pose="pose" mood="happy" />
    </View>
  );
}

/** Face verification intro: the mascot is gently scanned inside a frame. */
export function FaceScanScene({ size = 160 }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const inner = size * 0.82;
  useEffect(() => {
    if (reduceMotion) { sweep.set(0.5); return undefined; }
    sweep.set(withRepeat(withSequence(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
    ), -1));
    return () => cancelAnimation(sweep);
  }, [reduceMotion, sweep]);
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.get() * (inner - 6) }] }));
  const corner = size * 0.2;
  const stroke = Math.max(3, Math.round(size * 0.028));
  const bracket = { position: 'absolute', width: corner, height: corner, borderColor: colors.primary };
  return (
    <View {...hidden({ width: size, height: size, alignItems: 'center', justifyContent: 'center' })}>
      <View style={[styles.abs, { width: inner, height: inner, borderRadius: inner * 0.3, borderCurve: 'continuous', backgroundColor: colors.primarySoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }]}>
        <Mascot size={inner * 0.5} pose="scan" mood="calm" style={{ marginBottom: -inner * 0.08 }} />
        <Animated.View style={[styles.abs, { top: 0, left: inner * 0.08, right: inner * 0.08, height: 4, borderRadius: 2, backgroundColor: colors.primary, opacity: 0.85, shadowColor: colors.primary, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }, lineStyle]} />
      </View>
      <View style={[bracket, { top: 0, left: 0, borderTopWidth: stroke, borderLeftWidth: stroke, borderTopLeftRadius: corner * 0.6 }]} />
      <View style={[bracket, { top: 0, right: 0, borderTopWidth: stroke, borderRightWidth: stroke, borderTopRightRadius: corner * 0.6 }]} />
      <View style={[bracket, { bottom: 0, left: 0, borderBottomWidth: stroke, borderLeftWidth: stroke, borderBottomLeftRadius: corner * 0.6 }]} />
      <View style={[bracket, { bottom: 0, right: 0, borderBottomWidth: stroke, borderRightWidth: stroke, borderBottomRightRadius: corner * 0.6 }]} />
    </View>
  );
}

/** Waiting for a result: the mascot thinks while a magnifier circles it. */
export function CheckingScene({ size = 170 }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const orbit = useSharedValue(0);
  const dot0 = useSharedValue(0);
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const dots = [dot0, dot1, dot2];
    orbit.set(withRepeat(withTiming(360, { duration: 3200, easing: Easing.linear }), -1));
    dots.forEach((dot, index) => dot.set(withDelay(index * 160, withRepeat(withSequence(
      withTiming(-6, { duration: 320, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
      withDelay(320, withTiming(0, { duration: 1 })),
    ), -1))));
    return () => [orbit, ...dots].forEach((value) => cancelAnimation(value));
  }, [dot0, dot1, dot2, orbit, reduceMotion]);
  const radius = size * 0.42;
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${orbit.get()}deg` }] }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-orbit.get()}deg` }] }));
  const dotStyles = [
    useAnimatedStyle(() => ({ transform: [{ translateY: dot0.get() }] })),
    useAnimatedStyle(() => ({ transform: [{ translateY: dot1.get() }] })),
    useAnimatedStyle(() => ({ transform: [{ translateY: dot2.get() }] })),
  ];
  const glass = size * 0.2;
  return (
    <View {...hidden({ width: size, height: size + 24, alignItems: 'center' })}>
      <View style={[styles.abs, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft }]} />
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Mascot size={size * 0.46} pose="think" mood="calm" />
      </View>
      <Animated.View style={[styles.abs, { width: size, height: size, alignItems: 'center' }, orbitStyle]}>
        <Animated.View style={[{ marginTop: size / 2 - radius - glass / 2 }, counterStyle]}>
          <View style={{ width: glass, height: glass, borderRadius: glass / 2, borderWidth: Math.max(3, glass * 0.16), borderColor: MASCOT_COLORS.outline, backgroundColor: 'rgba(255,255,255,0.75)' }} />
          <View style={{ position: 'absolute', left: glass * 0.8, top: glass * 0.78, width: glass * 0.5, height: Math.max(4, glass * 0.18), borderRadius: glass, backgroundColor: MASCOT_COLORS.outline, transform: [{ rotate: '45deg' }] }} />
        </Animated.View>
      </Animated.View>
      <View style={styles.dots}>
        {dotStyles.map((style, index) => (
          <Animated.View key={index} style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, opacity: 0.4 + index * 0.25 }, style]} />
        ))}
      </View>
    </View>
  );
}

/** Outcome art: a cheering mascot, a patient one, or a sorry one. */
export function ResultScene({ kind = 'success', size = 160 }) {
  const { colors } = useTheme();
  const body = size * 0.52;
  const badge = Math.round(size * 0.24);
  const config = {
    success: { pose: 'jump', mood: 'happy', icon: 'checkmark', color: colors.green, halo: colors.greenSoft },
    review: { pose: 'idle', mood: 'calm', icon: 'clock.fill', color: colors.primary, halo: colors.primarySoft },
    oops: { pose: 'sway', mood: 'sad', icon: 'arrow.clockwise', color: colors.amber, halo: colors.amberSoft },
  }[kind] || {};
  return (
    <View {...hidden({ width: size * 1.2, height: size * 1.05, alignItems: 'center', justifyContent: 'flex-end' })}>
      <View style={[styles.abs, { width: size, height: size, borderRadius: size / 2, backgroundColor: config.halo, top: 0 }]} />
      {kind === 'oops' ? <Floaty name="drop.fill" color="#7CC4FF" size={Math.round(size * 0.1)} style={{ left: size * 0.36, top: size * 0.24 }} distance={4} /> : null}
      {kind === 'success' ? (
        <>
          <Floaty name="sparkles" color={colors.amber} size={Math.round(size * 0.14)} style={{ left: size * 0.12, top: size * 0.12 }} />
          <Floaty name="star.fill" color={colors.coral} size={Math.round(size * 0.1)} delay={300} style={{ left: size * 0.02, top: size * 0.5 }} />
        </>
      ) : null}
      <Mascot size={body} pose={config.pose} mood={config.mood} />
      <PopBadge icon={config.icon} color={config.color} size={badge} style={{ right: size * 0.16, top: size * 0.1 }} />
    </View>
  );
}

/** Shown in place of a photo that did not load: friendlier than a broken-image icon. */
export function EmptyPhotoScene({ size = 120 }) {
  const badge = Math.round(size * 0.3);
  return (
    <View {...hidden({ width: size * 1.1, height: size, alignItems: 'center', justifyContent: 'flex-end' })}>
      <Mascot size={size * 0.52} variant="blue" mood="calm" pose="think" />
      <View style={[styles.abs, styles.center, { right: size * 0.06, top: size * 0.08, width: badge, height: badge, borderRadius: badge * 0.3, borderCurve: 'continuous', backgroundColor: MASCOT_COLORS.white, borderWidth: 2, borderColor: MASCOT_COLORS.outline, transform: [{ rotate: '10deg' }] }]}>
        <FeatureIcon name="photo" size={Math.round(badge * 0.55)} color={MASCOT_COLORS.outline} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
