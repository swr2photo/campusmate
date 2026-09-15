import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';

/**
 * CallPulseIndicator
 * Multi-ring pulsing waves behind an avatar for incoming/outgoing calls.
 */
export default function CallPulseIndicator({
  size = 120,
  color = '#10B981', // green default, or blue for video call
  ringCount = 3,
  duration = 2000,
  active = true,
  children,
  style,
}) {
  const rings = Array.from({ length: ringCount });

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      {active &&
        rings.map((_, index) => {
          const delay = (duration / ringCount) * index;
          return (
            <MotiView
              key={index}
              from={{
                opacity: 0.7,
                scale: 1,
              }}
              animate={{
                opacity: 0,
                scale: 2.2,
              }}
              transition={{
                type: 'timing',
                duration: duration,
                loop: true,
                delay: delay,
                repeatReverse: false,
              }}
              style={[
                styles.pulseRing,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: color,
                },
              ]}
            />
          );
        })}
      <View style={[styles.avatarContent, { width: size, height: size, borderRadius: size / 2 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
  },
  avatarContent: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 2,
  },
});
