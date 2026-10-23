import React, { forwardRef } from 'react';
import { Pressable as RNPressable, TouchableOpacity as RNOpacity, TouchableHighlight as RNHighlight, TouchableWithoutFeedback as RNWithoutFeedback } from 'react-native';

// Strip iOS-only adapter options; Android/web keep the original control props.
function adapt(Component) {
  return forwardRef(function PlatformPressable({ nativeGestureSurface, nativeButtonStyle, nativeCardSurface, ...props }, ref) {
    return <Component {...props} ref={ref} />;
  });
}
export const Pressable = adapt(RNPressable);
export const TouchableOpacity = adapt(RNOpacity);
export const TouchableHighlight = adapt(RNHighlight);
export const TouchableWithoutFeedback = adapt(RNWithoutFeedback);
export default Pressable;
