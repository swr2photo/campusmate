import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme';

// Graceful import for expo-glass-effect (Apple Liquid Glass)
let GlassView = null;
let isLiquidGlassAvailable = () => false;
let isGlassEffectAPIAvailable = () => false;

try {
  const glassModule = require('expo-glass-effect');
  GlassView = glassModule.GlassView;
  if (typeof glassModule.isLiquidGlassAvailable === 'function') {
    isLiquidGlassAvailable = glassModule.isLiquidGlassAvailable;
  }
  if (typeof glassModule.isGlassEffectAPIAvailable === 'function') {
    isGlassEffectAPIAvailable = glassModule.isGlassEffectAPIAvailable;
  }
} catch {
  // Graceful fallback when native module is unavailable
}

/**
 * Checks whether Apple Liquid Glass is supported natively on this device.
 */
export function canUseLiquidGlass() {
  if (Platform.OS !== 'ios') return false;
  try {
    return Boolean(isLiquidGlassAvailable() && isGlassEffectAPIAvailable());
  } catch {
    return false;
  }
}

/**
 * LiquidGlassView
 *
 * Implements Apple Liquid Glass UI:
 * - On supported iOS: renders native `GlassView` with realistic refraction, highlights, and dynamic blur.
 * - On other platforms or older iOS: renders `BlurView` with material blur, tinted translucent surface,
 *   and specular highlight borders (rim lighting).
 * - When Reduce Transparency is enabled: renders an opaque solid surface according to Apple HIG.
 */
export default function LiquidGlassView({
  children,
  style,
  contentStyle,
  glassEffectStyle = 'regular', // 'regular' | 'clear' | 'none'
  tintColor,
  isInteractive = false,
  intensity,
  borderWidth = StyleSheet.hairlineWidth,
  specular = true,
  fallbackTint,
}) {
  const { colors, isDark } = useTheme();
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(Boolean(enabled));
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      (enabled) => setReduceTransparency(Boolean(enabled))
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  const flattenedStyle = StyleSheet.flatten(style) || {};
  const borderRadius = flattenedStyle.borderRadius ?? 20;
  const borderCurve = flattenedStyle.borderCurve ?? 'continuous';

  // HIG: If Reduce Transparency is enabled, render a solid accessible surface
  if (reduceTransparency) {
    return (
      <View
        style={[
          styles.base,
          {
            backgroundColor: isDark ? colors.card : colors.card,
            borderColor: colors.line,
            borderRadius,
            borderCurve,
            borderWidth,
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  // 1. Native Apple Liquid Glass (iOS 26+)
  if (canUseLiquidGlass() && GlassView) {
    // Note: HIG & Expo guidelines: DO NOT set overflow: 'hidden' on GlassView,
    // as it clips the specular rim highlight and press bulge.
    return (
      <GlassView
        colorScheme={isDark ? 'dark' : 'light'}
        glassEffectStyle={glassEffectStyle}
        isInteractive={isInteractive}
        style={[
          styles.base,
          {
            borderRadius,
            borderCurve,
          },
          style,
        ]}
        tintColor={tintColor}
      >
        <View style={[{ width: '100%', alignItems: 'center' }, contentStyle]}>{children}</View>
      </GlassView>
    );
  }

  // 2. Adaptive Apple Liquid Glass Fallback (BlurView + Specular Rim)
  const resolvedIntensity =
    typeof intensity === 'number'
      ? intensity
      : isDark
      ? 55
      : 75;

  const resolvedTint =
    fallbackTint ||
    (Platform.OS === 'ios'
      ? 'systemMaterial'
      : isDark
      ? 'dark'
      : 'light');

  const specularBorderColor = isDark
    ? 'rgba(255, 255, 255, 0.18)'
    : 'rgba(255, 255, 255, 0.75)';

  const glassOverlayColor = isDark
    ? 'rgba(28, 30, 36, 0.58)'
    : 'rgba(255, 255, 255, 0.45)';

  return (
    <View
      style={[
        styles.base,
        {
          borderRadius,
          borderCurve,
          borderWidth,
          borderColor: specular ? specularBorderColor : colors.line,
          overflow: 'hidden',
          backgroundColor: Platform.OS === 'android' ? (isDark ? 'rgba(30, 32, 38, 0.88)' : 'rgba(255, 255, 255, 0.88)') : 'transparent',
        },
        style,
      ]}
    >
      <BlurView
        intensity={resolvedIntensity}
        style={StyleSheet.absoluteFill}
        tint={resolvedTint}
      />
      {/* Specular sheen layer */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: glassOverlayColor,
          },
        ]}
      />
      <View style={[{ width: '100%', alignItems: 'center' }, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'relative',
  },
});
