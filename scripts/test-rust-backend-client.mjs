import test from 'node:test';
import assert from 'node:assert/strict';
import { createRustBackendClient, normalizeRustOrigin } from '../src/services/rustBackendProtocol.mjs';

const ORIGIN = 'https://api.example.test';
const tokens = (uid, digit = 'a') => ({ user: { uid, emailVerified: true }, accessToken: digit.repeat(64), refreshToken: (digit === 'a' ? 'b' : 'c').repeat(64), expiresIn: 900 });
const reply = (value, status = 200, extra = {}) => ({ ok: status < 400, status, url: ORIGIN, redirected: false, text: async () => JSON.stringify(value), ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(handler, options = {}) {
  let saved = null;
  const calls = [];
  const storage = { read: async () => saved, write: async value => { saved = structuredClone(value); }, clear: async () => { saved = null; } };
  const client = createRustBackendClient({ baseURL: ORIGIN, storage, fetch: async (url, opts) => {
    const request = { path: new URL(url).pathname, ...opts, json: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(request); return handler(request);
  }, ...options });
  return { client, calls, get saved() { return saved; } };
}

test('only a bare HTTPS origin can receive credentials', () => {
  assert.equal(normalizeRustOrigin(`${ORIGIN}/`), ORIGIN);
  for (const bad of ['http://api.example.test', `${ORIGIN}/api`, `${ORIGIN}?token=x`, 'https://user:password@api.example.test', `${ORIGIN}#x`]) {
    assert.throws(() => normalizeRustOrigin(bad));
  }
});

test('persist only refresh credentials and prevent subscriber errors interrupting sign-in', async () => {
  const f = fixture(() => reply(tokens('alice')));
  f.client.subscribe(() => {});
  await f.client.signIn('alice@example.test', 'correct password');
  f.client.subscribe(() => { throw new Error('subscriber failed'); });
  assert.equal(f.client.user.uid, 'alice');
  assert.deepEqual(Object.keys(f.saved).sort(), ['refreshToken', 'user']);
  assert.equal(f.calls[0].redirect, 'error');
});

test('concurrent requests share one refresh rotation', async () => {
  let current = 0, rotations = 0;
  const gate = deferred();
  const f = fixture(async req => {
    if (req.path.endsWith('/login')) return reply(tokens('alice'));
    if (req.path.endsWith('/refresh')) { rotations++; await gate.promise; return reply(tokens('alice', 'd')); }
    return reply({ ok: true });
  }, { now: () => current });
  await f.client.signIn('alice@example.test', 'correct password'); current = 899_000;
  const requests = Array.from({ length: 10 }, () => f.client.request('/v1/me/profile', { method: 'GET' }));
  await new Promise(resolve => setImmediate(resolve)); gate.resolve();
  await Promise.all(requests);
  assert.equal(rotations, 1);
  assert.equal(f.calls.filter(c => c.path.endsWith('/profile')).length, 10);
});

test('an old refresh cannot replace the account after a new sign-in', async () => {
  let current = 0;
  const gate = deferred();
  const f = fixture(async req => {
    if (req.path.endsWith('/login')) return reply(tokens(req.json.email.startsWith('alice') ? 'alice' : 'bob', req.json.email.startsWith('alice') ? 'a' : 'd'));
    if (req.path.endsWith('/refresh')) { await gate.promise; return reply(tokens('alice', 'e')); }
    return reply({ ok: true });
  }, { now: () => current });
  await f.client.signIn('alice@example.test', 'correct password'); current = 899_000;
  const old = f.client.request('/v1/me/profile', { method: 'GET' });
  const rejected = assert.rejects(old, { code: 'account-changed' });
  await new Promise(resolve => setImmediate(resolve));
  await f.client.signIn('bob@example.test', 'correct password');
  gate.resolve(); await rejected;
  assert.equal(f.client.user.uid, 'bob'); assert.equal(f.saved.user.uid, 'bob');
  await f.client.request('/v1/me/profile', { method: 'GET' });
});

test('a pending profile response cannot cross account boundaries', async () => {
  const gate = deferred();
  const f = fixture(req => req.path.endsWith('/login') ? reply(tokens(req.json.email)) : gate.promise);
  await f.client.signIn('alice', 'correct password');
  const response = f.client.request('/v1/me/profile');
  const rejected = assert.rejects(response, { code: 'account-changed' });
  await f.client.signIn('bob', 'correct password'); gate.resolve(reply({ private: 'alice' }));
  await rejected;
});

test('logout during credential persistence clears the completed write', async () => {
  const gate = deferred(); let saved = null;
  const f = fixture(() => reply(tokens('alice')), { storage: {
    read: async () => saved, clear: async () => { saved = null; },
    write: async value => { await gate.promise; saved = value; },
  } });
  const signing = f.client.signIn('alice', 'correct password');
  const rejected = assert.rejects(signing, { code: 'account-changed' });
  await new Promise(resolve => setImmediate(resolve));
  const logout = f.client.signOut(); gate.resolve(); await logout; await rejected;
  assert.equal(f.client.user, null); assert.equal(saved, null);
});

test('corrupt stored JSON is cleared while storage I/O failure remains visible', async () => {
  let cleared = 0;
  const f = fixture(() => reply({}), { storage: { read: async () => { throw new SyntaxError('corrupt JSON'); }, clear: async () => { cleared++; } } });
  assert.equal(await f.client.restore(), null); assert.equal(cleared, 1);
  const broken = fixture(() => reply({}), { storage: { read: async () => { throw new Error('keychain unavailable'); } } });
  await assert.rejects(broken.client.restore(), /keychain unavailable/);
});

test('secure storage deletion failure cannot prevent online logout revocation', async () => {
  let broken = false;
  const f = fixture(req => reply(req.path.endsWith('/login') ? tokens('alice') : { ok: true }), {
    storage: { read: async () => null, write: async () => {}, clear: async () => { if (broken) throw new Error('keychain deletion failed'); } },
  });
  await f.client.signIn('alice', 'correct password'); broken = true;
  await assert.rejects(f.client.signOut(), /keychain deletion failed/);
  assert.equal(f.client.user, null);
  const logout = f.calls.filter(call => call.path === '/v1/auth/logout');
  assert.equal(logout.length, 1);
  assert.equal(logout[0].headers.Authorization, `Bearer ${'a'.repeat(64)}`);
});

test('refresh rejection clears saved credentials and never invokes another backend', async () => {
  let current = 0;
  const f = fixture(req => req.path.endsWith('/login') ? reply(tokens('alice')) : reply({ error: { code: 'unauthenticated', message: 'expired' } }, 401), { now: () => current });
  await f.client.signIn('alice', 'correct password'); current = 899_000;
  await assert.rejects(f.client.request('/v1/me/profile'), { code: 'unauthenticated' });
  assert.equal(f.saved, null); assert.equal(f.client.user, null);
  assert.equal(f.calls.length, 2);
});

test('refresh cannot return a different identity', async () => {
  let current = 0;
  const f = fixture(req => reply(tokens(req.path.endsWith('/login') ? 'alice' : 'bob')), { now: () => current });
  await f.client.signIn('alice', 'correct password'); current = 899_000;
  await assert.rejects(f.client.request('/v1/me/profile'), /เปลี่ยนรหัสบัญชี/);
  assert.equal(f.client.user.uid, 'alice'); assert.equal(f.saved.user.uid, 'alice');
});

test('reject redirected, malformed and oversized responses', async () => {
  for (const response of [reply(tokens('alice'), 200, { redirected: true }), reply(tokens('alice'), 200, { url: 'https://other.example.test' }), reply(null, 200, { text: async () => 'bad json' }), reply(null, 200, { text: async () => ' '.repeat(2_000_001) })]) {
    const f = fixture(() => response); await assert.rejects(f.client.signIn('alice', 'correct password'));
    assert.equal(f.client.user, null);
  }
});

test('the timeout covers both connection and body reading', async () => {
  const f = fixture(req => reply(null, 200, { text: () => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) }), { timeoutMs: 10 });
  await assert.rejects(f.client.signIn('alice', 'correct password'), /aborted/);
});

test('a Firebase session is exchanged once and RPC results are unwrapped', async () => {
  const f = fixture(req => {
    if (req.path === '/v1/auth/firebase-exchange') return reply(tokens('legacy-uid'));
    if (req.path === '/v1/rpc/listConversations') return reply({ result: { conversations: [] } });
    if (req.path === '/v1/rpc/missing') return reply({ error: { code: 'not-found', message: 'missing' } }, 404);
    return reply({ ok: true });
  });
  await f.client.exchangeFirebase('header.payload.signature');
  assert.equal(f.client.user.uid, 'legacy-uid');
  assert.deepEqual(f.calls[0].json, { idToken: 'header.payload.signature' });
  assert.deepEqual(await f.client.rpc('listConversations', { a: 1 }), { conversations: [] });
  assert.deepEqual(f.calls.at(-1).json, { data: { a: 1 } });
  assert.equal(f.calls.at(-1).headers.Authorization, `Bearer ${'a'.repeat(64)}`);
  await assert.rejects(f.client.rpc('missing'), (error) => error.code === 'not-found' && error.status === 404);
  await assert.rejects(f.client.rpc('../escape'));
  const { token, uid } = await f.client.accessToken();
  assert.equal(token, 'a'.repeat(64));
  assert.equal(uid, 'legacy-uid');
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const stored = (uid, refreshToken = 'b'.repeat(64)) => ({ refreshToken, user: { uid, emailVerified: true } });
function launch(handler, read) {
  let saved = null, reads = 0;
  const { client, calls } = fixture(handler, { storage: {
    read: () => { reads++; return read(); }, write: async value => { saved = value; }, clear: async () => { saved = null; },
  } });
  return { client, calls, get saved() { return saved; }, get reads() { return reads; } };
}

test('requests made before the stored session is read wait for the launch restore', async () => {
  const read = deferred();
  const f = launch(req => req.path === '/v1/auth/refresh' ? reply(tokens('alice', 'd')) : reply({ result: { conversations: [] } }), () => read.promise);
  // Subscriptions start before the auth provider asks for the restore.
  const early = f.client.rpc('listConversations');
  const token = f.client.accessToken();
  const user = f.client.ready();
  const restored = f.client.restore();
  await tick(); read.resolve(stored('alice'));
  assert.deepEqual(await early, { conversations: [] });
  assert.equal((await token).uid, 'alice');
  assert.equal((await user).uid, 'alice');
  assert.equal((await restored).uid, 'alice');
  assert.equal(f.reads, 1);
  assert.deepEqual(f.calls.map(c => c.path), ['/v1/auth/refresh', '/v1/rpc/listConversations']);
  assert.deepEqual(f.calls[0].json, { refreshToken: 'b'.repeat(64) });
  assert.equal(f.calls[1].headers.Authorization, `Bearer ${'d'.repeat(64)}`);
});

test('without a stored session launch requests still reject as signed out', async () => {
  const f = launch(() => reply({}), async () => null);
  await assert.rejects(f.client.request('/v1/me/profile'), { code: 'unauthenticated' });
  await assert.rejects(f.client.accessToken(), { code: 'unauthenticated' });
  assert.equal(await f.client.ready(), null);
  // Once storage has answered, signed-out calls do not read it again.
  assert.equal(f.reads, 1); assert.equal(f.calls.length, 0);

  const revoked = launch(() => reply({ error: { code: 'unauthenticated', message: 'revoked' } }, 401), async () => stored('alice'));
  await assert.rejects(revoked.client.request('/v1/me/profile'), { code: 'unauthenticated', status: 401 });
  await assert.rejects(revoked.client.request('/v1/me/profile'), { code: 'unauthenticated' });
  assert.equal(revoked.client.user, null); assert.equal(revoked.reads, 1);
  assert.deepEqual(revoked.calls.map(c => c.path), ['/v1/auth/refresh']);
});

test('sign-out or sign-in during the launch restore cannot revive the stored session', async () => {
  // Sign-out while secure storage is still being read (the read returns the old value).
  const read = deferred();
  const out = launch(() => reply(tokens('alice', 'd')), () => read.promise);
  const early = assert.rejects(out.client.request('/v1/me/profile'), { code: 'account-changed' });
  await tick(); await out.client.signOut();
  read.resolve(stored('alice')); await early;
  assert.equal(out.client.user, null); assert.equal(out.saved, null);
  await assert.rejects(out.client.request('/v1/me/profile'), { code: 'unauthenticated' });
  assert.equal(await out.client.ready(), null);
  assert.equal(out.reads, 1); assert.equal(out.calls.length, 0);

  // Sign-in as another account while the stored session is being refreshed.
  const gate = deferred();
  const swap = launch(async req => {
    if (req.path === '/v1/auth/refresh') { await gate.promise; return reply(tokens('alice', 'e')); }
    if (req.path === '/v1/auth/login') return reply(tokens('bob', 'd'));
    return reply({ ok: true });
  }, async () => stored('alice'));
  const stale = assert.rejects(swap.client.request('/v1/me/profile'), { code: 'account-changed' });
  const staleUser = assert.rejects(swap.client.ready(), { code: 'account-changed' });
  while (!swap.calls.some(c => c.path === '/v1/auth/refresh')) await tick();
  await swap.client.signIn('bob', 'correct password');
  gate.resolve(); await stale; await staleUser;
  assert.equal(swap.client.user.uid, 'bob'); assert.equal(swap.saved.user.uid, 'bob');
  await swap.client.request('/v1/me/profile');
  assert.equal(swap.calls.at(-1).headers.Authorization, `Bearer ${'d'.repeat(64)}`);
  assert.equal(swap.calls.filter(c => c.path === '/v1/me/profile').length, 1);
});

test('public RPC works signed out and never sends a stale token', async () => {
  const f = fixture(() => reply({ result: { sent: true } }));
  assert.deepEqual(await f.client.publicRpc('sendBrandedPasswordReset', { email: 'a@psu.ac.th' }), { sent: true });
  assert.equal(f.calls[0].headers.Authorization, undefined);
  await assert.rejects(f.client.accessToken(), (error) => error.code === 'unauthenticated');
});
