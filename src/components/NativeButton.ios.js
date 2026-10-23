import React, { useContext } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { Button, Host, HStack, ProgressView, Text } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, accessibilityLabel as nativeLabel, buttonBorderShape, buttonStyle, controlSize, disabled as nativeDisabled, font, foregroundStyle, frame, labelStyle, padding, tint } from '@expo/ui/swift-ui/modifiers';
import NativeInteractionContext from './NativeInteractionContext';
import GestureButton from './NativeButton.js';

// Text/icon controls use actual SwiftUI labels, Dynamic Type and button roles.
export default function NativeButton({ label, accessibilityLabel, icon, onPress, disabled = false,
  loading = false, style, variant = 'bordered', color = '#2869C7', foregroundColor,
  iconOnly = false, selected = false, role, compact = false }) {
  const colorScheme = useColorScheme();
  const insideGestureSurface = useContext(NativeInteractionContext);
  const symbol = typeof icon === 'string' && /^[a-z][a-z0-9.]*$/.test(icon) ? icon : undefined;
  const visibleLabel = icon && !symbol ? (iconOnly ? String(icon) : `${icon} ${label}`) : label;
  const flat = StyleSheet.flatten(style) || {};
  const fixedWidth = Number.isFinite(flat.width) ? Math.max(44, flat.width) : undefined;
  const intrinsic = !fixedWidth && (flat.alignSelf === 'flex-start' || iconOnly);
  const fixedHeight = Number.isFinite(flat.height) ? Math.max(44, flat.height) : undefined;
  const minHeight = Math.max(44, Number(flat.minHeight) || (compact ? 44 : 48));
  if (insideGestureSurface) return <GestureButton label={label} accessibilityLabel={accessibilityLabel}
    icon={icon} iconOnly={iconOnly} onPress={onPress} disabled={disabled} loading={loading}
    color={color} foregroundColor={foregroundColor} style={[style, { minHeight, minWidth: 44,
      borderRadius: 24, backgroundColor: variant === 'borderedProminent' ? color : flat.backgroundColor }]} />;
  const modifiers = [
    buttonStyle(variant), buttonBorderShape(iconOnly ? 'circle' : 'capsule'),
    controlSize('large'), tint(color), nativeDisabled(disabled || loading),
    nativeLabel(accessibilityLabel || label),
    frame({ ...(fixedWidth ? { width: fixedWidth } : intrinsic ? { minWidth: 44 } : { maxWidth: Infinity }),
      ...(fixedHeight ? { height: fixedHeight } : { minHeight }) }),
    ...(foregroundColor ? [foregroundStyle(foregroundColor)] : []),
    ...(iconOnly && symbol ? [labelStyle('iconOnly')] : []),
    ...(selected ? [accessibilityAddTraits(['isSelected'])] : []),
  ];
  // The explicit Yoga minimum prevents zero-height hosts; SwiftUI may grow
  // vertically for Dynamic Type instead of clipping an enlarged Thai label.
  return <View style={[style, { minHeight, minWidth: 44, backgroundColor: 'transparent', borderWidth: 0, shadowOpacity: 0 }]}>
    <Host colorScheme={colorScheme} matchContents={intrinsic ? true : { vertical: !fixedHeight }}
      style={{ ...(!intrinsic ? { width: '100%' } : {}), ...(fixedHeight ? { height: fixedHeight } : { minHeight }) }}>
      <Button label={loading ? undefined : visibleLabel} systemImage={symbol} role={role}
        onPress={onPress} modifiers={modifiers}>
        {loading ? <HStack spacing={8} modifiers={[padding({ horizontal: 12, vertical: 8 })]}>
          <ProgressView />
          <Text modifiers={[font({ size: 17 }), ...(foregroundColor ? [foregroundStyle(foregroundColor)] : [])]}>{label}</Text>
        </HStack> : undefined}
      </Button>
    </Host>
  </View>;
}
