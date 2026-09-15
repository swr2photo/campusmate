import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService.js';

let LiveKitClient = null;
let LiveKitRN = null;

try {
  LiveKitClient = require('livekit-client');
} catch (_) {}

try {
  LiveKitRN = require('@livekit/react-native');
} catch (_) {}

/**
 * Check if LiveKit SDK is available in the current environment
 */
export function isLiveKitAvailable() {
  return Boolean(LiveKitClient?.Room);
}

/**
 * Fetch a LiveKit room token from Firebase Cloud Functions
 */
export async function fetchLiveKitToken({ callId, participantName }) {
  const { app } = requireFirebase();
  const functions = getFunctions(app, 'asia-southeast1');
  const getTokenFn = httpsCallable(functions, 'getLiveKitToken', { timeout: 15000 });

  const result = await getTokenFn({ callId, participantName });
  return result.data;
}

/**
 * Connect to a LiveKit Room
 */
export async function connectToLiveKitRoom({
  url,
  token,
  isVideo = false,
  onRemoteTrackUpdate,
  onLocalTrackUpdate,
  onDisconnect,
}) {
  if (!isLiveKitAvailable()) {
    console.warn('[LiveKit] LiveKit client is not available in this environment');
    throw new Error('LiveKit client unavailable');
  }

  const { Room, RoomEvent } = LiveKitClient;

  // Request runtime permissions on Android before starting media devices
  if (Platform.OS === 'android') {
    try {
      const { PermissionsAndroid } = require('react-native');
      const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
      if (isVideo) {
        perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
      }
      await PermissionsAndroid.requestMultiple(perms);
    } catch (permErr) {
      console.warn('[LiveKit] Permission request error:', permErr);
    }
  }

  // NOTE: adaptiveStream must be false in React Native Modals
  // because ViewPortDetector cannot measure dimensions inside native Modals,
  // causing LiveKit SFU to think the view is invisible and pause video packets.
  const room = new Room({
    autoSubscribe: true,
    adaptiveStream: false,
    dynacast: false,
    videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 24 }, facingMode: 'user' },
    publishDefaults: { videoEncoding: { maxBitrate: 600000, maxFramerate: 24 }, simulcast: false },
  });

  const notifyRemoteTrack = (track, publication, participant, isMuted = false) => {
    if (!participant || participant === room.localParticipant) return;
    const kind = track?.kind || publication?.kind;
    if (kind === 'video' && onRemoteTrackUpdate) {
      const vidTrack = track || publication?.track || null;
      onRemoteTrackUpdate({
        track: vidTrack,
        publication,
        participant,
        kind: 'video',
        source: track?.source || publication?.source,
        isMuted,
      });
    }
  };

  // Track subscription events for remote participant
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    notifyRemoteTrack(track, publication, participant, Boolean(publication?.isMuted || track?.isMuted));
  });

  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    if (participant !== room.localParticipant) {
      if (!publication.isSubscribed && typeof publication.setSubscribed === 'function') {
        publication.setSubscribed(true);
      }
      if (publication.track) {
        notifyRemoteTrack(publication.track, publication, participant, Boolean(publication.isMuted));
      }
    }
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    participant.trackPublications?.forEach?.((pub) => {
      if (pub.kind === 'video') {
        if (!pub.isSubscribed && typeof pub.setSubscribed === 'function') {
          pub.setSubscribed(true);
        }
        if (pub.track) {
          notifyRemoteTrack(pub.track, pub, participant, Boolean(pub.isMuted));
        }
      }
    });
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    if (participant !== room.localParticipant && (track?.kind === 'video' || publication?.kind === 'video')) {
      if (onRemoteTrackUpdate) {
        onRemoteTrackUpdate({
          track: null,
          publication,
          participant,
          kind: 'video',
          unsubscribed: true,
        });
      }
    }
  });

  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    if (participant !== room.localParticipant && publication?.kind === 'video') {
      if (onRemoteTrackUpdate) {
        onRemoteTrackUpdate({
          track: null,
          publication,
          participant,
          kind: 'video',
          unsubscribed: true,
        });
      }
    }
  });

  room.on(RoomEvent.TrackMuted, (publication, participant) => {
    if (participant !== room.localParticipant && publication?.kind === 'video') {
      notifyRemoteTrack(publication.track, publication, participant, true);
    }
  });

  room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    if (participant !== room.localParticipant && publication?.kind === 'video') {
      notifyRemoteTrack(publication.track, publication, participant, false);
    }
  });

  if (RoomEvent.TrackStreamStateChanged) {
    room.on(RoomEvent.TrackStreamStateChanged, (publication, streamState, participant) => {
      if (participant !== room.localParticipant && publication?.kind === 'video') {
        const isMuted = streamState === 'paused' || Boolean(publication.isMuted);
        notifyRemoteTrack(publication.track, publication, participant, isMuted);
      }
    });
  }

  // Local track events
  room.on(RoomEvent.LocalTrackPublished, (publication, participant) => {
    if (onLocalTrackUpdate && publication.track) {
      onLocalTrackUpdate({
        track: publication.track,
        publication,
        participant,
        kind: publication.track.kind,
      });
    }
  });

  room.on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
    if (onLocalTrackUpdate) {
      onLocalTrackUpdate({
        track: null,
        publication,
        participant,
        kind: publication.track?.kind,
        unsubscribed: true,
      });
    }
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    if (onDisconnect) {
      onDisconnect(reason);
    }
  });

  // Start LiveKit AudioSession for VoIP call audio focus (keeps audio alive in background)
  if (LiveKitRN?.AudioSession) {
    try {
      if (Platform.OS === 'android' && LiveKitRN.AndroidAudioTypePresets?.communication) {
        await LiveKitRN.AudioSession.configureAudio({
          android: {
            audioTypeOptions: LiveKitRN.AndroidAudioTypePresets.communication,
          },
        });
      }
      await LiveKitRN.AudioSession.startAudioSession();
    } catch (audioErr) {
      console.warn('[LiveKit] Failed to start AudioSession:', audioErr);
    }
  }

  // Connect to LiveKit server
  try {
    await room.connect(url, token);
    await setLiveKitSpeaker(isVideo);
  } catch (error) {
    await disconnectLiveKitRoom(room);
    throw error;
  }

  // Enable audio
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    console.warn('[LiveKit] Failed to enable microphone:', err);
  }

  // Enable video if video call
  if (isVideo) {
    try {
      const pub = await room.localParticipant.setCameraEnabled(true);
      const track = pub?.track || room.localParticipant.getTrackPublication(LiveKitClient.Track.Source.Camera)?.track;
      if (track && onLocalTrackUpdate) {
        onLocalTrackUpdate({
          track,
          publication: pub,
          participant: room.localParticipant,
          kind: 'video',
        });
      }
    } catch (err) {
      console.warn('[LiveKit] Failed to enable camera:', err);
    }
  }

  // Sync existing remote participant tracks if already published before join
  const syncExistingTracks = () => {
    try {
      room.remoteParticipants?.forEach?.((participant) => {
        participant.trackPublications?.forEach?.((pub) => {
          if (pub.kind === 'video') {
            if (!pub.isSubscribed && typeof pub.setSubscribed === 'function') {
              pub.setSubscribed(true);
            }
            if (pub.track) {
              notifyRemoteTrack(pub.track, pub, participant, Boolean(pub.isMuted));
            }
          }
        });
      });

      // Also sync existing local track publication if ready
      room.localParticipant?.trackPublications?.forEach?.((pub) => {
        if (pub.track && onLocalTrackUpdate) {
          onLocalTrackUpdate({
            track: pub.track,
            publication: pub,
            participant: room.localParticipant,
            kind: pub.track.kind,
          });
        }
      });
    } catch (syncErr) {
      console.warn('[LiveKit] Remote track sync error:', syncErr);
    }
  };

  syncExistingTracks();
  setTimeout(syncExistingTracks, 400);
  setTimeout(syncExistingTracks, 1200);
  setTimeout(syncExistingTracks, 2500);

  return room;
}

/**
 * Toggle microphone mute
 */
export async function setLiveKitMicrophone(room, enabled) {
  if (!room?.localParticipant) return;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled);
  } catch (err) {
    throw err;
  }
}

/**
 * Toggle audio between speakerphone and earpiece
 */
export async function setLiveKitSpeaker(enabled) {
  if (!LiveKitRN?.AudioSession) return;
  try {
    const target = enabled ? 'speaker' : 'earpiece';
    await LiveKitRN.AudioSession.selectAudioOutput(target);
  } catch (err) {
    throw err;
  }
}

/**
 * Toggle camera video enable
 */
export async function setLiveKitCamera(room, enabled) {
  if (!room?.localParticipant) return null;
  if (enabled && Platform.OS === 'android') {
    try {
      const { PermissionsAndroid } = require('react-native');
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    } catch (permErr) {
      console.warn('[LiveKit] Camera permission request error:', permErr);
    }
  }
  try {
    const pub = await room.localParticipant.setCameraEnabled(enabled);
    return pub?.track || room.localParticipant.getTrackPublication(LiveKitClient?.Track?.Source?.Camera)?.track || null;
  } catch (err) {
    throw err;
  }
}

/**
 * Flip between front and back camera
 */
export async function switchLiveKitCamera(room, targetFacingMode) {
  if (!room?.localParticipant) throw new Error('Call is not connected');

  let pub = room.localParticipant.getTrackPublication(LiveKitClient?.Track?.Source?.Camera);
  if (!pub?.track) {
    pub = await room.localParticipant.setCameraEnabled(true);
  }
  const track = pub?.track || room.localParticipant.getTrackPublication(LiveKitClient?.Track?.Source?.Camera)?.track;
  if (!track) throw new Error('Camera is unavailable');

  // Find target camera device using enumerateDevices
  const isTargetFront = targetFacingMode === 'user';
  let targetDeviceId = null;
  if (global.navigator?.mediaDevices?.enumerateDevices) {
    try {
      const devices = await global.navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      const match = videoDevices.find((d) =>
        isTargetFront
          ? d.facing === 'front' || d.facing === 'user'
          : d.facing === 'environment' || d.facing === 'back'
      );
      if (match?.deviceId) {
        targetDeviceId = match.deviceId;
      }
    } catch (e) {
      console.warn('[LiveKit] enumerateDevices failed in switchCamera:', e);
    }
  }

  // 1. Primary & reliable method: restartTrack with target deviceId and facingMode
  if (typeof track.restartTrack === 'function') {
    try {
      const options = targetDeviceId
        ? { deviceId: targetDeviceId, facingMode: targetFacingMode }
        : { facingMode: targetFacingMode };
      await track.restartTrack(options);
      return track;
    } catch (err) {
      console.warn('[LiveKit] restartTrack failed, trying fallback:', err);
    }
  }

  // 2. Fallback: native WebRTC switchCamera directly on the mediaStreamTrack if available
  const mediaTrack = track.mediaStreamTrack;
  if (mediaTrack && typeof mediaTrack._switchCamera === 'function') {
    try {
      mediaTrack._switchCamera();
      return track;
    } catch (err) {
      console.warn('[LiveKit] _switchCamera fallback failed:', err);
    }
  }

  return track;
}

/**
 * Disconnect and release room resources
 */
export async function disconnectLiveKitRoom(room) {
  if (LiveKitRN?.AudioSession) {
    try {
      await LiveKitRN.AudioSession.stopAudioSession();
    } catch (err) {
      console.warn('[LiveKit] Error stopping AudioSession:', err);
    }
  }
  if (!room) return;
  try {
    await room.disconnect();
  } catch (err) {
    console.warn('[LiveKit] Error disconnecting room:', err);
  }
}
