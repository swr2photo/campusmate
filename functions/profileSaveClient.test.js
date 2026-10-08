import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/context/AppContext.js', import.meta.url), 'utf8');
const persistSource = source.slice(source.indexOf('async function persistProfileToFirestore('), source.indexOf('async function persistLikeResponse('));
const saveStart = source.indexOf('  const saveProfile = async (profileData) => {');
const saveEnd = source.indexOf('\n  };', saveStart) + '\n  };'.length;
const saveSource = source.slice(saveStart, saveEnd).replace('const saveProfile =', 'globalThis.saveProfile =');

function fixture({ error, queued = false } = {}) {
  const calls = { uploaded: [], profiles: [], states: [], accounts: [] };
  const initial = { id: 'owner', name: 'Before', avatarUri: 'https://example.test/avatar.jpg', avatarRevision: 123 };
  const context = vm.createContext({
    profile: initial,
    user: { id: 'owner', email: 'owner@example.test' },
    withProfileDefaults: (value) => value,
    setProfile: (value) => calls.states.push(value),
    saveAccount: async (value) => calls.accounts.push(value),
    uploadImage: async () => 'https://example.test/new-avatar.jpg',
    uploadGalleryImage: async (uri, uid) => { calls.uploaded.push({ uri, uid }); return `https://example.test/upload-${calls.uploaded.length}.jpg`; },
    createUserProfile: async (_, value) => calls.profiles.push(value),
    runOrQueue: async (_, __, execute) => {
      assert.equal(calls.states.length, 0, 'state must remain unchanged while saving');
      assert.equal(calls.accounts.length, 0, 'account cache must remain unchanged while saving');
      if (error) throw error;
      return queued ? { queued: true } : execute();
    },
  });
  vm.runInContext(`${persistSource}\n${saveSource}`, context);
  return { save: context.saveProfile, calls, initial };
}

test('a rejected profile save leaves profile state and account cache unchanged', async () => {
  const error = new Error('Image blocked');
  const f = fixture({ error });
  await assert.rejects(f.save({ name: 'After', gallery: ['file:///photo.jpg'] }), (caught) => caught === error);
  assert.equal(f.calls.states.length, 0);
  assert.equal(f.calls.accounts.length, 0);
});

test('profile save publishes uploaded URLs and caps gallery uploads at five', async () => {
  const f = fixture();
  const saved = await f.save({ name: ' After ', avatarUri: 'file:///avatar.jpg', gallery: [null, {}, ...Array.from({ length: 7 }, (_, i) => `file:///photo-${i}.jpg`)] });
  assert.equal(saved.name, 'After');
  assert.equal(saved.avatarUri, 'https://example.test/new-avatar.jpg');
  assert.equal(saved.gallery.length, 5);
  assert.equal(f.calls.uploaded.length, 5);
  assert.ok(f.calls.uploaded.every((call) => call.uid === 'owner'));
  assert.equal(f.calls.states[0], saved);
  assert.equal(f.calls.profiles[0].gallery[0], 'https://example.test/upload-1.jpg');
  assert.equal(f.calls.accounts[0].avatarUri, saved.avatarUri);
  assert.ok(Number.isSafeInteger(saved.avatarRevision) && saved.avatarRevision > f.initial.avatarRevision);
  assert.equal(f.calls.accounts[0].avatarRevision, saved.avatarRevision);
});

test('durably queued profile saves publish a local profile without attempting upload', async () => {
  const f = fixture({ queued: true });
  const saved = await f.save({ notificationsEnabled: false });
  assert.equal(saved.notificationsEnabled, false);
  assert.equal(f.calls.states[0], saved);
  assert.equal(f.calls.uploaded.length, 0);
  assert.equal(f.calls.accounts.length, 1);
});

test('editing bio keeps the avatar cache version stable', async () => {
  const f = fixture();
  const saved = await f.save({ bio: 'new bio' });
  assert.equal(saved.avatarUri, f.initial.avatarUri);
  assert.equal(saved.avatarRevision, f.initial.avatarRevision);
  assert.equal(f.calls.accounts[0].avatarRevision, f.initial.avatarRevision);
});
