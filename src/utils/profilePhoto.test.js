import test from 'node:test';
import assert from 'node:assert/strict';
import { isCommittedProfilePhoto, sameProfilePhoto } from './profilePhoto.js';

test('profile photo comparison ignores download tokens and encoding', () => {
  const stored = 'https://firebasestorage.googleapis.com/v0/b/app/o/profile_gallery%2Fuser%2Fphoto.jpg?alt=media&token=abc';
  const candidate = 'https://firebasestorage.googleapis.com/v0/b/app/o/profile_gallery/user/photo.jpg?alt=media&token=other';
  assert.equal(sameProfilePhoto(stored, candidate), true);
  assert.equal(sameProfilePhoto(stored, 'https://firebasestorage.googleapis.com/v0/b/app/o/profile_gallery/user/other.jpg'), false);
  assert.equal(sameProfilePhoto('', candidate), false);
});

test('a committed photo requires the server verification flag and the same object', () => {
  const uri = 'https://cdn.example.test/profile_gallery/user/photo.jpg';
  assert.equal(isCommittedProfilePhoto({ isFaceVerified: true, avatarUri: `${uri}?token=1` }, uri), true);
  assert.equal(isCommittedProfilePhoto({ isFaceVerified: false, avatarUri: uri }, uri), false);
  assert.equal(isCommittedProfilePhoto({ isFaceVerified: true, avatarUri: 'https://cdn.example.test/old.jpg' }, uri), false);
});
