import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactLyrics,
  findRepeatedLyricPassage,
  parseSyncedLyrics,
  selectLyricsRecord,
} from './musicLyrics.js';

test('parseSyncedLyrics keeps timestamped lines in time order', () => {
  assert.deepEqual(parseSyncedLyrics('[00:03.50] second\n[00:01.2] first\n[bad] ignored\n[00:59.123] third'), [
    { timeMs: 1200, text: 'first' },
    { timeMs: 3500, text: 'second' },
    { timeMs: 59123, text: 'third' },
  ]);
});

test('findRepeatedLyricPassage finds a repeated chorus without assuming preview offset', () => {
  const lines = [
    { timeMs: 0, text: 'Intro one' },
    { timeMs: 5000, text: 'Intro two' },
    { timeMs: 10000, text: 'Sing this chorus line one' },
    { timeMs: 13000, text: 'Sing this chorus line two' },
    { timeMs: 16000, text: 'Sing this chorus line three' },
    { timeMs: 19000, text: 'Sing this chorus line four' },
    { timeMs: 22000, text: 'Verse one' },
    { timeMs: 26000, text: 'Verse two' },
    { timeMs: 30000, text: 'Sing this chorus line one' },
    { timeMs: 33000, text: 'Sing this chorus line two' },
    { timeMs: 36000, text: 'Sing this chorus line three' },
    { timeMs: 39000, text: 'Sing this chorus line four' },
  ];
  assert.deepEqual(findRepeatedLyricPassage(lines), {
    suggestedLines: lines.slice(2, 6).map((line) => line.text),
    suggestedLineStartMs: 10000,
  });
});

test('compactLyrics handles plain lyrics and instrumental records', () => {
  const plain = compactLyrics({ plainLyrics: 'Line one\nLine two', syncedLyrics: null });
  assert.equal(plain.status, 'found');
  assert.equal(plain.plainLyrics, 'Line one\nLine two');
  assert.deepEqual(plain.lines, []);
  assert.deepEqual(plain.suggestedLines, []);
  assert.equal(plain.suggestedLineStartMs, null);

  const instrumental = compactLyrics({ instrumental: true, plainLyrics: 'wrong text' });
  assert.equal(instrumental.status, 'not_found');
  assert.equal(instrumental.plainLyrics, '');
});

test('selectLyricsRecord uses full-song duration to avoid another version', () => {
  const live = {
    trackName: 'Signal', artistName: 'Example Artist', albumName: 'Live', duration: 270,
    plainLyrics: 'live words',
  };
  const studio = {
    trackName: 'Signal', artistName: 'Example Artist', albumName: 'Studio', duration: 200,
    plainLyrics: 'studio words',
  };
  assert.equal(selectLyricsRecord([live, studio], {
    title: 'Signal', artist: 'Example Artist', albumName: 'Studio', durationMs: 200_000,
  }), studio);
  assert.equal(selectLyricsRecord([live], {
    title: 'Signal', artist: 'Example Artist', albumName: 'Studio', durationMs: 200_000,
  }), null);
});

test('selectLyricsRecord prefers matching album but allows a different album', () => {
  const compilation = {
    trackName: 'Signal', artistName: 'Example Artist', albumName: 'Greatest Hits', duration: 200,
    plainLyrics: 'words',
  };
  const single = {
    ...compilation, albumName: 'Signal - Single', plainLyrics: 'same words',
  };
  const metadata = {
    title: 'Signal', artist: 'Example Artist', albumName: 'Signal - Single', durationMs: 200_000,
  };
  assert.equal(selectLyricsRecord([compilation, single], metadata), single);
  assert.equal(selectLyricsRecord([compilation], metadata), compilation);
});
