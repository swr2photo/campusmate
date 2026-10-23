// Realtime change signals from the native backend (Server-Sent Events).
// A signal only names a topic; listeners refetch through authorized RPCs.
// One shared stream serves every listener. It reconnects with backoff, pauses
// in the background and tells everyone to refetch after any gap, so missed
// signals are recovered by a reload rather than replayed.
import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { rustAccessToken, rustOrigin, RUST_BACKEND } from './backend';

const listeners = new Map(); // topic -> Set<{ id, callback }>
let controller = null;
let connecting = false;
let stopped = true;
let retryTimer = null;
let pollTimer = null;
let backoff = 1000;
let appState = AppState.currentState;
let appStateSubscription = null;

function emit(topic, id) {
  const targets = topic === '*'
    ? [...listeners.values()].flatMap((set) => [...set])
    : [...(listeners.get(topic) || [])];
  for (const listener of targets) {
    if (listener.id && id && listener.id !== id) continue;
    try { listener.callback({ topic, id }); } catch { /* A listener cannot break delivery. */ }
  }
}

// An acknowledged mutation on this device need not wait for the stream or
// its outage polling interval. Other devices still use authorized SSE.
export function notifyBackendChange(topic, id = null) { emit(topic, id); }

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let code; let size;
    if (b < 0x80) { code = b; size = 1; }
    else if (b >= 0xf0) { code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); size = 4; }
    else if (b >= 0xe0) { code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); size = 3; }
    else { code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); size = 2; }
    out += String.fromCodePoint(code);
    i += size;
  }
  return out;
}

function handleBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (event === 'ready' || event === 'resync') {
    backoff = 1000;
    emit('*', null);
    return;
  }
  if (event !== 'change') return;
  try {
    const payload = JSON.parse(data.join('\n'));
    if (typeof payload?.topic === 'string') emit(payload.topic, typeof payload.id === 'string' ? payload.id : null);
  } catch { /* Malformed signals are ignored. */ }
}

function startPolling() {
  if (pollTimer) return;
  // Without a stream (503, proxies that buffer), refetch on a slow cadence.
  pollTimer = setInterval(() => { if (appState === 'active') emit('*', null); }, 15000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function scheduleReconnect() {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, backoff);
  backoff = Math.min(backoff * 2, 30000);
}

async function connect() {
  if (stopped || connecting || controller || appState !== 'active' || !listeners.size) return;
  connecting = true;
  const abort = new AbortController();
  controller = abort;
  try {
    const { token } = await rustAccessToken();
    const response = await fetch(`${rustOrigin()}/v1/events`, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      signal: abort.signal,
    });
    connecting = false;
    if (response.status === 503) startPolling();
    if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
    stopPolling();
    const reader = response.body.getReader();
    let pending = new Uint8Array(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const merged = new Uint8Array(pending.length + chunk.length);
      merged.set(pending); merged.set(chunk, pending.length);
      // Split on a blank line (\n\n) at the byte level so UTF-8 never breaks.
      let start = 0;
      for (let i = 0; i + 1 < merged.length; i += 1) {
        if (merged[i] === 10 && merged[i + 1] === 10) {
          handleBlock(decodeUtf8(merged.subarray(start, i)).replace(/\r/g, ''));
          start = i + 2;
          i += 1;
        }
      }
      pending = merged.slice(start);
      if (pending.length > 64 * 1024) pending = new Uint8Array(0);
    }
  } catch {
    if (!abort.signal.aborted) startPolling();
  } finally {
    connecting = false;
    if (controller === abort) controller = null;
    // The server closes the stream when the access token expires; reconnect.
    if (!abort.signal.aborted) scheduleReconnect();
    // A reset that arrived while this attempt was still waiting for its token
    // (at launch: the stored-session restore) was skipped; connect for it now.
    else if (!controller) void connect();
  }
}

function disconnect() {
  controller?.abort();
  controller = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function ensureRunning() {
  if (!RUST_BACKEND) return;
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (next) => {
      const wasActive = appState === 'active';
      appState = next;
      if (next === 'active' && !wasActive) {
        backoff = 1000;
        emit('*', null);
        void connect();
      } else if (next !== 'active') {
        disconnect();
      }
    });
  }
  stopped = false;
  void connect();
}

/**
 * Listen for changes to `topic` (optionally one resource `id`). The callback
 * also runs after reconnects, when the app returns to the foreground and on
 * a slow poll if streaming is unavailable.
 */
export function onBackendChange(topic, callback, { id = null } = {}) {
  if (!RUST_BACKEND) return () => {};
  const listener = { id, callback };
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(listener);
  ensureRunning();
  return () => {
    listeners.get(topic)?.delete(listener);
    if (!listeners.get(topic)?.size) listeners.delete(topic);
    if (!listeners.size) {
      stopped = true;
      disconnect();
      stopPolling();
    }
  };
}

/** Reconnect with the current account (after sign-in or sign-out). */
export function resetBackendEvents() {
  disconnect();
  backoff = 1000;
  if (listeners.size && !stopped) void connect();
}

/**
 * onSnapshot-style live query: loads now, reloads (coalesced) whenever one
 * of `topics` changes. Returns an unsubscribe function.
 */
export function liveQuery(topics, load, onData, onError, { id = null, debounceMs = 150 } = {}) {
  let active = true;
  let timer = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (!active) return;
    if (running) { again = true; return; }
    running = true;
    try {
      const value = await load();
      if (active) onData(value);
    } catch (error) {
      if (active) onError?.(error);
    } finally {
      running = false;
      if (again && active) { again = false; void run(); }
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void run(); }, debounceMs);
  };
  const stops = (Array.isArray(topics) ? topics : [topics]).map((topic) => onBackendChange(topic, schedule, { id }));
  void run();
  const stop = () => {
    active = false;
    if (timer) clearTimeout(timer);
    stops.forEach((off) => off());
  };
  stop.refresh = run;
  return stop;
}
