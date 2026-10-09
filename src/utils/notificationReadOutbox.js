const KEY_PREFIX = '@campusmate:notification-read-outbox:v1:';
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const validUid = uid => typeof uid === 'string' && uid.length > 0 && uid.length <= 128;

function changedAccount() {
  const error = new Error('Notification read account changed');
  error.code = 'outbox/account-changed';
  return error;
}

// Only receipt identifiers and their local read times go to disk. The server
// write supplies its own timestamp and remains authoritative for other devices.
export function createNotificationReadOutbox({ storage, currentUid, write, now = Date.now }) {
  const states = new Map();
  const key = uid => KEY_PREFIX + encodeURIComponent(uid);
  const stateFor = uid => {
    if (!states.has(uid)) states.set(uid, {
      uid, generation: 0, loaded: false, receipts: new Map(), listeners: new Set(),
      serial: Promise.resolve(), flushing: null, flushRequested: false,
    });
    return states.get(uid);
  };
  const authorized = (state, generation) => state.generation === generation && currentUid() === state.uid;
  const copy = state => [...state.receipts].map(([id, readAt]) => ({ id, readAt }));
  const notify = state => {
    if (currentUid() !== state.uid) return;
    state.listeners.forEach(listener => {
      if (!listener.active || listener.generation !== state.generation) return;
      try { listener.callback(copy(state)); } catch {}
    });
  };
  // Loads, enqueues, acknowledgements and clears share one storage lane per UID.
  const serialize = (state, generation, operation) => {
    const result = state.serial.then(() => operation(generation));
    state.serial = result.catch(() => {});
    return result;
  };
  const sanitize = raw => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return new Map(); }
    const receipts = new Map(), time = now();
    if (!Array.isArray(parsed)) return receipts;
    parsed.forEach(receipt => {
      if (!receipt || !validId(receipt.id) || !Number.isSafeInteger(receipt.readAt)
        || receipt.readAt < 0 || receipt.readAt > time || receipt.readAt < time - RETENTION_MS) return;
      const earlier = receipts.get(receipt.id);
      receipts.set(receipt.id, earlier == null ? receipt.readAt : Math.min(earlier, receipt.readAt));
    });
    return receipts;
  };
  const load = async (state, generation) => {
    if (!authorized(state, generation)) return false;
    if (state.loaded) return true;
    const raw = await storage.getItem(key(state.uid));
    if (!authorized(state, generation)) return false;
    const receipts = sanitize(raw);
    const clean = JSON.stringify([...receipts].map(([id, readAt]) => ({ id, readAt })));
    if (raw != null && raw !== clean) {
      if (receipts.size) await storage.setItem(key(state.uid), clean);
      else await storage.removeItem(key(state.uid));
      if (!authorized(state, generation)) return false;
    }
    state.receipts = receipts;
    state.loaded = true;
    notify(state);
    return true;
  };
  const persist = async (state, generation, receipts) => {
    if (!authorized(state, generation)) return false;
    const payload = JSON.stringify([...receipts].map(([id, readAt]) => ({ id, readAt })));
    if (receipts.size) await storage.setItem(key(state.uid), payload);
    else await storage.removeItem(key(state.uid));
    if (!authorized(state, generation)) {
      if (state.generation === generation) state.loaded = false;
      return false;
    }
    state.receipts = receipts;
    notify(state);
    return true;
  };

  async function enqueue(uid, id) {
    if (!validUid(uid) || currentUid() !== uid) throw changedAccount();
    if (!validId(id)) {
      const error = new Error('Invalid notification receipt identifier');
      error.code = 'outbox/invalid-id';
      throw error;
    }
    const state = stateFor(uid), generation = state.generation;
    const receipt = await serialize(state, generation, async () => {
      if (!await load(state, generation)) throw changedAccount();
      const receipts = new Map(state.receipts);
      if (!receipts.has(id)) receipts.set(id, Math.max(0, Math.floor(now())));
      if (!await persist(state, generation, receipts)) throw changedAccount();
      return { id, readAt: receipts.get(id) };
    });
    // A Firestore request may stay pending offline. It must never hold up the
    // caller after the local receipt has reached durable storage.
    void flush(uid).catch(() => {});
    return receipt;
  }

  function flush(uid) {
    if (!validUid(uid) || currentUid() !== uid) return Promise.resolve({ pending: 0, blocked: true });
    const state = stateFor(uid);
    if (state.flushing) { state.flushRequested = true; return state.flushing; }
    const generation = state.generation;
    state.flushRequested = false;
    const run = async () => {
      let acknowledged = 0, discarded = 0;
      while (authorized(state, generation)) {
        const next = await serialize(state, generation, async () => {
          if (!await load(state, generation)) return null;
          return copy(state)[0] || null;
        });
        if (!next || !authorized(state, generation)) break;
        let permanent = false;
        try { await write(uid, next.id); }
        catch (error) {
          const code = String(error?.code || '').split('/').at(-1);
          permanent = code === 'permission-denied' || code === 'not-found';
          if (!permanent) return { acknowledged, discarded, pending: state.receipts.size, errorCode: code || 'transient' };
        }
        if (!authorized(state, generation)) break;
        const removed = await serialize(state, generation, async () => {
          if (!authorized(state, generation)) return false;
          const receipts = new Map(state.receipts);
          receipts.delete(next.id);
          return persist(state, generation, receipts);
        });
        if (!removed) break;
        if (permanent) discarded++; else acknowledged++;
      }
      return { acknowledged, discarded, pending: state.receipts.size, blocked: !authorized(state, generation) };
    };
    state.flushing = run().finally(() => {
      const requested = state.flushRequested || state.generation !== generation;
      state.flushing = null;
      state.flushRequested = false;
      if (requested && currentUid() === uid) void flush(uid).catch(() => {});
    });
    return state.flushing;
  }

  function subscribe(uid, callback) {
    if (!validUid(uid) || typeof callback !== 'function') return () => {};
    const state = stateFor(uid), generation = state.generation;
    const listener = { callback, generation, active: true };
    state.listeners.add(listener);
    void serialize(state, generation, async () => {
      if (await load(state, generation) && listener.active && authorized(state, generation)) {
        try { callback(copy(state)); } catch {}
      }
    }).catch(() => {});
    return () => { listener.active = false; state.listeners.delete(listener); };
  }

  async function clear(uid) {
    if (!validUid(uid)) return;
    const state = stateFor(uid);
    state.generation++;
    state.loaded = false;
    state.receipts = new Map();
    state.listeners.forEach(listener => {
      if (listener.active && currentUid() === uid) {
        try { listener.callback([]); } catch {}
      }
      listener.active = false;
    });
    state.listeners.clear();
    const generation = state.generation;
    await serialize(state, generation, async () => {
      await storage.removeItem(key(uid));
      if (state.generation === generation) state.loaded = true;
    });
  }
  return { enqueue, flush, subscribe, clear };
}
