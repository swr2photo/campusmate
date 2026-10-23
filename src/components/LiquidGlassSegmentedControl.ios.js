import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { controlSize, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../theme';

/**
 * LiquidGlassSegmentedControl (iOS)
 * ─────────────────────────────────
 * Canonical Apple Liquid Glass segmented picker on iOS (Apple HIG & Landmarks spec).
 * - Matches Host height (38pt) to native segmented proportions without vertical dead-space.
 * - Supports theme-synchronized Dark/Light color schemes and accent tints.
 * - Aligns horizontally with standard 16pt screen padding without extraneous offsets.
 */
export default function LiquidGlassSegmentedControl({
  activeTab,
  onChangeTab,
  style,
  tabs = [],
  compact = false,
}) {
  const { colors, isDark } = useTheme();
  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  const flattenedStyle = StyleSheet.flatten(style) || {};
  const hostHeight = flattenedStyle.height ?? (compact ? 44 : 38);
  const isLarge = hostHeight >= 42;

  return (
    <View accessibilityRole="tablist" style={[styles.container, compact && { height: 44, marginVertical: 0 }, style]}>
      <Host
        colorScheme={isDark ? 'dark' : 'light'}
        seedColor={colors.primary}
        style={[styles.host, { height: hostHeight }]}
      >
        <Picker
          label="Segmented Selector"
          modifiers={
            isLarge
              ? [pickerStyle('segmented'), controlSize('large')]
              : [pickerStyle('segmented')]
          }
          onSelectionChange={(selection) => {
            if (selection && selection !== activeTab) {
              onChangeTab?.(selection);
            }
          }}
          selection={activeTab}
        >
          {tabs.map((tab) => {
            const badge =
              typeof tab.badgeCount === 'number' && tab.badgeCount > 0
                ? ` (${tab.badgeCount > 99 ? '99+' : tab.badgeCount})`
                : '';
            const title = `${tab.label}${badge}`;

            return (
              <Text key={tab.id} modifiers={[tag(tab.id)]}>
                {title}
              </Text>
            );
          })}
        </Picker>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'center',
    marginVertical: 4,
  },
  host: {
    width: '100%',
    height: 38,
  },
});
