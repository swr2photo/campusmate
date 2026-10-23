import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { withAlpha } from './LiquidGlassSurface';
import { useTheme } from '../theme';

/**
 * Soft top/bottom fades over a scroll view, so content dissolves into the
 * header or tab bar instead of being cut mid-line. Render it as a sibling
 * after the scroll view inside a `position: relative` parent.
 */
export default function ScrollFadeEdges({ top = 0, bottom = 0, topSize = 20, bottomSize = 28, color, showTop = true, showBottom = true }) {
  const { colors } = useTheme();
  const base = color || colors.canvas;
  return (
    <>
      {showTop ? (
        <View pointerEvents="none" style={[styles.edge, { top, height: topSize }]}>
          <LinearGradient colors={[base, withAlpha(base, 0)]} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
      {showBottom ? (
        <View pointerEvents="none" style={[styles.edge, { bottom, height: bottomSize }]}>
          <LinearGradient colors={[withAlpha(base, 0), base]} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, right: 0 },
});
