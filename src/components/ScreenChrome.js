import React, { forwardRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassBackground, useLiquidGlass, withAlpha } from './LiquidGlassSurface';
import { useTheme } from '../theme';

// Functional header/footer chrome only. Android uses tonal surfaces; iOS
// uses native glass when available and an opaque accessibility fallback.
export function ScreenChrome({ children, style, elevated = false, ...props }) {
  const { colors } = useTheme();
  const glass = useLiquidGlass();
  return <View {...props} style={[{ backgroundColor: glass ? 'transparent' : elevated ? colors.surfaceRaised : colors.canvas }, style]}>
    {glass ? <GlassBackground tintColor={withAlpha(colors.canvas, 0.75)} /> : null}
    {children}
  </View>;
}

export const ScreenScrollView = forwardRef(function ScreenScrollView({ children, contentContainerStyle, onScroll, onScrolledChange, ...props }, ref) {
  const { colors } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  return <View style={styles.viewport}>
    <ScrollView scrollIndicatorInsets={{ top: 16, bottom: 16 }} {...props} ref={ref} scrollEventThrottle={32}
      contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      onScroll={(event) => {
        const next = event.nativeEvent.contentOffset.y > 4;
        if (next !== scrolled) { setScrolled(next); onScrolledChange?.(next); }
        onScroll?.(event);
      }}>
      {children}
    </ScrollView>
    {scrolled ? <LinearGradient pointerEvents="none" colors={[colors.canvas, withAlpha(colors.canvas, 0)]} style={styles.top} /> : null}
    <LinearGradient pointerEvents="none" colors={[withAlpha(colors.canvas, 0), colors.canvas]} style={styles.bottom} />
  </View>;
});

const styles = StyleSheet.create({
  viewport: { flex: 1, minHeight: 0 },
  content: { paddingTop: 20, paddingBottom: 24 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, height: Platform.OS === 'ios' ? 20 : 16 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 14 },
});
