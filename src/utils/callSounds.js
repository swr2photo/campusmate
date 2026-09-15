import { Platform, Vibration } from 'react-native';

let isRinging = false;

/**
 * Start incoming call vibration pattern (repeating 1s vibrate, 1s pause)
 */
export function startIncomingRingtone() {
  if (isRinging) return;
  isRinging = true;

  try {
    // 0ms delay, 1200ms vibrate, 1000ms silence, repeat
    Vibration.vibrate([0, 1200, 1000], true);
  } catch (err) {
    console.warn('[callSounds] Ringtone error:', err);
  }
}

/**
 * Start outgoing call feedback (gentle periodic vibration pulse)
 */
export function startOutgoingRingback() {
  if (isRinging) return;
  isRinging = true;

  try {
    // 0ms delay, 300ms vibrate, 2500ms silence, repeat
    Vibration.vibrate([0, 300, 2500], true);
  } catch (err) {
    console.warn('[callSounds] Outgoing ringback error:', err);
  }
}

/**
 * Stop any ongoing ringtone or vibration
 */
export function stopAllCallSounds() {
  isRinging = false;
  try {
    Vibration.cancel();
  } catch (err) {
    console.warn('[callSounds] Stop error:', err);
  }
}

/**
 * Play a short disconnect feedback
 */
export function playCallEndTone() {
  stopAllCallSounds();
  try {
    // Two quick short pulses
    Vibration.vibrate([0, 80, 80, 80]);
  } catch (err) {
    // Ignore
  }
}
