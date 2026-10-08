import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useMembership } from '../context/MembershipContext';

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

/** Backoff between automatic attempts: 1s, 2s, 4s, 8s, 16s, then every 30s. */
export function packageRetryDelay(attempt) {
  return Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
}

/**
 * Keeps the paywall's store packages loading on its own while the screen is focused:
 * on focus, retried with backoff after a failure, and immediately again when the app
 * returns to the foreground or the connection comes back. Stops on blur/unmount and
 * once prices are available. Returns `offline` so the screen can say it is waiting.
 */
export function useMembershipPackageAutoload() {
  const { configured, plus, packages, loadPackages } = useMembership();
  const [focused, setFocused] = useState(false);
  const [offline, setOffline] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const waiting = focused && configured && !plus && packages.length === 0;

  useEffect(() => {
    if (!waiting) return undefined;
    let cancelled = false, inFlight = false, online = true, attempt = 0, timer = null;
    const stopTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const run = async () => {
      if (cancelled || inFlight || !online) return;
      stopTimer();
      inFlight = true;
      let loaded = false;
      try {
        loaded = (await loadPackages()).length > 0;
      } catch {
        loaded = false;
      }
      inFlight = false;
      if (cancelled || loaded || !online) return;
      timer = setTimeout(run, packageRetryDelay(attempt));
      attempt += 1;
    };
    const restart = () => {
      attempt = 0;
      stopTimer();
      void run();
    };
    const offNetwork = NetInfo.addEventListener((state) => {
      const next = state.isConnected !== false;
      setOffline(!next);
      if (next && !online) {
        online = true;
        restart();
      } else if (!next) {
        online = false;
        stopTimer();
      }
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') restart();
    });
    void run();
    return () => {
      cancelled = true;
      stopTimer();
      offNetwork();
      appState.remove();
    };
  }, [waiting, loadPackages]);

  return { offline: waiting && offline };
}
