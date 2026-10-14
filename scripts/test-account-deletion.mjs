import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Link the real ES modules so a missing named export fails exactly as it does
// in the app. Mock only platform, storage and remote boundaries; never delete
// a real identity or send a real OTP from these tests.
async function harness({ rust = false, configured = true, signedIn = true, reauthError, callableError, response = {} } = {}) {
  const calls = [];
  const user = signedIn ? { uid: 'test-user', email: 'test@example.test' } : null;
  const auth = { currentUser: user };
  const context = vm.createContext({ console: { warn() {}, error() {} }, setTimeout, clearTimeout, __DEV__: false });
  const modules = new Map();
  function mock(name, values) {
    const module = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context, identifier: name });
    modules.set(name, module);
    return module;
  }
  const authNames = /import\s*\{([^}]+)\}\s*from 'firebase\/auth'/.exec(readFileSync('src/services/authService.js', 'utf8'))[1]
    .split(',').map(name => name.trim()).filter(Boolean);
  mock('firebase/auth', {
    ...Object.fromEntries(authNames.map(name => [name, () => { throw new Error(`Unexpected Auth call: ${name}`); }])),
    getAuth: () => auth,
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    reauthenticateWithCredential: async (current, credential) => {
      calls.push({ name: 'reauth', current, credential });
      if (reauthError) throw reauthError;
    },
  });
  mock('firebase/functions', { getFunctions: () => ({}), httpsCallable: () => { throw new Error('Use shared callable adapter'); } });
  mock('react-native', { Platform: { OS: 'web' }, NativeModules: {}, TurboModuleRegistry: {} });
  mock('./dbService', { firebaseApp: configured ? {} : null, firebaseConfigError: null, requireFirebase: () => ({ app: {}, db: {} }) });
  mock('@react-native-async-storage/async-storage', { default: {} });
  const campusSource = readFileSync('src/services/authService.js', 'utf8');
  const campusNames = /import\s*\{([^}]+)\}\s*from '\.\.\/utils\/campusEmail'/.exec(campusSource)[1]
    .split(',').map(name => name.trim()).filter(Boolean);
  mock('../utils/campusEmail', Object.fromEntries(campusNames.map(name => [name, () => {}])));
  mock('../utils/passwordPolicy', { getPasswordError: () => null, PASSWORD_REQUIREMENTS_MESSAGE: '' });
  mock('./rust/auth', {});
  mock('./rust/backend', {
    RUST_BACKEND: rust,
    rustClient: () => ({ user }),
    rpc: async (name, data) => { calls.push({ name, data }); if (callableError) throw callableError; return { verified: true, email: user?.email, sent: true, ...response }; },
  });
  mock('./callableClient', { getCallable: name => async data => {
    calls.push({ name, data });
    if (callableError) throw callableError;
    return { data: { verified: true, sent: true, email: user?.email, ...response } };
  } });
  const firestoreNames = ['doc', 'getDoc', 'setDoc', 'serverTimestamp', 'deleteDoc'];
  mock('firebase/firestore', Object.fromEntries(firestoreNames.map(name => [name, () => { throw new Error(`Unexpected client OTP fallback: ${name}`); }])));
  for (const [id, file] of [['./authService', 'src/services/authService.js'], ['./accountSecurityService', 'src/services/accountSecurityService.js']]) {
    modules.set(id, new vm.SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: id }));
  }
  const security = modules.get('./accountSecurityService');
  await security.link(name => {
    assert.ok(modules.has(name), `Unmocked dependency: ${name}`);
    return modules.get(name);
  });
  await security.evaluate();
  return { api: security.namespace, authApi: modules.get('./authService').namespace, auth, calls };
}

test('Firebase deletion links the real Auth exports and reauthenticates the signed-in user', async () => {
  const h = await harness();
  assert.equal(typeof h.authApi.requireAuth, 'function');
  assert.equal(h.authApi.requireAuth(), h.auth);
  assert.equal(h.auth.languageCode, 'th');
  assert.equal(await h.api.verifyUserPassword('test-password'), true);
  assert.equal(h.calls[0].current, h.auth.currentUser);
  assert.deepEqual(h.calls[0].credential, { email: 'test@example.test', password: 'test-password' });
});

test('Firebase deletion rejects incorrect passwords before remote deletion', async () => {
  const h = await harness({ reauthError: { code: 'auth/invalid-credential' } });
  await assert.rejects(h.api.verifyUserPassword('wrong-password'), /รหัสผ่านไม่ถูกต้อง/);
  assert.deepEqual(h.calls.map(call => call.name), ['reauth']);
});

test('Firebase deletion rejects missing configuration or a signed-out user with a useful error', async () => {
  const missing = await harness({ configured: false });
  await assert.rejects(missing.api.verifyUserPassword('test-password'), /Firebase Authentication is not initialized/);
  const signedOut = await harness({ signedIn: false });
  await assert.rejects(signedOut.api.verifyUserPassword('test-password'), /เข้าสู่ระบบใหม่/);
  assert.equal(signedOut.calls.length, 0);
});

test('Firebase deletion requests and verifies OTP through the server', async () => {
  const h = await harness();
  assert.equal((await h.api.requestDeletionOtp()).success, true);
  assert.equal(await h.api.verifyDeletionOtp('123456'), true);
  assert.deepEqual(h.calls.map(call => call.name), ['sendAccountDeletionOtp', 'verifyAccountDeletionOtp']);
});

test('Rust deletion uses native RPC without initializing Firebase Auth', async () => {
  const h = await harness({ rust: true, configured: false });
  assert.equal(await h.api.verifyUserPassword('test-password'), true);
  assert.equal((await h.api.requestDeletionOtp()).success, true);
  assert.equal(await h.api.verifyDeletionOtp('123456'), true);
  assert.deepEqual(h.calls.map(call => call.name), ['verifyPassword', 'sendAccountDeletionOtp', 'verifyAccountDeletionOtp']);
});

test('incomplete OTP never reaches either backend', async () => {
  for (const rust of [false, true]) {
    const h = await harness({ rust });
    await assert.rejects(h.api.verifyDeletionOtp('123'), /ครบ 6 หลัก/);
    assert.equal(h.calls.length, 0);
  }
});

test('OTP outages never fall back to device-generated or client-writable codes', async () => {
  for (const rust of [false, true]) {
    const error = Object.assign(new Error('OTP unavailable'), { code: 'functions/not-found' });
    const h = await harness({ rust, callableError: error });
    await assert.rejects(h.api.requestDeletionOtp(), caught => caught === error);
    await assert.rejects(h.api.verifyDeletionOtp('123456'), caught => caught === error);
  }
});

test('negative OTP results block deletion and passwords preserve significant spaces', async () => {
  for (const rust of [false, true]) {
    const h = await harness({ rust, response: { verified: false, sent: false } });
    await assert.rejects(h.api.requestDeletionOtp());
    await assert.rejects(h.api.verifyDeletionOtp('123456'));
    await h.api.verifyUserPassword(' test-password ');
    const call = h.calls.at(-1);
    assert.equal(rust ? call.data.password : call.credential.password, ' test-password ');
  }
});

async function deletion({ remoteError, result = { deleted: true, userId: 'owner' }, failingStep } = {}) {
  const calls = [], context = vm.createContext({ console: { warn() {} } });
  const run = async name => { calls.push(name); if (failingStep === name) throw new Error('simulated local failure'); };
  const dependencies = {
    './authService': { signOutUser: () => run('signOut') },
    './offlineStorage': { clearOfflineDataForUser: () => run('offline') },
    './chatEncryptionService': { clearEncryptionIdentity: () => run('encryption') },
    './accountStorage': { clearActiveUser: () => run('active'), removeSavedAccount: id => run(`saved:${id}`) },
    './fastBootService': { clearFastBootData: () => run('boot') },
    './callableClient': { callFunction: async (name, data, options) => {
      calls.push({ name, data, options }); if (remoteError) throw remoteError; return result;
    } },
  };
  const module = new vm.SourceTextModule(readFileSync('src/services/deleteAccount.js', 'utf8'), { context });
  await module.link(name => {
    assert.ok(dependencies[name], `Unexpected deletion dependency: ${name}`);
    const values = dependencies[name];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { run: () => module.namespace.deleteAccountData('owner', 'test@example.test'), calls };
}

test('failed server deletion preserves client state, error identity and authorization details', async () => {
  const remoteError = Object.assign(new Error('OTP expired'), { code: 'functions/failed-precondition' });
  const h = await deletion({ remoteError });
  await assert.rejects(h.run(), caught => caught === remoteError);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.retries, 0);
  assert.equal(h.calls[0].name, 'deleteUserData');
  assert.equal(Object.keys(h.calls[0].data).length, 0);
});

test('missing deletion confirmation or foreign identity cannot clear local data', async () => {
  for (const result of [null, { deleted: false }, { deleted: true, userId: 'someone-else' }]) {
    const h = await deletion({ result }); await assert.rejects(h.run());
    assert.equal(h.calls.length, 1);
  }
});

test('after confirmed deletion, a cache failure cannot prevent other cleanup or sign-out', async () => {
  const h = await deletion({ failingStep: 'offline' });
  const result = await h.run();
  assert.equal(result.deleted, true);
  assert.equal(result.localCleanupPending, true);
  assert.deepEqual(h.calls.slice(1), ['saved:owner', 'saved:test@example.test', 'active', 'boot', 'offline', 'encryption', 'signOut']);
});

test('a sign-out failure explicitly records that remote deletion has already succeeded', async () => {
  const h = await deletion({ failingStep: 'signOut' });
  await assert.rejects(h.run(), error => error.accountDeleted === true && error.message.includes('บัญชีถูกลบแล้ว'));
});
