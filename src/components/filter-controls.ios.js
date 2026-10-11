import React from 'react';
import { Host, Slider, Switch } from '@expo/ui';
import { accessibilityLabel, labelsHidden } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../theme';

export function FilterSlider({ value, onValueChange, min, max, step = 1, disabled = false, testID, label }) {
  const { colors, isDark } = useTheme();
  return <Host colorScheme={isDark ? 'dark' : 'light'} seedColor={colors.primary} ignoreSafeArea="all" style={{ width: '100%', height: 44 }}>
    <Slider value={value} onValueChange={onValueChange} min={min} max={max} step={step} disabled={disabled} testID={testID} modifiers={label ? [accessibilityLabel(label)] : []} />
  </Host>;
}

export function FilterSwitch({ value, onValueChange, disabled = false, testID, label }) {
  const { colors, isDark } = useTheme();
  return <Host colorScheme={isDark ? 'dark' : 'light'} seedColor={colors.primary} ignoreSafeArea="all" style={{ width: 56, height: 38 }}>
    <Switch value={value} onValueChange={onValueChange} disabled={disabled} testID={testID} label={label} modifiers={[labelsHidden(), ...(label ? [accessibilityLabel(label)] : [])]} />
  </Host>;
}
