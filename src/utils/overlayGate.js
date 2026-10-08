import { useEffect, useSyncExternalStore } from 'react';

/**
 * Tiny registry of full-screen startup overlays (app update, consent, Plus upsell, ...).
 * Lets the first-run tour and the Plus upsell wait instead of stacking on top of each other.
 *
 *   useOverlayGate('appUpdate', visible)   // inside the component that shows the overlay
 *   const busy = useAnyOverlayActive(exceptKey?)
 */
const active = new Set();
const listeners = new Set();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((listener) => {
    try { listener(); } catch { /* ignore */ }
  });
}

export function setOverlayActive(key, on) {
  if (!key) return;
  const had = active.has(key);
  if (on && !had) { active.add(key); emit(); }
  if (!on && had) { active.delete(key); emit(); }
}

export function subscribeOverlays(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isOverlayActive(exceptKey) {
  for (const key of active) if (key !== exceptKey) return true;
  return false;
}

export function useOverlayGate(key, on) {
  const value = Boolean(on);
  useEffect(() => {
    setOverlayActive(key, value);
    return () => setOverlayActive(key, false);
  }, [key, value]);
}

export function useAnyOverlayActive(exceptKey) {
  useSyncExternalStore(subscribeOverlays, () => version, () => version);
  return isOverlayActive(exceptKey);
}
