// A native-backend session has no Firebase token, app instance or automatic legacy fallback.
export function normalizeRustOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Rust backend ต้องใช้ HTTPS origin ที่ไม่มี path หรือข้อมูลล็อกอิน');
  }
  return url.origin;
}

export function createRustBackendClient({ baseURL, fetch, storage, timeoutMs = 12000, now = Date.now }) {
  const origin = normalizeRustOrigin(baseURL);
  let session = null, epoch = 0, refreshing = null, restoring = null, writes = Promise.resolve();
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => { try { listener(session?.user ?? null); } catch { /* Subscribers cannot interrupt credential persistence. */ } });
  const persist = action => {
    const next = writes.catch(() => {}).then(action);
    writes = next;
    return next;
  };
  const changed = () => Object.assign(new Error('บัญชีเปลี่ยนแล้ว กรุณาลองอีกครั้ง'), { code: 'account-changed' });
  function validTokens(value) {
    return value && /^[0-9a-f]{64}$/.test(value.accessToken) && /^[0-9a-f]{64}$/.test(value.refreshToken)
      && typeof value.user?.uid === 'string' && value.user.uid.length > 0 && value.user.uid.length <= 128
      && Number.isFinite(value.expiresIn) && value.expiresIn > 0 && value.expiresIn <= 3600;
  }
  async function call(path, { method = 'POST', body, token } = {}) {
    if (!/^\/v1\/[a-zA-Z0-9/_-]+$/.test(path)) throw new Error('API path ไม่ถูกต้อง');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${origin}${path}`, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.redirected || (response.url && new URL(response.url).origin !== origin)) throw new Error('Backend redirect ถูกปฏิเสธ');
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('Backend response ใหญ่เกินไป');
      let value;
      try { value = JSON.parse(text); } catch { throw new Error('Backend response ไม่ถูกต้อง'); }
      if (!response.ok) {
        throw Object.assign(new Error(value.error?.message || 'บริการไม่พร้อมใช้งาน'), {
          code: value.error?.code || 'internal', status: response.status, details: value.error?.details,
        });
      }
      return value;
    } finally { clearTimeout(timer); }
  }
  async function accept(value, expected) {
    if (epoch !== expected) throw changed();
    if (!validTokens(value)) throw new Error('Backend session ไม่ถูกต้อง');
    await persist(async () => {
      if (epoch !== expected) throw changed();
      await storage.write({ refreshToken: value.refreshToken, user: value.user });
    });
    if (epoch !== expected) throw changed();
    session = { ...value, expiresAt: now() + value.expiresIn * 1000 };
    notify();
    return value.user;
  }
  async function refresh() {
    if (refreshing) return refreshing;
    const expected = epoch, previous = session;
    if (!previous?.refreshToken) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
    const pending = (async () => {
      try {
        const value = await call('/v1/auth/refresh', { body: { refreshToken: previous.refreshToken } });
        if (value.user?.uid !== previous.user.uid) throw new Error('Backend เปลี่ยนรหัสบัญชีใน session');
        await accept(value, expected);
      } catch (error) {
        if (epoch === expected && error.status === 401) {
          epoch++; session = null;
          await persist(() => storage.clear()); notify();
        }
        throw error;
      }
    })();
    refreshing = pending;
    try { return await pending; } finally { if (refreshing === pending) refreshing = null; }
  }
  return {
    origin,
    get user() { return session?.user ?? null; },
    subscribe(listener) { listeners.add(listener); try { listener(session?.user ?? null); } catch { /* Same isolation as notify. */ } return () => listeners.delete(listener); },
    async signIn(email, password) {
      const expected = ++epoch;
      refreshing = null; restoring = null;
      session = null; notify();
      await persist(() => storage.clear());
      const value = await call('/v1/auth/login', { body: { email, password } });
      return accept(value, expected);
    },
    // One-time move of a signed-in Firebase session (same UID) to a native session.
    async exchangeFirebase(idToken) {
      const expected = ++epoch;
      refreshing = null; restoring = null;
      session = null; notify();
      await persist(() => storage.clear());
      const value = await call('/v1/auth/firebase-exchange', { body: { idToken } });
      return accept(value, expected);
    },
    async signInWithGoogle(idToken) {
      const expected = ++epoch;
      refreshing = null; restoring = null;
      session = null; notify();
      await persist(() => storage.clear());
      const value = await call('/v1/auth/google', { body: { idToken } });
      return accept(value, expected);
    },
    async signUp(email, password) {
      const expected = ++epoch;
      refreshing = null; restoring = null;
      session = null; notify();
      await persist(() => storage.clear());
      const value = await call('/v1/auth/signup', { body: { email, password } });
      return accept(value, expected);
    },
    async restore() {
      if (session?.accessToken) return session.user;
      if (restoring) return restoring;
      const expected = epoch;
      const pending = (async () => {
        let saved;
        try { saved = await storage.read(); }
        catch (error) {
          if (epoch !== expected) throw changed();
          if (!(error instanceof SyntaxError)) throw error;
          await persist(() => storage.clear()); return null;
        }
        if (epoch !== expected) throw changed();
        if (!saved) return null;
        if (!/^[0-9a-f]{64}$/.test(saved.refreshToken) || typeof saved.user?.uid !== 'string' || !saved.user.uid.length || saved.user.uid.length > 128) {
          await persist(() => storage.clear()); return null;
        }
        session = { ...saved, expiresAt: 0 };
        await refresh(); return session?.user ?? null;
      })();
      restoring = pending;
      try { return await pending; } finally { if (restoring === pending) restoring = null; }
    },
    async signOut() {
      const previous = session;
      epoch++; session = null; notify();
      refreshing = null; restoring = null;
      let storageError;
      try { await persist(() => storage.clear()); } catch (error) { storageError = error; }
      if (previous?.accessToken) {
        // Local sign-out is immediate. Server revocation is best effort while offline.
        await call('/v1/auth/logout', { token: previous.accessToken }).catch(() => {});
      }
      // Failed local deletion must remain visible, but cannot prevent online
      // revocation of credentials that may still be present in secure storage.
      if (storageError) throw storageError;
    },
    async request(path, options = {}) {
      const expected = epoch;
      if (!session?.user) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
      if (session.expiresAt <= now() + 30000) await refresh();
      if (epoch !== expected) throw changed();
      let value;
      const attemptedToken = session.accessToken;
      try { value = await call(path, { ...options, token: attemptedToken }); }
      catch (error) {
        if (epoch !== expected) throw changed();
        if (error.status !== 401) throw error;
        if (session.accessToken === attemptedToken) await refresh();
        if (epoch !== expected) throw changed();
        value = await call(path, { ...options, token: session.accessToken });
      }
      if (epoch !== expected) throw changed();
      return value;
    },
    // A fresh access token for transports the request helper cannot wrap
    // (Server-Sent Events, native file uploads). Never persist the result.
    async accessToken() {
      const expected = epoch;
      if (!session?.user) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
      if (session.expiresAt <= now() + 30000) await refresh();
      if (epoch !== expected || !session?.accessToken) throw changed();
      return { token: session.accessToken, uid: session.user.uid };
    },
    async refreshUser() {
      const value = await this.request('/v1/auth/me', { method: 'GET' });
      if (value?.user?.uid && session?.user?.uid === value.user.uid) {
        session = { ...session, user: value.user };
        await persist(() => storage.write({ refreshToken: session.refreshToken, user: value.user }));
        notify();
      }
      return session?.user ?? null;
    },
    async rpc(name, data = {}) {
      if (!/^[A-Za-z0-9]{1,64}$/.test(name)) throw new Error('RPC name ไม่ถูกต้อง');
      const value = await this.request(`/v1/rpc/${name}`, { body: { data } });
      return value?.result;
    },
    // Signed-out callers (password reset, campus email availability).
    async publicRpc(name, data = {}) {
      if (!/^[A-Za-z0-9]{1,64}$/.test(name)) throw new Error('RPC name ไม่ถูกต้อง');
      const value = await call(`/v1/rpc/${name}`, { body: { data }, token: session?.accessToken });
      return value?.result;
    },
    verifyEmail: token => call('/v1/auth/verify-email', { body: { token } }),
    forgotPassword: email => call('/v1/auth/forgot-password', { body: { email } }),
    resetPassword: (token, password) => call('/v1/auth/reset-password', { body: { token, password } }),
  };
}
