import React from 'react';
import { StyleSheet } from 'react-native';
import { MotiView } from 'moti';

/**
 * MotiFadeSlideIn
 * Wraps any item (e.g. Chat Bubble, List Item) to smoothly fade in and slide up when mounted.
 */
export default function MotiFadeSlideIn({
  children,
  delay = 0,
  duration = 350,
  translateY = 12,
  style,
}) {
  return (
    <MotiView
      from={{
        opacity: 0,
        translateY: translateY,
      }}
      animate={{
        opacity: 1,
        translateY: 0,
      }}
      transition={{
        type: 'timing',
        duration: duration,
        delay: delay,
      }}
      style={[styles.container, style]}
    >
      {children}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
