// Run: node --test scripts/test-tab-headers.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const NATIVE_HEADER_ITEM = /<Stack\.(Screen|SearchBar|Toolbar)[\s>]/g;

test('screens without a native bar register no native header items', () => {
  for (const file of [
    'src/screens/LikesScreen.js',
    'src/screens/HomeScreen.js',
    'src/screens/HomeScreen.ios.js',
    'src/screens/MeetupScreen.js',
    'src/screens/ProfileHubScreen.js',
  ]) {
    assert.doesNotMatch(read(file), NATIVE_HEADER_ITEM, file);
  }
});

test('Messages and Activities register the system search bar only outside previews', () => {
  for (const file of ['src/screens/ChatScreen.js', 'src/screens/MeetupScreen.ios.js']) {
    const source = read(file);
    const items = [...source.matchAll(NATIVE_HEADER_ITEM)];
    assert.ok(items.length > 0, file);
    for (const item of items) {
      const before = source.slice(Math.max(0, item.index - 700), item.index);
      assert.match(before, /isTabPreview \? null|\|\| isTabPreview \? null/, `${file}: ${item[0]} must be skipped in previews`);
    }
    assert.match(source, /const isTabPreview = useIsTabPreview\(\);/, file);
  }
  assert.doesNotMatch(read('src/screens/MeetupScreen.ios.js'), /Toolbar\.Button[^>]*icon="map"/, 'map toolbar button was removed');
});

test('iOS tab headers: native bar for search tabs, in-page title for the others', () => {
  assert.match(read('app/(tabs)/chat/index.js'), /headerShown: Platform\.OS !== 'android'/);
  assert.match(read('app/(tabs)/meetup/index.ios.js'), /headerShown: true/);
  assert.match(read('app/(tabs)/home/index.js'), /headerShown: Platform\.OS !== 'ios'/);
  assert.match(read('src/screens/HomeScreen.ios.js'), /<HomeTitleBar \/>/);
});

test('iOS tab bar minimizes on scroll only in the Activities tab', () => {
  const layout = read('app/(tabs)/_layout.ios.js');
  assert.match(layout, /segments\[1\] === 'meetup' \? 'onScrollDown' : 'never'/);
  assert.match(layout, /minimizeBehavior=\{minimizeBehavior\}/);
});
