import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import FeatureIcon from './FeatureIcon';

export default function NativeButton({ label, accessibilityLabel, icon, iconOnly, onPress, disabled, loading, style, color, foregroundColor, variant, selected, role, compact, ...props }) {
  return <Pressable {...props} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}
    accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading}
    onPress={onPress} style={[{ minHeight: 48, minWidth: 44, justifyContent: 'center', alignItems: 'center' }, style]}>
    {loading ? <ActivityIndicator color={foregroundColor || color} /> : iconOnly
      ? <FeatureIcon name={icon} size={22} color={foregroundColor || color} />
      : <Text style={{ color: foregroundColor || color }}>{label}</Text>}
  </Pressable>;
}
