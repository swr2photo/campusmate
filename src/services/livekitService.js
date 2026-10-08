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

function isAudioKind(kind, track) {
  return kind === 'audio' || track?.kind === 'audio';
}

function startRemoteAudioTrack(track) {
  if (!track) return;
  try { track.start?.(); } catch (_) {}
  try { if (typeof track.setVolume === 'function') track.setVolume(1); } catch (_) {}
  try { if (track.mediaStreamTrack) track.mediaStreamTrack.enabled = true; } catch (_) {}
}

async function configureCallAudioSession(isVideo) {
  if (!LiveKitRN?.AudioSession) return;
  try {
    await LiveKitRN.AudioSession.configureAudio({
      android: {
        preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
        audioTypeOptions: LiveKitRN.AndroidAudioTypePresets?.communication || {
          manageAudioFocus: true,
          audioMode: 'inCommunication',
          audioFocusMode: 'gain',
          audioStreamType: 'voiceCall',
          audioAttributesUsageType: 'voiceCommunication',
          audioAttributesContentType: 'speech',
        },
      },
      ios: {
        defaultOutput: 'speaker',
      },
    });
  } catch (err) {
    console.warn('[LiveKit] configureAudio failed:', err);
  }
  if (Platform.OS === 'ios' && typeof LiveKitRN.AudioSession.setAppleAudioConfiguration === 'function') {
    try {
      await LiveKitRN.AudioSession.setAppleAudioConfiguration({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: ['allowBluetooth', 'defaultToSpeaker'],
        audioMode: isVideo ? 'videoChat' : 'voiceChat',
      });
    } catch (err) {
      console.warn('[LiveKit] setAppleAudioConfiguration failed:', err);
    }
  }
  try {
    await LiveKitRN.AudioSession.startAudioSession();
  } catch (err) {
    console.warn('[LiveKit] Failed to start AudioSession:', err);
  }
  if (typeof LiveKitRN.AudioSession.setDefaultRemoteAudioTrackVolume === 'function') {
    try {
      await LiveKitRN.AudioSession.setDefaultRemoteAudioTrackVolume(1);
    } catch (_) {}
  }
}

function subscribeParticipantMedia(participant, onRemoteTrackUpdate) {
  participant?.trackPublications?.forEach?.((pub) => {
    if (!pub.isSubscribed && typeof pub.setSubscribed === 'function') {
      pub.setSubscribed(true);
    }
    if (isAudioKind(pub.kind, pub.track)) {
      startRemoteAudioTrack(pub.track);
    } else if ((pub.kind === 'video' || pub.track?.kind === 'video') && pub.track && onRemoteTrackUpdate) {
      onRemoteTrackUpdate({
        track: pub.track,
        publication: pub,
        participant,
        kind: 'video',
        source: pub.source,
        isMuted: Boolean(pub.isMuted),
      });
    }
  });
}

const roomSyncTimeouts = new WeakMap();

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
  onReconnecting,
  onReconnected,
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
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
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
    if (isAudioKind(track?.kind || publication?.kind, track)) {
      startRemoteAudioTrack(track);
      return;
    }
    notifyRemoteTrack(track, publication, participant, Boolean(publication?.isMuted || track?.isMuted));
  });

  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    if (participant !== room.localParticipant) {
      if (!publication.isSubscribed && typeof publication.setSubscribed === 'function') {
        publication.setSubscribed(true);
      }
      if (isAudioKind(publication.kind, publication.track)) {
        startRemoteAudioTrack(publication.track);
      } else if (publication.track) {
        notifyRemoteTrack(publication.track, publication, participant, Boolean(publication.isMuted));
      }
    }
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    subscribeParticipantMedia(participant, onRemoteTrackUpdate);
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

  if (RoomEvent.Reconnecting) {
    room.on(RoomEvent.Reconnecting, () => {
      if (onReconnecting) {
        onReconnecting();
      }
    });
  }

  if (RoomEvent.Reconnected) {
    room.on(RoomEvent.Reconnected, () => {
      syncExistingTracks();
      if (onReconnected) {
        onReconnected();
      }
    });
  }

  await configureCallAudioSession(isVideo);

  // Connect to LiveKit server
  try {
    await room.connect(url, token);
    try { await room.startAudio?.(); } catch (_) {}
    await setLiveKitSpeaker(true);
  } catch (error) {
    await disconnectLiveKitRoom(room);
    throw error;
  }

  // Enable microphone so the other person can hear us
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    const micPub = room.localParticipant.getTrackPublication(LiveKitClient.Track.Source.Microphone);
    if (!micPub?.track && typeof LiveKitClient.createLocalAudioTrack === 'function') {
      const audioTrack = await LiveKitClient.createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      await room.localParticipant.publishTrack(audioTrack);
    }
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
        subscribeParticipantMedia(participant, onRemoteTrackUpdate);
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
  roomSyncTimeouts.set(room, [
    setTimeout(syncExistingTracks, 400),
    setTimeout(syncExistingTracks, 1200),
    setTimeout(syncExistingTracks, 2500),
  ]);

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
    const outputs = typeof LiveKitRN.AudioSession.getAudioOutputs === 'function'
      ? await LiveKitRN.AudioSession.getAudioOutputs()
      : [];
    let target;
    if (Platform.OS === 'ios') {
      target = enabled ? 'force_speaker' : 'default';
    } else {
      target = enabled ? 'speaker' : 'earpiece';
    }
    if (Array.isArray(outputs) && outputs.length && !outputs.includes(target)) {
      target = enabled
        ? (outputs.includes('speaker') ? 'speaker' : outputs[0])
        : (outputs.includes('earpiece') ? 'earpiece' : outputs[0]);
    }
    await LiveKitRN.AudioSession.selectAudioOutput(target);
  } catch (err) {
    console.warn('[LiveKit] selectAudioOutput failed:', err);
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
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('กรุณาอนุญาตการเข้าถึงกล้องในการตั้งค่าตัวเครื่อง');
      }
    } catch (permErr) {
      console.warn('[LiveKit] Camera permission request error:', permErr);
      throw permErr;
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
 * Flip between front and back camera.
 * On React Native, switching the live track in place is more reliable than
 * stopping it and calling getUserMedia again.
 */
export async function switchLiveKitCamera(room, targetFacingMode) {
  if (!room?.localParticipant) throw new Error('Call is not connected');

  let pub = room.localParticipant.getTrackPublication(LiveKitClient?.Track?.Source?.Camera);
  if (!pub?.track) {
    pub = await room.localParticipant.setCameraEnabled(true);
  }
  const track = pub?.track || room.localParticipant.getTrackPublication(LiveKitClient?.Track?.Source?.Camera)?.track;
  if (!track) throw new Error('Camera is unavailable');

  const wantedFront = targetFacingMode === 'user';
  const wantedFacing = wantedFront ? 'user' : 'environment';

  const readFacing = (mediaTrack) => {
    try {
      const facing = mediaTrack?.getSettings?.()?.facingMode;
      if (facing === 'environment' || facing === 'user') return facing;
    } catch (_) {}
    return null;
  };

  const notifyRestarted = () => {
    if (typeof track.emit === 'function') {
      try { track.emit('restarted', track); } catch (_) {}
    }
  };

  const mediaTrack = track.mediaStreamTrack;

  // 1. Native in-place switch (React Native WebRTC)
  if (mediaTrack && typeof mediaTrack.applyConstraints === 'function') {
    try {
      const settings = typeof mediaTrack.getSettings === 'function' ? mediaTrack.getSettings() : {};
      const constraints = { ...settings, facingMode: wantedFacing };
      delete constraints.deviceId;
      await mediaTrack.applyConstraints(constraints);
      const applied = readFacing(mediaTrack);
      if (!applied || applied === wantedFacing) {
        notifyRestarted();
        return { track, facingMode: applied || wantedFacing };
      }
    } catch (err) {
      console.warn('[LiveKit] applyConstraints camera switch failed:', err);
    }
  }

  if (mediaTrack && typeof mediaTrack._switchCamera === 'function') {
    try {
      await mediaTrack._switchCamera();
      notifyRestarted();
      return { track, facingMode: readFacing(mediaTrack) || wantedFacing };
    } catch (err) {
      console.warn('[LiveKit] _switchCamera failed:', err);
    }
  }

  // 2. Restart the LiveKit track with an explicit device / facingMode
  let targetDeviceId = null;
  if (global.navigator?.mediaDevices?.enumerateDevices) {
    try {
      const devices = await global.navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      const match = videoDevices.find((d) => {
        const facing = String(d.facing || d.facingMode || '').toLowerCase();
        const label = String(d.label || '').toLowerCase();
        return wantedFront
          ? facing === 'front' || facing === 'user' || label.includes('front')
          : facing === 'environment' || facing === 'back' || facing === 'rear' || label.includes('back');
      });
      if (match?.deviceId) targetDeviceId = match.deviceId;
    } catch (e) {
      console.warn('[LiveKit] enumerateDevices failed in switchCamera:', e);
    }
  }

  if (typeof track.restartTrack === 'function') {
    const options = targetDeviceId
      ? { deviceId: targetDeviceId, facingMode: wantedFacing }
      : { facingMode: wantedFacing };
    await track.restartTrack(options);
    return { track, facingMode: readFacing(track.mediaStreamTrack) || wantedFacing };
  }

  throw new Error('ไม่สามารถสลับกล้องได้');
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
  const syncTimeouts = roomSyncTimeouts.get(room);
  if (syncTimeouts) {
    syncTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    roomSyncTimeouts.delete(room);
  }
  try {
    await room.disconnect();
  } catch (err) {
    console.warn('[LiveKit] Error disconnecting room:', err);
  }
}
