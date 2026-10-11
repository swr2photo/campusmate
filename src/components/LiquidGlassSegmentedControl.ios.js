import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

/**
 * LiquidGlassSegmentedControl (iOS)
 * ─────────────────────────────────
 * Real native Apple SwiftUI segmented picker on iOS.
 * - Stretches with explicit height in Host to prevent collapse.
 * - Native iOS 18 liquid glass sliding interaction and haptics.
 */
export default function LiquidGlassSegmentedControl({
  activeTab,
  onChangeTab,
  style,
  tabs = [],
}) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  const flattenedStyle = StyleSheet.flatten(style) || {};
  const hostHeight = flattenedStyle.height ?? 34;

  return (
    <View style={[styles.container, style]}>
      <Host style={[styles.host, { height: hostHeight }]}>
        <Picker
          label="Segmented Selector"
          modifiers={[pickerStyle('segmented')]}
          onSelectionChange={(selection) => {
            if (selection && selection !== activeTab) {
              onChangeTab?.(selection);
            }
          }}
          selection={activeTab}
        >
          {tabs.map((tab) => {
            const count =
              typeof tab.badgeCount === 'number' && tab.badgeCount > 0
                ? ` (${tab.badgeCount})`
                : '';
            const title = `${tab.label}${count}`;

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
    marginVertical: 2,
  },
  host: {
    width: '100%',
    height: 34,
  },
});
