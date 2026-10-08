import test from 'node:test';
import assert from 'node:assert/strict';
import { browseMusicTracks, searchSpotifyTracks } from './index.js';

test('iTunes fallback returns consecutive search pages and a next-page flag', async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.SPOTIFY_CLIENT_ID;
  const originalClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const requestedLimits = [];

  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'itunes.apple.com');
    assert.equal(url.searchParams.get('country'), 'TH');
    const limit = Number(url.searchParams.get('limit'));
    requestedLimits.push(limit);
    return {
      ok: true,
      json: async () => ({
        results: Array.from({ length: Math.min(limit, 23) }, (_, index) => ({
          trackId: index + 1,
          trackName: `Song ${index + 1}`,
          artistName: 'Artist',
          collectionName: `Album ${index + 1}`,
          trackTimeMillis: 190_000 + index * 1000,
        })),
      }),
    };
  };

  try {
    const request = (offset) => ({ auth: { uid: 'listener' }, data: { q: 'song', limit: 10, offset, source: 'itunes' } });
    const first = await searchSpotifyTracks.run(request(0));
    const second = await searchSpotifyTracks.run(request(first.nextOffset));
    const third = await searchSpotifyTracks.run(request(second.nextOffset));

    assert.deepEqual(requestedLimits, [11, 21, 31]);
    assert.deepEqual(first.tracks.map((track) => track.id), Array.from({ length: 10 }, (_, index) => `it-${index + 1}`));
    assert.deepEqual(second.tracks.map((track) => track.id), Array.from({ length: 10 }, (_, index) => `it-${index + 11}`));
    assert.deepEqual(third.tracks.map((track) => track.id), ['it-21', 'it-22', 'it-23']);
    assert.equal(first.hasMore, true);
    assert.equal(first.tracks[0].albumName, 'Album 1');
    assert.equal(first.tracks[0].durationMs, 190_000);
    assert.equal(second.hasMore, true);
    assert.equal(third.hasMore, false);
    assert.equal(third.source, 'itunes');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    else process.env.SPOTIFY_CLIENT_SECRET = originalClientSecret;
  }
});

test('Spotify search respects the 10-track limit and advances by offset', async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.SPOTIFY_CLIENT_ID;
  const originalClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const offsets = [];

  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'accounts.spotify.com') {
      return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
    }
    assert.equal(url.hostname, 'api.spotify.com');
    assert.equal(url.searchParams.get('limit'), '10');
    const offset = Number(url.searchParams.get('offset'));
    offsets.push(offset);
    const count = offset === 0 ? 10 : 2;
    return {
      ok: true,
      json: async () => ({
        tracks: {
          next: offset === 0 ? 'https://api.spotify.com/v1/search?offset=10' : null,
          items: Array.from({ length: count }, (_, index) => ({
            id: `spotify-${offset + index}`,
            name: `Song ${offset + index}`,
            artists: [{ name: 'Artist' }],
            album: { name: `Spotify Album ${offset + index}` },
            duration_ms: 220_000 + index * 1000,
          })),
        },
      }),
    };
  };

  try {
    const first = await searchSpotifyTracks.run({ auth: { uid: 'listener' }, data: { q: 'song', limit: 25 } });
    const second = await searchSpotifyTracks.run({ auth: { uid: 'listener' }, data: { q: 'song', limit: 25, offset: first.nextOffset, source: first.source } });
    assert.deepEqual(offsets, [0, 10]);
    assert.equal(first.tracks.length, 10);
    assert.equal(first.tracks[0].albumName, 'Spotify Album 0');
    assert.equal(first.tracks[0].durationMs, 220_000);
    assert.equal(first.hasMore, true);
    assert.equal(second.tracks.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(second.source, 'spotify');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    else process.env.SPOTIFY_CLIENT_SECRET = originalClientSecret;
  }
});

test('browse chart tracks gain full-song metadata from iTunes lookup', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'rss.applemarketingtools.com') {
      return { ok: true, json: async () => ({ feed: { results: [{ id: '42', name: 'Trending Song', artistName: 'Artist', url: 'https://music.apple.com/track/42' }] } }) };
    }
    if (url.pathname.includes('/rss/topsongs/')) {
      return { ok: true, json: async () => ({ feed: { entry: [{
        id: { attributes: { 'im:id': '41' }, label: 'https://music.apple.com/track/41' },
        'im:name': { label: 'Recommended Song' },
        'im:artist': { label: 'Artist' },
        'im:collection': { 'im:name': { label: 'Chart Album' } },
      }] } }) };
    }
    assert.equal(url.pathname, '/lookup');
    return { ok: true, json: async () => ({ results: url.searchParams.get('id').split(',').map((id) => ({
      trackId: Number(id),
      collectionName: `Lookup Album ${id}`,
      trackTimeMillis: Number(id) * 5000,
      previewUrl: `https://example.com/${id}.m4a`,
    })) }) };
  };

  try {
    const result = await browseMusicTracks.run({ auth: { uid: 'listener' }, data: { limit: 4 } });
    assert.equal(result.recommended[0].albumName, 'Chart Album');
    assert.equal(result.recommended[0].durationMs, 205_000);
    assert.equal(result.trending[0].albumName, 'Lookup Album 42');
    assert.equal(result.trending[0].durationMs, 210_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
