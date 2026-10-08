import { Vibration } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

let isRinging = false;
let tonePlayer = null;

function uint8ToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    result += chars[(triple >> 18) & 63];
    result += chars[(triple >> 12) & 63];
    result += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? chars[triple & 63] : '=';
  }
  return result;
}

function makeWavBytes(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  }
  return bytes;
}

function toneSamples({ sampleRate, durationSec, segments }) {
  const total = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    const segment = segments.find((item) => t >= item.start && t < item.end);
    if (!segment?.frequency) continue;
    const local = t - segment.start;
    const length = segment.end - segment.start;
    const fade = Math.min(0.02, length / 4);
    const envelope = Math.min(local / fade, (length - local) / fade, 1);
    samples[i] = Math.sin(2 * Math.PI * segment.frequency * local) * 0.38 * Math.max(0, envelope);
  }
  return samples;
}

async function ensureToneUri(kind) {
  const fileName = kind === 'incoming' ? 'cm-ring-in.wav' : kind === 'outgoing' ? 'cm-ring-out.wav' : 'cm-ring-end.wav';
  const path = `${FileSystem.cacheDirectory}${fileName}`;
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) return path;

  const sampleRate = 22050;
  let samples;
  if (kind === 'incoming') {
    samples = toneSamples({
      sampleRate,
      durationSec: 1.6,
      segments: [
        { start: 0, end: 0.4, frequency: 440 },
        { start: 0.4, end: 0.8, frequency: 480 },
      ],
    });
  } else if (kind === 'outgoing') {
    samples = toneSamples({
      sampleRate,
      durationSec: 1.8,
      segments: [{ start: 0, end: 0.32, frequency: 425 }],
    });
  } else {
    samples = toneSamples({
      sampleRate,
      durationSec: 0.35,
      segments: [
        { start: 0, end: 0.08, frequency: 360 },
        { start: 0.14, end: 0.22, frequency: 300 },
      ],
    });
  }

  await FileSystem.writeAsStringAsync(path, uint8ToBase64(makeWavBytes(samples, sampleRate)), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

async function stopTonePlayer() {
  if (!tonePlayer) return;
  const player = tonePlayer;
  tonePlayer = null;
  try { player.pause(); } catch (_) {}
  try { player.remove(); } catch (_) {}
}

async function playLoopingTone(kind) {
  await stopTonePlayer();
  if (!isRinging) return;
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      playsInSilentModeIOS: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    });
    if (!isRinging) return;
    const uri = await ensureToneUri(kind);
    if (!isRinging) return;
    const player = createAudioPlayer({ uri });
    if (!isRinging) {
      try { player.remove(); } catch (_) {}
      return;
    }
    player.loop = true;
    player.volume = 0.9;
    player.play();
    tonePlayer = player;
  } catch (err) {
    console.warn('[callSounds] Tone playback error:', err);
  }
}

export function startIncomingRingtone() {
  if (isRinging) return;
  isRinging = true;
  try {
    Vibration.vibrate([0, 1200, 1000], true);
  } catch (err) {
    console.warn('[callSounds] Ringtone vibration error:', err);
  }
  void playLoopingTone('incoming');
}

export function startOutgoingRingback() {
  if (isRinging) return;
  isRinging = true;
  try {
    Vibration.vibrate([0, 300, 2500], true);
  } catch (err) {
    console.warn('[callSounds] Outgoing ringback vibration error:', err);
  }
  void playLoopingTone('outgoing');
}

export function stopAllCallSounds() {
  isRinging = false;
  try {
    Vibration.cancel();
  } catch (err) {
    console.warn('[callSounds] Stop vibration error:', err);
  }
  void stopTonePlayer();
}

export function playCallEndTone() {
  stopAllCallSounds();
  try {
    Vibration.vibrate([0, 80, 80, 80]);
  } catch (_) {}
  void (async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        playsInSilentModeIOS: true,
      });
      const uri = await ensureToneUri('end');
      const player = createAudioPlayer({ uri });
      player.volume = 0.8;
      player.play();
      setTimeout(() => {
        try { player.pause(); } catch (_) {}
        try { player.remove(); } catch (_) {}
      }, 500);
    } catch (_) {}
  })();
}
