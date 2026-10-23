// Run: node --test scripts/test-liquid-glass.mjs
// iOS 26 Liquid Glass is applied to the functional layer only (Apple HIG
// Materials): sheets/dialogs and controls floating over content. Each surface
// keeps its opaque fill unless glass is actually drawn (iOS 26+, Reduce
// Transparency off), so older iOS and Android look unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('glass helpers fall back to nothing outside iOS 26 and respect Reduce Transparency', () => {
  const source = read('src/components/LiquidGlassSurface.js');
  assert.match(source, /LIQUID_GLASS_AVAILABLE = Platform\.OS === 'ios' && Boolean\(GlassView\) && canUseLiquidGlass\(\)/);
  assert.match(source, /isReduceTransparencyEnabled\(\)/);
  assert.match(source, /reduceTransparencyChanged/);
  assert.match(source, /return LIQUID_GLASS_AVAILABLE && !reduced;/);
  assert.match(source, /if \(!enabled\) return null;/);
});

const SHEETS = [
  'src/components/ReportModal.js',
  'src/components/ChatPreviewModal.js',
  'src/components/ReactionDetailsModal.js',
  'src/components/PlusUpsellSheet.js',
  'src/components/SpotifyTrackSearchSheet.js',
  'src/components/ChatMediaPickerSheet.js',
  'src/components/ChatGiphyPickerSheet.js',
  'src/components/ConsentModal.js',
  'src/components/AvailabilityModal.js',
  'src/components/ImageModerationNotice.js',
  'src/components/PartyFinderSection.js',
  'src/components/AppTourOverlay.js',
  'src/screens/MatchingFiltersScreen.js',
  'src/screens/AccountSecurityScreen.js',
  'src/screens/GroupChatRoomScreen.js',
  'src/screens/ChatRoomScreen.ios.js',
  'src/screens/ProfileScreen.js',
];

test('sheets and dialogs draw glass and drop their opaque fill only when glass is on', () => {
  for (const file of SHEETS) {
    const source = read(file);
    assert.match(source, /<GlassBackground\b/, file);
    assert.match(source, /const glass = useLiquidGlass\(\);/, file);
    assert.match(source, /glass \? 'transparent'|glass && \{ backgroundColor: 'transparent' \}|glass\s*\n\s*\? \{ backgroundColor: 'transparent'/, file);
  }
});

test('media screens use dark glass behind their white controls', () => {
  for (const file of [
    'src/components/ChatCameraModal.js',
    'src/components/ChatImageViewerModal.js',
    'src/components/ChatImageEditorModal.ios.js',
    'src/components/CallModal.js',
    'src/components/ChatMediaComposer.js',
    'src/components/ChatVideoComposer.js',
  ]) {
    assert.match(read(file), /colorScheme="dark"/, file);
  }
});

test('in-content buttons become capsules on iOS 26 but stay opaque', () => {
  const ui = read('src/components/ui.js');
  assert.match(ui, /BUTTON_RADIUS = LIQUID_GLASS_AVAILABLE \? radius\.pill : radius\.md/);
  assert.doesNotMatch(ui, /GlassBackground/);
});
