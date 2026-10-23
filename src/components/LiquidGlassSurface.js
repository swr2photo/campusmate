import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { Pressable } from './NativePressable';
import FeatureIcon from './FeatureIcon';
import { canUseLiquidGlass } from './LiquidGlassView';
import { useTheme } from '../theme';

// iOS 26 Liquid Glass for the functional layer only (Apple HIG Materials):
// sheets, dialogs and controls floating above content. Cards, list rows,
// message bubbles and in-content buttons stay opaque.

let GlassView = null;
try {
  GlassView = require('expo-glass-effect').GlassView;
} catch {
  // Native module missing (Expo Go / web): every helper falls back to opaque.
}

/** iOS 26+ with the native glass API. Resolved once; the OS cannot change at runtime. */
export const LIQUID_GLASS_AVAILABLE = Platform.OS === 'ios' && Boolean(GlassView) && canUseLiquidGlass();

let reduceTransparency = false;
let watching = false;
const listeners = new Set();

function watchReduceTransparency() {
  if (watching || !LIQUID_GLASS_AVAILABLE) return;
  watching = true;
  const publish = (enabled) => {
    reduceTransparency = Boolean(enabled);
    listeners.forEach((listener) => listener(reduceTransparency));
  };
  AccessibilityInfo.isReduceTransparencyEnabled().then(publish).catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', publish);
}

/** True when Liquid Glass should be drawn: iOS 26+ and Reduce Transparency off. */
export function useLiquidGlass() {
  const [reduced, setReduced] = useState(reduceTransparency);
  useEffect(() => {
    if (!LIQUID_GLASS_AVAILABLE) return undefined;
    watchReduceTransparency();
    listeners.add(setReduced);
    setReduced(reduceTransparency);
    return () => {
      listeners.delete(setReduced);
    };
  }, []);
  return LIQUID_GLASS_AVAILABLE && !reduced;
}

/** `#RRGGBB` + alpha -> `rgba()`. Other color formats are returned unchanged. */
export function withAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!match) return color;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/**
 * Tint for sheet and dialog glass. Large surfaces carry text over whatever is
 * behind them, so they keep part of the page color for legibility.
 */
export function useSheetGlassTint() {
  const { colors } = useTheme();
  return withAlpha(colors.canvas, 0.42);
}

/**
 * Glass layer drawn behind a surface's content. Renders nothing where glass is
 * unavailable, so the caller keeps its opaque background (use `useLiquidGlass`
 * to make that background transparent only when this layer is drawn). Pass the
 * surface's corner radii in `style`.
 */
export function GlassBackground({ colorScheme, style, tintColor, variant = 'regular', interactive = false }) {
  const enabled = useLiquidGlass();
  const { isDark } = useTheme();
  if (!enabled) return null;
  return (
    <GlassView
      // Media screens (camera, viewer, call) pass 'dark': their white glyphs
      // need dark glass regardless of the app theme.
      colorScheme={colorScheme || (isDark ? 'dark' : 'light')}
      glassEffectStyle={variant}
      isInteractive={interactive}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      tintColor={tintColor}
    />
  );
}

/**
 * Circular control for the floating layer (close, back, share, overlay
 * actions). Glass on iOS 26; elsewhere the given fallback fill.
 */
export function GlassIconButton({
  accessibilityLabel,
  colorScheme,
  disabled = false,
  fallbackBackgroundColor,
  hitSlop = 6,
  icon,
  iconColor,
  iconSize = 18,
  onPress,
  prominent = false,
  size = 44,
  style,
}) {
  const glass = useLiquidGlass();
  const { colors } = useTheme();
  const foreground = iconColor || (prominent ? colors.onPrimary : colors.ink);
  const fallback = fallbackBackgroundColor ?? (prominent ? colors.primary : colors.surfaceRaised);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        styles.circle,
        { backgroundColor: glass ? 'transparent' : fallback, borderRadius: size / 2, height: size, width: size },
        style,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <GlassBackground colorScheme={colorScheme} style={{ borderRadius: size / 2 }} tintColor={prominent ? colors.primary : undefined} />
      <FeatureIcon color={foreground} name={icon} size={iconSize} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
});
