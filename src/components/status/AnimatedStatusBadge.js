import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';

export const STATUS_STYLES = {
  online: { color: '#34D399', icon: null, label: 'ออนไลน์' },
  studying: { color: '#5B8DEF', icon: 'pencil', label: 'กำลังอ่านหนังสือ' },
  cafe: { color: '#C77B4A', icon: 'cup.and.saucer.fill', label: 'อยู่ที่คาเฟ่' },
  sports: { color: '#FF8A3D', icon: 'basketball.fill', label: 'เล่นกีฬา' },
  running: { color: '#F25F5C', icon: 'figure.run', label: 'ออกไปวิ่ง' },
  offline: { color: '#9AA3B2', icon: 'moon.fill', label: 'ออฟไลน์' },
};

function useLoop(active, duration) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active) { t.set(0); return undefined; }
    t.set(withRepeat(withSequence(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration, easing: Easing.inOut(Easing.sin) }),
    ), -1));
    return () => cancelAnimation(t);
  }, [active, duration, t]);
  return t;
}

/** Small animated glyph for a status: ripple, wiggling pencil, steam, Z's. */
export function StatusGlyph({ kind = 'online', size = 14, color }) {
  const reduceMotion = useReducedMotion();
  const meta = STATUS_STYLES[kind] || STATUS_STYLES.online;
  const tint = color || meta.color;
  const t = useLoop(!reduceMotion, kind === 'online' ? 900 : kind === 'offline' ? 1400 : 600);
  const rippleStyle = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - t.get()), transform: [{ scale: 1 + t.get() * 1.4 }] }));
  const iconStyle = useAnimatedStyle(() => {
    const v = t.get();
    if (kind === 'studying') return { transform: [{ rotate: `${-14 + v * 28}deg` }, { translateX: -1 + v * 2 }] };
    if (kind === 'sports' || kind === 'running') return { transform: [{ translateY: -2.5 * v }] };
    return {};
  });
  const steamStyle = useAnimatedStyle(() => ({ opacity: 1 - t.get(), transform: [{ translateY: -5 * t.get() }] }));
  const zStyle = useAnimatedStyle(() => ({ opacity: 1 - t.get(), transform: [{ translateY: -7 * t.get() }, { translateX: 3 * t.get() }] }));

  if (kind === 'online') {
    const dot = Math.round(size * 0.62);
    return (
      <View style={[styles.glyph, { width: size, height: size }]}>
        <Animated.View style={[styles.abs, { width: dot, height: dot, borderRadius: dot, backgroundColor: tint }, rippleStyle]} />
        <View style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: tint }} />
      </View>
    );
  }
  return (
    <View style={[styles.glyph, { width: size, height: size }]}>
      {kind === 'cafe' ? (
        <Animated.View style={[styles.steamRow, { top: -size * 0.45 }, steamStyle]}>
          <View style={[styles.steam, { backgroundColor: tint }]} />
          <View style={[styles.steam, { height: 5, backgroundColor: tint }]} />
        </Animated.View>
      ) : null}
      {kind === 'offline' ? (
        <Animated.Text style={[styles.zzz, { color: tint, fontSize: size * 0.55, right: -size * 0.35, top: -size * 0.5 }, zStyle]}>z</Animated.Text>
      ) : null}
      <Animated.View style={iconStyle}>
        <FeatureIcon name={meta.icon} size={size} color={tint} />
      </Animated.View>
    </View>
  );
}

/** Frosted pill with a live glyph, e.g. “หาเพื่อนกินชาบูหลังเลิกเรียน”. */
export default function AnimatedStatusBadge({ kind = 'online', text, tone = 'onPhoto', style }) {
  const meta = STATUS_STYLES[kind] || STATUS_STYLES.online;
  const onPhoto = tone === 'onPhoto';
  return (
    <View
      accessible
      accessibilityLabel={text || meta.label}
      style={[styles.badge, { backgroundColor: onPhoto ? 'rgba(12,16,28,0.55)' : `${meta.color}22`, borderColor: onPhoto ? 'rgba(255,255,255,0.22)' : `${meta.color}55` }, style]}
    >
      <StatusGlyph kind={kind} size={13} color={onPhoto && kind !== 'online' ? '#FFFFFF' : undefined} />
      <Text numberOfLines={1} style={[styles.text, { color: onPhoto ? '#FFFFFF' : meta.color }]}>{text || meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  glyph: { alignItems: 'center', justifyContent: 'center' },
  steamRow: { position: 'absolute', flexDirection: 'row', gap: 2 },
  steam: { width: 1.5, height: 4, borderRadius: 1, opacity: 0.7 },
  zzz: { position: 'absolute', fontWeight: '900' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', minHeight: 28, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  text: { fontSize: 12, lineHeight: 17, fontWeight: '700', flexShrink: 1 },
});
