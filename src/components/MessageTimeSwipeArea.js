import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { rubberband } from '../utils/motion';

export default function MessageTimeSwipeArea({
  children,
  timeDragAnim,
  onReveal,
  onHide,
  maxDrag = 48,
  style,
}) {
  const revealed = useSharedValue(0);
  const context = useSharedValue(0);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX(-10)
    .failOffsetY([-16, 16])
    .onStart(() => {
      revealed.set(0);
      context.set(timeDragAnim.get());
    })
    .onUpdate((e) => {
      const next = context.get() + e.translationX;
      if (next >= 0) {
        timeDragAnim.set(0);
      } else if (next < -maxDrag) {
        timeDragAnim.set(-maxDrag + rubberband(next + maxDrag, maxDrag));
      } else {
        timeDragAnim.set(next);
      }
      if (timeDragAnim.get() < -14 && revealed.get() === 0) {
        revealed.set(1);
        if (onReveal) scheduleOnRN(onReveal);
      }
    })
    .onFinalize((e) => {
      timeDragAnim.set(withSpring(0, {
        duration: 400,
        dampingRatio: 0.8,
        velocity: e.velocityX,
      }));
      if (revealed.get()) {
        revealed.set(0);
        if (onHide) scheduleOnRN(onHide);
      }
    }), [maxDrag, onHide, onReveal, revealed, timeDragAnim]);

  if (children) {
    return (
      <GestureDetector gesture={pan}>
        <View style={[{ flex: 1, width: '100%' }, style]}>
          {children}
        </View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <View
        pointerEvents="box-none"
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
    </GestureDetector>
  );
}
