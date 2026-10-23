import { useSyncExternalStore } from 'react';

// Cold-start coordination. Every boot stage that is still waiting (auth,
// routing, the first profile) renders AppSplashScreen, which holds the
// launch overlay open; the overlay plays its exit once nothing holds it, so
// the intro runs once per launch instead of restarting at each stage.
let holds = 0;
let finished = false;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

/** Keeps the launch overlay up until the returned release is called. */
export function holdLaunch() {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    emit();
  };
}

export const launchHolds = () => holds;
export const isLaunchFinished = () => finished;

export function finishLaunch() {
  if (finished) return;
  finished = true;
  emit();
}

export function subscribeLaunch(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLaunchFinished() {
  return useSyncExternalStore(subscribeLaunch, isLaunchFinished, isLaunchFinished);
}

export function useLaunchHolds() {
  return useSyncExternalStore(subscribeLaunch, launchHolds, launchHolds);
}
