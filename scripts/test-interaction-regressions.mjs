import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { dailyPick, pickDailyProfile } from '../src/utils/dailyPick.js';
import { createPhotoVerification } from '../src/services/photoVerificationProtocol.mjs';
const require = createRequire(import.meta.url), babel = require('@babel/core');
function extract(file, predicate, mocks) {
  const source = readFileSync(file, 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let found;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (!found && predicate(node, source)) found = node;
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  }
  walk(ast); assert.ok(found, `missing code in ${file}`);
  return vm.runInNewContext(`(${source.slice(found.start, found.end)})`, mocks);
}
const named = name => node => (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionDeclaration') && node.id?.name === name;
function action(file, name, mocks) {
  let target;
  extract(file, node => {
    if (node.type === 'VariableDeclarator' && node.id.name === name) target = node.init.type === 'CallExpression' ? node.init.arguments[0] : node.init;
    return node === target;
  }, {});
  const source = readFileSync(file, 'utf8');
  return vm.runInNewContext(`(${source.slice(target.start, target.end)})`, mocks);
}
test('Plus rewind has priority over daily selection and the previous pinned candidate', () => {
  const cards = [{ id: 'normal' }, { id: 'earlier', rewindPriority: 10 }, { id: 'last', rewindPriority: 20 }];
  assert.equal(dailyPick(cards, 'seed')[0].id, 'last');
  assert.equal(pickDailyProfile(cards, 'seed', 'normal')[0].id, 'last');
  assert.equal(pickDailyProfile(cards.filter(p => p.id !== 'last'), 'seed', 'normal')[0].id, 'earlier');
});
test('rewind serializes taps and retains each returned profile outside the paged discovery result', async () => {
  let release, calls = 0, restored = [], available = [], hidden = ['a', 'b'], lastAction = null;
  const busy = { current: false }, owner = { current: 'owner' };
  const run = action('src/context/AppContext.js', 'rewindProfileAction', {
    canRewind: true, rewindBusyRef: busy, user: { id: 'owner' }, activeUserIdRef: owner,
    lastDiscoveryAction: 'like', setLastDiscoveryAction: val => { lastAction = val; },
    rewindSecureDiscoveryAction: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    setRewoundProfiles: fn => { restored = fn(restored); }, setAvailableProfiles: fn => { available = fn(available); },
    setOptimisticHiddenIds: fn => { hidden = fn(hidden); }, setCachedOutgoingDecisions() {},
  });
  const first = run(); assert.equal((await run()).busy, true); assert.equal(calls, 1);
  release({ profile: { id: 'b', rewindPriority: 10 } }); await first;
  const second = run(); release({ profile: { id: 'a', rewindPriority: 20 } }); await second;
  assert.equal(restored.map(p => p.id).join(','), 'a,b');
  assert.equal(available[0].id, 'a'); assert.equal(hidden.length, 0); assert.equal(busy.current, false);
  const late = run(); owner.current = 'another'; release({ profile: { id: 'foreign' } }); await late;
  assert.equal(restored.some(p => p.id === 'foreign'), false);

  assert.equal(restored[0].rewindPriority, 20);
  const serverDenied = action('src/context/AppContext.js', 'rewindProfileAction', {
    canRewind: false, lastDiscoveryAction: 'like', rewindBusyRef: { current: false }, user: { id: 'owner' }, activeUserIdRef: owner,
    rewindSecureDiscoveryAction: () => { throw Object.assign(Error('server denied'), { code: 'permission-denied' }); },
  });
  await assert.rejects(serverDenied(), /server denied/);

});
for (const file of ['src/screens/ChatRoomScreen.js', 'src/screens/ChatRoomScreen.ios.js']) {
  test(`${file}: empty cache cannot erase messages; an authoritative empty server result can`, () => {
    const applied = [];
    const callback = extract(file, (node, source) => node.type === 'ArrowFunctionExpression'
      && node.params[0]?.name === 'snapshot' && source.slice(node.start, node.end).includes('applyDecrypted(rawDocs, key)'), {
      setHasMoreOlder() {}, oldestDocRef: { current: null }, key: null, applyDecrypted: docs => applied.push(docs), console,
    });
    callback({ empty: true, metadata: { fromCache: true }, docs: [] }); assert.equal(applied.length, 0);
    callback({ empty: true, metadata: { fromCache: false }, docs: [] }); assert.equal(applied.length, 1);
    callback({ empty: false, metadata: { fromCache: false }, docs: [{ id: 'new', data: () => ({ text: 'ok' }) }] });
    assert.equal(applied[1][0].id, 'new');
  });
}
test('party mutation refreshes subscribers only after acknowledgement; failed and read-only calls do not', async () => {
  let ack, fail = false; const signals = [];
  const invoke = extract('src/services/partyService.js', named('invoke'), {
    RUST_BACKEND: true, callable: () => () => fail ? Promise.reject(Error('offline')) : new Promise(resolve => { ack = resolve; }),
    notifyBackendChange: topic => signals.push(topic),
  });
  const pending = invoke('createParty', {}); assert.equal(signals.length, 0);
  ack({ data: { partyId: 'p' } }); assert.equal((await pending).partyId, 'p');
  assert.deepEqual(signals, ['parties', 'group-messages']);
  fail = true; await assert.rejects(invoke('requestJoinParty', {}), /offline/); assert.equal(signals.length, 2);
  fail = false; const read = invoke('searchCampusPlaces', {}); ack({ data: {} }); await read; assert.equal(signals.length, 2);
});
test('gallery uploads have at most two in flight, preserve slot order and do not commit on failure', async () => {
  let inFlight = 0, max = 0, failed = false, saved;
  const persist = extract('src/context/AppContext.js', named('persistProfileToFirestore'), {
    MAX_GALLERY_PHOTOS: 8, uploadImage: assert.fail,
    uploadGalleryImage: async uri => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise(resolve => setTimeout(resolve, uri.endsWith('0') ? 10 : 1));
      inFlight--; if (failed) throw Error('upload failed'); return `https://cdn.test/${uri.slice(-1)}`;
    }, createUserProfile: async (_id, data) => { saved = data; return data; },
  });
  await persist('owner', { gallery: ['file:///0', 'file:///1', 'file:///2', 'https://existing.test/3'] });
  assert.equal(max, 2); assert.equal(saved.gallery.join(','), 'https://cdn.test/0,https://cdn.test/1,https://cdn.test/2,https://existing.test/3');
  failed = true; saved = null; await assert.rejects(persist('owner', { gallery: ['file:///0', 'file:///1'] }), /upload failed/);
  assert.equal(saved, null);
});
test('starting main-photo verification stages a candidate without calling profile save', async () => {
  let candidate, shown = false;
  const run = action('src/screens/ProfilePhotosScreen.js', 'verifyMainPhoto', {
    savingRef: { current: false }, processingRef: { current: false }, profile: { id: 'owner' },
    profileIdRef: { current: 'owner' }, mountedRef: { current: true }, draft: { gallery: [] },
    setProcessing() {}, uploadGalleryImage: async () => 'https://candidate.test/photo', savePhotos: assert.fail,
    setVerificationCandidate: value => { candidate = value; }, verificationPassedRef: { current: false },
    setVerificationVisible: value => { shown = value; }, reportSaveError: assert.fail,
  });
  await run('file:///candidate.jpg', ['gallery']);
  assert.equal(candidate.uri, 'https://candidate.test/photo'); assert.equal(shown, true);
});

for (const [file, picker] of [
  ['src/screens/ProfileSetupScreen.js', 'pickAvatar'],
  ['src/screens/ProfileScreen.js', 'pickImage'],
]) {
  test(`${file}: picking a replacement leaves the published photo alone until exact server approval`, async () => {
    let candidate, shown = false, avatar = 'https://old.test/main', passed = false;
    let committed = { avatarUri: 'https://other.test/photo', isFaceVerified: true };
    const owner = { current: 'owner' };
    const mocks = {
      isProcessingImage: false, profile: { id: 'owner' }, photoOwnerRef: owner,
      ImagePicker: { launchImageLibraryAsync: async () => ({ assets: [{ uri: 'file:///candidate.jpg' }] }) },
      validateImageSize: async () => ({ valid: true }), MAX_PROFILE_IMAGE_SIZE_MB: 30,
      compressProfileImage: async uri => uri, uploadGalleryImage: async () => 'https://candidate.test/photo',
      setIsProcessingImage() {}, saveProfile: assert.fail, handleSave: assert.fail, showAlert: assert.fail,
      showImageModeration: assert.fail, console, setVerificationCandidate: value => { candidate = value; },
      verificationPassedRef: { current: false }, setShowFaceVerificationModal: value => { shown = value; },
      markFaceVerified: async () => committed, setAvatarUri: uri => { avatar = uri; },
      setFaceVerification: value => { passed = value; }, showToast() {}, onToast() {},
    };
    await action(file, picker, mocks)();
    assert.equal(avatar, 'https://old.test/main'); assert.equal(shown, true);
    assert.equal(candidate.uri, 'https://candidate.test/photo');
    const approve = () => action(file, 'handleFaceVerified', { ...mocks, verificationCandidate: candidate })();
    await assert.rejects(approve()); assert.equal(avatar, 'https://old.test/main');
    committed = { avatarUri: candidate.uri, isFaceVerified: false };
    await assert.rejects(approve()); assert.equal(avatar, 'https://old.test/main');
    committed.isFaceVerified = true;
    await approve(); assert.equal(avatar, candidate.uri); assert.equal(mocks.verificationPassedRef.current, true);
    if (picker === 'pickAvatar') assert.equal(passed, true);
    owner.current = 'different-owner'; avatar = 'https://old.test/main';
    await approve(); assert.equal(avatar, 'https://old.test/main');
  });
}

test('a missing identity origin produces an unavailable result without crashing the verification screen', async () => {
  const getFlow = extract('src/services/photoVerificationService.js', named('getPhotoVerification'), {
    flow: null, RUST_BACKEND: false, process: { env: {} }, fetch: assert.fail,
    getCurrentAuthUserId: () => 'owner', getCurrentUserIdToken: assert.fail,
    createFirebaseIdentityClient() { throw Error('Invalid URL'); },
    createPhotoVerification, bridge: { isAvailable: () => false }, FACE_CONSENT_VERSION: 'test',
  });
  const flow = getFlow();
  await assert.rejects(flow.status(), error => error.code === 'IDENTITY_UNAVAILABLE');
  assert.equal((await flow.run({ consent: true })).reason, 'NATIVE_UNAVAILABLE');
});

test('reopening the group inbox retains rows for the same owner and hides them from another owner', () => {
  const file = 'src/hooks/useGroupChatInbox.js';
  const expoRequire = createRequire(require.resolve('babel-preset-expo/package.json'));
  const code = babel.transformSync(readFileSync(file, 'utf8'), { configFile: false, babelrc: false,
    plugins: [expoRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  let states, refs, effects, stateIndex, refIndex, emit;
  const React = {
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; },
    useMemo: callback => callback(), useEffect: callback => effects.push(callback),
  };
  const context = vm.createContext({ exports: {}, require: name => name === 'react' ? React : {
    subscribeGroupChats: (_owner, callback) => { emit = callback; return () => {}; },
    subscribeGroupReads: (_owner, callback) => { callback({}); return () => {}; },
  } });
  vm.runInContext(code, context);
  function mount(owner) { states = []; refs = []; effects = []; stateIndex = refIndex = 0; return context.exports.default(owner); }
  assert.equal(mount('owner').items.length, 0);
  const stops = effects.map(effect => effect());
  emit([{ id: 'room', title: 'Friends' }], { hasMore: false }); stops.forEach(stop => stop?.());
  assert.equal(mount('owner').items[0].id, 'room');
  assert.equal(mount('different-owner').items.length, 0);
});

test('party retry keeps loaded rows while an account change clears them', () => {
  for (const changed of [false, true]) {
    let clears = 0;
    const mocks = { userId: 'owner', feedOwnerRef: { current: changed ? 'old-owner' : 'owner' }, pageSubscriptions: { current: {} } };
    for (const name of ['setOwnParties', 'setRequestedParties', 'setRequestByParty', 'setPages', 'setPlaceResults', 'setPeerProfiles',
      'setActivationErrors', 'setError', 'setLoading', 'setRawParties', 'setLegacyParties', 'setRequests', 'setGroupChats', 'setHostRequests']) {
      mocks[name] = () => { if (name === 'setRawParties') clears++; };
    }
    for (const name of ['subscribeParties', 'subscribeOwnParties', 'subscribeMyPartyRequests', 'subscribeLegacyPartiesToActivate']) mocks[name] = () => () => {};
    const start = extract('src/hooks/usePartyFeed.js', (node, source) => node.type === 'ArrowFunctionExpression'
      && source.slice(node.start, node.end).startsWith('() => {\n    const ownerChanged'), mocks);
    const stop = start(); assert.equal(clears, changed ? 1 : 0); stop();
  }
});

for (const file of ['HomeScreen.js', 'HomeScreen.ios.js', 'DiscoverProfileScreen.js', 'DiscoverProfileScreen.ios.js']) {
  test(file + ': rewind asks the backend even with stale local like and membership caches', async () => {
    let calls = 0;
    const name = file === 'HomeScreen.js' ? 'restartDeck' : 'handleRewind';
    const fn = action('src/screens/' + file, name, {
      actionInProgress: false, rewindingRef: { current: false }, pinnedDailyRef: { current: {} },
      lastDiscoveryAction: 'like', rewind: { guard: assert.fail }, setActionInProgress() {},
      recycleSkippedProfiles: async () => { calls++; return { profile: { id: 'older-skip', name: 'Skipped' } }; },
      showToast() {}, onToast() {}, router: { push: assert.fail },
    });
    await fn(); assert.equal(calls, 1);
  });
}
test('a server snapshot replaces restored cards and clears only their local hidden IDs', () => {
  let restored = [{ id: 'stale' }], hidden = ['restored-on-another-device', 'other'];
  const sync = extract('src/context/AppContext.js', (node, source) => node.type === 'ArrowFunctionExpression'
    && source.slice(node.start, node.end).includes('setRewoundProfiles(decisionSnapshots.rewoundProfiles)'), {
    decisionSnapshots: { rewoundProfiles: [{ id: 'restored-on-another-device', rewindPriority: 123 }] },
    Set, setRewoundProfiles: value => { restored = value; }, setOptimisticHiddenIds: fn => { hidden = fn(hidden); },
  });
  sync(); assert.equal(restored[0].id, 'restored-on-another-device');
  assert.equal(restored[0].rewindPriority, 123); assert.equal(hidden.join(','), 'other');
});

test('auto-recycle 5-minute skips clears optimisticHiddenIds when server outgoing decisions drop recycled targets', () => {
  let cached = [];
  let hidden = ['expired-skip', 'still-active-like'];
  const sync = extract('src/context/AppContext.js', (node, source) => node.type === 'ArrowFunctionExpression'
    && source.slice(node.start, node.end).includes('activeOutgoing = new Set(outgoingDecisionSnapshot'), {
    outgoingDecisionSnapshot: [{ toUserId: 'still-active-like', type: 'like', status: 'pending' }],
    compactOutgoingDecisions: val => val,
    areCompactDecisionListsEqual: () => false,
    setCachedOutgoingDecisions: fn => { cached = typeof fn === 'function' ? fn(cached) : fn; },
    setOptimisticHiddenIds: fn => { hidden = typeof fn === 'function' ? fn(hidden) : fn; },
  });
  sync();
  assert.deepEqual(hidden, ['still-active-like']);
  assert.equal(hidden.includes('expired-skip'), false);
});

