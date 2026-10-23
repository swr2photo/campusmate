import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDiscoveryPhoto } from './discoveryPresentation.js';

test('a later discovery payload keeps the photo it omitted', () => {
  const previous = {
    id: 'a',
    avatarUri: 'https://cdn.example/a.jpg?token=1',
    gallery: ['https://cdn.example/a-2.jpg'],
    avatarRevision: 4,
  };
  const next = { id: 'a', name: 'ใหม่', avatarUri: '', gallery: [] };
  const merged = mergeDiscoveryPhoto(previous, next);
  assert.equal(merged.avatarUri, previous.avatarUri);
  assert.deepEqual(merged.gallery, previous.gallery);
  assert.equal(merged.avatarRevision, 4);
  assert.equal(merged.name, 'ใหม่');
});
