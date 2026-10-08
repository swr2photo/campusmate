import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useAuth } from './AuthContext';
import { useAppProfile } from './AppContext';
import { useCall } from './CallContext';
import { APP_TOUR_STEPS, APP_TOUR_VERSION } from '../data/appTourSteps';
import { hasPendingAlerts, subscribeAlerts } from '../utils/appAlert';
import { useAnyOverlayActive } from '../utils/overlayGate';

/**
 * First-run feature tour state.
 *  - Screens mark spotlight targets with <TourTarget id="..."> (or useTourTarget).
 *  - <AppTourOverlay /> (mounted once in app/_layout.js) renders the active tour.
 *  - The tour starts automatically once per user id (persisted) when the user first reaches the
 *    main tabs with nothing else on screen, and can be replayed with startTour().
 */
export const MAIN_TAB_PATHS = ['/home', '/discover', '/chat', '/meetup', '/me'];
export const isMainTabPath = (pathname) => MAIN_TAB_PATHS.includes(pathname);

const STORAGE_PREFIX = `@campusmate:app_tour_done_v${APP_TOUR_VERSION}:`;
const AUTO_START_DELAY_MS = 1200;

const TourRegistryContext = createContext(null);
const AppTourContext = createContext(null);

function createRegistry() {
  const targets = new Map();
  return {
    set(id, entry) { targets.set(id, entry); },
    remove(id, node) { if (targets.get(id)?.node === node) targets.delete(id); },
    get(id) { return targets.get(id) || null; },
  };
}

function useAppForeground() {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export function AppTourProvider({ children }) {
  const { user, isLoggedIn } = useAuth();
  const { profile } = useAppProfile();
  const { isCallActive } = useCall();
  const pathname = usePathname();
  const uid = isLoggedIn ? (user?.id || user?.uid || null) : null;
  const registry = useRef(null);
  if (!registry.current) registry.current = createRegistry();

  const [doneState, setDoneState] = useState({ uid: null, done: null }); // done: null = loading
  const [run, setRun] = useState(null); // { uid, steps, index, replay }
  const alertsPending = useSyncExternalStore(subscribeAlerts, hasPendingAlerts, hasPendingAlerts);
  const overlayBusy = useAnyOverlayActive();
  const foreground = useAppForeground();

  useEffect(() => {
    setRun((current) => (current && current.uid !== uid ? null : current));
    if (!uid) { setDoneState({ uid: null, done: null }); return undefined; }
    let live = true;
    setDoneState({ uid, done: null });
    AsyncStorage.getItem(STORAGE_PREFIX + uid)
      .then((value) => { if (live) setDoneState({ uid, done: value === '1' }); })
      // Never block the app on a storage failure: just don't auto-start.
      .catch(() => { if (live) setDoneState({ uid, done: true }); });
    return () => { live = false; };
  }, [uid]);

  const status = !uid ? 'idle' : doneState.uid !== uid || doneState.done === null ? 'loading' : doneState.done ? 'done' : 'pending';
  const active = Boolean(run && run.uid === uid);

  const startTour = useCallback((options = {}) => {
    if (!uid) return;
    const steps = APP_TOUR_STEPS.filter((step) => !step.platforms || step.platforms.includes(Platform.OS));
    if (!steps.length) return;
    setRun({ uid, steps, index: 0, replay: Boolean(options.replay) });
  }, [uid]);

  const finishTour = useCallback(() => {
    setRun(null);
    if (!uid) return;
    setDoneState({ uid, done: true });
    void AsyncStorage.setItem(STORAGE_PREFIX + uid, '1').catch(() => {});
  }, [uid]);

  const goToStep = useCallback((index) => {
    setRun((current) => {
      if (!current) return current;
      if (index < 0) return { ...current, index: 0 };
      return { ...current, index: Math.min(index, current.steps.length - 1) };
    });
  }, []);

  // Auto-start once per user, only on the main tabs with nothing else on screen.
  const canAutoStart = status === 'pending' && !active && foreground && isMainTabPath(pathname)
    && Boolean(profile) && profile?.id === uid && !profile?.isNewUser
    && !alertsPending && !overlayBusy && !isCallActive;
  useEffect(() => {
    if (!canAutoStart) return undefined;
    const timer = setTimeout(() => startTour(), AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canAutoStart, startTour]);

  const value = useMemo(() => ({
    status,
    active,
    run: active ? run : null,
    startTour,
    finishTour,
    goToStep,
    registry: registry.current,
  }), [active, finishTour, goToStep, run, startTour, status]);

  return (
    <TourRegistryContext.Provider value={registry.current}>
      <AppTourContext.Provider value={value}>{children}</AppTourContext.Provider>
    </TourRegistryContext.Provider>
  );
}

const FALLBACK = { status: 'idle', active: false, run: null, startTour: () => {}, finishTour: () => {}, goToStep: () => {}, registry: null };

export function useAppTour() {
  return useContext(AppTourContext) || FALLBACK;
}

/**
 * Ref callback that registers a View as a tour spotlight target.
 * ensureVisible (optional) scrolls the element on screen before it is measured.
 */
export function useTourTarget(id, ensureVisible) {
  const registry = useContext(TourRegistryContext);
  const ensureRef = useRef(ensureVisible);
  ensureRef.current = ensureVisible;
  const nodeRef = useRef(null);
  return useCallback((node) => {
    if (!registry) return;
    if (nodeRef.current && nodeRef.current !== node) registry.remove(id, nodeRef.current);
    nodeRef.current = node;
    if (node) registry.set(id, { node, ensureVisible: () => ensureRef.current?.() });
  }, [id, registry]);
}

/**
 * Wraps children in a plain View registered as a tour target. Pass `scrollRef` when the
 * target is a direct child of a ScrollView's content so the tour can scroll it into view.
 */
export function TourTarget({ id, scrollRef, scrollOffset = 96, children, onLayout, style, ...rest }) {
  const layoutY = useRef(0);
  const ref = useTourTarget(id, scrollRef ? () => {
    scrollRef.current?.scrollTo?.({ animated: true, y: Math.max(0, layoutY.current - scrollOffset) });
  } : undefined);
  return (
    <View
      collapsable={false}
      onLayout={(event) => {
        layoutY.current = event.nativeEvent.layout.y;
        onLayout?.(event);
      }}
      ref={ref}
      style={style}
      {...rest}
    >
      {children}
    </View>
  );
}
