import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { DEFAULT_PREFERENCES, normalizePreferences, validatePreferencePatch } from '../utils/appPreferences';
import { RUST_BACKEND, rpc } from '../services/rust/backend';
import { liveQuery, notifyBackendChange } from '../services/rust/events';

const unavailableCapabilities = Object.freeze({ presence: false, push: false, email: false, sms: false, team: false, publicUsername: false });
const PreferencesContext = createContext({ preferences: DEFAULT_PREFERENCES, ready: false, serverReady: false,
  capabilities: unavailableCapabilities, syncError: '', retry() {},
  updatePreferences: async () => { throw new Error('ยังโหลดการตั้งค่าไม่เสร็จ กรุณาลองอีกครั้ง'); } });

export function PreferencesProvider({ children, userId }) {
  const key = `campusmate_preferences_v1:${userId || 'guest'}`;
  const initial = () => ({ key, preferences: DEFAULT_PREFERENCES, ready: false, serverReady: false, revision: -1,
    capabilities: unavailableCapabilities, syncError: '' });
  const [state, setState] = useState(initial);
  const [retryRevision, setRetryRevision] = useState(0);
  const stateRef = useRef(state), generation = useRef(0), queue = useRef(Promise.resolve()), currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    const revision = ++generation.current;
    let active = true, unsubscribe, hadCache = false;
    const current = () => active && revision === generation.current && currentKey.current === key;
    const commit = next => { if (current()) { stateRef.current = next; setState(next); } };
    const loading = { key, preferences: DEFAULT_PREFERENCES, ready: false, serverReady: false, revision: -1,
      capabilities: unavailableCapabilities, syncError: '' };
    commit(loading);
    void AsyncStorage.getItem(key).then(raw => { hadCache = !!raw; return raw ? normalizePreferences(JSON.parse(raw)) : normalizePreferences(); })
      .catch(() => normalizePreferences()).then(preferences => {
        if (!current()) return;
        commit({ ...loading, preferences, ready: true });
        if (!RUST_BACKEND || !userId) return;
        unsubscribe = liveQuery('preferences', async () => {
          let result;
          try {
            result = await rpc('getAppPreferences');
          } catch (error) {
            if (String(error?.code).includes('not-found') || String(error?.message).includes('ไม่พบบริการนี้')) {
              return { revision: 0, preferences, capabilities: unavailableCapabilities };
            }
            throw error;
          }
          if (result.revision !== -1 || !hadCache || !current()) return result;
          // Preserve existing appearance/playback choices when creating the
          // server record, without overwriting a choice made on another phone.
          try {
            return await rpc('saveAppPreferences', { expectedRevision: -1, settings: {
              theme: preferences.theme, autoplay: preferences.autoplay,
              muteAutoplayVideo: preferences.muteAutoplayVideo, recommendation: preferences.recommendation,
            } });
          } catch (error) {
            if (String(error?.code).endsWith('aborted')) return rpc('getAppPreferences');
            throw error;
          }
        }, result => {
          if (!current() || !result?.preferences || result.revision < stateRef.current.revision) return;
          const next = { key, preferences: normalizePreferences(result.preferences), ready: true, serverReady: true,
            revision: result.revision, capabilities: { ...unavailableCapabilities, ...result.capabilities }, syncError: '' };
          commit(next);
          void AsyncStorage.setItem(key, JSON.stringify(next.preferences)).catch(() => {});
        }, () => {
          if (current()) commit({ ...stateRef.current, serverReady: false, syncError: 'เชื่อมต่อการตั้งค่าไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง' });
        });
      });
    return () => { active = false; unsubscribe?.(); };
  }, [key, userId, retryRevision]);

  const visible = state.key === key ? state : { ...state, preferences: DEFAULT_PREFERENCES, ready: false, serverReady: false };
  useEffect(() => {
    if (visible.ready) Appearance.setColorScheme(visible.preferences.theme === 'system' ? 'auto' : visible.preferences.theme);
  }, [visible.preferences.theme, visible.ready]);

  const updatePreferences = useCallback((patch) => {
    validatePreferencePatch(patch);
    const revision = generation.current;
    const task = queue.current.catch(() => {}).then(async () => {
      const current = () => currentKey.current === key && revision === generation.current;
      if (!current() || !stateRef.current.ready) throw new Error('การตั้งค่ายังไม่พร้อม กรุณาลองอีกครั้ง');
      const previous = stateRef.current;
      let nextPreferences, nextRevision = previous.revision;
      if (RUST_BACKEND && userId) {
        if (!previous.serverReady) throw new Error('กรุณาเชื่อมต่ออินเทอร์เน็ตและโหลดการตั้งค่าอีกครั้ง');
        const result = await rpc('saveAppPreferences', { settings: patch });
        if (!result?.preferences) throw new Error('เซิร์ฟเวอร์ยังไม่ยืนยันการบันทึก กรุณาลองใหม่');
        nextPreferences = normalizePreferences(result.preferences);
        nextRevision = result.revision;
      } else {
        nextPreferences = normalizePreferences({ ...previous.preferences, ...patch,
          notifications: { ...previous.preferences.notifications, ...patch.notifications } });
        await AsyncStorage.setItem(key, JSON.stringify(nextPreferences));
      }
      if (!current()) return;
      // A newer stream response wins over a delayed mutation response.
      if (nextRevision >= stateRef.current.revision) {
        const committed = { ...stateRef.current, preferences: nextPreferences, revision: nextRevision, syncError: '' };
        stateRef.current = committed; setState(committed);
        await AsyncStorage.setItem(key, JSON.stringify(nextPreferences)).catch(() => {});
      }
      if (RUST_BACKEND) notifyBackendChange('preferences', userId);
      return stateRef.current.preferences;
    });
    queue.current = task;
    return task;
  }, [key, userId]);

  const context = useMemo(() => ({ preferences: visible.preferences, ready: visible.ready, serverReady: visible.serverReady,
    capabilities: visible.capabilities, syncError: visible.syncError, retry: () => setRetryRevision(value => value + 1), updatePreferences }),
  [visible, updatePreferences]);
  return <PreferencesContext.Provider value={context}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() { return useContext(PreferencesContext); }
