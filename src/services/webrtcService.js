/**
 * WebRTC Service for Audio and Video Calling
 * Handles STUN/TURN ICE servers configuration, MediaStream controls,
 * and RTCPeerConnection abstractions.
 */

export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

/**
 * Check if native WebRTC module (react-native-webrtc) is available in current runtime
 */
let nativeWebRTC = null;
try {
  nativeWebRTC = require('react-native-webrtc');
} catch (e) {
  // Native module not linked in current JS bundle / Expo Go
}

export function isWebRTCAvailable() {
  return Boolean(nativeWebRTC && nativeWebRTC.RTCPeerConnection);
}

/**
 * Get WebRTC classes if available
 */
export function getWebRTC() {
  return nativeWebRTC;
}

/**
 * Create a new RTCPeerConnection instance with STUN/TURN configuration
 */
export function createPeerConnection(customIceServers = null) {
  const iceServers = customIceServers || DEFAULT_ICE_SERVERS;

  if (isWebRTCAvailable()) {
    const { RTCPeerConnection } = nativeWebRTC;
    return new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 10,
    });
  }

  // Fallback simulator for non-native environment
  return createMockPeerConnection();
}

/**
 * Request user audio/video media stream
 */
export async function getUserMedia({ audio = true, video = false }) {
  if (isWebRTCAvailable() && nativeWebRTC.mediaDevices?.getUserMedia) {
    return await nativeWebRTC.mediaDevices.getUserMedia({
      audio,
      video: video
        ? {
            frameRate: 30,
            facingMode: 'user',
          }
        : false,
    });
  }

  return null;
}

/**
 * Switch camera front/back
 */
export function switchCamera(stream) {
  if (!stream) return;
  const videoTrack = stream.getVideoTracks?.()?.[0];
  if (videoTrack && typeof videoTrack._switchCamera === 'function') {
    videoTrack._switchCamera();
  }
}

/**
 * Toggle microphone mute
 */
export function setAudioEnabled(stream, enabled) {
  if (!stream) return;
  const audioTracks = stream.getAudioTracks?.() || [];
  audioTracks.forEach((track) => {
    track.enabled = enabled;
  });
}

/**
 * Toggle camera video enable
 */
export function setVideoEnabled(stream, enabled) {
  if (!stream) return;
  const videoTracks = stream.getVideoTracks?.() || [];
  videoTracks.forEach((track) => {
    track.enabled = enabled;
  });
}

/**
 * Helper to close and stop all tracks in a MediaStream
 */
export function stopMediaStream(stream) {
  if (!stream) return;
  try {
    const tracks = stream.getTracks?.() || [];
    tracks.forEach((track) => {
      try {
        track.stop?.();
      } catch (_) {}
    });
  } catch (_) {}
}

/**
 * Minimal mock peer connection to gracefully handle testing when native C++ module isn't compiled
 */
function createMockPeerConnection() {
  const listeners = {};
  return {
    onicecandidate: null,
    ontrack: null,
    oniceconnectionstatechange: null,
    iceConnectionState: 'connected',
    createOffer: async () => ({ type: 'offer', sdp: 'mock_offer_sdp' }),
    createAnswer: async () => ({ type: 'answer', sdp: 'mock_answer_sdp' }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {},
    addIceCandidate: async () => {},
    addTrack: () => {},
    close: () => {},
    addEventListener: (event, handler) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    },
  };
}
