import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme';

const TOUCH_SIZE = 48;
const THUMB_SIZE = 26;

function clamp(value, lower, upper) {
  'worklet';
  return Math.min(upper, Math.max(lower, value));
}

function integerOr(value, fallback) {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeRange(minValue, maxValue, min, max) {
  const lower = integerOr(min, 18);
  const upper = Math.max(lower, integerOr(max, 60));
  const high = clamp(integerOr(maxValue, upper), lower, upper);
  const low = clamp(integerOr(minValue, lower), lower, high);
  return { lower, upper, low, high };
}

function valueOffset(value, lower, upper, trackWidth) {
  'worklet';
  return upper > lower ? ((clamp(value, lower, upper) - lower) / (upper - lower)) * trackWidth : 0;
}

function consumeControlledUpdate(value, previousValue, pendingValues) {
  if (value === previousValue) return 'unchanged';
  const echoIndex = pendingValues.lastIndexOf(value);
  if (echoIndex >= 0) {
    pendingValues.splice(0, echoIndex + 1);
    return 'echo';
  }
  pendingValues.length = 0;
  return 'external';
}

export default function AgeRangeSlider({ minValue, maxValue, onChangeMin, onChangeMax, min, max, disabled = false }) {
  const { colors } = useTheme();
  const { lower, upper, low, high } = normalizeRange(minValue, maxValue, min, max);
  const inactive = disabled || lower === upper;
  const lowAge = useSharedValue(low);
  const highAge = useSharedValue(high);
  const trackWidth = useSharedValue(0);
  const activeThumb = useSharedValue(0);
  const startAge = useSharedValue(0);
  const dragWidth = useSharedValue(0);
  const interaction = useSharedValue(0);
  const reported = useRef({ low, high });
  const pending = useRef({ low: [], high: [] });
  const controlled = useRef({ low, high, lower, upper });

  const reportMin = useCallback((value, token) => {
    if (token != null && token !== interaction.get()) return;
    if (reported.current.low === value) return;
    reported.current.low = value;
    pending.current.low.push(value);
    onChangeMin?.(value);
  }, [onChangeMin, interaction]);
  const reportMax = useCallback((value, token) => {
    if (token != null && token !== interaction.get()) return;
    if (reported.current.high === value) return;
    reported.current.high = value;
    pending.current.high.push(value);
    onChangeMax?.(value);
  }, [onChangeMax, interaction]);

  useEffect(() => {
    const lowUpdate = consumeControlledUpdate(low, controlled.current.low, pending.current.low);
    const highUpdate = consumeControlledUpdate(high, controlled.current.high, pending.current.high);
    const boundsChanged = lower !== controlled.current.lower || upper !== controlled.current.upper;
    const external = lowUpdate === 'external' || highUpdate === 'external' || boundsChanged || inactive;
    if (external) {
      // An authoritative reset cancels this drag and invalidates queued callbacks.
      activeThumb.set(0);
      interaction.set(interaction.get() + 1);
      pending.current.low.length = 0;
      pending.current.high.length = 0;
    }
    const active = activeThumb.get();
    // Keep the thumb continuous while normal integer echoes are still arriving.
    if (active !== 1 && !pending.current.low.length) {
      lowAge.set(low);
      reported.current.low = low;
    }
    if (active !== 2 && !pending.current.high.length) {
      highAge.set(high);
      reported.current.high = high;
    }
    lowAge.set(clamp(lowAge.get(), lower, highAge.get()));
    highAge.set(clamp(highAge.get(), lowAge.get(), upper));
    controlled.current = { low, high, lower, upper };
  }, [low, high, lower, upper, inactive, activeThumb, lowAge, highAge, interaction]);

  // Only publish an age when its integer step changes, not on every frame.
  useAnimatedReaction(
    () => {
      const active = activeThumb.get();
      return { active, value: Math.round(active === 1 ? lowAge.get() : highAge.get()), token: interaction.get() };
    },
    (current, previous) => {
      if (!current.active || (previous?.active === current.active && previous.value === current.value)) return;
      if (current.active === 1) scheduleOnRN(reportMin, current.value, current.token);
      else scheduleOnRN(reportMax, current.value, current.token);
    },
    [reportMin, reportMax],
  );

  const pan = useMemo(() => Gesture.Pan()
    .enabled(!inactive)
    .maxPointers(1)
    .activeOffsetX([-2, 2])
    .failOffsetY([-10, 10])
    .onStart((event) => {
      const width = trackWidth.get();
      if (width <= 0) return;
      const lowX = valueOffset(lowAge.get(), lower, upper, width);
      const highX = valueOffset(highAge.get(), lower, upper, width);
      const touchX = event.x - event.translationX - (TOUCH_SIZE / 2);
      // At the same age, dragging left chooses the minimum; right chooses maximum.
      const thumb = Math.abs(highX - lowX) < 1
        ? (event.translationX < 0 ? 1 : 2)
        : (touchX < (lowX + highX) / 2 ? 1 : 2);
      interaction.set(interaction.get() + 1);
      activeThumb.set(thumb);
      startAge.set(thumb === 1 ? lowAge.get() : highAge.get());
      dragWidth.set(width);
    })
    .onUpdate((event) => {
      const width = dragWidth.get();
      const active = activeThumb.get();
      if (width <= 0 || !active) return;
      const value = startAge.get() + (event.translationX / width) * (upper - lower);
      if (active === 1) lowAge.set(clamp(value, lower, Math.floor(highAge.get())));
      else highAge.set(clamp(value, Math.ceil(lowAge.get()), upper));
    })
    .onFinalize(() => {
      const active = activeThumb.get();
      const value = Math.round(active === 1 ? lowAge.get() : highAge.get());
      if (active === 1) {
        lowAge.set(value);
        scheduleOnRN(reportMin, value, interaction.get());
      } else if (active === 2) {
        highAge.set(value);
        scheduleOnRN(reportMax, value, interaction.get());
      }
      activeThumb.set(0);
    }), [inactive, lower, upper, trackWidth, lowAge, highAge, activeThumb, startAge, dragWidth, interaction, reportMin, reportMax]);

  const activeTrackStyle = useAnimatedStyle(() => {
    const left = valueOffset(lowAge.get(), lower, upper, trackWidth.get());
    const right = valueOffset(highAge.get(), lower, upper, trackWidth.get());
    return { width: Math.max(0, right - left), transform: [{ translateX: left }] };
  });
  const minThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: valueOffset(lowAge.get(), lower, upper, trackWidth.get()) }],
    zIndex: activeThumb.get() === 1 ? 2 : 1,
  }));
  const maxThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: valueOffset(highAge.get(), lower, upper, trackWidth.get()) }],
    zIndex: activeThumb.get() === 2 ? 2 : 1,
  }));

  const adjustMin = ({ nativeEvent: { actionName } }) => {
    if (inactive || !['increment', 'decrement'].includes(actionName)) return;
    const value = clamp(Math.round(lowAge.get()) + (actionName === 'increment' ? 1 : -1), lower, Math.floor(highAge.get()));
    lowAge.set(value);
    reportMin(value);
  };
  const adjustMax = ({ nativeEvent: { actionName } }) => {
    if (inactive || !['increment', 'decrement'].includes(actionName)) return;
    const value = clamp(Math.round(highAge.get()) + (actionName === 'increment' ? 1 : -1), Math.ceil(lowAge.get()), upper);
    highAge.set(value);
    reportMax(value);
  };

  return <GestureDetector gesture={pan}>
    <View
      accessible={false}
      onLayout={({ nativeEvent: { layout } }) => trackWidth.set(Math.max(0, layout.width - TOUCH_SIZE))}
      style={[styles.slider, inactive && styles.disabled]}
    >
      <View pointerEvents="none" style={[styles.track, { right: TOUCH_SIZE / 2, backgroundColor: colors.surfaceRaised }]} />
      <Animated.View pointerEvents="none" style={[styles.track, { backgroundColor: colors.primary }, activeTrackStyle]} />
      <Animated.View
        accessible
        accessibilityLabel="อายุขั้นต่ำ"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: inactive }}
        accessibilityValue={{ min: lower, max: high, now: low, text: `${low} ปี` }}
        accessibilityActions={[{ name: 'increment', label: 'เพิ่มอายุขั้นต่ำ' }, { name: 'decrement', label: 'ลดอายุขั้นต่ำ' }]}
        onAccessibilityAction={adjustMin}
        style={[styles.touchTarget, minThumbStyle]}
      ><View style={[styles.thumb, { borderColor: colors.line }]} /></Animated.View>
      <Animated.View
        accessible
        accessibilityLabel="อายุสูงสุด"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: inactive }}
        accessibilityValue={{ min: low, max: upper, now: high, text: `${high} ปี` }}
        accessibilityActions={[{ name: 'increment', label: 'เพิ่มอายุสูงสุด' }, { name: 'decrement', label: 'ลดอายุสูงสุด' }]}
        onAccessibilityAction={adjustMax}
        style={[styles.touchTarget, maxThumbStyle]}
      ><View style={[styles.thumb, { borderColor: colors.line }]} /></Animated.View>
    </View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  slider: { width: '100%', height: TOUCH_SIZE },
  disabled: { opacity: 0.45 },
  track: { position: 'absolute', left: TOUCH_SIZE / 2, top: (TOUCH_SIZE - 4) / 2, height: 4, borderRadius: 2 },
  touchTarget: { position: 'absolute', left: 0, top: 0, width: TOUCH_SIZE, height: TOUCH_SIZE, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_SIZE / 2, borderWidth: StyleSheet.hairlineWidth, backgroundColor: '#FFFFFF', boxShadow: '0 2px 5px rgba(0,0,0,0.17)' },
});
