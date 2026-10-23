import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import * as activities from '../src/data/activityCategories.js';
import { finishMatchingFilters } from '../src/utils/matchingFilterNavigation.js';
import { isReliablePreviewUrl } from '../src/utils/trackPlayback.js';

const require = createRequire(import.meta.url), babel = require('@babel/core');
function source(file) {
  const text = readFileSync(file, 'utf8'), nodes = [];
  const ast = babel.parseSync(text, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type) nodes.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  }
  walk(ast);
  return { nodes, code: node => text.slice(node.start, node.end) };
}
const filters = source('src/screens/MatchingFiltersScreen.js'), app = source('src/context/AppContext.js');
const matchingFile = source('src/data/matchingFilters.js');
const matchingNames = matchingFile.nodes.filter(node => node.type === 'ExportNamedDeclaration').flatMap(node =>
  node.declaration?.type === 'VariableDeclaration' ? node.declaration.declarations.map(value => value.id.name) : [node.declaration?.id?.name]).filter(Boolean);
const matchingContext = vm.createContext({ ...activities });
const matchingSource = readFileSync('src/data/matchingFilters.js', 'utf8').replace(/import[\s\S]*?from '[^']+';?/g, '').replace(/^export /gm, '');
vm.runInContext(matchingSource + `;globalThis.api = {${matchingNames.join(',')}};`, matchingContext);
const matching = matchingContext.api;
function handler(file, name, mocks) {
  const node = file.nodes.find(node => node.type === 'VariableDeclarator' && node.id?.name === name);
  assert.ok(node, name);
  const context = vm.createContext(mocks);
  vm.runInContext(`globalThis.action = ${file.code(node.init)};`, context);
  return context;
}
function filterSave(saveMatchingPreferences, focused = true) {
  const events = [], mounted = { current: true };
  const context = handler(filters, 'saveSearchSettings', { ...matching, saveMatchingPreferences, mounted,
    submitLock: { current: false }, navigation: { isFocused: () => focused },
    setSaving: value => events.push(['busy', value]), setSaveError: value => events.push(['error', value]),
    finishMatchingFilters, router: { dismissTo: href => events.push(['route', href]) },
    profile: { id: 'owner', matchingPreferences: {} }, activities: {}, ageMin: 18, ageMax: 25,
    availabilityPeriods: {}, detailFilters: {}, sameFacultyOnly: false, faculty: 'all', genders: {},
    distance: 25, showPace: false, paces: {}, requireAvailability: false, requirePhoto: true, weekdays: {}, years: {},
  });
  return { press: context.action, events, mounted };
}

test('filter confirmation sends one save and returns explicitly to discovery after acknowledgement', async () => {
  let finish, requests = 0;
  const h = filterSave(() => { requests++; return new Promise(resolve => { finish = resolve; }); });
  const first = h.press(); await h.press(); await h.press();
  assert.equal(requests, 1); assert.equal(h.events.some(event => event[0] === 'route'), false);
  finish(); await first;
  assert.deepEqual(h.events.filter(event => event[0] === 'route'), [['route', '/home']]);
});

test('a successful filter save keeps the departing native view stable until it unmounts', async () => {
  let requests = 0;
  const h = filterSave(async () => { requests++; });
  await h.press();
  const navigationIndex = h.events.findIndex(event => event[0] === 'route');
  assert.ok(navigationIndex >= 0);
  // Native-stack retains the outgoing Android subtree during its transition.
  // Clearing busy here flattens the body wrapper and re-parents its ScrollView.
  assert.deepEqual(h.events.slice(navigationIndex + 1), []);
  await h.press();
  assert.equal(requests, 1, 'a second tap during dismissal must not save or dismiss again');
});

test('filter failure leaves the draft screen visible and permits a successful retry', async () => {
  let requests = 0;
  const h = filterSave(async () => { if (++requests === 1) throw new Error('offline'); });
  await h.press(); assert.equal(h.events.some(event => event[0] === 'route'), false);
  assert.ok(h.events.some(event => event[0] === 'error' && event[1] === 'offline'));
  assert.deepEqual(h.events.at(-1), ['busy', false]);
  await h.press(); assert.equal(requests, 2);
  assert.deepEqual(h.events.at(-1), ['route', '/home']);
});

test('finishing a save after leaving filters cannot navigate another active screen', async () => {
  for (const unmount of [true, false]) {
    let finish;
    const h = filterSave(() => new Promise(resolve => { finish = resolve; }), unmount);
    const pending = h.press(); if (unmount) h.mounted.current = false;
    finish(); await pending;
    assert.equal(h.events.some(event => event[0] === 'route'), false);
  }
});

test('failed preference writes cannot replace the underlying discovery data; queued saves may commit locally', async () => {
  for (const fail of [true, false]) {
    let profile = { id: 'owner', matchingPreferences: { maxDistance: 25 } };
    const h = handler(app, 'saveMatchingPreferences', {
      user: { id: 'owner' }, profile, canAdvancedFilters: true, activeUserIdRef: { current: 'owner' },
      keepPaidMatchingPreferences: value => value, withProfileDefaults: value => value,
      runOrQueue: async () => { if (fail) throw new Error('permission-denied'); return { queued: true }; },
      setProfile: update => { profile = update(profile); }, updateUserMatchingPreferences() {},
    });
    if (fail) { await assert.rejects(h.action({ maxDistance: 5 })); assert.equal(profile.matchingPreferences.maxDistance, 25); }
    else { assert.equal((await h.action({ maxDistance: 5 })).queued, true); assert.equal(profile.matchingPreferences.maxDistance, 5); }
  }
});

test('a filter save for a departed identity cannot update the next account', async () => {
  let writes = 0;
  const h = handler(app, 'saveMatchingPreferences', {
    user: { id: 'old' }, profile: {}, canAdvancedFilters: true, activeUserIdRef: { current: 'new' },
    keepPaidMatchingPreferences: value => value, withProfileDefaults: value => value, runOrQueue: async () => ({}),
    setProfile: () => writes++, updateUserMatchingPreferences() {},
  });
  await assert.rejects(h.action({ maxDistance: 5 }), /บัญชีเปลี่ยน/); assert.equal(writes, 0);
});

function lyricsHarness() {
  const state = [], effects = [], requests = [];
  let cursor = 0, effectCursor = 0, pending = [];
  const context = vm.createContext({
    useState: initial => {
      const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }];
    },
    useEffect: (action, deps) => {
      const index = effectCursor++, old = effects[index];
      if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
      old?.cleanup?.(); pending.push(() => { effects[index] = { deps, cleanup: action() }; });
    },
    getTrackLyrics: ({ track }) => new Promise((resolve, reject) => { requests.push({ track, resolve, reject }); }),
  });
  const code = readFileSync('src/hooks/useTrackLyrics.js', 'utf8').replace(/^import[^\n]+\n/gm, '').replace('export function', 'function');
  vm.runInContext(code + ';globalThis.hook = useTrackLyrics;', context);
  return { requests,
    render(track, retry = 0) { cursor = effectCursor = 0; const result = context.hook(track, retry); const next = pending; pending = []; next.forEach(run => run()); return result; },
    close() { effects.forEach(effect => effect.cleanup?.()); },
  };
}
const song = { id: 'song-a', name: 'Test song', artists: 'Artist', durationMs: 180000 };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('100 playback/trim renders retain lyrics without re-entering loading or issuing new fetches', async () => {
  const h = lyricsHarness(); h.render(song);
  h.requests[0].resolve({ status: 'found', suggestedLineStartMs: 42000 }); await tick();
  for (let frame = 0; frame < 100; frame++) {
    assert.equal(h.render({ ...song, previewStartMs: frame * 100, previewEndMs: 30000 + frame * 100 }).status, 'found');
  }
  assert.equal(h.requests.length, 1); h.close();
});

test('switching songs discards old lyrics and late requests; only an explicit retry reloads the same song', async () => {
  const h = lyricsHarness(); h.render(song);
  const next = { ...song, id: 'song-b', name: 'Next song' };
  assert.equal(h.render(next).status, 'loading');
  h.requests[0].resolve({ status: 'found', plainLyrics: 'stale' });
  h.requests[1].resolve({ status: 'found', plainLyrics: 'current' }); await tick();
  assert.equal(h.render(next).plainLyrics, 'current');
  assert.equal(h.render(next, 1).status, 'loading'); assert.equal(h.requests.length, 3);
  h.requests[2].reject(new Error('simulated failure')); await tick();
  assert.equal(h.render(next, 1).status, 'error'); h.close();
});

test('music search sends a song without opening a passage editor', () => {
  const file = source('src/components/SpotifyTrackSearchSheet.js');
  assert.equal(file.nodes.some(node => node.type === 'FunctionDeclaration' && node.id?.name === 'TrimModule'), false);
  assert.doesNotMatch(readFileSync('src/components/SpotifyTrackSearchSheet.js', 'utf8'), /เลือกท่อนเพลง/);
});

test('music search initializes its audio and close/back handlers without accessing uninitialized bindings', () => {
  const file = source('src/components/SpotifyTrackSearchSheet.js');
  const component = file.nodes.find(node => node.type === 'FunctionDeclaration' && node.id?.name === 'SpotifyTrackSearchSheet');
  const boundary = component.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name === 'isSearching');
  const prefix = file.code(component).slice(0, boundary.start - component.start);
  const shared = () => ({ get: () => 0, set() {} });
  const gesture = new Proxy({}, { get: () => () => gesture });
  const context = vm.createContext({
    useTheme: () => ({ colors: {} }), useColorScheme: () => 'light', useSafeAreaInsets: () => ({ bottom: 0 }),
    getCachedBrowseMusicTracks: () => null, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useSharedValue: shared, useCallback: fn => fn, useEffect() {}, useMemo: fn => fn(),
    useAnimatedStyle: fn => fn, useAudioPlayer: () => ({ pause() {} }), useAudioPlayerStatus: () => ({}),
    useLiquidGlass: () => false, useSheetGlassTint: () => undefined,
    isReliablePreviewUrl,
    Gesture: { Pan: () => gesture },
  });
  vm.runInContext(prefix + 'return { closeWithAnimation, handleBackFromTrim }; };globalThis.render = SpotifyTrackSearchSheet;', context);
  const result = context.render({ visible: true });
  assert.equal(typeof result.closeWithAnimation, 'function');
  assert.equal(typeof result.handleBackFromTrim, 'function');
});
