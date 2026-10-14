import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const helper = readFileSync('src/utils/faceVerificationState.js', 'utf8').replace(/^export /gm, '');
const sync = readFileSync('src/services/ownProfileSync.js', 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const service = readFileSync('src/services/firestoreService.js', 'utf8');
export function loadOwnProfileSync(dependencies = {}) {
  const context = vm.createContext({ ...dependencies });
  vm.runInContext(`${helper}\n${sync}\nglobalThis.api = {mergePendingOwnProfile, subscribeToOwnProfileUpdates};`, context);
  return context.api;
}
export function loadProfileListener(dependencies) {
  const context = vm.createContext({ RUST_BACKEND: false, ...dependencies });
  const body = service.slice(service.indexOf('export function subscribeToFaceVerification('), service.indexOf('export async function getUserProfile('))
    .replace(/^export /gm, '').replace("import('firebase/auth')", 'Promise.resolve({getAuth})');
  vm.runInContext(`${body}\nglobalThis.subscribe = subscribeToUserProfile;`, context);
  return context.subscribe;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(queue = async () => []) {
  let emit, fail, stopped = false, current = true;
  const values = [], errors = [];
  const api = loadOwnProfileSync({ getOfflineQueue: queue, subscribeToUserProfile: (id, callback, error) => {
    assert.equal(id, 'owner'); emit = callback; fail = error; return () => { stopped = true; };
  } });
  const stop = api.subscribeToOwnProfileUpdates('owner', value => values.push(value), error => errors.push(error), () => current);
  return { api, values, errors, stop, emit: value => emit(value), fail: error => fail(error), switchUser: () => { current = false; }, stopped: () => stopped };
}

test('remote avatar, revision, name and removed fields replace the cached owner record', async () => {
  const f = fixture();
  await f.emit({ id: 'owner', avatarUri: 'same-url', avatarRevision: 1, nickname: 'Before', bio: 'old', isFaceVerified: true });
  await f.emit({ id: 'owner', avatarUri: 'same-url', avatarRevision: 2, nickname: 'After', isFaceVerified: false, meetup: null });
  assert.equal(f.values.at(-1).avatarRevision, 2);
  assert.equal(f.values.at(-1).nickname, 'After');
  assert.equal(f.values.at(-1).bio, undefined);
  assert.equal(f.values.at(-1).isFaceVerified, false);
  assert.equal(f.values.at(-1).meetup, null);
});
test('queued edits survive a remote update without forging verification or identity', async () => {
  const f = fixture(async () => [
    { type: 'saveProfile', payload: { profile: { id: 'wrong', nickname: 'unsent', isFaceVerified: true, faceMatchScore: 99 } } },
    { type: 'saveMatchingPreferences', payload: { matchingPreferences: { maxDistance: 5 } } },
    { type: 'updateMeetup', payload: { meetup: null } },
    { type: 'saveLocationEnabled', payload: { locationEnabled: false } },
  ]);
  await f.emit({ id: 'owner', avatarRevision: 2, isFaceVerified: false, meetup: { id: 'remote' } });
  assert.equal(f.values[0].nickname, 'unsent');
  assert.equal(f.values[0].avatarRevision, 2);
  assert.equal(f.values[0].id, 'owner');
  assert.equal(f.values[0].isFaceVerified, false);
  assert.equal(f.values[0].faceMatchScore, undefined);
  assert.equal(f.values[0].matchingPreferences.maxDistance, 5);
  assert.equal(f.values[0].locationEnabled, false);
  assert.equal(f.values[0].meetup, null);
});
test('an older pending queue read cannot overwrite the newest snapshot', async () => {
  const reads = [], f = fixture(() => new Promise(resolve => reads.push(resolve)));
  const old = f.emit({ id: 'owner', avatarRevision: 1 });
  const recent = f.emit({ id: 'owner', avatarRevision: 2 });
  reads[1]([]); await recent; reads[0]([]); await old;
  assert.deepEqual(f.values.map(value => value.avatarRevision), [2]);
});
test('sign-out and unsubscribe suppress late updates and errors', async () => {
  for (const cancel of ['switchUser', 'stop']) {
    let resolve, f = fixture(() => new Promise(done => { resolve = done; }));
    const pending = f.emit({ id: 'owner', avatarRevision: 2 });
    f[cancel](); resolve([]); await pending;
    await f.emit({ id: 'owner', avatarRevision: 3 }); f.fail(new Error('late'));
    assert.equal(f.values.length, 0); assert.equal(f.errors.length, 0);
    if (cancel === 'stop') assert.equal(f.stopped(), true);
  }
});
test('queue-read failure retains existing UI and allows the next update', async () => {
  let attempts = 0;
  const f = fixture(async () => { if (++attempts === 1) throw new Error('storage'); return []; });
  await f.emit({ id: 'owner', avatarRevision: 1 }); assert.equal(f.values.length, 0); assert.equal(f.errors.length, 1);
  await f.emit({ id: 'owner', avatarRevision: 2 }); assert.equal(f.values[0].avatarRevision, 2);
});
test('owner listener delivers complete committed records and rejects stale cache, pending writes and late events', async () => {
  let emit, stopped = false;
  const values = [];
  const subscribe = loadProfileListener({
    requireFirebase: () => ({ db: {}, app: {} }), getAuth: () => ({}), waitForAuthReady: async () => ({ uid: 'owner' }),
    doc: (_db, collection, id) => `${collection}/${id}`, normalizeProfileRecord: (id, value) => ({ ...value, id }),
    onSnapshot: (ref, options, callback) => { assert.equal(ref, 'users/owner'); emit = callback; return () => { stopped = true; }; },
  });
  const stop = subscribe('owner', value => values.push(value), assert.fail); await tick();
  const snapshot = (revision, fromCache = false, hasPendingWrites = false) => ({ exists: () => true,
    metadata: { fromCache, hasPendingWrites }, data: () => ({ avatarUri: 'image', avatarRevision: revision, nickname: 'New', matchingPreferences: { maxDistance: 5 } }) });
  emit(snapshot(0, true)); emit(snapshot(1, false, true)); assert.equal(values.length, 0);
  emit(snapshot(2)); assert.equal(values[0].nickname, 'New'); assert.equal(values[0].avatarRevision, 2); assert.equal(values[0].matchingPreferences.maxDistance, 5);
  stop(); emit(snapshot(3)); assert.equal(stopped, true); assert.equal(values.length, 1);
});
test('listener cancellation while authentication restores does not attach to the old user', async () => {
  let finish, attached = 0;
  const subscribe = loadProfileListener({ requireFirebase: () => ({ db: {}, app: {} }), getAuth: () => ({}),
    waitForAuthReady: () => new Promise(resolve => { finish = resolve; }), onSnapshot: () => { attached++; }, doc: () => ({}), normalizeProfileRecord: () => ({}) });
  const stop = subscribe('owner', assert.fail, assert.fail); await tick(); stop(); finish({ uid: 'owner' }); await tick();
  assert.equal(attached, 0);
});
