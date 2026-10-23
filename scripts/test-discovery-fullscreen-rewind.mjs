import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { mergeDiscoveryPhoto } from '../src/utils/discoveryPresentation.js';

const require = createRequire(import.meta.url), babel = require('@babel/core');
function sourceTree(file) {
  const source = readFileSync(file, 'utf8');
  return { source, ast: babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } }) };
}
function fn(file, name, mocks) {
  const { source, ast } = sourceTree(file);
  let node;
  babel.traverse(ast, {
    FunctionDeclaration(path) { if (path.node.id?.name === name) node = path.node; },
    VariableDeclarator(path) { if (path.node.id.name === name) node = path.node.init.type === 'CallExpression' ? path.node.init.arguments[0] : path.node.init; },
  });
  assert.ok(node, name);
  return vm.runInNewContext(`(${source.slice(node.start, node.end)})`, mocks);
}
const service = 'src/services/firestoreService.js';
const normalizedReady = fn(service, 'isNormalizedProfileReady', {});
const ready = fn(service, 'isProfileReadyForDiscovery', { normalizeProfileRecord: (id, value) => ({ ...value, id }), isNormalizedProfileReady: normalizedReady });
const publicProfile = { id: 'authorized', name: 'Public', avatarUri: 'https://cdn.example/photo.jpg', isFaceVerified: true };

test('privacy-filtered server cards do not need private registration fields, while owner validation stays strict', () => {
  assert.equal(ready(publicProfile), false);
  assert.equal(ready(publicProfile, { publicProjection: true }), true);
  for (const change of [{ isFaceVerified: false }, { isNewUser: true }, { avatarUri: '' }, { name: '' }, { id: '' }]) {
    assert.equal(ready({ ...publicProfile, ...change }, { publicProjection: true }), false);
  }
});

test('authorized public filtering preserves privacy and still excludes consumed, hidden, and unverified identities', () => {
  const filter = fn(service, 'filterAvailableProfiles', {
    isProfileReadyForDiscovery: ready,
    matchesPreferences() { throw Error('The server already applied filters to full owner records'); },
  });
  const items = [publicProfile, { ...publicProfile, id: 'unverified', isFaceVerified: false }, { ...publicProfile, id: 'hidden', isDiscoverable: false }];
  let result = filter('viewer', { faculty: 'private faculty', genders: ['hidden gender'] }, items, [], null, { publicProjection: true });
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].faculty, undefined); assert.equal(result.profiles[0].gender, undefined);
  for (const decision of [{ type: 'skip', status: 'pending' }, { type: 'like', status: 'pending' }, { type: 'like', status: 'accepted' }, { type: 'like', status: 'removed' }]) {
    result = filter('viewer', {}, items, [{ ...decision, toUserId: publicProfile.id }], null, { publicProjection: true });
    assert.equal(result.profiles.length, 0);
  }
  assert.equal(filter('viewer', {}, items).profiles.length, 0);
});

test('rewind returns the same restored card published to the feed and never revives old private demographics', async () => {
  let release, calls = 0, restored = [], available = [], hidden = ['authorized'];
  const lock = { current: false };
  const run = fn('src/context/AppContext.js', 'rewindProfileAction', {
    rewindBusyRef: lock, user: { id: 'viewer' }, activeUserIdRef: { current: 'viewer' },
    sharedProfiles: [{ ...publicProfile, faculty: 'was public', gender: 'was public' }], availableProfiles: [], mergeDiscoveryPhoto,
    rewindSecureDiscoveryAction: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    setDiscoveryRecycledProfileIds() {}, setCachedOutgoingDecisions() {},
    setRewoundProfiles: update => { restored = update(restored); }, setAvailableProfiles: update => { available = update(available); },
    setOptimisticHiddenIds: update => { hidden = update(hidden); },
  });
  const first = run(); assert.equal((await run()).busy, true); assert.equal(calls, 1);
  release({ profile: publicProfile, hasMore: false }); const result = await first;
  assert.equal(lock.current, false); assert.equal(result.profile, restored[0]); assert.equal(result.profile, available[0]);
  assert.equal(hidden.length, 0); assert.equal(result.profile.faculty, undefined); assert.equal(result.profile.gender, undefined);
  assert.equal(ready(result.profile, { publicProjection: true }), true);
  assert.ok(Number.isFinite(result.profile.rewindPriority));
});

for (const file of ['HomeScreen.js', 'HomeScreen.ios.js', 'DiscoverProfileScreen.js', 'DiscoverProfileScreen.ios.js']) {
  test(`${file}: empty-deck rewind reaches the server with a stale local eligibility cache`, async () => {
    let calls = 0, hidden = ['authorized'];
    const run = fn(`src/screens/${file}`, file === 'HomeScreen.js' ? 'restartDeck' : 'handleRewind', {
      actionInProgress: false, rewindingRef: { current: false }, rewindPending: { current: false }, rewindEntering: { current: false }, pinnedDailyRef: { current: {} },
      rewindEligibleProfileId: () => { throw Error('A local cache must not veto the server'); },
      setActionInProgress() {}, setSessionExcludedIds: update => { hidden = update(hidden); },
      recycleSkippedProfiles: async () => { calls++; return { profile: publicProfile }; }, showToast() {}, onToast() {}, router: { push: assert.fail },
    });
    await run(); assert.equal(calls, 1);
    if (file.startsWith('Discover')) assert.equal(hidden.length, 0);
  });
}

for (const file of ['DiscoverProfileScreen.js', 'DiscoverProfileScreen.ios.js']) {
  test(`${file}: the newly restored card wins over an older route profile; hidden direct profiles stay hidden`, () => {
    const restored = { ...publicProfile, rewindPriority: 100 };
    const older = { ...publicProfile, id: 'route-profile' };
    const args = {
      isViewOnly: false, profileId: older.id, candidatePool: [older, restored], decidedIds: new Set(), directProfile: older, processing: false,
      decisionInFlight: { current: false }, decisionCandidateId: { current: null }, candidateCache: { current: new Map() },
    };
    assert.equal(fn(`src/screens/${file}`, 'candidate', args)(), restored);
    assert.equal(fn(`src/screens/${file}`, 'candidate', { ...args, isViewOnly: true, directProfile: null })(), null);
  });
}

test('iOS uses the measured full viewport, native glass controls, and an empty-deck restore action', () => {
  const { source, ast } = sourceTree('src/screens/DiscoverProfileScreen.ios.js');
  let card, viewportLayout, emptyRestore;
  babel.traverse(ast, { JSXOpeningElement(path) {
    if (path.node.name.name === 'ProfileCardView') card = path.node;
    if (path.node.name.name === 'View') {
      const layout = path.node.attributes.find(attr => attr.name?.name === 'onLayout');
      if (layout && source.slice(layout.start, layout.end).includes('setCardViewportHeight')) viewportLayout = layout.value.expression;
    }
    if (path.node.name.name === 'Button' && path.node.attributes.some(attr => attr.name?.name === 'label' && attr.value?.value === 'ย้อนกลับคนที่ข้าม')) emptyRestore = path.node;
  } });
  assert.ok(card.attributes.some(attr => attr.name?.name === 'fullScreen' && attr.value === null));
  assert.equal(card.attributes.find(attr => attr.name?.name === 'cardHeight').value.expression.name, 'cardViewportHeight');
  assert.ok(emptyRestore); assert.ok(viewportLayout);
  let height = 844;
  vm.runInNewContext(`(${source.slice(viewportLayout.start, viewportLayout.end)})`, { cardViewportHeight: height, setCardViewportHeight: next => { height = next; } })({ nativeEvent: { layout: { height: 700 } } });
  assert.equal(height, 700);
  assert.match(source, /buttonStyle\('glass'\)/); assert.match(source, /icon="ellipsis"/);
  assert.doesNotMatch(source, /paddingTop: headerHeight|windowHeight - headerHeight/);
});
