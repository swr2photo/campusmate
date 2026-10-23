import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { usePreferences } from './PreferencesContext';
import { useAppConversations, useAppSync } from './AppContext';
import { RUST_BACKEND, rpc, rustUid } from '../services/rust/backend';
import { liveQuery } from '../services/rust/events';
import { presencePresentation } from '../utils/chatPresence';

const Context = createContext({ records: {}, now: Date.now(), enabled: false });

export function ChatPresenceProvider({ children }) {
  const { user } = useAuth();
  const { preferences, serverReady, capabilities } = usePreferences();
  const { conversations = [] } = useAppConversations();
  const { isOnline } = useAppSync();
  const uid = user?.id;
  const enabled = RUST_BACKEND && !!uid && serverReady && capabilities.presence && preferences.showOnlineStatus !== false;
  const [state, setState] = useState({ uid: null, records: {}, offset: 0 });
  const [tick, setTick] = useState(Date.now());
  const config = useRef({ enabled, isOnline });
  config.current = { enabled, isOnline };
  const heartbeatRef = useRef(null);
  const idsKey = JSON.stringify(conversations.filter(room => room.kind !== 'group').map(room => room.id).filter(Boolean).sort());

  useEffect(() => {
    if (!RUST_BACKEND || !uid || !serverReady || !capabilities.presence) return;
    let active = true, pending = Promise.resolve();
    const heartbeat = foreground => {
      pending = pending.catch(() => {}).then(() => active && rustUid() === uid
        ? rpc('presenceHeartbeat', { active: foreground && config.current.enabled && config.current.isOnline !== false }).catch(() => {}) : undefined);
    };
    heartbeatRef.current = heartbeat;
    heartbeat(AppState.currentState === 'active');
    const timer = setInterval(() => { if (AppState.currentState === 'active' && config.current.enabled && config.current.isOnline !== false) heartbeat(true); }, 30000);
    const listener = AppState.addEventListener('change', next => heartbeat(next === 'active'));
    return () => {
      active = false; heartbeatRef.current = null; clearInterval(timer); listener.remove();
      // Do not take another device offline; the server binds this to our family.
      void pending.catch(() => {}).then(() => rustUid() === uid ? rpc('presenceHeartbeat', { active: false }) : undefined).catch(() => {});
    };
  }, [uid, serverReady, capabilities.presence]);
  useEffect(() => { heartbeatRef.current?.(AppState.currentState === 'active'); }, [enabled, isOnline]);

  useEffect(() => {
    if (!enabled || isOnline === false) { setState({ uid, records: {}, offset: 0 }); return; }
    let active = true, inFlight;
    const ids = JSON.parse(idsKey);
    const fetchPresence = () => {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const records = {}; let serverTime;
        for (let index = 0; index < ids.length; index += 100) {
          const result = await rpc('getChatPresence', { conversationIds: ids.slice(index, index + 100) });
          Object.assign(records, result.presence); serverTime = result.serverTime;
        }
        return { records, offset: Number.isFinite(serverTime) ? serverTime - Date.now() : 0 };
      })().finally(() => { inFlight = null; });
      return inFlight;
    };
    const commit = result => { if (active) setState({ uid, ...result }); };
    const fail = () => { if (active) setState({ uid, records: {}, offset: 0 }); };
    const unsubscribe = liveQuery(['presence', 'preferences', 'blocks'], fetchPresence, commit, fail);
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      setTick(Date.now());
      void fetchPresence().then(commit, fail);
    }, 30000);
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active') { setTick(Date.now()); void fetchPresence().then(commit, fail); }
    });
    return () => { active = false; clearInterval(timer); listener.remove(); unsubscribe(); };
  }, [uid, enabled, idsKey, isOnline]);
  const value = useMemo(() => ({ records: state.uid === uid ? state.records : {}, enabled,
    offset: state.offset, tick }), [state, uid, enabled, tick]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatPresence(conversationId) {
  const { records, offset = 0, enabled } = useContext(Context);
  return presencePresentation(enabled ? records[conversationId] : null, Date.now() + offset);
}
