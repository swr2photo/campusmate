import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import FeatureIcon from '../FeatureIcon';
import { WEATHER_THEMES } from '../../context/WeatherContext';

// Decorative, weather-reactive background for banners and the campus map.
// Every particle is positioned from a fixed seed, so re-renders never make
// the scene jump; Reduce Motion freezes everything in place.

function seeded(index, salt) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function useLoop(still, delay, build) {
  const value = useSharedValue(0);
  useEffect(() => {
    if (still) { value.set(0.5); return undefined; }
    value.set(0);
    value.set(withDelay(delay, build()));
    return () => cancelAnimation(value);
    // `build` is recreated each render but always describes the same loop.
  }, [delay, still, value]);
  return value;
}

function RainDrop({ index, width, height, still }) {
  const x = seeded(index, 1) * width;
  const length = 10 + seeded(index, 2) * 10;
  const duration = 650 + seeded(index, 3) * 450;
  const t = useLoop(still, seeded(index, 4) * 900, () => withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1));
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -length + t.get() * (height + length) }, { rotate: '12deg' }] }));
  return <Animated.View style={[styles.drop, { left: x, height: length }, style]} />;
}

function Ripple({ index, width, height, still }) {
  const t = useLoop(still, index * 700, () => withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1));
  const size = 26 + seeded(index, 5) * 18;
  const style = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - t.get()), transform: [{ scaleX: 0.3 + t.get() }, { scaleY: 0.3 + t.get() }] }));
  return <Animated.View style={[styles.ripple, { left: seeded(index, 6) * (width - size), top: height - 14 - seeded(index, 7) * 10, width: size, height: size * 0.32, borderRadius: size }, style]} />;
}

/** Water drops clinging to the top edge of a glass card. */
function GlassDroplet({ index, width }) {
  const size = 5 + seeded(index, 8) * 6;
  return (
    <View style={[styles.droplet, { left: 8 + seeded(index, 9) * (width - 24), top: 2 + seeded(index, 10) * 6, width: size, height: size * 1.2, borderRadius: size }]}>
      <View style={styles.dropletShine} />
    </View>
  );
}

function Sparkle({ index, width, height, still, color }) {
  const t = useLoop(still, index * 420, () => withRepeat(withSequence(
    withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }),
    withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }),
  ), -1));
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + t.get() * 0.75, transform: [{ scale: 0.6 + t.get() * 0.5 }, { rotate: `${t.get() * 45}deg` }] }));
  return (
    <Animated.View style={[styles.abs, { left: width * (0.45 + seeded(index, 11) * 0.5), top: height * seeded(index, 12) * 0.8 }, style]}>
      <FeatureIcon name="sparkle" size={10 + seeded(index, 13) * 8} color={color} />
    </Animated.View>
  );
}

function SunGlow({ width, still }) {
  const t = useLoop(still, 0, () => withRepeat(withSequence(
    withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
    withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
  ), -1));
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 0.92 + t.get() * 0.12 }] }));
  const size = Math.min(150, width * 0.4);
  return (
    <Animated.View style={[styles.abs, { right: -size * 0.25, top: -size * 0.35, width: size, height: size }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: size, backgroundColor: 'rgba(255,214,102,0.35)' }]} />
      <View style={[styles.abs, { left: size * 0.18, top: size * 0.18, width: size * 0.64, height: size * 0.64, borderRadius: size, backgroundColor: 'rgba(255,200,64,0.55)' }]} />
      <View style={[styles.abs, { left: size * 0.32, top: size * 0.32, width: size * 0.36, height: size * 0.36, borderRadius: size, backgroundColor: '#FFC940' }]} />
    </Animated.View>
  );
}

function Cloud({ index, width, height, still }) {
  const scale = 0.7 + seeded(index, 14) * 0.6;
  const duration = 14000 + seeded(index, 15) * 9000;
  const t = useLoop(still, 0, () => withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1));
  const start = seeded(index, 16);
  const style = useAnimatedStyle(() => {
    const progress = (start + t.get()) % 1;
    return { transform: [{ translateX: -90 * scale + progress * (width + 120 * scale) }] };
  });
  return (
    <Animated.View style={[styles.abs, { top: height * (0.08 + seeded(index, 17) * 0.4), opacity: 0.85 }, style]}>
      <View style={{ width: 70 * scale, height: 24 * scale, borderRadius: 14 * scale, backgroundColor: 'rgba(255,255,255,0.9)' }} />
      <View style={{ position: 'absolute', left: 14 * scale, top: -12 * scale, width: 30 * scale, height: 30 * scale, borderRadius: 15 * scale, backgroundColor: 'rgba(255,255,255,0.9)' }} />
      <View style={{ position: 'absolute', left: 34 * scale, top: -7 * scale, width: 24 * scale, height: 24 * scale, borderRadius: 12 * scale, backgroundColor: 'rgba(255,255,255,0.9)' }} />
    </Animated.View>
  );
}

function Leaf({ index, width, height, still }) {
  const duration = 4200 + seeded(index, 18) * 2600;
  const t = useLoop(still, seeded(index, 19) * 3000, () => withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1));
  const style = useAnimatedStyle(() => ({
    opacity: Math.sin(t.get() * Math.PI),
    transform: [
      { translateX: -20 + t.get() * (width * 0.7) },
      { translateY: t.get() * height * 0.7 + Math.sin(t.get() * Math.PI * 4) * 8 },
      { rotate: `${t.get() * 540}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.abs, { left: seeded(index, 20) * width * 0.3, top: -10 }, style]}>
      <FeatureIcon name="leaf.fill" size={12 + seeded(index, 21) * 6} color="#6FBF73" />
    </Animated.View>
  );
}

function Star({ index, width, height, still }) {
  const t = useLoop(still, seeded(index, 22) * 2000, () => withRepeat(withSequence(
    withTiming(1, { duration: 900 + seeded(index, 23) * 900 }),
    withTiming(0, { duration: 900 + seeded(index, 24) * 900 }),
  ), -1));
  const size = 2 + seeded(index, 25) * 2.5;
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + t.get() * 0.75 }));
  return <Animated.View style={[styles.star, { left: seeded(index, 26) * width, top: seeded(index, 27) * height * 0.55, width: size, height: size, borderRadius: size }, style]} />;
}

/** Campus buildings along the bottom with windows and street lamps lighting up. */
function NightSkyline({ width, height, still }) {
  const buildings = [0.0, 0.16, 0.3, 0.52, 0.68, 0.84].map((x, index) => ({
    left: x * width,
    w: width * (0.12 + seeded(index, 28) * 0.06),
    h: height * (0.22 + seeded(index, 29) * 0.22),
  }));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {buildings.map((building, index) => (
        <View key={index} style={[styles.building, { left: building.left, width: building.w, height: building.h }]}>
          {[0, 1, 2, 3].map((window) => (
            <NightWindow key={window} index={index * 4 + window} still={still} />
          ))}
        </View>
      ))}
      {[0.24, 0.62, 0.95].map((x, index) => (
        <View key={`lamp-${index}`} style={[styles.abs, { left: x * width - 8, bottom: 0, alignItems: 'center' }]}>
          <View style={styles.lampGlow} />
          <View style={styles.lampPost} />
        </View>
      ))}
    </View>
  );
}

function NightWindow({ index, still }) {
  const lit = seeded(index, 30) > 0.35;
  const t = useLoop(still || !lit, seeded(index, 31) * 4000, () => withRepeat(withSequence(
    withTiming(1, { duration: 600 }),
    withDelay(2400 + seeded(index, 32) * 3000, withTiming(0.55, { duration: 500 })),
  ), -1, true));
  const style = useAnimatedStyle(() => ({ opacity: lit ? 0.45 + t.get() * 0.55 : 0.12 }));
  return <Animated.View style={[styles.window, style]} />;
}

/**
 * @param {object} props
 * @param {'sunny'|'rainy'|'cloudy'|'night'} props.condition
 * @param {boolean} [props.dark] use the dark-mode gradient.
 * @param {'banner'|'map'} [props.density] fewer particles in small banners.
 * @param {boolean} [props.transparent] particles only, for overlaying content.
 */
export default function WeatherBackdrop({ condition = 'sunny', dark = false, density = 'banner', transparent = false, style, children }) {
  const reduceMotion = useReducedMotion();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const theme = WEATHER_THEMES[condition] || WEATHER_THEMES.sunny;
  const colors = dark || condition === 'night' ? theme.gradientDark : theme.gradient;
  const scale = density === 'map' ? 1.6 : 1;
  const { width, height } = box;
  const ready = width > 0 && height > 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent }) => setBox({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.clip, style]}
    >
      {transparent ? null : <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      {ready && condition === 'sunny' ? (
        <>
          <SunGlow width={width} still={reduceMotion} />
          {Array.from({ length: Math.round(5 * scale) }, (_, index) => <Sparkle key={index} index={index} width={width} height={height} still={reduceMotion} color="#FFFFFF" />)}
        </>
      ) : null}
      {ready && condition === 'rainy' ? (
        <>
          {Array.from({ length: Math.round(18 * scale) }, (_, index) => <RainDrop key={index} index={index} width={width} height={height} still={reduceMotion} />)}
          {Array.from({ length: 3 }, (_, index) => <Ripple key={index} index={index} width={width} height={height} still={reduceMotion} />)}
          {Array.from({ length: 6 }, (_, index) => <GlassDroplet key={index} index={index} width={width} />)}
        </>
      ) : null}
      {ready && condition === 'cloudy' ? (
        <>
          {Array.from({ length: 3 }, (_, index) => <Cloud key={index} index={index} width={width} height={height} still={reduceMotion} />)}
          {Array.from({ length: Math.round(4 * scale) }, (_, index) => <Leaf key={index} index={index} width={width} height={height} still={reduceMotion} />)}
        </>
      ) : null}
      {ready && condition === 'night' ? (
        <>
          {Array.from({ length: Math.round(14 * scale) }, (_, index) => <Star key={index} index={index} width={width} height={height} still={reduceMotion} />)}
          <NightSkyline width={width} height={height} still={reduceMotion} />
        </>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  abs: { position: 'absolute' },
  drop: { position: 'absolute', top: 0, width: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.75)' },
  ripple: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  droplet: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
  dropletShine: { position: 'absolute', top: 1, left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },
  star: { position: 'absolute', backgroundColor: '#FFF6D8' },
  building: { position: 'absolute', bottom: 0, backgroundColor: 'rgba(8,10,24,0.85)', borderTopLeftRadius: 4, borderTopRightRadius: 4, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', padding: 4, gap: 4 },
  window: { width: 6, height: 7, borderRadius: 1.5, backgroundColor: '#FFD66B' },
  lampGlow: { width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(255,214,107,0.55)', marginBottom: -4 },
  lampPost: { width: 2, height: 22, backgroundColor: 'rgba(8,10,24,0.9)' },
});
