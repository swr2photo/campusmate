import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { DEFAULT_PREFERENCES, normalizePreferences } from '../utils/appPreferences';

const PreferencesContext = createContext({
  preferences: DEFAULT_PREFERENCES,
  ready: false,
  updatePreferences: async () => { throw new Error('ยังโหลดการตั้งค่าไม่เสร็จ กรุณาลองอีกครั้ง'); },
});

export function PreferencesProvider({ children, userId }) {
  const key = `campusmate_preferences_v1:${userId || 'guest'}`;
  const [state, setState] = useState({ key, preferences: DEFAULT_PREFERENCES, ready: false });
  const stateRef = useRef(state);
  const generation = useRef(0);
  const queue = useRef(Promise.resolve());
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    const revision = ++generation.current;
    let active = true;
    const initial = { key, preferences: DEFAULT_PREFERENCES, ready: false };
    stateRef.current = initial;
    setState(initial);
    void AsyncStorage.getItem(key).then((raw) => raw ? normalizePreferences(JSON.parse(raw)) : normalizePreferences())
      .catch(() => normalizePreferences())
      .then((preferences) => {
        if (!active || revision !== generation.current) return;
        const loaded = { key, preferences, ready: true };
        stateRef.current = loaded;
        setState(loaded);
      });
    return () => { active = false; };
  }, [key]);

  const preferences = state.key === key ? state.preferences : DEFAULT_PREFERENCES;
  const ready = state.key === key && state.ready;

  useEffect(() => {
    if (ready) Appearance.setColorScheme(preferences.theme === 'system' ? 'auto' : preferences.theme);
  }, [preferences.theme, ready]);

  const updatePreferences = useCallback((patch) => {
    const revision = generation.current;
    const task = queue.current.catch(() => undefined).then(async () => {
      if (currentKey.current !== key || revision !== generation.current || !stateRef.current.ready) {
        throw new Error('การตั้งค่ายังไม่พร้อม กรุณาลองอีกครั้ง');
      }
      const previous = stateRef.current.preferences;
      const next = normalizePreferences({
        ...previous, ...patch,
        notifications: { ...previous.notifications, ...patch.notifications },
      });
      await AsyncStorage.setItem(key, JSON.stringify(next));
      if (currentKey.current !== key || revision !== generation.current) return;
      const committed = { key, preferences: next, ready: true };
      stateRef.current = committed;
      setState(committed);
      return next;
    });
    queue.current = task;
    return task;
  }, [key]);

  const context = useMemo(() => ({ preferences, updatePreferences, ready }), [preferences, updatePreferences, ready]);
  return <PreferencesContext.Provider value={context}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
