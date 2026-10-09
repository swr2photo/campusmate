import React, { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

// Native tab items need an image source; render the circular crop into a
// transparent PNG so UIKit preserves the shape in both selection states.
export default function CircularTabAvatar({ uri, onReady }) {
  const viewRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  useEffect(() => {
    if (!loaded || !laidOut) return undefined;
    let active = true;
    let capture;
    const frame = requestAnimationFrame(async () => {
      try {
        capture = await captureRef(viewRef, { format: 'png', result: 'tmpfile', useRenderInContext: true });
        if (active) onReady({ input: uri, source: { uri: capture, width: 28, height: 28, scale: 3 } });
        else releaseCapture(capture);
      } catch { /* A new avatar or remount retries the capture. */ }
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      if (capture) releaseCapture(capture);
    };
  }, [laidOut, loaded, onReady, uri]);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: -100, top: 0 }}>
      <View ref={viewRef} collapsable={false} onLayout={() => setLaidOut(true)} style={{ width: 28, height: 28, borderRadius: 14, overflow: 'hidden', backgroundColor: 'transparent' }}>
        <Image source={{ uri }} resizeMode="cover" onLoad={() => setLoaded(true)} style={{ width: 28, height: 28, borderRadius: 14 }} />
      </View>
    </View>
  );
}
