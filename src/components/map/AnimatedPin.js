import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Pressable } from '../NativePressable';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { motion } from '../../theme';

export const PIN_SIZE = 46;
export const PIN_SELECTED_SIZE = 60;
const CALLOUT_MAX = 200;

export const PIN_KINDS = {
  cafe: { icon: 'cup.and.saucer.fill', color: '#C77B4A', label: 'คาเฟ่' },
  sports: { icon: 'basketball.fill', color: '#FF8A3D', label: 'กีฬา' },
  gym: { icon: 'dumbbell.fill', color: '#7B6CF6', label: 'ฟิตเนส' },
  running: { icon: 'figure.run', color: '#F25F5C', label: 'วิ่ง' },
  study: { icon: 'book.fill', color: '#3D7BD9', label: 'อ่านหนังสือ' },
  chill: { icon: 'leaf.fill', color: '#2FA36B', label: 'พักผ่อน' },
  appointment: { icon: 'calendar', color: '#E5484D', label: 'นัดของฉัน' },
};

function useLoop(active, build) {
  const value = useSharedValue(0);
  useEffect(() => {
    if (!active) { value.set(0); return undefined; }
    value.set(build());
    return () => cancelAnimation(value);
    // `build` always describes the same loop for a kind.
  }, [active, value]);
  return value;
}

/** Icon that acts out its place: steam over coffee, a bouncing ball, a turning page. */
function PinGlyph({ kind, color, animate }) {
  const t = useLoop(animate, () => withRepeat(withSequence(
    withTiming(1, { duration: kind === 'sports' ? 380 : 900, easing: kind === 'sports' ? Easing.out(Easing.quad) : Easing.inOut(Easing.sin) }),
    withTiming(0, { duration: kind === 'sports' ? 320 : 900, easing: kind === 'sports' ? Easing.in(Easing.quad) : Easing.inOut(Easing.sin) }),
  ), -1));
  const glyphStyle = useAnimatedStyle(() => {
    const v = t.get();
    if (kind === 'sports') return { transform: [{ translateY: -6 * v }, { scaleY: 1 - (1 - v) * 0.12 }] };
    if (kind === 'chill') return { transform: [{ rotate: `${-12 + v * 24}deg` }] };
    if (kind === 'running' || kind === 'gym') return { transform: [{ translateY: -3 * v }] };
    return {};
  });
  const steamStyle = useAnimatedStyle(() => ({ opacity: 1 - t.get(), transform: [{ translateY: -8 * t.get() }] }));
  const pageStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: 1 - t.get() * 2 }] }));
  const meta = PIN_KINDS[kind] || PIN_KINDS.chill;
  return (
    <View style={styles.glyphBox}>
      {kind === 'cafe' ? (
        <Animated.View style={[styles.steamRow, steamStyle]}>
          <View style={[styles.steam, { backgroundColor: color }]} />
          <View style={[styles.steam, { height: 7, backgroundColor: color }]} />
        </Animated.View>
      ) : null}
      <Animated.View style={glyphStyle}>
        <FeatureIcon name={meta.icon} size={20} color={color} />
      </Animated.View>
      {kind === 'study' ? <Animated.View style={[styles.page, pageStyle]} /> : null}
    </View>
  );
}

/**
 * Map pin: a 46 × 46 bubble that springs to 60 when selected. Appointment
 * pins show the other person's avatar with a soft pulse.
 */
export default function AnimatedPin({ x, y, kind = 'chill', label, count = 1, avatarUri, selected, onPress, dark }) {
  const reduceMotion = useReducedMotion();
  const meta = PIN_KINDS[kind] || PIN_KINDS.chill;
  const scale = useSharedValue(1);
  const pulse = useSharedValue(0);
  useEffect(() => {
    const target = selected ? PIN_SELECTED_SIZE / PIN_SIZE : 1;
    scale.set(reduceMotion ? target : withSpring(target, motion.spring.bouncy));
  }, [reduceMotion, scale, selected]);
  useEffect(() => {
    if (reduceMotion || kind !== 'appointment') return undefined;
    pulse.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1));
    return () => cancelAnimation(pulse);
  }, [kind, pulse, reduceMotion]);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -(scale.get() - 1) * PIN_SIZE * 0.5 }, { scale: scale.get() }] }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - pulse.get()), transform: [{ scale: 1 + pulse.get() * 0.6 }] }));
  return (
    <View pointerEvents="box-none" style={[styles.anchor, { left: x - PIN_SIZE / 2, top: y - PIN_SIZE - 8, zIndex: selected ? 20 : 2 }]}>
      {selected && label ? (
        <View pointerEvents="none" style={styles.callout}>
          <View style={[styles.calloutBubble, { backgroundColor: dark ? '#1F2433' : '#FFFFFF', borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}>
            {/* Long Thai place names wrap instead of being cut off. */}
            <Text numberOfLines={2} style={[styles.calloutText, { color: dark ? '#FFFFFF' : '#1C1C22' }]}>{label}</Text>
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}${count > 1 ? ` และอีก ${count - 1} จุด` : ''}`}
        accessibilityState={{ selected }}
        hitSlop={6}
        onPress={onPress}
      >
        <Animated.View style={bubbleStyle}>
          {kind === 'appointment' ? <Animated.View style={[styles.pulse, { borderColor: meta.color }, pulseStyle]} /> : null}
          <View style={[styles.bubble, { borderColor: selected ? meta.color : '#FFFFFF', backgroundColor: dark ? '#252B3B' : '#FFFFFF' }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
            ) : (
              <PinGlyph kind={kind} color={meta.color} animate={!reduceMotion} />
            )}
          </View>
          <View style={[styles.tip, { borderTopColor: selected ? meta.color : '#FFFFFF' }]} />
          {count > 1 ? (
            <View style={[styles.count, { backgroundColor: meta.color }]}><Text style={styles.countText}>{count}</Text></View>
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', width: PIN_SIZE, alignItems: 'center' },
  bubble: {
    width: PIN_SIZE, height: PIN_SIZE, borderRadius: PIN_SIZE / 2, borderWidth: 3, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  avatar: { width: '100%', height: '100%' },
  tip: { alignSelf: 'center', width: 0, height: 0, marginTop: -2, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  pulse: { position: 'absolute', width: PIN_SIZE, height: PIN_SIZE, borderRadius: PIN_SIZE / 2, borderWidth: 3 },
  count: { position: 'absolute', top: -4, right: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  countText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  // A fixed-width, transparent wrapper centres the bubble over the pin.
  callout: { position: 'absolute', bottom: PIN_SELECTED_SIZE + 14, left: (PIN_SIZE - CALLOUT_MAX) / 2, width: CALLOUT_MAX, alignItems: 'center' },
  calloutBubble: { maxWidth: CALLOUT_MAX, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  calloutText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  glyphBox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  steamRow: { position: 'absolute', top: -6, flexDirection: 'row', gap: 3 },
  steam: { width: 2, height: 5, borderRadius: 1, opacity: 0.6 },
  page: { position: 'absolute', right: 4, top: 8, width: 7, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.9)', transformOrigin: '0% 50%' },
});
