import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('likes hide unverified legacy identities even when the decision was accepted', () => {
  const service = read('src/services/firestoreService.js');
  const start = service.indexOf('export function hydrateDecisionLikes(');
  const end = service.indexOf('\n/**', start);
  const context = vm.createContext({ Map, Array,
    decisionProfileId: (decision, direction) => direction === 'incoming' ? decision.fromUserId : decision.toUserId,
    formatLikeTime: () => '', toMillis: (value) => value || 0,
  });
  vm.runInContext(service.slice(start, end).replace('export ', ''), context);
  const profiles = [{ id: 'verified', name: 'Verified', isFaceVerified: true },
    { id: 'legacy', name: 'Legacy' }, { id: 'false', name: 'False', isFaceVerified: false }];
  for (const direction of ['incoming', 'outgoing']) {
    const decisions = profiles.flatMap((profile) => ['pending', 'accepted'].map((status) => ({
      id: `${profile.id}-${status}`, fromUserId: profile.id, toUserId: profile.id, type: 'like', status,
    })));
    assert.deepEqual(Array.from(context.hydrateDecisionLikes(decisions, profiles, direction), (item) => item.id), ['verified', 'verified']);
  }
});

test('a hidden public profile does not remove an existing conversation or its history', async () => {
  const source = read('src/context/AppContext.js');
  const start = source.indexOf('  useEffect(() => {', source.indexOf('  // A paged discovery list'));
  const end = source.indexOf('\n  const visibleDiscoveryProfileCount', start);
  const conversation = { id: 'c-owner-legacy', profileId: 'legacy', participants: ['owner', 'legacy'], lastMessage: 'kept' };
  const unexpected = () => { throw new Error('Public visibility must not modify conversations'); };
  const context = vm.createContext({ Map, Set, Array, console,
    user: { id: 'owner' }, sharedProfiles: [], decisionProfilesById: new Map(), decisionSnapshots: null,
    conversations: [conversation], removedUserIds: new Set(), discoveryProfileFetchesRef: { current: new Set() },
    useEffect: (effect) => effect(), getPublicProfilesByIds: async () => [],
    setConversations: unexpected, setHiddenConversationIds: unexpected, cleanupDeletedUserInteractions: unexpected,
    setRemovedUserIds: unexpected, setDecisionProfiles: unexpected,
    isRetryableNetworkError: () => false,
  });
  vm.runInContext(source.slice(start, end), context);
  await tick();
  assert.equal(context.conversations[0], conversation);
  assert.equal(context.conversations[0].lastMessage, 'kept');
  assert.equal(context.removedUserIds.size, 0);
});
function fixture(handler) {
  const signals = [], auth = { currentUser: { uid: 'owner' } }, emissions = [], errors = [];
  const source = read('src/services/secureDiscoveryService.js')
    .replace(/^import .*;\n/gm, '').replace(/export (?=(?:async )?function|const)/g, '');
  const context = vm.createContext({ console, Map, Set, Date, Promise,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    Constants: { expoConfig: { extra: { secureDiscoveryEnabled: true } } },
    Crypto: { randomUUID: () => 'receipt' }, requireFirebase: () => ({ app: {}, db: {} }), getAuth: () => auth,
    onAuthStateChanged: () => () => {},
    getFunctions: () => ({}), httpsCallable: (_functions, name) => async (data) => ({ data: await handler(name, data) }),
    doc: (_db, ...parts) => parts.join('/'), onSnapshot: (_doc, next) => { signals.push(next); return () => {}; },
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(source + '\nglobalThis.api = { createSecureProfilesSubscription, subscribeSecureDecisions };', context);
  return { ...context.api, auth, emissions, errors, signal: () => signals[0](),
    profiles: (value) => emissions.push(Array.from(value, (item) => item.id)), error: (reason) => errors.push(reason) };
}

test('live skip hides its card and an empty Rewind snapshot overrides the old decision cache', () => {
  const source = read('src/context/AppContext.js'), service = read('src/services/firestoreService.js');
  const helpers = source.slice(source.indexOf('function compactOutgoingDecisions('), source.indexOf('function isNearCoordinate('));
  const memo = source.slice(source.indexOf('  const outgoingDecisionSnapshot ='), source.indexOf('\n  // Once the live listener', source.indexOf('  const outgoingDecisionSnapshot =')));
  const filter = service.slice(service.indexOf('export function filterAvailableProfiles('), service.indexOf('export function hydrateDecisionLikes(')).replace('export ', '');
  const context = vm.createContext({ Set, Map, Array, useMemo: (fn) => fn(),
    isProfileReadyForDiscovery: () => true, matchesPreferences: () => true,
    allowedMatchingPreferences: (value) => value, profile: { id: 'owner', matchingPreferences: {} },
    user: { id: 'owner' }, membership: { plus: true }, canAdvancedFilters: true, membershipLoading: false, sharedProfiles: [{ id: 'skipped' }, { id: 'unseen' }],
    cachedOutgoingDecisions: [{ toUserId: 'skipped', type: 'skip', status: 'pending' }], outgoingLikes: [],
  });
  vm.runInContext(helpers + filter, context);
  function evaluate(decisions) {
    context.decisionSnapshots = decisions === null ? null : { outgoingDecisions: decisions };
    vm.runInContext(`{${memo}\nglobalThis.result = remoteAvailableResult;}`, context);
    return [...context.result.profiles.map((item) => item.id)];
  }
  assert.deepEqual(evaluate(null), ['unseen']);
  assert.deepEqual(evaluate([{ toUserId: 'skipped', type: 'skip', status: 'pending' }]), ['unseen']);
  assert.deepEqual(evaluate([]), ['skipped', 'unseen']);
});

test('discovery revisions refresh every loaded page and remove identities that became private', async () => {
  let revision = 1;
  const f = fixture(async (_name, { cursor }) => cursor
    ? { profiles: [{ id: revision === 1 ? 'second' : 'replacement' }], nextCursor: null, hasMore: false }
    : { profiles: [{ id: 'first' }], nextCursor: 'page2', hasMore: true });
  const subscription = f.createSecureProfilesSubscription(f.profiles, f.error);
  await tick(); await subscription.loadMore();
  assert.deepEqual(f.emissions.at(-1), ['first', 'second']);
  revision = 2; f.signal(); await tick();
  assert.deepEqual(f.emissions.at(-1), ['first', 'replacement']);
  subscription.unsubscribe();
});

test('a visibility signal arriving during pagination is revalidated after the request completes', async () => {
  let finishPage, revision = 1;
  const f = fixture(async (_name, { cursor }) => {
    if (!cursor) return { profiles: [{ id: 'first' }], nextCursor: 'page2', hasMore: true };
    if (revision === 1) return new Promise((resolve) => { finishPage = resolve; });
    return { profiles: [], nextCursor: null, hasMore: false };
  });
  const subscription = f.createSecureProfilesSubscription(f.profiles, f.error);
  await tick(); const pending = subscription.loadMore();
  revision = 2; f.signal();
  finishPage({ profiles: [{ id: 'now-private' }], nextCursor: null, hasMore: false });
  await pending; await tick();
  assert.deepEqual(f.emissions.at(-1), ['first']);
  assert.equal(f.emissions.some((ids) => ids.includes('now-private')), false);
  subscription.unsubscribe();
});

test('an account switch discards an in-flight discovery response', async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const subscription = f.createSecureProfilesSubscription(f.profiles, f.error);
  f.auth.currentUser = { uid: 'another-account' };
  finish({ profiles: [{ id: 'private-peer' }], hasMore: false, nextCursor: null }); await tick();
  assert.deepEqual(f.emissions.at(-1), []); assert.equal(f.errors.length, 1);
  subscription.unsubscribe();
});

test('Plus expiry during pending-like pagination drops identities from every earlier page', async () => {
  const accepted = { id: 'accepted', status: 'accepted', fromUserId: 'friend' };
  const f = fixture(async (name) => name === 'getMyDecisionState'
    ? { incomingDecisions: [accepted, { id: 'pending', status: 'pending', fromUserId: 'hidden-sender' }], outgoingDecisions: [], pendingCount: 2, hasMorePending: true, nextPendingCursor: 'page2' }
    : { pendingLikes: [], pendingCount: 2, identitiesAvailable: false, hasMore: false, nextCursor: null });
  const states = [], unsubscribe = f.subscribeSecureDecisions('owner', (value) => states.push(value), f.error);
  await tick(); await unsubscribe.loadMore();
  assert.deepEqual([...states.at(-1).incomingDecisions.map((item) => item.id)], ['accepted']);
  assert.equal(states.at(-1).pendingCount, 2); unsubscribe();
});

test('profile bootstrap only reports a new account after server-confirmed absence', async () => {
  const source = read('src/services/firestoreService.js');
  const body = source.slice(source.indexOf('export async function getUserProfile('), source.indexOf('export async function createUserProfile(')).replace('export ', '');
  const missing = (fromCache) => ({ exists: () => false, metadata: { fromCache } });
  const existing = { exists: () => true, data: () => ({ name: 'Existing profile', isNewUser: false }) };
  let privateRecord = existing, publicRecord = missing(false), reads = 0;
  const ctx = vm.createContext({ secureDiscoveryConfigured: () => false, requireFirebase: () => ({ db: {} }),
    doc: (_db, collection) => collection, normalizeProfileRecord: (id, data) => ({ id, ...data }),
    getProfileDocFresh: async (collection) => {
      reads++; const result = collection === 'users' ? privateRecord : publicRecord;
      if (result instanceof Error) throw result; return result;
    },
    getProfileDocPreferCache: async (collection) => {
      reads++; const result = collection === 'users' ? privateRecord : publicRecord;
      if (result instanceof Error) throw result; return result;
    },
  });
  vm.runInContext(body + '\nglobalThis.getProfile = getUserProfile;', ctx);
  assert.equal((await ctx.getProfile('owner')).name, 'Existing profile'); assert.equal(reads, 1);
  privateRecord = Object.assign(new Error('Network unavailable'), { code: 'unavailable' });
  await assert.rejects(ctx.getProfile('owner'), { code: 'unavailable' });
  privateRecord = missing(true); await assert.rejects(ctx.getProfile('owner'), { code: 'unavailable' });
  privateRecord = missing(false); publicRecord = missing(true);
  await assert.rejects(ctx.getProfile('owner'), { code: 'unavailable' });
  publicRecord = missing(false); assert.equal(await ctx.getProfile('owner'), null);
});

test('bootstrap cannot overwrite a profile created or restored concurrently', async () => {
  const source = read('src/services/firestoreService.js');
  const body = source.slice(source.indexOf('export async function createUserProfile('), source.indexOf('export async function updateUserMatchingPreferences(')).replace('export ', '');
  const restored = { name: 'Recovered', avatarUri: 'https://example.test/original.jpg', isNewUser: false };
  let writes = 0;
  const ctx = vm.createContext({ console, Number, Date, requireFirebase: () => ({ db: {} }),
    doc: (_db, collection) => collection, getProfileDocFresh: async () => ({ exists: () => false, metadata: { fromCache: false } }),
    normalizeProfileRecord: (id, data) => ({ id, ...data }), mergeProfileInput: (a, b) => ({ ...a, ...b }),
    getOrCreateEncryptionIdentity: async () => ({}), withIdentityDevice: (value) => value,
    sanitizeProfileForFirestore: (_id, value) => value, serverTimestamp: () => 1, sanitizeMeetup: (value) => value,
    privateProfileFields: ['name', 'avatarUri'], legacyPrivateProfileFields: [], toPublicProfile: (_id, value) => value,
    withoutUndefined: (value) => value, setDoc: async () => { writes++; },
    runTransaction: async (_db, run) => run({ get: async () => ({ exists: () => true, data: () => restored }), set: () => { writes++; } }),
  });
  vm.runInContext(body + '\nglobalThis.save = createUserProfile;', ctx);
  const saved = await ctx.save('owner', { name: '', avatarUri: '', isNewUser: true }, { onlyIfMissing: true });
  assert.equal(saved.name, 'Recovered'); assert.equal(saved.avatarUri, restored.avatarUri);
  assert.equal(writes, 0);
});
