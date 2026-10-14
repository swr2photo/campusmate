// Admin console session for the native (Rust) backend. Tokens stay in memory
// only: closing the tab signs the administrator out.
type Principal = { uid: string; email: string; emailVerified: boolean; role: string };
type Session = { accessToken: string; refreshToken: string; expiresAt: number; user: Principal };
type Listener = (user: Principal | null) => void;

export const RUST_ADMIN = import.meta.env.VITE_BACKEND === 'rust';
const ORIGIN = String(import.meta.env.VITE_RUST_BACKEND_URL || '').replace(/\/+$/, '');

let session: Session | null = null;
let refreshing: Promise<void> | null = null;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((listener) => listener(session?.user ?? null));

async function call(path: string, body?: unknown, token?: string) {
  if (!ORIGIN.startsWith('https://')) throw new Error('ยังไม่ได้ตั้งค่า VITE_RUST_BACKEND_URL');
  const response = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(value?.error?.message || 'บริการไม่พร้อมใช้งาน'), {
      code: value?.error?.code || 'internal', status: response.status, details: value?.error?.details,
    });
  }
  return value;
}

function accept(value: any) {
  session = { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: Date.now() + value.expiresIn * 1000, user: value.user };
  notify();
}

async function refresh() {
  if (!session) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
  if (!refreshing) {
    const current = session;
    refreshing = call('/v1/auth/refresh', { refreshToken: current.refreshToken })
      .then(accept)
      .catch((error) => { session = null; notify(); throw error; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export const rustAdmin = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    listener(session?.user ?? null);
    return () => { listeners.delete(listener); };
  },
  async signIn(email: string, password: string) {
    accept(await call('/v1/auth/login', { email, password }));
  },
  async signOut() {
    const current = session;
    session = null;
    notify();
    if (current) await call('/v1/auth/logout', {}, current.accessToken).catch(() => {});
  },
  async console(op: string, data: Record<string, unknown> = {}) {
    if (!session) throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { code: 'unauthenticated' });
    if (session.expiresAt <= Date.now() + 30_000) await refresh();
    try {
      return (await call('/v1/rpc/adminConsole', { data: { op, ...data } }, session!.accessToken)).result;
    } catch (error: any) {
      if (error?.status !== 401) throw error;
      await refresh();
      return (await call('/v1/rpc/adminConsole', { data: { op, ...data } }, session!.accessToken)).result;
    }
  },
};
