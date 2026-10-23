import { Pressable } from './NativePressable';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

// Keep the existing API; opaque surfaces respect reduced transparency without blur.
export default function LiquidGlassSegmentedControl({ activeTab, onChangeTab, style, tabs = [], compact = false }) {
  const { colors } = useTheme();
  return <View style={[styles.track, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }, compact && styles.compactTrack, style]}>
    {tabs.map(tab => {
      const selected = activeTab === tab.id;
      const foreground = selected ? colors.onPrimary : colors.inkMuted;
      return <Pressable nativeGestureSurface={compact} key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }} onPress={() => onChangeTab?.(tab.id)} android_ripple={{ color: 'rgba(98,168,255,0.18)' }} style={({ pressed }) => [styles.tab, compact && styles.compactTab, { backgroundColor: selected ? colors.primary : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
        {tab.icon ? <FeatureIcon name={tab.icon} color={foreground} size={16} /> : null}
        <Text style={[styles.label, compact && { fontSize: 14 }, { color: foreground, fontWeight: selected ? '700' : '500' }]}>{tab.label}</Text>
        {typeof tab.badgeCount === 'number' && tab.badgeCount > 0 ? <Text accessibilityLabel={`${tab.badgeCount} รายการ`} style={[styles.count, { color: foreground }]}>{tab.badgeCount > 99 ? '99+' : tab.badgeCount}</Text> : null}
      </Pressable>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  compactTrack: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', height: 44, borderRadius: 22, borderWidth: 0, gap: 0, padding: 4 },
  compactTab: { minWidth: 0, minHeight: 36, height: 36, paddingVertical: 0, paddingHorizontal: 8, flexWrap: 'nowrap', borderRadius: 18 },
  track: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: Platform.OS === 'android' ? 30 : 16, padding: 4, gap: 4 },
  tab: { flex: 1, minWidth: 84, minHeight: 52, borderRadius: Platform.OS === 'android' ? 22 : 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, overflow: 'hidden' },
  label: { fontSize: 15, textAlign: 'center', flexShrink: 1 },
  count: { fontSize: 12, fontWeight: '700' },
});
