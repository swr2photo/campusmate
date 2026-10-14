import React, { useEffect, useRef, useState } from 'react';
import { Animated, I18nManager, Pressable, StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

// Android uses a solid selected surface. Taps drive the controlled index
// directly; a failed pan recognizer cannot leave the indicator drag-locked.
export default function AndroidSegmentedControl({ activeTab, onChangeTab, style, tabs = [] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(0)).current;
  const items = Array.isArray(tabs) ? tabs : [];
  const activeIndex = Math.max(0, items.findIndex(tab => tab.id === activeTab));
  const tabWidth = items.length ? width / items.length : 0;
  const visualIndex = I18nManager.isRTL ? items.length - 1 - activeIndex : activeIndex;
  useEffect(() => {
    if (!tabWidth) return;
    const animation = Animated.timing(position, {
      toValue: visualIndex * tabWidth, duration: 180, useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [position, tabWidth, visualIndex]);
  if (!items.length) return null;
  return (
    <View style={[styles.track, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }, style]}>
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.row}>
        {tabWidth > 0 ? <Animated.View pointerEvents="none" style={[
          styles.selection, { width: tabWidth, backgroundColor: colors.primary, transform: [{ translateX: position }] },
        ]} /> : null}
        {items.map((tab, index) => {
          const selected = index === activeIndex;
          const foreground = selected ? colors.onPrimary : colors.inkMuted;
          return (
            <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label}
              accessibilityState={{ selected }} onPress={() => onChangeTab?.(tab.id)}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              {tab.icon ? <FeatureIcon name={tab.icon} size={16} color={foreground} /> : null}
              <Text numberOfLines={1} style={[styles.label, { color: foreground }]}>{tab.label}</Text>
              {typeof tab.badgeCount === 'number' && tab.badgeCount > 0 ? (
                <View style={[styles.badge, { backgroundColor: selected ? colors.onPrimary : colors.card }]}>
                  <Text style={[styles.badgeLabel, { color: selected ? colors.primary : colors.inkMuted }]}>{tab.badgeCount}</Text>
                </View>
              ) : tab.badge || null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  track: { borderRadius: 28, borderWidth: 1, padding: 4 },
  row: { flexDirection: 'row', position: 'relative', minHeight: 48 },
  selection: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 24 },
  button: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  label: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  badge: { minWidth: 20, minHeight: 20, paddingHorizontal: 5, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
