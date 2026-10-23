import React from 'react';
import NativeButton from './NativeButton';
import { useTheme } from '../theme';
export { IosLikeScreen, IosLikeHeader, IosLikeCard, IosLikeSectionTitle, IosLikeAvatar, getAndroidSymbol } from './iosLike.js';

export function IconButton({ icon, onPress, tintColor, accessibilityLabel, style, size = 20 }) {
  const { colors } = useTheme();
  return <NativeButton label={accessibilityLabel || icon} icon={icon} onPress={onPress}
    accessibilityLabel={accessibilityLabel || icon} disabled={!onPress} iconOnly
    variant="glass" color={tintColor || colors.primary}
    style={[{ width: Math.max(48, size + 24), height: Math.max(48, size + 24) }, style]} />;
}

export function IosLikePill({ children, active = false, color, onPress, style, icon }) {
  const { colors } = useTheme();
  const symbol = icon && /^[a-z][a-z0-9.]+$/.test(icon) ? icon : undefined;
  return <NativeButton label={`${icon && !symbol ? `${icon} ` : ''}${children}`}
    icon={symbol} onPress={onPress} disabled={!onPress} selected={active}
    color={color || colors.primary} variant={active ? 'borderedProminent' : 'bordered'}
    style={[{ alignSelf: 'flex-start' }, style]} compact />;
}
