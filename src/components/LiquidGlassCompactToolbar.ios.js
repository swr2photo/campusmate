import React from 'react';
import { View } from 'react-native';
import { Button, HStack, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled, frame, labelStyle, lineLimit, tint } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../theme';

// Native controls own the glass; no painted refraction/rim/blur imitation.
export default function LiquidGlassCompactToolbar({ query = '', placeholder = 'ค้นหากิจกรรมหรือสถานที่',
  onPressSearch, onClearSearch, onOpenMap, onCreateParty, style }) {
  const { colors, isDark } = useTheme();
  const iconModifiers = [buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'),
    labelStyle('iconOnly'), frame({ width: 48, height: 48 }), tint(colors.primary)];
  return <View style={[{ minHeight: 52, width: '100%' }, style]}>
    <Host colorScheme={isDark ? 'dark' : 'light'} matchContents={{ vertical: true }} style={{ minHeight: 52, width: '100%' }}>
      <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 52 })]}>
        <Button label={query || placeholder} systemImage="magnifyingglass" onPress={onPressSearch}
          modifiers={[buttonStyle('glass'), buttonBorderShape('capsule'), controlSize('large'),
            frame({ maxWidth: Infinity, minHeight: 48 }), lineLimit(1), disabled(!onPressSearch),
            accessibilityLabel('ค้นหาหรือเลื่อนกลับไปด้านบน')]} />
        {query ? <Button label="ล้างคำค้นหา" systemImage="xmark" onPress={onClearSearch} modifiers={[...iconModifiers, disabled(!onClearSearch)]} /> : null}
        {onOpenMap ? <Button label="เปิดแผนที่วิทยาเขต" systemImage="map.fill" onPress={onOpenMap} modifiers={iconModifiers} /> : null}
        {onCreateParty ? <Button label="สร้างตี้กิจกรรมใหม่" systemImage="plus" onPress={onCreateParty} modifiers={iconModifiers} /> : null}
      </HStack>
    </Host>
  </View>;
}
