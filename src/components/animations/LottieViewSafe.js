import React, { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';

let LottieView = null;
try {
  LottieView = require('lottie-react-native').default || require('lottie-react-native');
} catch (e) {
  console.warn('[LottieViewSafe] lottie-react-native could not be loaded:', e?.message);
}

const LottieViewSafe = forwardRef(function LottieViewSafe(
  {
    source,
    autoPlay = true,
    loop = true,
    speed = 1,
    style,
    fallback = null,
    onAnimationFinish,
    ...props
  },
  ref
) {
  if (!LottieView || !source) {
    return fallback ? <View style={[styles.fallbackContainer, style]}>{fallback}</View> : null;
  }

  return (
    <LottieView
      ref={ref}
      source={source}
      autoPlay={autoPlay}
      loop={loop}
      speed={speed}
      style={style}
      onAnimationFinish={onAnimationFinish}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  fallbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default LottieViewSafe;
