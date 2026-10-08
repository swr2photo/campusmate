/**
 * Audio Session Manager
 *
 * Configures platform audio session policies for iOS and Android.
 * Follows Apple Human Interface Guidelines:
 * - Plays voice notes and previews with ducking (interruptionMode: duckOthers)
 *   so the user's background music isn't abruptly cut off.
 * - Restores default ambient playback when stopped.
 */

let expoAudioModule = null;

async function getExpoAudio() {
  if (expoAudioModule) return expoAudioModule;
  try {
    expoAudioModule = await import('expo-audio');
    return expoAudioModule;
  } catch (err) {
    return null;
  }
}

export async function setVoicePlaybackMode() {
  const audio = await getExpoAudio();
  if (!audio?.setAudioModeAsync) return;

  try {
    await audio.setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      interruptionMode: 'duckOthers',
      shouldDuckAndroid: true,
    });
  } catch (error) {
    // Non-blocking fallback
    console.warn('[AudioSession] Failed to set voice playback mode:', error?.message || error);
  }
}

export async function resetAudioMode() {
  const audio = await getExpoAudio();
  if (!audio?.setAudioModeAsync) return;

  try {
    await audio.setAudioModeAsync({
      playsInSilentMode: false,
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      shouldDuckAndroid: false,
    });
  } catch (error) {
    console.warn('[AudioSession] Failed to reset audio mode:', error?.message || error);
  }
}
