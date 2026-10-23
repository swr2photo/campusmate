import React, { Children, cloneElement, isValidElement, forwardRef, useContext, useRef, useState } from 'react';
import { Pressable as GesturePressable, TouchableOpacity as GestureOpacity, TouchableHighlight as GestureHighlight, TouchableWithoutFeedback as GestureWithoutFeedback, StyleSheet, View, useColorScheme } from 'react-native';
import { Button, Host, Rectangle } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, accessibilityHint, accessibilityIdentifier, accessibilityLabel, accessibilityRemoveTraits, accessibilityValue, buttonStyle, contentShape, disabled, foregroundStyle, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { actionAccessibilityValue, actionLabel, isActionDisabled, nativeBounds, needsGestureResponder } from './native-base-policy';
import NativeInteractionContext from './NativeInteractionContext';
import { NativeCardBackground } from './NativeCard';

function hideLabelContent(children) {
  return Children.map(children, child => {
    if (!isValidElement(child)) return child;
    if (child.type === React.Fragment) return cloneElement(child, {}, hideLabelContent(child.props.children));
    return cloneElement(child, { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', pointerEvents: 'none' });
  });
}

function createNativePressable(GestureSurface) {
  return forwardRef(function NativePressable({ children, nativeGestureSurface, nativeCardSurface = false, nativeButtonStyle = 'plain', ...props }, ref) {
    const [bounds, setBounds] = useState(null);
    const [pressed, setPressed] = useState(false);
    const lastTouch = useRef(null);
    const colorScheme = useColorScheme();
    const insideGestureSurface = useContext(NativeInteractionContext);
    const gestureSurface = insideGestureSurface || needsGestureResponder({ ...props, nativeGestureSurface }, children);
    const isDisabled = isActionDisabled(props);
    const label = actionLabel(children, props.accessibilityLabel);
    const valueLabel = actionAccessibilityValue(props);
    // No invisible action, no overlay above unknown/nested interactive content.
    if (gestureSurface || !props.onPress || !label) {
      const content = state => <NativeInteractionContext.Provider value={true}>
        {nativeCardSurface ? <NativeCardBackground style={typeof props.style === 'function' ? props.style(state) : props.style} /> : null}
        {typeof children === 'function' ? children(state) : children}
      </NativeInteractionContext.Provider>;
      return <GestureSurface {...props} ref={ref}>{typeof children === 'function' || nativeCardSurface ? content : content({ pressed: false })}</GestureSurface>;
    }
    const { onPress, onLayout, style, accessibilityLabel: _label, accessibilityHint: hint,
      accessibilityRole: _role, accessibilityState: state, accessibilityValue: value,
      testID, disabled: _disabled, hitSlop, pressRetentionOffset: _retention,
      android_ripple: _ripple, android_disableSound: _sound, delayLongPress: _delay,
      unstable_pressDelay: _pressDelay, activeOpacity: _activeOpacity,
      underlayColor: _underlay, onShowUnderlay: _show, onHideUnderlay: _hide,
      ...viewProps } = props;
    const resolvedStyle = typeof style === 'function' ? style({ pressed, hovered: false }) : style;
    const flat = StyleSheet.flatten(resolvedStyle) || {};
    return <View {...viewProps} ref={ref} accessible={false} collapsable={false}
      style={[resolvedStyle, { minWidth: Math.max(44, Number(flat.minWidth) || 0), minHeight: Math.max(44, Number(flat.minHeight) || 0) }]}
      onLayout={event => {
        const next = nativeBounds(event.nativeEvent.layout);
        setBounds(current => current?.width === next?.width && current?.height === next?.height ? current : next);
        onLayout?.(event);
      }}
      onTouchStart={event => { lastTouch.current = event; if (!isDisabled) setPressed(true); }}
      onTouchEnd={event => { lastTouch.current = event; setPressed(false); }}
      onTouchCancel={() => setPressed(false)}>
      {nativeCardSurface ? <NativeCardBackground style={resolvedStyle} /> : null}
      {hideLabelContent(children)}
      {bounds ? <Host colorScheme={colorScheme} style={StyleSheet.absoluteFill}>
        <Button onPress={() => { if (!isDisabled) onPress(lastTouch.current || { nativeEvent: {}, stopPropagation() {}, preventDefault() {} }); }}
          modifiers={[
            buttonStyle(nativeButtonStyle), frame(bounds), contentShape(shapes.rectangle()),
            disabled(isDisabled), accessibilityLabel(state?.busy ? `${label} กำลังดำเนินการ` : label),
            ...(hint ? [accessibilityHint(hint)] : []),
            ...(testID ? [accessibilityIdentifier(testID)] : []),
            ...(state?.selected || state?.checked === true ? [accessibilityAddTraits(['isSelected'])] : []),
            ...(props.accessibilityRole === 'link' ? [accessibilityAddTraits(['isLink']), accessibilityRemoveTraits(['isButton'])] : []),
            ...(props.accessibilityRole === 'checkbox' ? [accessibilityAddTraits(['isToggle'])] : []),
            ...(valueLabel ? [accessibilityValue(valueLabel)] : []),
          ]}>
          <Rectangle modifiers={[foregroundStyle('rgba(0,0,0,0.001)'), frame(bounds)]} />
        </Button>
      </Host> : null}
    </View>;
  });
}

export const Pressable = createNativePressable(GesturePressable);
export const TouchableOpacity = createNativePressable(GestureOpacity);
export const TouchableHighlight = createNativePressable(GestureHighlight);
export const TouchableWithoutFeedback = createNativePressable(GestureWithoutFeedback);
export default Pressable;
