import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

// Builds made before expo-sensors was added have no accelerometer module;
// shaking then simply does nothing and the settings entry still works.
let Accelerometer = null;
try {
  ({ Accelerometer } = require('expo-sensors'));
} catch {
  Accelerometer = null;
}

// A shake: JOLTS readings beyond THRESHOLD_G (beyond gravity) within
// WINDOW_MS. Walking or putting the phone down stays well below this.
const THRESHOLD_G = 1.6;
const JOLTS = 3;
const WINDOW_MS = 1000;
const COOLDOWN_MS = 3000;
const INTERVAL_MS = 80;

/** Calls `onShake` when the phone is shaken, only while `enabled` and in the foreground. */
export default function useShakeGesture(onShake, enabled = true) {
  const callback = useRef(onShake);
  callback.current = onShake;

  useEffect(() => {
    if (!enabled || !Accelerometer) return undefined;
    let subscription = null;
    let jolts = [];
    let last = 0;
    const start = () => {
      if (subscription) return;
      try {
        Accelerometer.setUpdateInterval(INTERVAL_MS);
        subscription = Accelerometer.addListener(({ x = 0, y = 0, z = 0 }) => {
          // Readings are in g; at rest the magnitude is about 1.
          const force = Math.abs(Math.sqrt(x * x + y * y + z * z) - 1);
          if (force < THRESHOLD_G) return;
          const now = Date.now();
          jolts = [...jolts.filter((at) => now - at < WINDOW_MS), now];
          if (jolts.length >= JOLTS && now - last > COOLDOWN_MS) {
            last = now;
            jolts = [];
            callback.current?.();
          }
        });
      } catch {
        subscription = null;
      }
    };
    const stop = () => {
      subscription?.remove();
      subscription = null;
      jolts = [];
    };
    if (AppState.currentState === 'active') start();
    // The sensor runs only while the app is in front, to save battery.
    const app = AppState.addEventListener('change', (next) => (next === 'active' ? start() : stop()));
    return () => {
      app.remove();
      stop();
    };
  }, [enabled]);
}

export const shakeSupported = () => Boolean(Accelerometer);
