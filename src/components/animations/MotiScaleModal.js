import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatePresence, MotiView } from 'moti';

/**
 * MotiScaleModal
 * Animated modal container that smoothly zooms and fades in using spring physics.
 */
export default function MotiScaleModal({
  visible = true,
  children,
  style,
  backdropStyle,
  onBackdropPress,
}) {
  return (
    <AnimatePresence>
      {visible && (
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'timing', duration: 250 }}
          style={[styles.backdrop, backdropStyle]}
        >
          <MotiView
            from={{
              opacity: 0,
              scale: 0.88,
              translateY: 20,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              translateY: 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.9,
              translateY: 10,
            }}
            transition={{
              type: 'spring',
              damping: 18,
              stiffness: 220,
            }}
            style={[styles.content, style]}
          >
            {children}
          </MotiView>
        </MotiView>
      )}
    </AnimatePresence>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1000,
  },
  content: {
    borderRadius: 24,
    maxWidth: 420,
    overflow: 'hidden',
    width: '100%',
  },
});
