// Regression tests for the 3.0.0 "stuck on the welcome photo" cold start:
// 1. secure callables ran before Firebase Auth restored currentUser and latched
//    a permanent "please sign in" error in AppContext;
// 2. RN 0.88 removed StyleSheet.absoluteFillObject, so the error screen's
//    background photo was laid out in-flow and pushed its retry card off-screen.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

function loadService(auth, calls) {
  const source = read('src/services/secureDiscoveryService.js')
    .replace(/^import .*;\n/gm, '').replace(/export (?=(?:async )?function|const)/g, '');
  const context = vm.createContext({ console, Map, Set, Date, Promise, setTimeout, clearTimeout,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    Constants: { expoConfig: { extra: { secureDiscoveryEnabled: true } } },
    Crypto: { randomUUID: () => 'id' }, requireFirebase: () => ({ app: {}, db: {} }), getAuth: () => auth,
    onAuthStateChanged: () => () => {}, getFunctions: () => ({}),
    httpsCallable: (_functions, name) => async (data) => { calls.push(name); return { data: { ok: true, profiles: [] } }; },
    doc: (_db, ...parts) => parts.join('/'), onSnapshot: () => () => {},
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(source + '\nglobalThis.api = { secureDiscoveryCall, subscribeSecureProfile, waitForAuthReady };', context);
  return context.api;
}

test('secure callables wait for Firebase Auth to restore a returning session', async () => {
  let ready;
  const auth = { currentUser: null, authStateReady: () => new Promise((resolve) => { ready = resolve; }) };
  const calls = [];
  const api = loadService(auth, calls);
  const pending = api.secureDiscoveryCall('getMyDecisionState');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [], 'must not call or fail before Auth is ready');
  auth.currentUser = { uid: 'owner' };
  ready();
  assert.deepEqual(await pending, { ok: true, profiles: [] });
  assert.deepEqual(calls, ['getMyDecisionState']);
});

test('a genuinely signed-out restore still rejects as unauthenticated', async () => {
  const auth = { currentUser: null, authStateReady: async () => {} };
  const api = loadService(auth, []);
  await assert.rejects(api.secureDiscoveryCall('getMyDecisionState'), (error) => error.code === 'unauthenticated');
});

test('a chat partner subscription opened during the restore starts once Auth is ready', async () => {
  let ready;
  const auth = { currentUser: null, authStateReady: () => new Promise((resolve) => { ready = resolve; }) };
  const calls = [], seen = [];
  const api = loadService(auth, calls);
  api.subscribeSecureProfile('partner', (profile) => seen.push(profile));
  auth.currentUser = { uid: 'owner' };
  ready();
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['getVisibleProfiles']);
});

test('getUserProfile waits for Auth before deciding the owner is a stranger', () => {
  const service = read('src/services/firestoreService.js');
  const body = service.slice(service.indexOf('export async function getUserProfile('), service.indexOf('export async function createUserProfile('));
  assert.match(body, /await waitForAuthReady\(/);
  assert.ok(body.indexOf('waitForAuthReady') < body.indexOf('getPublicProfile(userId)'));
});

test('no app code uses StyleSheet.absoluteFillObject (removed in React Native 0.88)', () => {
  const rn = read('node_modules/react-native/Libraries/StyleSheet/StyleSheetExports.js');
  assert.ok(!/^\s*absoluteFillObject[,:]/m.test(rn), 'RN still exports absoluteFillObject; this guard can be relaxed');
  const offenders = [];
  const walk = (dir) => readdirSync(dir).forEach((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return walk(file);
    if (/\.(js|jsx|ts|tsx)$/.test(name) && read(file).includes('StyleSheet.absoluteFillObject')) offenders.push(file);
  });
  ['src', 'app'].forEach(walk);
  assert.deepEqual(offenders, []);
});