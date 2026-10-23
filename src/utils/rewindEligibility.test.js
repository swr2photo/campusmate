import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearRewindEligibility,
  noteDismissWithoutOpen,
  noteProfileOpened,
  noteSwipeDismiss,
  rewindEligibleProfileId,
} from './rewindEligibility.js';

test('rewind is allowed only after the opened profile is swiped away', () => {
  clearRewindEligibility();
  noteProfileOpened('a');
  noteSwipeDismiss('a');
  assert.equal(rewindEligibleProfileId(), 'a');

  noteDismissWithoutOpen('b');
  assert.equal(rewindEligibleProfileId(), null);

  noteProfileOpened('c');
  noteDismissWithoutOpen('c');
  assert.equal(rewindEligibleProfileId(), null);

  noteSwipeDismiss('d');
  assert.equal(rewindEligibleProfileId(), null);
});
