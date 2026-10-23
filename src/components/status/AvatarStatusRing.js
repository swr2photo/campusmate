import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { STATUS_STYLES, StatusGlyph } from './AnimatedStatusBadge';

/**
 * Ring around an avatar that shows status: a rippling mint ring when online,
 * and a small badge (pencil, steaming cup, moon with Z's) for the others.
 * Wraps any avatar element passed as children.
 */
export default function AvatarStatusRing({ status, size = 48, children, ringWidth = 2.5 }) {
  const reduceMotion = useReducedMotion();
  const meta = status ? STATUS_STYLES[status] || STATUS_STYLES.online : null;
  const ripple = useSharedValue(0);
  useEffect(() => {
    if (status !== 'online' || reduceMotion) { ripple.set(0); return undefined; }
    ripple.set(withRepeat(withTiming(1, { duration: 1700, easing: Easing.out(Easing.quad) }), -1));
    return () => cancelAnimation(ripple);
  }, [reduceMotion, ripple, status]);
  const rippleStyle = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - ripple.get()), transform: [{ scale: 1 + ripple.get() * 0.22 }] }));
  const outer = size + ringWidth * 2 + 4;
  const badge = Math.max(18, Math.round(size * 0.38));
  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
      {meta ? (
        <>
          {status === 'online' ? <Animated.View style={[styles.ring, { width: outer, height: outer, borderRadius: outer, borderColor: meta.color, borderWidth: ringWidth }, rippleStyle]} /> : null}
          <View style={[styles.ring, { width: outer, height: outer, borderRadius: outer, borderColor: meta.color, borderWidth: ringWidth, opacity: status === 'offline' ? 0.5 : 1 }]} />
        </>
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>{children}</View>
      {meta && status !== 'online' ? (
        <View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2, backgroundColor: meta.color }]}>
          <StatusGlyph kind={status} size={Math.round(badge * 0.58)} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute' },
  badge: { position: 'absolute', right: -2, bottom: -2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
});
