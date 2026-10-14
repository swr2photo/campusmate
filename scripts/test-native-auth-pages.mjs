import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const script = await readFile(new URL('../rust-backend/web/auth-action.js', import.meta.url), 'utf8');
function harness({ reset = false, hash = `#token=${'a'.repeat(64)}`, fetcher, fastTimeout = false } = {}) {
  const elements = Object.fromEntries(['action-form', 'submit', 'status', 'password', 'confirmation'].map(id => [id, {
    value: '', textContent: '', disabled: id === 'submit', attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    focus() { this.focused = true; },
    addEventListener(_, fn) { this.submit = fn; },
  }]));
  const calls = [], history = [], listeners = {};
  const location = { hash, pathname: reset ? '/auth/reset-password' : '/auth/verify-email', origin: 'https://auth.example.test', reload() { location.reloaded = true; } };
  const context = {
    document: { getElementById: id => elements[id], body: { dataset: { action: reset ? 'reset-password' : 'verify-email' } } },
    location, history: { replaceState: (...args) => history.push(args) },
    window: { addEventListener: (event, fn) => { listeners[event] = fn; } },
    URL, TextEncoder, AbortController, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, fastTimeout ? 1 : ms),
    fetch: async (path, options) => {
      calls.push({ path, options });
      return fetcher ? fetcher(path, options) : { url: location.origin + path, ok: true, status: 200, text: async () => '{"ok":true}' };
    },
  };
  vm.runInNewContext(script, context);
  return { elements, calls, history, listeners, location, submit: () => elements['action-form'].submit?.({ preventDefault() {} }) };
}

test('opening and previewing an email link never consumes a challenge; secrets leave browser history', async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.equal(h.elements.submit.disabled, false);
  assert.equal(h.history[0][2], '/auth/verify-email');
  assert.ok(!JSON.stringify(h.history).includes('a'.repeat(64)));
  h.listeners.hashchange(); assert.equal(h.location.reloaded, true);
  await h.submit();
  assert.equal(h.calls[0].path, '/v1/auth/verify-email');
  assert.equal(h.calls[0].options.redirect, 'error');
  assert.equal(h.calls[0].options.credentials, 'omit');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { token: 'a'.repeat(64) });
  assert.equal(h.elements.submit.disabled, true);
  await h.submit(); assert.equal(h.calls.length, 1);
});

test('missing, query-only, duplicate or malformed fragment tokens cannot be submitted', async () => {
  for (const hash of ['', '#token=bad', `#token=${'A'.repeat(64)}`, `#token=${'a'.repeat(64)}&token=${'b'.repeat(64)}`]) {
    const h = harness({ hash });
    await h.submit(); assert.equal(h.calls.length, 0); assert.equal(h.elements.submit.disabled, true);
  }
});

test('reset validates Unicode length and matching confirmation, and links errors to fields', async () => {
  const h = harness({ reset: true });
  h.elements.password.value = 'short'; h.elements.confirmation.value = 'short';
  await h.submit(); assert.equal(h.calls.length, 0); assert.equal(h.elements.password.attributes['aria-invalid'], 'true');
  h.elements.password.value = '🔒'.repeat(12); h.elements.confirmation.value = 'different';
  await h.submit(); assert.equal(h.calls.length, 0); assert.equal(h.elements.confirmation.focused, true);
  h.elements.confirmation.value = h.elements.password.value;
  await h.submit(); assert.equal(h.calls[0].path, '/v1/auth/reset-password');
  assert.equal(JSON.parse(h.calls[0].options.body).password, '🔒'.repeat(12));
  assert.equal(h.elements.password.value, ''); assert.equal(h.elements.confirmation.value, '');
});

test('parallel submissions share one request and show a busy form', async () => {
  let finish;
  const h = harness({ fetcher: path => new Promise(resolve => { finish = () => resolve({ url: `https://auth.example.test${path}`, ok: true, text: async () => '{"ok":true}' }); }) });
  const pending = h.submit();
  assert.equal(h.elements['action-form'].attributes['aria-busy'], 'true');
  await h.submit(); assert.equal(h.calls.length, 1);
  finish(); await pending;
  assert.equal(h.elements['action-form'].attributes['aria-busy'], undefined);
});

test('redirect, invalid/oversized body and timeout never mark a challenge successful', async () => {
  const cases = [
    async () => ({ url: 'https://other.example.test', ok: true, text: async () => '{"ok":true}' }),
    async () => ({ url: 'https://auth.example.test/path', redirected: true, ok: true, text: async () => '{"ok":true}' }),
    async () => ({ url: 'https://auth.example.test/path', ok: true, text: async () => 'not JSON' }),
    async () => ({ url: 'https://auth.example.test/path', ok: true, text: async () => 'x'.repeat(8193) }),
    async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')))),
  ];
  for (const fetcher of cases) {
    const h = harness({ fetcher, fastTimeout: true }); await h.submit();
    assert.equal(h.elements.submit.disabled, false); assert.ok(h.elements.status.textContent.includes('เชื่อมต่อไม่สำเร็จ'));
  }
});

test('expired challenges and provider backpressure remain visible and retryable without exposing server content', async () => {
  for (const status of [400, 429, 503]) {
    const h = harness({ fetcher: async path => ({ url: `https://auth.example.test${path}`, ok: false, status, text: async () => '{"error":{"message":"SECRET SERVER TEXT"}}' }) });
    await h.submit(); assert.equal(h.elements.submit.disabled, false);
    assert.ok(!h.elements.status.textContent.includes('SECRET SERVER TEXT'));
    assert.ok(h.elements.status.textContent.includes(status === 503 ? 'เซิร์ฟเวอร์' : status === 429 ? 'คำขอมากเกินไป' : 'ลิงก์หมดอายุ'));
  }
});
