// A deliberately separate client: Firebase tokens are sent only to the
// identity API, never exchanged for native passwords or stored in this client.
export function createFirebaseIdentityClient({ origin, fetch, getIdToken, getUserId = () => null, timeoutMs = 15000 }) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Identity backend must be an HTTPS origin');
  }
  return {
    async request(path, { method = 'GET', body, signal } = {}) {
      const cancelled = () => Object.assign(new Error('Request cancelled'), { code: 'CANCELLED' });
      if (signal?.aborted) throw cancelled();
      if (!/^\/v1\/identity\/[a-zA-Z0-9/-]+$/.test(path)) throw new Error('Identity endpoint required');
      const subject = getUserId();
      const changed = () => Object.assign(new Error('Account changed'), { code: 'account-changed' });
      const token = await getIdToken();
      if (signal?.aborted) throw cancelled();
      if (getUserId() !== subject) throw changed();
      if (typeof token !== 'string' || !token) throw Object.assign(new Error('Login required'), { code: 'unauthenticated' });
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
      const response = await fetch(`${url.origin}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.redirected || (response.url && new URL(response.url).origin !== url.origin)) throw new Error('Identity redirect refused');
      let data;
      try { data = await response.json(); } catch { throw Object.assign(new Error('Service unavailable'), { code: 'SERVICE_UNAVAILABLE' }); }
      if (getUserId() !== subject) throw changed();
      if (!response.ok) throw Object.assign(new Error(data?.error?.message || 'Service unavailable'), {
        code: data?.error?.code || 'SERVICE_UNAVAILABLE', details: data?.error?.details,
      });
      if (signal?.aborted) throw cancelled();
      return data;
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  };
}
