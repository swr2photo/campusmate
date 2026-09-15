import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, View } from 'react-native';

export default function MessageTimeSwipeArea({
  children,
  timeDragAnim,
  onReveal,
  onHide,
  maxDrag = 48,
  style,
}) {
  const isRevealed = useRef(false);
  const startDxRef = useRef(0);

  const responder = useMemo(() => {
    return PanResponder.create({
      // Never capture touch down - let children (pressables, buttons) receive touches immediately
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      // Only capture when moving horizontally to the left (dx < -10)
      // and horizontal drag dominates vertical drag to avoid interfering with scrolling
      onMoveShouldSetPanResponder: (_, g) => {
        return g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        return g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4;
      },
      onPanResponderGrant: (_, g) => {
        isRevealed.current = false;
        startDxRef.current = g.dx || 0;
        if (timeDragAnim) {
          timeDragAnim.stopAnimation();
        }
      },
      onPanResponderMove: (_, g) => {
        if (timeDragAnim) {
          const rawDelta = g.dx - startDxRef.current;
          if (rawDelta < 0) {
            let val = rawDelta;
            if (val < -maxDrag) {
              val = -maxDrag + (val - (-maxDrag)) * 0.22;
            }
            timeDragAnim.setValue(val);
          } else {
            timeDragAnim.setValue(0);
          }
        }
        if (g.dx < -14 && !isRevealed.current) {
          isRevealed.current = true;
          onReveal?.();
        }
      },
      onPanResponderRelease: () => {
        if (timeDragAnim) {
          Animated.spring(timeDragAnim, {
            toValue: 0,
            damping: 22,
            mass: 0.7,
            stiffness: 280,
            useNativeDriver: true,
          }).start();
        }
        if (isRevealed.current) {
          isRevealed.current = false;
          onHide?.();
        }
      },
      onPanResponderTerminate: () => {
        if (timeDragAnim) {
          Animated.spring(timeDragAnim, {
            toValue: 0,
            damping: 22,
            mass: 0.7,
            stiffness: 280,
            useNativeDriver: true,
          }).start();
        }
        if (isRevealed.current) {
          isRevealed.current = false;
          onHide?.();
        }
      },
      onPanResponderTerminationRequest: () => true,
    });
  }, [timeDragAnim, maxDrag, onReveal, onHide]);

  // If wrapping children, act as a container with panHandlers that passes touches to children
  if (children) {
    return (
      <View
        {...responder.panHandlers}
        style={[{ flex: 1, width: '100%' }, style]}
      >
        {children}
      </View>
    );
  }

  // Fallback: standalone overlay with pointerEvents="box-none" so it doesn't block touches
  return (
    <View
      pointerEvents="box-none"
      {...responder.panHandlers}
      style={[
        {
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 32,
        },
        style,
      ]}
    />
  );
}
