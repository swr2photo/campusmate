import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MotiView } from 'moti';

/**
 * MotiPulseButton
 * A button that gently scales in and out with a breathing animation.
 * Ideal for "Call", "Like", or "Record Audio" actions.
 */
export default function MotiPulseButton({
  children,
  onPress,
  style,
  contentStyle,
  scaleMin = 0.96,
  scaleMax = 1.05,
  duration = 1200,
  active = true,
  disabled = false,
  accessibilityLabel,
  ...props
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
      {...props}
    >
      <MotiView
        from={{ scale: 1 }}
        animate={{
          scale: active && !disabled ? [scaleMin, scaleMax, scaleMin] : 1,
        }}
        transition={{
          type: 'timing',
          duration: duration,
          loop: active && !disabled,
        }}
        style={[styles.inner, contentStyle]}
      >
        {children}
      </MotiView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.94 }],
  },
});
