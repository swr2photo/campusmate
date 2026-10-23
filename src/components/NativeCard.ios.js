import React, { forwardRef, useState } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { Host, UnevenRoundedRectangle } from '@expo/ui/swift-ui';
import { foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers';
import { nativeBounds, nativeSurfaceColor } from './native-base-policy';

// Native surface below RN content; never a glass overlay above photos or text.
// Keeping content in its original Yoga tree preserves nested controls and refs.
const NativeCard = forwardRef(function NativeCard({ children, style, onLayout, ...props }, ref) {
  const [bounds, setBounds] = useState(null);
  const colorScheme = useColorScheme();
  const flat = StyleSheet.flatten(style) || {};
  const color = nativeSurfaceColor(flat);
  const radius = Number(flat.borderRadius) || 0;
  return <View {...props} ref={ref} collapsable={false}
    style={[style, bounds && color && { backgroundColor: 'transparent' }]}
    onLayout={event => {
      const next = nativeBounds(event.nativeEvent.layout);
      setBounds(current => current?.width === next?.width && current?.height === next?.height ? current : next);
      onLayout?.(event);
    }}>
    {bounds && color ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Host colorScheme={colorScheme} style={StyleSheet.absoluteFill}>
        <UnevenRoundedRectangle
          topLeadingRadius={flat.borderTopLeftRadius ?? radius}
          topTrailingRadius={flat.borderTopRightRadius ?? radius}
          bottomLeadingRadius={flat.borderBottomLeftRadius ?? radius}
          bottomTrailingRadius={flat.borderBottomRightRadius ?? radius}
          modifiers={[foregroundStyle(color), frame(bounds)]} />
      </Host>
    </View> : null}
    {children}
  </View>;
});
export default NativeCard;

// Used inside compound touchable cards without changing their responder root.
export function NativeCardBackground({ style }) {
  const [bounds, setBounds] = useState(null);
  const colorScheme = useColorScheme();
  const flat = StyleSheet.flatten(style) || {};
  const color = nativeSurfaceColor(flat);
  const radius = Number(flat.borderRadius) || 0;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={StyleSheet.absoluteFill} onLayout={event => {
      const next = nativeBounds(event.nativeEvent.layout);
      setBounds(current => current?.width === next?.width && current?.height === next?.height ? current : next);
    }}>
    {bounds && color ? <Host colorScheme={colorScheme} style={StyleSheet.absoluteFill}>
      <UnevenRoundedRectangle topLeadingRadius={flat.borderTopLeftRadius ?? radius}
        topTrailingRadius={flat.borderTopRightRadius ?? radius}
        bottomLeadingRadius={flat.borderBottomLeftRadius ?? radius}
        bottomTrailingRadius={flat.borderBottomRightRadius ?? radius}
        modifiers={[foregroundStyle(color), frame(bounds)]} />
    </Host> : null}
  </View>;
}
