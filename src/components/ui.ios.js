import React from 'react';
import { StyleSheet } from 'react-native';
import NativeButton from './NativeButton';
import NativeCard from './NativeCard';
import { useTheme } from '../theme';
export { Avatar, SectionTitle, getStyles } from './ui.js';

export function Card({ children, style }) {
  const { colors } = useTheme();
  return <NativeCard style={[{ backgroundColor: colors.card, borderRadius: 24 }, style]}>{children}</NativeCard>;
}

export function PrimaryButton({ label, icon, iconName, onPress, style, disabled = false, loading = false, compact = false }) {
  const { colors } = useTheme();
  return <NativeButton label={label} icon={iconName || icon} onPress={onPress} style={style}
    disabled={disabled} loading={loading} compact={compact} variant="borderedProminent"
    color={colors.primary} foregroundColor={colors.onPrimary} />;
}

// HIG "bordered" (tinted) button: the iOS counterpart of a Material tonal button.
export function TonalButton({ label, icon, iconName, onPress, style, disabled = false, compact = false }) {
  const { colors } = useTheme();
  return <NativeButton label={label} icon={iconName || icon} onPress={onPress} style={style}
    disabled={disabled} compact={compact} variant="bordered" color={colors.primary} />;
}

export function OutlineButton({ label, icon, iconName, onPress, style, danger = false, disabled = false, compact = false }) {
  const { colors } = useTheme();
  return <NativeButton label={label} icon={iconName || icon} onPress={onPress} style={style}
    disabled={disabled} compact={compact} variant="bordered" role={danger ? 'destructive' : undefined}
    color={danger ? colors.danger : colors.primary} />;
}

export function Chip({ label, icon, iconName, active = false, color, onPress, style }) {
  const { colors } = useTheme();
  const symbol = iconName || (typeof icon === 'string' && /^[a-z][a-z0-9.]+$/.test(icon) ? icon : undefined);
  const flat = StyleSheet.flatten(style) || {};
  return <NativeButton label={`${icon && !symbol ? `${icon} ` : ''}${label}`} icon={symbol}
    selected={active} disabled={!onPress} onPress={onPress} compact color={color || colors.primary}
    variant={active ? 'borderedProminent' : 'bordered'}
    style={[{ alignSelf: flat.width === '100%' ? 'stretch' : 'flex-start' }, style]} />;
}
