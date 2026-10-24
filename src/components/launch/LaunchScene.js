import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation, Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat,
  withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';

const APP_ICON = require('../../../assets/adaptive-icon.png');

// The first frame matches the native splash (app.json `expo-splash-screen`:
// the icon 180 pt wide, centred), so the hand-off has no visible jump.
export const NATIVE_LOGO_SIZE = 180;
const SETTLED_SCALE = 0.74;
const SETTLED_OFFSET = -64;
const SETTLED_SIZE = NATIVE_LOGO_SIZE * SETTLED_SCALE;
// The blue tile inside the icon artwork, for clipping the light sweep.
const TILE_INSET = 0.045;
const TILE_RADIUS = 0.2;

const PALETTES = {
  light: {
    background: ['#F5FAFF', '#EAF2FF', '#F3EEFF'],
    title: '#1D2433', accent: '#2F6FE4', muted: '#5B6475',
    orbs: ['#3A8DFF', '#7C5CFF', '#33C6FF'], orbAlpha: 0.26, glyph: '#2F6FE4', glow: '#2F6FE4',
  },
  dark: {
    background: ['#0B1020', '#101A33', '#15121C'],
    title: '#F3F6FC', accent: '#8DB9FF', muted: '#AAB4C5',
    orbs: ['#2F6FE4', '#7C5CFF', '#1FB6E8'], orbAlpha: 0.34, glyph: '#8DB9FF', glow: '#3D7BFF',
  },
};

// Stable easing functions: a new one per render would restart every loop.
const EASE = Easing.inOut(Easing.quad);
const EASE_SINE = Easing.inOut(Easing.sin);
const EASE_OUT = Easing.out(Easing.quad);
const EASE_SMOOTH = Easing.inOut(Easing.cubic);

// Campus and friendship cues that drift up around the logo while loading.
const GLYPHS = ['heart.fill', 'bubble.left.fill', 'graduationcap.fill', 'sparkles', 'star.fill', 'person.2.fill', 'heart.fill', 'sparkles'];
const WORD = ['Campus', 'Mate'];

function seeded(index, salt) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function withAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** A repeating 0→1 value; held at `rest` when motion is off. */
function useLoop(still, delay, duration, { reverse = false, easing = EASE, rest = 0 } = {}) {
  const value = useSharedValue(still ? rest : 0);
  useEffect(() => {
    if (still) { value.set(rest); return undefined; }
    value.set(withDelay(delay, withRepeat(withTiming(1, { duration, easing }), -1, reverse)));
    return () => cancelAnimation(value);
  }, [delay, duration, easing, rest, reverse, still, value]);
  return value;
}

function Orb({ color, alpha, size, x, y, index, still }) {
  const t = useLoop(still, index * 380, 5200 + index * 900, { reverse: true, easing: EASE_SINE, rest: 0.5 });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (t.get() - 0.5) * 44 }, { translateY: (0.5 - t.get()) * 32 }, { scale: 1 + t.get() * 0.08 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.orb, { width: size, height: size, borderRadius: size / 2, left: x - size / 2, top: y - size / 2 }, style]}>
      <LinearGradient colors={[withAlpha(color, alpha), withAlpha(color, 0)]} end={{ x: 0.5, y: 1 }} start={{ x: 0.5, y: 0 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

function PulseRing({ color, delay, still }) {
  const t = useLoop(still, delay, 2300, { easing: EASE_OUT });
  const style = useAnimatedStyle(() => ({
    opacity: still ? 0 : 0.42 * (1 - t.get()),
    transform: [{ scale: 0.92 + t.get() * 0.95 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color }, style]} />;
}

function FloatingGlyph({ index, cx, cy, color, still }) {
  const angle = (index / GLYPHS.length) * Math.PI * 2 + seeded(index, 1) * 0.6;
  const radius = 118 + seeded(index, 2) * 64;
  const size = 14 + Math.round(seeded(index, 3) * 8);
  const t = useLoop(still, 760 + index * 170, 2700 + seeded(index, 4) * 1300);
  const style = useAnimatedStyle(() => {
    const v = t.get();
    return {
      opacity: still ? 0 : interpolate(v, [0, 0.2, 0.75, 1], [0, 0.72, 0.5, 0]),
      transform: [{ translateY: -44 * v }, { translateX: Math.sin(v * Math.PI * 2) * 7 }, { scale: 0.8 + v * 0.3 }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.glyph, { left: cx + Math.cos(angle) * radius - size / 2, top: cy + Math.sin(angle) * radius * 0.82 - size / 2 }, style]}>
      <FeatureIcon color={color} name={GLYPHS[index]} size={size} />
    </Animated.View>
  );
}

function Letter({ char, index, color, still }) {
  const v = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) { v.set(1); return; }
    v.set(withDelay(560 + index * 38, withSpring(1, { damping: 13, stiffness: 190, mass: 0.7 })));
  }, [index, still, v]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, v.get()),
    transform: [{ translateY: (1 - v.get()) * 18 }, { rotate: `${(1 - v.get()) * -8}deg` }],
  }));
  return <Animated.View style={style}><Text style={[styles.wordmark, { color }]}>{char}</Text></Animated.View>;
}

function LoadingDots({ color, still }) {
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((index) => <Dot color={color} index={index} key={index} still={still} />)}
    </View>
  );
}

function Dot({ color, index, still }) {
  const t = useLoop(still, index * 160, 520, { reverse: true, rest: 1 });
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * t.get(), transform: [{ translateY: -4 * t.get() }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/**
 * Brand scene for launch and loading. `mode="intro"` plays the entrance from
 * the native splash frame; `mode="settled"` starts finished. `exit` (0→1) is
 * driven by the launch overlay.
 */
export default function LaunchScene({ mode = 'settled', isDark, fromColor, exit, hint, hintDelay = 700 }) {
  const reduceMotion = useReducedMotion();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const palette = isDark ? PALETTES.dark : PALETTES.light;
  const intro = mode === 'intro' && !reduceMotion;
  const still = reduceMotion;

  const background = useSharedValue(intro ? 0 : 1);
  const settle = useSharedValue(intro ? 0 : 1);
  const tilt = useSharedValue(0);
  const shine = useSharedValue(0);
  const tagline = useSharedValue(intro ? 0 : 1);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (!intro) return;
    background.set(withTiming(1, { duration: 450, easing: EASE_OUT }));
    settle.set(withDelay(140, withSpring(1, { damping: 15, stiffness: 120, mass: 0.9 })));
    tilt.set(withDelay(140, withSequence(
      withTiming(1, { duration: 260, easing: EASE_OUT }),
      withSpring(0, { damping: 9, stiffness: 140 }),
    )));
    shine.set(withDelay(720, withTiming(1, { duration: 760, easing: EASE_SMOOTH })));
    tagline.set(withDelay(980, withTiming(1, { duration: 420, easing: EASE_OUT })));
  }, [background, intro, settle, shine, tagline, tilt]);

  useEffect(() => {
    if (!hint) { setShowHint(false); return undefined; }
    const timer = setTimeout(() => setShowHint(true), hintDelay);
    return () => clearTimeout(timer);
  }, [hint, hintDelay]);

  const cx = size.width / 2;
  const cy = size.height / 2;
  const logoCenter = cy + SETTLED_OFFSET;

  const backgroundStyle = useAnimatedStyle(() => ({ opacity: background.get() }));
  const logoStyle = useAnimatedStyle(() => {
    const s = settle.get();
    const leaving = exit ? exit.get() : 0;
    return {
      opacity: 1 - leaving,
      transform: [
        { translateY: SETTLED_OFFSET * s - leaving * 24 },
        { perspective: 700 },
        { rotateX: `${tilt.get() * 16}deg` },
        { rotateY: `${tilt.get() * -10}deg` },
        { scale: (1 + (SETTLED_SCALE - 1) * s) * (1 + leaving * 0.22) },
      ],
    };
  });
  const shineStyle = useAnimatedStyle(() => ({
    opacity: shine.get() > 0 && shine.get() < 1 ? 1 : 0,
    transform: [{ translateX: interpolate(shine.get(), [0, 1], [-NATIVE_LOGO_SIZE, NATIVE_LOGO_SIZE]) }, { rotate: '18deg' }],
  }));
  const copyStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, (exit ? exit.get() : 0) * 1.8) }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: tagline.get(), transform: [{ translateY: (1 - tagline.get()) * 10 }] }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: 1 - (exit ? exit.get() : 0) }));

  const tileInset = NATIVE_LOGO_SIZE * TILE_INSET;
  const wordTop = cy + SETTLED_OFFSET + SETTLED_SIZE / 2 + 26;
  let letterIndex = 0;

  return (
    <View
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        if (width && height && (width !== size.width || height !== size.height)) setSize({ width, height });
      }}
      style={[styles.root, { backgroundColor: fromColor || palette.background[0] }]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, backgroundStyle]}>
        <LinearGradient colors={palette.background} end={{ x: 0.8, y: 1 }} start={{ x: 0.2, y: 0 }} style={StyleSheet.absoluteFill} />
        <Orb alpha={palette.orbAlpha} color={palette.orbs[0]} index={0} size={size.width * 1.1} still={still} x={size.width * 0.05} y={size.height * 0.12} />
        <Orb alpha={palette.orbAlpha} color={palette.orbs[1]} index={1} size={size.width * 0.95} still={still} x={size.width * 1.02} y={size.height * 0.5} />
        <Orb alpha={palette.orbAlpha} color={palette.orbs[2]} index={2} size={size.width * 1.2} still={still} x={size.width * 0.15} y={size.height * 0.98} />
        {GLYPHS.map((_, index) => (
          <FloatingGlyph color={withAlpha(palette.glyph, 0.75)} cx={cx} cy={logoCenter} index={index} key={index} still={still} />
        ))}
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.logo, { left: cx - NATIVE_LOGO_SIZE / 2, top: cy - NATIVE_LOGO_SIZE / 2 }, logoStyle]}>
        <PulseRing color={palette.accent} delay={intro ? 620 : 0} still={still} />
        <PulseRing color={palette.accent} delay={intro ? 1770 : 1150} still={still} />
        <View style={[styles.glow, { top: tileInset + 6, left: tileInset + 6, right: tileInset + 6, bottom: tileInset + 6, borderRadius: NATIVE_LOGO_SIZE * TILE_RADIUS, shadowColor: palette.glow }]} />
        <Image accessibilityIgnoresInvertColors contentFit="contain" source={APP_ICON} style={StyleSheet.absoluteFill} />
        <View style={[styles.tile, { top: tileInset, left: tileInset, right: tileInset, bottom: tileInset, borderRadius: NATIVE_LOGO_SIZE * TILE_RADIUS }]}>
          <Animated.View style={[styles.shine, shineStyle]}>
            <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} end={{ x: 1, y: 0.5 }} start={{ x: 0, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>
      </Animated.View>

      <Animated.View accessibilityLabel="CampusMate เพื่อนใหม่ในรั้วมหาวิทยาลัย" accessible style={[styles.copy, { top: wordTop }, copyStyle]}>
        <View importantForAccessibility="no-hide-descendants" style={styles.wordRow}>
          {WORD.map((part, partIndex) => [...part].map((char) => {
            const index = letterIndex++;
            return <Letter char={char} color={partIndex === 0 ? palette.title : palette.accent} index={index} key={index} still={!intro} />;
          }))}
        </View>
        <Animated.View importantForAccessibility="no-hide-descendants" style={taglineStyle}>
          <Text style={[styles.tagline, { color: palette.muted }]}>เพื่อนใหม่ในรั้วมหาวิทยาลัย</Text>
        </Animated.View>
      </Animated.View>

      {showHint ? (
        <Animated.View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={[styles.hint, { bottom: Math.max(insets.bottom, 16) + 40 }, hintStyle]}>
          <LoadingDots color={palette.accent} still={still} />
          <Text style={[styles.hintText, { color: palette.muted }]}>{hint}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  orb: { position: 'absolute', overflow: 'hidden' },
  glyph: { position: 'absolute' },
  logo: { position: 'absolute', width: NATIVE_LOGO_SIZE, height: NATIVE_LOGO_SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: NATIVE_LOGO_SIZE, height: NATIVE_LOGO_SIZE, borderRadius: NATIVE_LOGO_SIZE / 2, borderWidth: 2 },
  glow: { position: 'absolute', backgroundColor: '#2F6FE4', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.38, shadowRadius: 26, elevation: 14 },
  tile: { position: 'absolute', overflow: 'hidden' },
  shine: { position: 'absolute', top: -NATIVE_LOGO_SIZE * 0.3, bottom: -NATIVE_LOGO_SIZE * 0.3, left: NATIVE_LOGO_SIZE * 0.25, width: NATIVE_LOGO_SIZE * 0.32 },
  copy: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 6 },
  wordRow: { flexDirection: 'row' },
  wordmark: { fontSize: 32, fontWeight: '800', letterSpacing: -0.4 },
  tagline: { fontSize: 15, fontWeight: '500', textAlign: 'center' },
  hint: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 10 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hintText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
