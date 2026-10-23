import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './AppText';
import { type, useTheme } from '../theme';

/**
 * iOS main tabs draw their title inside the scrolling content instead of a
 * native navigation bar, so the header scrolls with the page and slides with
 * it during the tab swipe (SwipeableTabContainer moves only React Native
 * content; a native bar stayed fixed while the page moved underneath it).
 * Android keeps its existing headers.
 */
export const IN_PAGE_TAB_HEADERS = Platform.OS === 'ios';

export default function TabPageHeader({ title, children, style }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
        {title}
      </Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

/**
 * Opaque strip under the status bar so content scrolling up does not collide
 * with the clock and indicators once there is no navigation bar.
 */
export function StatusBarScrim() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!IN_PAGE_TAB_HEADERS || !insets.top) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.scrim, { backgroundColor: colors.canvas, height: insets.top }]}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 52,
  },
  title: {
    flexShrink: 1,
    fontSize: type.display,
    fontWeight: '800',
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  scrim: {
    left: 0,
    opacity: 0.94,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
});
