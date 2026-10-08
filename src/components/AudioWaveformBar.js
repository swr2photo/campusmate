import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

const TOTAL_BARS = 22;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 24;

export default function AudioWaveformBar({
  isRecording = false,
  isPlaying = false,
  playProgress = 0,
  levels = [],
  barColor = '#FFFFFF',
  inactiveColor = 'rgba(255, 255, 255, 0.45)',
  containerHeight = 28,
}) {
  const bars = useMemo(() => {
    // If we have dynamic levels during recording or captured levels
    const result = [];
    const len = levels.length;

    for (let i = 0; i < TOTAL_BARS; i++) {
      let norm = 0.2;
      if (len > 0) {
        // Sample from the levels array, matching the latest samples to the right
        const index = Math.max(0, len - TOTAL_BARS + i);
        if (index >= 0 && index < len) {
          norm = levels[index];
        } else {
          // Fallback wave shape
          norm = 0.15 + Math.sin((i / TOTAL_BARS) * Math.PI) * 0.2;
        }
      } else if (isRecording) {
        // Initial gentle undulating wave while waiting for first mic samples
        norm = 0.18 + Math.abs(Math.sin((i + Date.now() / 200) * 0.5)) * 0.25;
      } else {
        // Static pleasant waveform pattern for preview
        const pattern = [0.25, 0.4, 0.7, 0.5, 0.85, 0.45, 0.6, 0.9, 0.65, 0.4, 0.75, 0.55, 0.35, 0.6, 0.8, 0.45, 0.7, 0.5, 0.3, 0.55, 0.4, 0.2];
        norm = pattern[i % pattern.length];
      }

      const barHeight = Math.round(MIN_BAR_HEIGHT + norm * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT));
      result.push(barHeight);
    }
    return result;
  }, [levels, isRecording]);

  return (
    <View style={[styles.container, { height: containerHeight }]}>
      {bars.map((barHeight, idx) => {
        const barProgress = (idx + 1) / TOTAL_BARS;
        const isFilled = isRecording || (isPlaying && playProgress >= barProgress) || (!isPlaying && playProgress >= barProgress && playProgress > 0);
        return (
          <View
            key={idx}
            style={[
              styles.bar,
              {
                height: Math.max(MIN_BAR_HEIGHT, Math.min(MAX_BAR_HEIGHT, barHeight)),
                backgroundColor: isFilled ? barColor : inactiveColor,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
});
