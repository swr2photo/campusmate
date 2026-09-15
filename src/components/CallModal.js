import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import FeatureIcon from './FeatureIcon';
import { useRemoteImage } from '../utils/useRemoteImage';
import {
  addPipListener,
  enterPip,
  isPipSupported,
  setPipCallState,
} from '../services/pipService';
import {
  CALL_STATUS,
  CALL_TYPES,
  formatCallDuration,
} from '../services/callSignalingService';
import {
  playCallEndTone,
  startIncomingRingtone,
  startOutgoingRingback,
  stopAllCallSounds,
} from '../utils/callSounds';
import {
  getUserMedia,
  setAudioEnabled,
  setVideoEnabled,
  stopMediaStream,
  switchCamera,
} from '../services/webrtcService';
import {
  connectToLiveKitRoom,
  disconnectLiveKitRoom,
  fetchLiveKitToken,
  setLiveKitCamera,
  setLiveKitMicrophone,
  setLiveKitSpeaker,
  switchLiveKitCamera,
} from '../services/livekitService';

let LiveKitVideoView = null;
try {
  const LK = require('@livekit/react-native');
  LiveKitVideoView = LK.VideoView;
} catch (_) {}

let RTCView = null;
let LKMediaStream = null;
try {
  const LKWebRTC = require('@livekit/react-native-webrtc');
  RTCView = LKWebRTC.RTCView;
  LKMediaStream = LKWebRTC.MediaStream;
} catch (_) {}

function AppVideoView({
  videoTrack,
  style,
  objectFit = 'cover',
  mirror = false,
  zOrder = 0,
}) {
  const getStreamUrl = useCallback((track) => {
    if (!track) return '';
    try {
      if (track?.mediaStream && typeof track.mediaStream.toURL === 'function') {
        return track.mediaStream.toURL();
      }
      if (track?.mediaStreamTrack && LKMediaStream) {
        const ms = new LKMediaStream([track.mediaStreamTrack]);
        return ms.toURL();
      }
      return '';
    } catch (_) {
      return '';
    }
  }, []);

  const [streamUrl, setStreamUrl] = useState(() => getStreamUrl(videoTrack));

  useEffect(() => {
    let timer = null;

    const checkStream = () => {
      const url = getStreamUrl(videoTrack);
      setStreamUrl(url);
    };

    checkStream();

    if (!getStreamUrl(videoTrack)) {
      let attempts = 0;
      timer = setInterval(() => {
        attempts++;
        const url = getStreamUrl(videoTrack);
        if (url) {
          setStreamUrl(url);
          clearInterval(timer);
        } else if (attempts > 30) {
          clearInterval(timer);
        }
      }, 100);
    }

    const onUpdate = () => checkStream();
    if (videoTrack?.on) {
      try {
        videoTrack.on('unmuted', onUpdate);
        videoTrack.on('muted', onUpdate);
        videoTrack.on('restarted', onUpdate);
      } catch (_) {}
    }

    return () => {
      if (timer) clearInterval(timer);
      if (videoTrack?.off) {
        try {
          videoTrack.off('unmuted', onUpdate);
          videoTrack.off('muted', onUpdate);
          videoTrack.off('restarted', onUpdate);
        } catch (_) {}
      }
    };
  }, [videoTrack, getStreamUrl]);

  if (RTCView && streamUrl) {
    return (
      <RTCView
        key={`${streamUrl}-${zOrder}`}
        mirror={mirror}
        objectFit={objectFit}
        streamURL={streamUrl}
        style={style}
        zOrder={zOrder}
      />
    );
  }

  return null;
}

export default function CallModal({
  isOpen,
  callData,
  currentUserId,
  onAccept,
  onReject,
  onEnd,
  onClose,
  conversations = [],
  availableProfiles = [],
}) {
  const isCaller = callData?.callerId === currentUserId;
  const isIncoming = !isCaller;
  const status = callData?.status || CALL_STATUS.CALLING;
  const callType = callData?.callType || CALL_TYPES.VOICE;

  const otherUserId = isCaller ? callData?.receiverId : callData?.callerId;
  const rawOtherParty = isCaller ? callData?.receiverProfile : callData?.callerProfile;

  // Fallback lookup if profile info is missing from callData
  const fallbackFromConvo = useMemo(() => {
    if (!otherUserId) return null;
    const convo = (conversations || []).find(
      (c) =>
        c.profileId === otherUserId ||
        (c.participants && c.participants.includes(otherUserId)) ||
        (callData?.conversationId && c.id === callData.conversationId)
    );
    return convo || null;
  }, [conversations, otherUserId, callData?.conversationId]);

  const fallbackFromProfiles = useMemo(() => {
    if (!otherUserId) return null;
    return (availableProfiles || []).find((p) => p.id === otherUserId) || null;
  }, [availableProfiles, otherUserId]);

  const otherName =
    rawOtherParty?.name ||
    rawOtherParty?.nickname ||
    fallbackFromProfiles?.name ||
    fallbackFromProfiles?.nickname ||
    fallbackFromConvo?.name ||
    (isCaller ? 'ผู้รับสาย' : 'ผู้โทรเข้า');

  const rawAvatarUri =
    rawOtherParty?.avatarUri ||
    rawOtherParty?.photoURL ||
    rawOtherParty?.photoUrl ||
    rawOtherParty?.photos?.[0] ||
    (typeof rawOtherParty?.avatar === 'string' &&
    (rawOtherParty.avatar.startsWith('http') || rawOtherParty.avatar.startsWith('file:') || rawOtherParty.avatar.startsWith('data:'))
      ? rawOtherParty.avatar
      : null) ||
    fallbackFromProfiles?.avatarUri ||
    fallbackFromProfiles?.photoURL ||
    fallbackFromProfiles?.photoUrl ||
    fallbackFromProfiles?.photos?.[0] ||
    (typeof fallbackFromProfiles?.avatar === 'string' &&
    (fallbackFromProfiles.avatar.startsWith('http') || fallbackFromProfiles.avatar.startsWith('file:') || fallbackFromProfiles.avatar.startsWith('data:'))
      ? fallbackFromProfiles.avatar
      : null) ||
    fallbackFromConvo?.avatarUri ||
    fallbackFromConvo?.photoURL ||
    (typeof fallbackFromConvo?.avatar === 'string' &&
    (fallbackFromConvo.avatar.startsWith('http') || fallbackFromConvo.avatar.startsWith('file:') || fallbackFromConvo.avatar.startsWith('data:'))
      ? fallbackFromConvo.avatar
      : null) ||
    null;

  const otherAvatarColor =
    rawOtherParty?.avatarColor ||
    fallbackFromProfiles?.avatarColor ||
    fallbackFromConvo?.avatarColor ||
    '#3B5AFE';

  const otherAvatarEmoji =
    rawOtherParty?.avatar ||
    fallbackFromProfiles?.avatar ||
    fallbackFromConvo?.avatar ||
    '👤';

  const [imageLoadError, setImageLoadError] = useState(false);
  useEffect(() => {
    setImageLoadError(false);
  }, [callData?.id, rawAvatarUri]);

  const cachedAvatarUri = useRemoteImage(
    rawAvatarUri,
    rawOtherParty?.updatedAt || fallbackFromProfiles?.updatedAt,
    otherUserId
  );
  const otherAvatarUri = cachedAvatarUri || rawAvatarUri;

  // In-call states
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(callType === CALL_TYPES.VIDEO);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isInPip, setIsInPip] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaBusyRef = useRef(false);
  const [facingMode, setFacingMode] = useState('user');
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState(null);
  const [isRemoteVideoMuted, setIsRemoteVideoMuted] = useState(false);

  const hasRemoteVideo = Boolean(
    remoteVideoTrack &&
    !isRemoteVideoMuted &&
    !remoteVideoTrack?.isMuted
  );

  // Sync call state with Android native Picture-in-Picture manager
  useEffect(() => {
    const inCall = Boolean(isOpen && status === CALL_STATUS.CONNECTED);
    setPipCallState(inCall, callType === CALL_TYPES.VIDEO);
    return () => {
      setPipCallState(false, false);
    };
  }, [isOpen, status, callType]);

  // Listen to Android system Picture-in-Picture mode changes
  useEffect(() => {
    const unsub = addPipListener((pipState) => {
      setIsInPip(Boolean(pipState));
    });
    return unsub;
  }, []);

  const localStreamRef = useRef(null);
  const liveKitRoomRef = useRef(null);

  // Pulse ring animation for calling / ringing state
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const pulseOpacity1 = useRef(new Animated.Value(0.7)).current;
  const pulseOpacity2 = useRef(new Animated.Value(0.5)).current;

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const FLOATING_VIDEO_WIDTH = 130;
  const FLOATING_VIDEO_HEIGHT = 185;
  const isVideoCall = callType === CALL_TYPES.VIDEO;

  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 54;
  const bottomMargin = 32;

  // Safe bounds:
  // Video box: clamped horizontally between 12 and (windowWidth - 130 - 12)
  //            clamped vertically between topInset and (windowHeight - 185 - bottomMargin)
  // Voice pill: spans width with 16px margins, x stays 0, y clamped between topInset and (windowHeight - 80 - bottomMargin)
  const videoBounds = useMemo(() => ({
    minX: 12,
    maxX: Math.max(12, windowWidth - FLOATING_VIDEO_WIDTH - 12),
    minY: topInset,
    maxY: Math.max(topInset, windowHeight - FLOATING_VIDEO_HEIGHT - bottomMargin),
  }), [windowWidth, windowHeight, topInset]);

  const voiceBounds = useMemo(() => ({
    minX: 0,
    maxX: 0,
    minY: topInset,
    maxY: Math.max(topInset, windowHeight - 80 - bottomMargin),
  }), [windowHeight, topInset]);

  const activeBounds = isVideoCall ? videoBounds : voiceBounds;

  const initialPillPos = useMemo(() => {
    return isVideoCall
      ? { x: Math.max(12, windowWidth - FLOATING_VIDEO_WIDTH - 12), y: topInset + 48 }
      : { x: 0, y: topInset + 48 };
  }, [isVideoCall, windowWidth, topInset]);

  const pillPan = useRef(new Animated.ValueXY(initialPillPos)).current;
  const pillPosition = useRef(initialPillPos);
  const dragOrigin = useRef(initialPillPos);
  const boundsRef = useRef(activeBounds);
  boundsRef.current = activeBounds;

  const movePill = useCallback((point) => {
    const b = boundsRef.current;
    const next = {
      x: Math.max(b.minX, Math.min(b.maxX, point.x)),
      y: Math.max(b.minY, Math.min(b.maxY, point.y)),
    };
    pillPosition.current = next;
    pillPan.setValue(next);
  }, [pillPan]);

  const pillPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        dragOrigin.current = { ...pillPosition.current };
      },
      onPanResponderMove: (_, g) => {
        movePill({ x: dragOrigin.current.x + g.dx, y: dragOrigin.current.y + g.dy });
      },
      onPanResponderRelease: () => movePill(pillPosition.current),
      onPanResponderTerminate: () => movePill(pillPosition.current),
    })
  ).current;

  // Reposition within safe bounds when screen dimensions change or call mode changes
  useEffect(() => {
    movePill(pillPosition.current);
  }, [windowWidth, windowHeight, isVideoCall, movePill]);

  useEffect(() => {
    setIsMinimized(false);
    setIsMuted(false);
    setIsVideoOff(false);
    setFacingMode('user');
    setIsSpeaker(callType === CALL_TYPES.VIDEO);
    setDuration(0);
    const resetPos = isVideoCall
      ? { x: Math.max(12, windowWidth - FLOATING_VIDEO_WIDTH - 12), y: topInset + 48 }
      : { x: 0, y: topInset + 48 };
    pillPosition.current = resetPos;
    pillPan.setValue(resetPos);
  }, [callData?.id, isVideoCall, windowWidth, topInset, pillPan]);

  useEffect(() => {
    if (status === CALL_STATUS.CALLING || status === CALL_STATUS.RINGING) {
      const createPulseLoop = (scaleAnim, opacityAnim, delay = 0) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scaleAnim, {
                toValue: 1.85,
                duration: 2000,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(opacityAnim, {
                toValue: 0,
                duration: 2000,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 0,
                useNativeDriver: true,
              }),
              Animated.timing(opacityAnim, {
                toValue: 0.7,
                duration: 0,
                useNativeDriver: true,
              }),
            ]),
          ])
        );
      };

      const loop1 = createPulseLoop(pulseAnim1, pulseOpacity1, 0);
      const loop2 = createPulseLoop(pulseAnim2, pulseOpacity2, 900);
      loop1.start();
      loop2.start();

      return () => {
        loop1.stop();
        loop2.stop();
      };
    }
  }, [status, pulseAnim1, pulseAnim2, pulseOpacity1, pulseOpacity2]);

  // Audio / Ringtone feedback management
  useEffect(() => {
    if (!isOpen) {
      stopAllCallSounds();
      return;
    }

    if (status === CALL_STATUS.CALLING) {
      if (isIncoming) {
        startIncomingRingtone();
        setStatusMessage('สายเรียกเข้า...');
      } else {
        startOutgoingRingback();
        setStatusMessage('กำลังโทรหา...');
      }
    } else if (status === CALL_STATUS.RINGING) {
      if (isIncoming) {
        startIncomingRingtone();
        setStatusMessage('สายเรียกเข้า...');
      } else {
        startOutgoingRingback();
        setStatusMessage('กำลังส่งสัญญาณ...');
      }
    } else if (status === CALL_STATUS.CONNECTED) {
      stopAllCallSounds();
      setStatusMessage('เชื่อมต่อแล้ว');
    } else if (
      status === CALL_STATUS.ENDED ||
      status === CALL_STATUS.REJECTED ||
      status === CALL_STATUS.BUSY ||
      status === CALL_STATUS.MISSED
    ) {
      playCallEndTone();
      if (status === CALL_STATUS.REJECTED) setStatusMessage('ปฏิเสธสายแล้ว');
      else if (status === CALL_STATUS.BUSY) setStatusMessage('สายไม่ว่าง');
      else if (status === CALL_STATUS.MISSED) setStatusMessage('ไม่ได้รับสาย');
      else setStatusMessage('วางสายแล้ว');

      const timer = setTimeout(() => {
        onClose?.();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isOpen, status, isIncoming, onClose]);

  // Call duration counter when connected
  useEffect(() => {
    if (status === CALL_STATUS.CONNECTED) {
      setDuration(0);
      const timer = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [status]);

  // Connect to LiveKit Room when call is connected
  useEffect(() => {
    let active = true;

    if (isOpen && status === CALL_STATUS.CONNECTED && callData?.id) {
      (async () => {
        try {
          const isVideo = callType === CALL_TYPES.VIDEO;
          const { token, url } = await fetchLiveKitToken({
            callId: callData.id,
            participantName: currentUserId,
          });

          if (!active) return;

          const room = await connectToLiveKitRoom({
            url: url || process.env.EXPO_PUBLIC_LIVEKIT_URL || 'wss://campusmate-jmt5sy3c.livekit.cloud',
            token,
            isVideo,
            onRemoteTrackUpdate: ({ track, kind, unsubscribed, isMuted: muted }) => {
              if (active && kind === 'video') {
                if (unsubscribed) {
                  setRemoteVideoTrack(null);
                  setIsRemoteVideoMuted(false);
                } else {
                  if (track) setRemoteVideoTrack(track);
                  if (typeof muted === 'boolean') {
                    setIsRemoteVideoMuted(muted);
                  }
                }
              }
            },
            onLocalTrackUpdate: ({ track, kind, unsubscribed }) => {
              if (kind === 'video') {
                setLocalVideoTrack(unsubscribed ? null : track);
              }
            },
            onDisconnect: () => {
              if (!active) return;
              setRemoteVideoTrack(null);
              setIsRemoteVideoMuted(false);
              setLocalVideoTrack(null);
            },
          });

          if (active) {
            liveKitRoomRef.current = room;
            setIsVideoOff(!room?.localParticipant?.isCameraEnabled);
            setIsMuted(!room?.localParticipant?.isMicrophoneEnabled);
            setStatusMessage('เชื่อมต่อแล้ว');
          } else if (room) {
            disconnectLiveKitRoom(room);
          }
        } catch (err) {
          console.warn('[CallModal] Call connection failed:', err);
          if (active) setStatusMessage('เชื่อมต่อไม่สำเร็จ กรุณาวางสายแล้วโทรใหม่');
        }
      })();
    }

    return () => {
      active = false;
      if (liveKitRoomRef.current) {
        disconnectLiveKitRoom(liveKitRoomRef.current);
        liveKitRoomRef.current = null;
      }
      setRemoteVideoTrack(null);
      setIsRemoteVideoMuted(false);
      setLocalVideoTrack(null);
      if (localStreamRef.current) {
        stopMediaStream(localStreamRef.current);
        localStreamRef.current = null;
      }
    };
  }, [isOpen, status, callData?.id, callType, currentUserId]);

  const updateMedia = async (action) => {
    if (mediaBusyRef.current || !liveKitRoomRef.current) return;
    mediaBusyRef.current = true;
    setMediaBusy(true);
    const room = liveKitRoomRef.current;
    try {
      await action(room);
    } catch (error) {
      if (liveKitRoomRef.current === room) setStatusMessage('เปลี่ยนไมค์หรือกล้องไม่สำเร็จ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง');
    } finally {
      mediaBusyRef.current = false;
      setMediaBusy(false);
    }
  };
  const handleToggleMute = () => updateMedia(async (room) => {
    await setLiveKitMicrophone(room, isMuted);
    if (liveKitRoomRef.current === room) setIsMuted(!isMuted);
  });
  const handleToggleVideo = () => updateMedia(async (room) => {
    const track = await setLiveKitCamera(room, isVideoOff);
    if (liveKitRoomRef.current === room) {
      setIsVideoOff(!isVideoOff);
      if (isVideoOff && track) {
        setLocalVideoTrack(track);
      }
    }
  });
  const handleToggleSpeaker = async () => {
    try { await setLiveKitSpeaker(!isSpeaker); setIsSpeaker(!isSpeaker); }
    catch (_) { setStatusMessage('เปลี่ยนลำโพงไม่สำเร็จ'); }
  };
  const handleSwitchCamera = () => updateMedia(async (room) => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    const track = await switchLiveKitCamera(room, next);
    if (liveKitRoomRef.current === room) {
      setFacingMode(next);
      setIsVideoOff(false);
      try {
        const LK = require('livekit-client');
        const pub = room?.localParticipant?.getTrackPublication(LK?.Track?.Source?.Camera);
        const activeTrack = track || pub?.track;
        if (activeTrack) setLocalVideoTrack(activeTrack);
      } catch (_) {
        if (track) setLocalVideoTrack(track);
      }
    }
  });

  // End call
  const handleEndCall = () => {
    stopAllCallSounds();
    if (liveKitRoomRef.current) {
      disconnectLiveKitRoom(liveKitRoomRef.current);
      liveKitRoomRef.current = null;
    }
    onEnd?.(duration);
  };

  if (!isOpen) return null;

  // Android System Picture-in-Picture View (Outside the app)
  if (isInPip && status === CALL_STATUS.CONNECTED) {
    const isVideoMode = callType === CALL_TYPES.VIDEO && (RTCView || LiveKitVideoView);
    return (
      <View style={styles.systemPipContainer}>
        {isVideoMode ? (
          <View style={StyleSheet.absoluteFillObject}>
            {hasRemoteVideo ? (
              <AppVideoView
                objectFit="cover"
                style={StyleSheet.absoluteFillObject}
                videoTrack={remoteVideoTrack}
                zOrder={0}
              />
            ) : localVideoTrack && !isVideoOff ? (
              <AppVideoView
                mirror={facingMode === 'user'}
                objectFit="cover"
                style={StyleSheet.absoluteFillObject}
                videoTrack={localVideoTrack}
                zOrder={0}
              />
            ) : (
              <View style={styles.systemPipVoiceContent}>
                {otherAvatarUri && !imageLoadError ? (
                  <ExpoImage
                    contentFit="cover"
                    onError={() => setImageLoadError(true)}
                    source={{ uri: otherAvatarUri }}
                    style={styles.systemPipAvatarImg}
                  />
                ) : (
                  <View style={[styles.systemPipAvatarFallback, { backgroundColor: otherAvatarColor }]}>
                    <Text style={styles.systemPipAvatarEmoji}>{otherAvatarEmoji}</Text>
                  </View>
                )}
              </View>
            )}
            <View style={styles.systemPipOverlay}>
              <Text numberOfLines={1} style={styles.systemPipNameText}>{otherName}</Text>
              <Text style={styles.systemPipTimerText}>{formatCallDuration(duration)}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.systemPipVoiceContent}>
            {otherAvatarUri && !imageLoadError ? (
              <ExpoImage
                contentFit="cover"
                onError={() => setImageLoadError(true)}
                source={{ uri: otherAvatarUri }}
                style={styles.systemPipAvatarImg}
              />
            ) : (
              <View style={[styles.systemPipAvatarFallback, { backgroundColor: otherAvatarColor }]}>
                <Text style={styles.systemPipAvatarEmoji}>{otherAvatarEmoji}</Text>
              </View>
            )}
            <Text numberOfLines={1} style={styles.systemPipNameText}>{otherName}</Text>
            <Text style={styles.systemPipTimerText}>{formatCallDuration(duration)}</Text>
          </View>
        )}
      </View>
    );
  }

  // Minimized Floating View (Draggable, shows other party's live video or voice pill)
  if (isMinimized && status === CALL_STATUS.CONNECTED) {
    const isVideoMode = callType === CALL_TYPES.VIDEO && (RTCView || LiveKitVideoView);

    return (
      <Animated.View
        style={[
          isVideoMode ? styles.floatingVideoPipContainer : styles.floatingPillContainer,
          {
            transform: [
              { translateX: pillPan.x },
              { translateY: pillPan.y },
            ],
          },
        ]}
        {...pillPanResponder.panHandlers}
      >
        {isVideoMode ? (
          <Pressable
            onPress={() => setIsMinimized(false)}
            style={styles.floatingVideoPip}
          >
            {/* Live Video Stream */}
            {hasRemoteVideo ? (
              <AppVideoView
                objectFit="cover"
                style={StyleSheet.absoluteFillObject}
                videoTrack={remoteVideoTrack}
                zOrder={1}
              />
            ) : localVideoTrack && !isVideoOff ? (
              <AppVideoView
                mirror={facingMode === 'user'}
                objectFit="cover"
                style={StyleSheet.absoluteFillObject}
                videoTrack={localVideoTrack}
                zOrder={1}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, styles.floatingVideoFallback]}>
                {otherAvatarUri && !imageLoadError ? (
                  <ExpoImage
                    contentFit="cover"
                    onError={() => setImageLoadError(true)}
                    source={{ uri: otherAvatarUri }}
                    style={styles.floatingVideoFallbackAvatar}
                  />
                ) : (
                  <View style={[styles.floatingVideoFallbackAvatar, { backgroundColor: otherAvatarColor }]}>
                    <Text style={{ fontSize: 26 }}>{otherAvatarEmoji}</Text>
                  </View>
                )}
                <Text numberOfLines={1} style={styles.floatingVideoFallbackText}>
                  {isVideoOff ? 'ปิดกล้องอยู่' : (isRemoteVideoMuted ? 'อีกฝ่ายปิดกล้อง' : 'รอภาพคู่สนทนา...')}
                </Text>
              </View>
            )}

            {/* If remote track is active and our camera is on, show local camera preview thumbnail */}
            {hasRemoteVideo && localVideoTrack && !isVideoOff && (
              <View style={styles.floatingLocalMiniPip}>
                <AppVideoView
                  mirror={facingMode === 'user'}
                  objectFit="cover"
                  style={StyleSheet.absoluteFillObject}
                  videoTrack={localVideoTrack}
                  zOrder={2}
                />
              </View>
            )}

            {/* Top Bar with Name Badge and Action Buttons */}
            <View style={styles.floatingVideoTopBar}>
              <View style={styles.floatingVideoNameBadge}>
                <View style={styles.floatingLiveDotSmall} />
                <Text numberOfLines={1} style={styles.floatingVideoNameText}>{otherName}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                {isPipSupported && (
                  <Pressable
                    accessibilityLabel="ย่อออกนอกแอป"
                    onPress={enterPip}
                    style={styles.floatingVideoPipBtn}
                    hitSlop={8}
                  >
                    <FeatureIcon color="#FFFFFF" name="arrow.up.right.square" size={13} />
                  </Pressable>
                )}
                <Pressable
                  accessibilityLabel="วางสาย"
                  onPress={handleEndCall}
                  style={styles.floatingVideoEndBtn}
                  hitSlop={8}
                >
                  <FeatureIcon color="#FFFFFF" name="phone.down.fill" size={12} />
                </Pressable>
              </View>
            </View>

            {/* Bottom Bar with Timer and Action Buttons */}
            <View style={styles.floatingVideoBottomBar}>
              <Text style={styles.floatingVideoTimerText}>{formatCallDuration(duration)}</Text>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                <Pressable
                  accessibilityLabel="สลับกล้อง"
                  disabled={mediaBusy}
                  onPress={handleSwitchCamera}
                  style={styles.floatingVideoMiniBtn}
                  hitSlop={8}
                >
                  <FeatureIcon color="#FFFFFF" name="camera.rotate.fill" size={12} />
                </Pressable>
                <Pressable
                  accessibilityLabel={isMuted ? 'เปิดไมค์' : 'ปิดไมค์'}
                  disabled={mediaBusy}
                  onPress={handleToggleMute}
                  style={[styles.floatingVideoMiniBtn, isMuted && styles.floatingVideoMiniBtnActive]}
                  hitSlop={8}
                >
                  <FeatureIcon
                    color="#FFFFFF"
                    name={isMuted ? 'mic.slash.fill' : 'mic.fill'}
                    size={12}
                  />
                </Pressable>
              </View>
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setIsMinimized(false)}
            style={styles.floatingPill}
          >
            <View style={styles.floatingPillAvatar}>
              {otherAvatarUri && !imageLoadError ? (
                <ExpoImage
                  contentFit="cover"
                  onError={() => setImageLoadError(true)}
                  source={{ uri: otherAvatarUri }}
                  style={styles.floatingAvatarImg}
                />
              ) : (
                <View style={[styles.floatingAvatarFallback, { backgroundColor: otherAvatarColor }]}>
                  <Text style={styles.floatingAvatarEmoji}>{otherAvatarEmoji}</Text>
                </View>
              )}
              <View style={styles.floatingLiveDot} />
            </View>
            <View style={styles.floatingPillInfo}>
              <Text numberOfLines={1} style={styles.floatingPillName}>{otherName}</Text>
              <Text style={styles.floatingPillTimer}>{formatCallDuration(duration)}</Text>
            </View>
            {isPipSupported && (
              <Pressable
                accessibilityLabel="ย่อออกนอกแอป"
                onPress={enterPip}
                style={styles.floatingMiniBtn}
              >
                <FeatureIcon color="#FFFFFF" name="arrow.up.right.square" size={15} />
              </Pressable>
            )}
            <Pressable
              onPress={handleToggleMute}
              style={[styles.floatingMiniBtn, isMuted && styles.floatingMiniBtnActive]}
            >
              <FeatureIcon
                color="#FFFFFF"
                name={isMuted ? 'mic.slash.fill' : 'mic.fill'}
                size={15}
              />
            </Pressable>
            <Pressable
              onPress={handleEndCall}
              style={styles.floatingEndBtn}
            >
              <FeatureIcon color="#FFFFFF" name="phone.down.fill" size={15} />
            </Pressable>
          </Pressable>
        )}
      </Animated.View>
    );
  }

  return (
    <Modal
      animationType="slide"
      statusBarTranslucent
      transparent={true}
      visible={isOpen}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0B0E14" />
      <View
        style={[
          styles.callContainer,
          (callType === CALL_TYPES.VIDEO && status === CALL_STATUS.CONNECTED && hasRemoteVideo) && {
            backgroundColor: 'transparent',
          },
        ]}
      >
        {/* Remote Video Stream (Full Screen Background) */}
        {callType === CALL_TYPES.VIDEO && status === CALL_STATUS.CONNECTED && hasRemoteVideo ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            <AppVideoView
              objectFit="cover"
              style={StyleSheet.absoluteFillObject}
              videoTrack={remoteVideoTrack}
              zOrder={0}
            />
          </View>
        ) : null}

        {/* Ambient Blurred Background for Voice Calls */}
        {callType === CALL_TYPES.VOICE && otherAvatarUri && !imageLoadError ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            <ExpoImage
              blurRadius={50}
              contentFit="cover"
              source={{ uri: otherAvatarUri }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.voiceDimOverlay} />
          </View>
        ) : null}

        {/* Local Video Stream (Picture-in-Picture Floating Preview) */}
        {callType === CALL_TYPES.VIDEO && status === CALL_STATUS.CONNECTED && !isVideoOff && localVideoTrack ? (
          <View style={[styles.localVideoPipContainer, { backgroundColor: 'transparent' }]}>
            <AppVideoView
              mirror={facingMode === 'user'}
              objectFit="cover"
              style={styles.localVideoPip}
              videoTrack={localVideoTrack}
              zOrder={1}
            />
          </View>
        ) : null}

        <SafeAreaView style={styles.safeArea}>
          {/* Header Row */}
          <View style={styles.headerRow}>
            {status === CALL_STATUS.CONNECTED ? (
              <Pressable
                accessibilityLabel="ย่อหน้าจอโทร"
                onPress={() => setIsMinimized(true)}
                style={styles.headerIconButton}
              >
                <FeatureIcon color="#FFFFFF" name="chevron.down" size={24} />
              </Pressable>
            ) : (
              <View style={{ width: 44 }} />
            )}

            <View style={styles.headerTitleContainer}>
              <View style={styles.e2eeBadge}>
                <FeatureIcon color="#34D399" name="lock.shield.fill" size={11} />
                <Text style={styles.e2eeText}>เข้ารหัสต้นทางถึงปลายทาง</Text>
              </View>
              <Text style={styles.callTypeTitle}>
                {callType === CALL_TYPES.VIDEO ? 'วิดีโอคอล CampusMate' : 'โทรด้วยเสียง CampusMate'}
              </Text>
            </View>

            {status === CALL_STATUS.CONNECTED && isPipSupported ? (
              <Pressable
                accessibilityLabel="ย่อออกนอกแอป"
                onPress={enterPip}
                style={styles.headerIconButton}
              >
                <FeatureIcon color="#FFFFFF" name="arrow.up.right.square" size={20} />
              </Pressable>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>

          {/* Center Content: Avatar & Status */}
          <View style={styles.centerContent}>
            {/* Show avatar only when audio call or when remote video track is not yet available */}
            {(!hasRemoteVideo || callType !== CALL_TYPES.VIDEO) && (
              <View style={styles.avatarWrapper}>
                {(status === CALL_STATUS.CALLING || status === CALL_STATUS.RINGING) && (
                  <>
                    <Animated.View
                      style={[
                        styles.pulseCircle,
                        {
                          transform: [{ scale: pulseAnim1 }],
                          opacity: pulseOpacity1,
                          backgroundColor: callType === CALL_TYPES.VIDEO ? '#3B5AFE' : '#10B981',
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.pulseCircle,
                        {
                          transform: [{ scale: pulseAnim2 }],
                          opacity: pulseOpacity2,
                          backgroundColor: callType === CALL_TYPES.VIDEO ? '#3B5AFE' : '#10B981',
                        },
                      ]}
                    />
                  </>
                )}

                {otherAvatarUri && !imageLoadError ? (
                  <ExpoImage
                    contentFit="cover"
                    onError={() => setImageLoadError(true)}
                    source={{ uri: otherAvatarUri }}
                    style={styles.largeAvatarImg}
                    transition={200}
                  />
                ) : (
                  <View style={[styles.largeAvatarFallback, { backgroundColor: otherAvatarColor }]}>
                    <Text style={styles.largeAvatarEmoji}>{otherAvatarEmoji}</Text>
                  </View>
                )}

                {status === CALL_STATUS.CONNECTED && (
                  <View style={styles.connectedBadge}>
                    <FeatureIcon
                      color="#FFFFFF"
                      name={callType === CALL_TYPES.VIDEO ? 'video.fill' : 'phone.fill'}
                      size={13}
                    />
                  </View>
                )}
              </View>
            )}

            <Text style={styles.partnerName}>{otherName}</Text>

            <View style={styles.statusPill}>
              {status === CALL_STATUS.CONNECTED ? (
                <View style={styles.timerRow}>
                  <View style={styles.greenPulseDot} />
                  <Text style={styles.callTimerText}>{formatCallDuration(duration)}</Text>
                  {callType === CALL_TYPES.VIDEO && !hasRemoteVideo && (
                    <Text style={[styles.statusSubtitle, { marginLeft: 8, fontSize: 13 }]}>
                      ({isRemoteVideoMuted ? 'อีกฝ่ายปิดกล้อง' : 'รอภาพคู่สนทนา...'})
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={styles.statusSubtitle}>
                  {statusMessage || (callType === CALL_TYPES.VIDEO && status === CALL_STATUS.CONNECTED ? 'รอคู่สนทนาเปิดกล้อง...' : '')}
                </Text>
              )}
            </View>
          </View>

          {/* Bottom Controls */}
          <View style={styles.bottomControls}>
            {/* INCOMING CALL VIEW */}
            {isIncoming && (status === CALL_STATUS.CALLING || status === CALL_STATUS.RINGING) ? (
              <View style={styles.incomingActionRow}>
                <View style={styles.actionBtnGroup}>
                  <Pressable
                    accessibilityLabel="ปฏิเสธสาย"
                    onPress={() => onReject?.('declined')}
                    style={[styles.circleBtn, styles.declineBtn]}
                  >
                    <FeatureIcon color="#FFFFFF" name="phone.down.fill" size={32} />
                  </Pressable>
                  <Text style={styles.btnLabel}>ปฏิเสธ</Text>
                </View>

                <View style={styles.actionBtnGroup}>
                  <Pressable
                    accessibilityLabel="รับสาย"
                    onPress={() => onAccept?.()}
                    style={[styles.circleBtn, styles.acceptBtn]}
                  >
                    <FeatureIcon
                      color="#FFFFFF"
                      name={callType === CALL_TYPES.VIDEO ? 'video.fill' : 'phone.fill'}
                      size={32}
                    />
                  </Pressable>
                  <Text style={styles.btnLabel}>รับสาย</Text>
                </View>
              </View>
            ) : status === CALL_STATUS.CONNECTED ? (
              /* CONNECTED ACTIVE CALL CONTROLS */
              <View style={styles.connectedControlsContainer}>
                <View style={styles.controlsRow}>
                  {/* Mute Mic */}
                  <View style={styles.actionBtnGroup}>
                    <Pressable
                      accessibilityLabel={isMuted ? 'เปิดไมค์' : 'ปิดไมค์'}
                      onPress={handleToggleMute}
                      style={[styles.controlCircleBtn, isMuted && styles.controlCircleBtnActive]}
                    >
                      <FeatureIcon
                        color={isMuted ? '#EF4444' : '#FFFFFF'}
                        name={isMuted ? 'mic.slash.fill' : 'mic.fill'}
                        size={24}
                      />
                    </Pressable>
                    <Text style={styles.controlLabel}>{isMuted ? 'ปิดไมค์อยู่' : 'ไมค์'}</Text>
                  </View>

                  {/* Speaker Toggle */}
                  <View style={styles.actionBtnGroup}>
                    <Pressable
                      accessibilityLabel="สลับลำโพง"
                      onPress={handleToggleSpeaker}
                      style={[styles.controlCircleBtn, isSpeaker && styles.controlCircleBtnActive]}
                    >
                      <FeatureIcon
                        color={isSpeaker ? '#3B5AFE' : '#FFFFFF'}
                        name={isSpeaker ? 'speaker.wave.3.fill' : 'speaker.slash.fill'}
                        size={24}
                      />
                    </Pressable>
                    <Text style={styles.controlLabel}>ลำโพง</Text>
                  </View>

                  {/* Video Toggle (For Video Calls) */}
                  {callType === CALL_TYPES.VIDEO && (
                    <>
                      <View style={styles.actionBtnGroup}>
                        <Pressable
                          accessibilityLabel={isVideoOff ? 'เปิดกล้อง' : 'ปิดกล้อง'}
                          disabled={mediaBusy} onPress={handleToggleVideo}
                          style={[styles.controlCircleBtn, isVideoOff && styles.controlCircleBtnActive]}
                        >
                          <FeatureIcon
                            color={isVideoOff ? '#EF4444' : '#FFFFFF'}
                            name={isVideoOff ? 'video.slash.fill' : 'video.fill'}
                            size={24}
                          />
                        </Pressable>
                        <Text style={styles.controlLabel}>{isVideoOff ? 'ปิดกล้อง' : 'กล้อง'}</Text>
                      </View>

                      {/* Flip Camera */}
                      <View style={styles.actionBtnGroup}>
                        <Pressable
                          accessibilityLabel="สลับกล้องหน้าหลัง"
                          disabled={mediaBusy} onPress={handleSwitchCamera}
                          style={styles.controlCircleBtn}
                        >
                          <FeatureIcon color="#FFFFFF" name="camera.rotate.fill" size={24} />
                        </Pressable>
                        <Text style={styles.controlLabel}>สลับกล้อง</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Big Red End Call Button */}
                <View style={styles.endCallRow}>
                  <Pressable
                    accessibilityLabel="วางสาย"
                    onPress={handleEndCall}
                    style={[styles.circleBtn, styles.declineBtn, { width: 72, height: 72, borderRadius: 36 }]}
                  >
                    <FeatureIcon color="#FFFFFF" name="phone.down.fill" size={34} />
                  </Pressable>
                </View>
              </View>
            ) : (
              /* OUTGOING / CALLING CANCEL BUTTON */
              <View style={styles.singleActionRow}>
                <View style={styles.actionBtnGroup}>
                  <Pressable
                    accessibilityLabel="ยกเลิกการโทร"
                    onPress={handleEndCall}
                    style={[styles.circleBtn, styles.declineBtn]}
                  >
                    <FeatureIcon color="#FFFFFF" name="phone.down.fill" size={32} />
                  </Pressable>
                  <Text style={styles.btnLabel}>ยกเลิก</Text>
                </View>
              </View>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  callContainer: {
    backgroundColor: '#0B0E14',
    flex: 1,
  },
  videoDimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  voiceDimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 14, 20, 0.85)',
  },
  localVideoPipContainer: {
    backgroundColor: '#1E293B',
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 14,
    borderWidth: 2,
    elevation: 8,
    height: 145,
    overflow: 'hidden',
    position: 'absolute',
    right: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    top: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 60 : 64,
    width: 100,
    zIndex: 10,
  },
  localVideoPip: {
    height: '100%',
    width: '100%',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 10,
  },
  headerIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerTitleContainer: {
    alignItems: 'center',
    gap: 3,
  },
  e2eeBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  e2eeText: {
    color: '#34D399',
    fontSize: 10,
    flexShrink: 1,
    fontWeight: '700',
  },
  callTypeTitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  avatarWrapper: {
    alignItems: 'center',
    height: 156,
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative',
    width: 156,
  },
  pulseCircle: {
    borderRadius: 78,
    height: 156,
    position: 'absolute',
    width: 156,
  },
  largeAvatarImg: {
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 70,
    borderWidth: 3.5,
    height: 140,
    width: 140,
  },
  largeAvatarFallback: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 70,
    borderWidth: 3.5,
    height: 140,
    justifyContent: 'center',
    width: 140,
  },
  largeAvatarEmoji: {
    fontSize: 58,
  },
  connectedBadge: {
    alignItems: 'center',
    backgroundColor: '#10B981',
    borderColor: '#0B0E14',
    borderRadius: 14,
    borderWidth: 2,
    bottom: 4,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    width: 28,
  },
  partnerName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  statusPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  statusSubtitle: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  timerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  greenPulseDot: {
    backgroundColor: '#10B981',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  callTimerText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bottomControls: {
    paddingBottom: Platform.OS === 'ios' ? 24 : 32,
    paddingHorizontal: 24,
  },
  incomingActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  singleActionRow: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  actionBtnGroup: {
    alignItems: 'center',
    gap: 8,
  },
  circleBtn: {
    alignItems: 'center',
    borderRadius: 34,
    elevation: 4,
    height: 68,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    width: 68,
  },
  acceptBtn: {
    backgroundColor: '#10B981',
  },
  declineBtn: {
    backgroundColor: '#EF4444',
  },
  btnLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  connectedControlsContainer: {
    alignItems: 'center',
    gap: 24,
    width: '100%',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  controlCircleBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  controlCircleBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  controlLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '500',
  },
  endCallRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  // Floating Video PIP Styles
  floatingVideoPipContainer: {
    backgroundColor: '#0F172A',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 16,
    borderWidth: 2,
    elevation: 10,
    height: 185,
    overflow: 'hidden',
    position: 'absolute',
    left: 0,
    top: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    width: 130,
    zIndex: 99999,
  },
  floatingLocalMiniPip: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 8,
    borderWidth: 1.5,
    bottom: 30,
    elevation: 4,
    height: 52,
    overflow: 'hidden',
    position: 'absolute',
    right: 6,
    width: 38,
    zIndex: 5,
  },
  floatingVideoFallback: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    padding: 8,
  },
  floatingVideoFallbackAvatar: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 28,
    borderWidth: 1.5,
    height: 56,
    justifyContent: 'center',
    marginBottom: 6,
    width: 56,
  },
  floatingVideoFallbackText: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  floatingVideoPip: {
    backgroundColor: '#0F172A',
    flex: 1,
    height: '100%',
    position: 'relative',
    width: '100%',
  },
  floatingVideoTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  floatingVideoNameBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    flex: 1,
    minWidth: 0,
    marginRight: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  floatingLiveDotSmall: {
    backgroundColor: '#10B981',
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  floatingVideoNameText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  floatingVideoEndBtn: {
    alignItems: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  floatingVideoPipBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  floatingVideoBottomBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  floatingVideoTimerText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  floatingVideoMiniBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  floatingVideoMiniBtnActive: {
    backgroundColor: '#EF4444',
  },
  // Floating Pill Styles
  floatingPillContainer: {
    left: 16,
    position: 'absolute',
    right: 16,
    top: 0,
    zIndex: 99999,
  },
  floatingPill: {
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 32,
    borderWidth: 1,
    elevation: 8,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  floatingPillAvatar: {
    position: 'relative',
  },
  floatingAvatarImg: {
    borderRadius: 18,
    height: 36,
    width: 36,
  },
  floatingAvatarFallback: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  floatingAvatarEmoji: {
    fontSize: 16,
  },
  floatingLiveDot: {
    backgroundColor: '#10B981',
    borderColor: '#1E293B',
    borderRadius: 4,
    borderWidth: 1.5,
    bottom: 0,
    height: 9,
    position: 'absolute',
    right: 0,
    width: 9,
  },
  floatingPillInfo: {
    flex: 1,
  },
  floatingPillName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  floatingPillTimer: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  floatingMiniBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  floatingMiniBtnActive: {
    backgroundColor: '#EF4444',
  },
  floatingEndBtn: {
    alignItems: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  // Android System PiP Styles (Outside the app)
  systemPipContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: '#0B0E14',
    justifyContent: 'center',
    zIndex: 999999,
  },
  systemPipOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 8,
    bottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
    right: 6,
  },
  systemPipVoiceContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  systemPipAvatarImg: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 36,
    borderWidth: 2,
    height: 72,
    marginBottom: 6,
    width: 72,
  },
  systemPipAvatarFallback: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 36,
    borderWidth: 2,
    height: 72,
    justifyContent: 'center',
    marginBottom: 6,
    width: 72,
  },
  systemPipAvatarEmoji: {
    fontSize: 30,
  },
  systemPipNameText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  systemPipTimerText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '600',
  },
});
