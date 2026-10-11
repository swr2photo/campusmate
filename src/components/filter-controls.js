import React from 'react';
import { View } from 'react-native';
import { Host, Slider, Switch } from '@expo/ui';
import { useTheme } from '../theme';

export function FilterSlider({ value, onValueChange, min, max, step = 1, disabled = false, testID, label }) {
  const { colors, isDark } = useTheme();
  return <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{ disabled }} accessibilityValue={{ min, max, now: value }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={({ nativeEvent }) => {
    if (disabled) return;
    if (nativeEvent.actionName === 'increment') onValueChange(Math.min(max, value + step));
    if (nativeEvent.actionName === 'decrement') onValueChange(Math.max(min, value - step));
  }}>
    <Host importantForAccessibility="no-hide-descendants" colorScheme={isDark ? 'dark' : 'light'} seedColor={colors.primary} ignoreSafeArea="all" style={{ width: '100%', height: 44 }}>
      <Slider value={value} onValueChange={onValueChange} min={min} max={max} step={step} disabled={disabled} testID={testID} />
    </Host>
  </View>;
}

export function FilterSwitch({ value, onValueChange, disabled = false, testID, label }) {
  const { colors, isDark } = useTheme();
  return <View accessible accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} onAccessibilityTap={() => { if (!disabled) onValueChange(!value); }} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={({ nativeEvent }) => { if (!disabled && nativeEvent.actionName === 'activate') onValueChange(!value); }}>
    <Host importantForAccessibility="no-hide-descendants" colorScheme={isDark ? 'dark' : 'light'} seedColor={colors.primary} ignoreSafeArea="all" style={{ width: 56, height: 38 }}>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} testID={testID} />
    </Host>
  </View>;
}
