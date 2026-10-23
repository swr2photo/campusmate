import React, { useCallback, useEffect, useRef } from 'react';
import Animated, { FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { motion } from '../../theme';

// A resting finger shrinks the card only after this long, so cards stay
// still while the list scrolls under a passing touch.
const PRESS_DELAY_MS = 60;
// Items past this index mount while scrolling and appear without a delay.
const STAGGER_LIMIT = 8;
const STAGGER_STEP_MS = 45;

/**
 * Scales its content down slightly while pressed. Touch events bubble up from
 * the native pressable inside, so the press itself stays the platform's own.
 */
export function PressScale({ children, style, scale = 0.97 }) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const timer = useRef(null);
  const release = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    pressed.set(withSpring(0, motion.spring.snappy));
  }, [pressed]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 - (1 - scale) * pressed.get() }] }));
  if (reduceMotion) return <Animated.View style={style}>{children}</Animated.View>;
  return (
    <Animated.View
      onTouchCancel={release}
      onTouchEnd={release}
      onTouchStart={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => pressed.set(withSpring(1, motion.spring.snappy)), PRESS_DELAY_MS);
      }}
      style={[style, animated]}
    >
      {children}
    </Animated.View>
  );
}

/** Fades content up into place, one list item after another. */
export function StaggerIn({ children, index = 0, style }) {
  const reduceMotion = useReducedMotion();
  const delay = index < STAGGER_LIMIT ? index * STAGGER_STEP_MS : 0;
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.delay(delay).duration(motion.duration.slow)} style={style}>
      {children}
    </Animated.View>
  );
}
