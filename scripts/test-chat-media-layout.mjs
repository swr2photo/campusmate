import test from 'node:test';
import assert from 'node:assert/strict';
import { chatImageSize, chatTrackWidth, isGifMessage, isChatMediaPlaceholder } from '../src/utils/chatMediaLayout.js';

test('media fits small and large phones, preserving aspect ratio under the height cap', () => {
  for (const width of [320, 360, 375, 390, 430, 768]) {
    for (const ratio of [0.1, 9 / 16, 1, 16 / 9, 5]) {
      const size = chatImageSize(width, ratio);
      assert.ok(size.width <= Math.ceil(width * 0.55));
      assert.ok(size.width <= (width < 360 ? 180 : 220));
      assert.ok(size.height <= 260);
      assert.ok(Math.abs(size.width - size.height * ratio) <= 3);
    }
    assert.ok(chatTrackWidth(width) <= width * 0.65);
    assert.ok(chatTrackWidth(width) <= 250);
  }
});
test('protected square and preview image sizes are explicit and independent of photo loading', () => {
  assert.deepEqual(chatImageSize(320), { width: 176, height: 176, orientation: 'square' });
  assert.deepEqual(chatImageSize(430), { width: 220, height: 220, orientation: 'square' });
  for (const ratio of [0.5, 1, 2]) assert.deepEqual(chatImageSize(320, ratio, true), { width: 140, height: 140, orientation: 'square' });
});
test('GIF placeholders are metadata, while ordinary captions remain visible', () => {
  assert.equal(isChatMediaPlaceholder(' [gif] '), true);
  assert.equal(isChatMediaPlaceholder('ไปกินข้าวกัน'), false);
  assert.equal(isGifMessage({ mediaType: 'gif' }), true);
  assert.equal(isGifMessage({ text: '[GIF]', mediaUrl: 'encrypted.enc' }), true);
  assert.equal(isGifMessage({ mediaUrl: 'https://media.example/image.gif?x=1' }), true);
  assert.equal(isGifMessage({ mediaType: 'image', text: 'ภาพบรรยากาศ' }), false);
});
