import React, { forwardRef } from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';

export const fontFamilyForWeight = weight => Number(weight) >= 700 || weight === 'bold' ? 'NotoSansThai_700Bold' : Number(weight) >= 600 ? 'NotoSansThai_600SemiBold' : Number(weight) >= 500 ? 'NotoSansThai_500Medium' : 'NotoSansThai_400Regular';
function resolveFont(style) {
  const flat = StyleSheet.flatten(style) || {};
  // Keep intentional icon/monospace families intact.
  if (flat.fontFamily) return null;
  return { fontFamily: fontFamilyForWeight(flat.fontWeight), fontWeight: 'normal', includeFontPadding: false, lineHeight: Math.max(flat.lineHeight || (flat.fontSize || 15) * 1.5, (flat.fontSize || 15) * 1.4) };
}
const AppText = forwardRef(function AppText({ style, ...props }, ref) {
  return <Text ref={ref} {...props} style={[{ fontSize: 15 }, style, resolveFont(style)]} />;
});
export const AppTextInput = forwardRef(function AppTextInput({ style, ...props }, ref) {
  return <TextInput ref={ref} {...props} style={[{ fontSize: 15 }, style, resolveFont(style)]} />;
});
export default AppText;
