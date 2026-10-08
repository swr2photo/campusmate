import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as ScreenCapture from 'expo-screen-capture';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { getDecryptedMediaUri, getSyncCachedMediaUri, purgeDecryptedVideo } from '../services/chatMediaService';
import { getOrFetchConversationKey } from '../services/chatEncryptionService';
import { getBestVideoUrl } from '../services/videoUpgradeService';
import { recordMediaView } from '../services/chatVideoService';
import { isProtectedViewMode, VIDEO_MODES } from '../utils/chatVideoPolicy';
import { usePeerMediaView } from '../hooks/usePeerMediaView';
import { useVideoPoster } from '../hooks/useVideoPoster';
import { useAppActions } from '../context/AppContext';
import { createReplySnapshot } from '../utils/messageReply';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAlert } from '../utils/appAlert';

// Serialise native capture acquisition/release, including rapid close/reopen.
let activeSession = null;

function VideoTimeline({ duration, progress = 0, startMs = 0, endMs = duration }) {
  const total = Math.max(1, Number(duration) || 1);
  const start = Math.max(0, Math.min(total, Number(startMs) || 0));
  const end = Math.max(start + 1, Math.min(total, Number(endMs) || total));
  const played = Math.max(start, Math.min(end, Number(progress) || start));
  const playedWidth = `${Math.max(0, Math.min(100, ((played - start) / Math.max(1, end - start)) * 100))}%`;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 10, right: 10, height: 4, zIndex: 4 }}>
      <View style={{ flex: 1, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.28)' }}>
        <View style={{ height: '100%', width: playedWidth, backgroundColor: '#fff' }} />
      </View>
    </View>
  );
}

// A passive cover never starts playback or claims a view-once receipt. Its
// preview frame is generated once per video and then served from cache, so a
// list of covers holds no native players.
export function ChatVideoCover({ item, conversationId, currentUserId, mine = false, consumed = false }) {
  const protectedMode = item.videoMode === 'once' || item.videoMode === 'replay';
  const poster = useVideoPoster(item.mediaUrl, conversationId, currentUserId, !consumed);
  const seconds = Math.max(1, Math.ceil((item.videoDuration || 0) / 1000));
  return (
    <View style={{ width: 230, height: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' }}>
      {poster ? (
        <Image
          source={poster}
          blurRadius={protectedMode ? 32 : 0}
          contentFit="cover"
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      ) : null}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#05070d99' }}>
        <Ionicons name={consumed ? 'checkmark-circle-outline' : 'play-circle-outline'} size={42} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', marginTop: 9 }}>
          {consumed ? 'เปิดดูแล้ว' : mine ? 'วิดีโอที่ส่ง' : 'วิดีโอ'}
        </Text>
        <Text style={{ color: '#fff', marginTop: 5 }}>{seconds} วินาที</Text>
        <Text style={{ color: '#e2e8f0', marginTop: 5 }}>{VIDEO_MODES[item.videoMode] || VIDEO_MODES.chat}</Text>
      </View>
    </View>
  );
}

function VideoPlayback({ uri, startMs = 0, endMs, closeOnEnd = false, onClose, onReady }) {
  const callbacks = useRef({ onClose, onReady });
  callbacks.current = { onClose, onReady };
  const endedRef = useRef(false);
  const holdingRef = useRef(false);
  const pinchingRef = useRef(false);
  const resumeAfterHoldRef = useRef(false);
  const suppressTapRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [gesturePaused, setGesturePaused] = useState(false);
  const [position, setPosition] = useState(Math.max(0, Number(startMs) || 0));
  const [duration, setDuration] = useState(0);
  const clipStart = Math.max(0, Number(startMs) || 0);
  const clipEnd = Number.isFinite(Number(endMs)) ? Number(endMs) : null;
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const pinchActive = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
    // Default is 0 which disables timeUpdate — progress bar never moves.
    instance.timeUpdateEventInterval = 0.1;
  });

  useEffect(() => {
    let active = true;
    let starting = false;
    const handleStatus = ({ status, error }) => {
      if (!active) return;
      if (status === 'error') {
        showAlert('เล่นวิดีโอไม่สำเร็จ', error?.message || 'ไม่สามารถอ่านไฟล์วิดีโอนี้ได้ กรุณาลองอีกครั้ง', { tone: 'danger' });
        callbacks.current.onClose();
        return;
      }
      if (status !== 'readyToPlay' || starting) return;
      starting = true;
      if (player.duration > 0) setDuration(player.duration * 1000);
      try {
        if (clipStart > 0) {
          player.currentTime = clipStart / 1000;
          setPosition(clipStart);
        }
        setReady(true);
        player.play();
        setPlaying(true);
        // Record view in the background — never block first frame playback.
        Promise.resolve(callbacks.current.onReady?.()).catch((error) => {
          showAlert('เปิดวิดีโอไม่สำเร็จ', error?.message || 'กรุณาลองอีกครั้ง', { tone: 'danger' });
          callbacks.current.onClose();
        });
      } catch (error) {
        showAlert('เปิดวิดีโอไม่สำเร็จ', error?.message || 'กรุณาลองอีกครั้ง', { tone: 'danger' });
        callbacks.current.onClose();
      }
    };
    const finishPlayback = (finalPosition) => {
      if (endedRef.current) return;
      endedRef.current = true;
      setPlaying(false);
      setPosition(finalPosition);
      if (closeOnEnd) callbacks.current.onClose();
    };
    const end = player.addListener('playToEnd', () => {
      finishPlayback(clipEnd == null ? (player.duration * 1000) : clipEnd);
    });
    const progress = player.addListener('timeUpdate', ({ currentTime }) => {
      const ms = currentTime * 1000;
      setPosition(ms);
      if (!holdingRef.current && !pinchingRef.current) {
        setPlaying(Boolean(player.playing));
      }
      if (clipEnd != null && ms >= clipEnd) {
        try { player.pause(); } catch (_) {}
        finishPlayback(clipEnd);
      }
    });
    const status = player.addListener('statusChange', handleStatus);
    if (player.duration > 0) setDuration(player.duration * 1000);
    handleStatus({ status: player.status });
    return () => { active = false; end.remove(); progress.remove(); status.remove(); };
  }, [player, clipStart, clipEnd, closeOnEnd]);

  const togglePlayback = useCallback(() => {
    if (!ready || holdingRef.current || pinchingRef.current) return;
    try {
      if (player.playing) {
        player.pause();
        setPlaying(false);
        return;
      }
      const endAt = clipEnd == null ? (player.duration * 1000) : clipEnd;
      if (endAt > 0 && position >= endAt - 120) {
        endedRef.current = false;
        player.currentTime = clipStart / 1000;
        setPosition(clipStart);
      }
      player.play();
      setPlaying(true);
    } catch (_) {}
  }, [ready, player, position, clipStart, clipEnd]);

  const beginGesturePause = useCallback(() => {
    if (!ready) return;
    suppressTapRef.current = true;
    if (!holdingRef.current && !pinchingRef.current) {
      resumeAfterHoldRef.current = Boolean(player.playing);
    }
    if (player.playing) {
      try { player.pause(); } catch (_) {}
      setPlaying(false);
    }
    setGesturePaused(true);
  }, [player, ready]);

  const endGesturePause = useCallback(() => {
    if (holdingRef.current || pinchingRef.current) return;
    setGesturePaused(false);
    if (resumeAfterHoldRef.current && !endedRef.current) {
      try { player.play(); } catch (_) {}
      setPlaying(true);
    }
    resumeAfterHoldRef.current = false;
    setTimeout(() => { suppressTapRef.current = false; }, 0);
  }, [player]);

  const holdPlayback = useCallback(() => {
    if (!ready || pinchingRef.current) return;
    holdingRef.current = true;
    beginGesturePause();
  }, [beginGesturePause, ready]);

  const releasePlayback = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    endGesturePause();
  }, [endGesturePause]);

  const startPinchPause = useCallback(() => {
    if (!ready) return;
    pinchingRef.current = true;
    holdingRef.current = false;
    beginGesturePause();
  }, [beginGesturePause, ready]);

  const endPinchPause = useCallback(() => {
    if (!pinchingRef.current) return;
    pinchingRef.current = false;
    endGesturePause();
  }, [endGesturePause]);

  const handleTap = useCallback(() => {
    if (suppressTapRef.current || !ready) return;
    togglePlayback();
  }, [ready, togglePlayback]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));

  const gestures = useMemo(() => {
    const springFit = (velocity = 0) => {
      'worklet';
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      pinchActive.set(1);
      scale.set(withSpring(1, { duration: 400, dampingRatio: 0.8, velocity }, (finished) => {
        if (finished) {
          pinchActive.set(0);
          scheduleOnRN(endPinchPause);
        }
      }));
      translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    };

    const pinch = Gesture.Pinch()
      .onStart((event) => {
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        pinchActive.set(1);
        pinchStartScale.set(scale.get());
        pinchStartX.set(translateX.get());
        pinchStartY.set(translateY.get());
        pinchFocalX.set(event.focalX);
        pinchFocalY.set(event.focalY);
        scheduleOnRN(startPinchPause);
      })
      .onUpdate((event) => {
        const nextScale = Math.min(Math.max(pinchStartScale.get() * event.scale, 0.85), 4.5);
        scale.set(nextScale);
        translateX.set(pinchStartX.get() + (event.focalX - pinchFocalX.get()));
        translateY.set(pinchStartY.get() + (event.focalY - pinchFocalY.get()));
      })
      .onEnd((event) => {
        springFit(event.velocity || 0);
      })
      .onFinalize((_event, success) => {
        if (!success) {
          if (scale.get() > 1.02 || scale.get() < 0.98 || translateX.get() !== 0 || translateY.get() !== 0) {
            springFit(0);
          } else {
            pinchActive.set(0);
            scheduleOnRN(endPinchPause);
          }
        }
      });

    const longPress = Gesture.LongPress()
      .minDuration(110)
      .maxDistance(18)
      .onStart(() => {
        if (pinchActive.get()) return;
        scheduleOnRN(holdPlayback);
      })
      .onFinalize(() => {
        scheduleOnRN(releasePlayback);
      });

    const tap = Gesture.Tap()
      .maxDuration(220)
      .onEnd(() => {
        if (pinchActive.get()) return;
        scheduleOnRN(handleTap);
      });

    return Gesture.Simultaneous(pinch, Gesture.Exclusive(longPress, tap));
  }, [
    endPinchPause,
    handleTap,
    holdPlayback,
    pinchActive,
    pinchFocalX,
    pinchFocalY,
    pinchStartScale,
    pinchStartX,
    pinchStartY,
    releasePlayback,
    scale,
    startPinchPause,
    translateX,
    translateY,
  ]);

  const showPlayHint = ready && !playing && !gesturePaused;

  return (
    <GestureDetector gesture={gestures}>
      <View
        accessible
        accessibilityLabel={playing ? 'หยุดวิดีโอชั่วคราว' : 'เล่นวิดีโอ'}
        accessibilityHint="แตะเพื่อเล่นหรือหยุด กดค้างเพื่อพัก บีบนิ้วเพื่อซูม"
        style={{ flex: 1 }}
      >
        <Animated.View style={[{ flex: 1 }, zoomStyle]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
            allowsVideoFrameAnalysis={false}
            fullscreenOptions={{ enable: false }}
          />
        </Animated.View>
        {!ready ? (
          <View pointerEvents="none" style={styles.playHint}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : showPlayHint ? (
          <View pointerEvents="none" style={styles.playHint}>
            <Ionicons name="play-circle" size={64} color="rgba(255,255,255,0.92)" />
          </View>
        ) : null}
        <VideoTimeline
          duration={duration || Math.max(clipEnd || 0, clipStart + 1, 1)}
          progress={position}
          startMs={clipStart}
          endMs={clipEnd == null ? (duration || clipStart + 1) : clipEnd}
        />
      </View>
    </GestureDetector>
  );
}

function VideoSession({ item, conversationId, currentUserId, mine = false, onClose, onConsumed }) {
  const insets = useSafeAreaInsets();
  const { sendMessage } = useAppActions();
  const [uri, setUri] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const selectedUrl = useRef(item.mediaUrl);
  const callbacks = useRef({ onClose, onConsumed });
  callbacks.current = { onClose, onConsumed };
  const protectedVideo = item.videoMode === 'once' || item.videoMode === 'replay';

  useEffect(() => {
    let active = true;
    let captureEnabled = false;
    let switcherEnabled = false;
    const key = `chat-video-${item.id}-${Date.now()}-${Math.random()}`;
    const ownsSession = activeSession === null;
    if (ownsSession) activeSession = key;
    const background = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { active = false; setUri(null); callbacks.current.onClose(); }
    });
    const preparation = (async () => {
      try {
        if (!ownsSession) throw new Error('กรุณารอให้วิดีโอก่อนหน้าปิดก่อน');
        if (protectedVideo) {
          if (Platform.OS === 'web' || !(await ScreenCapture.isAvailableAsync())) {
            throw new Error('อุปกรณ์นี้ไม่รองรับการป้องกันแคปหน้าจอ');
          }
          captureEnabled = true;
          await ScreenCapture.preventScreenCaptureAsync(key);
          if (Platform.OS === 'ios') {
            await ScreenCapture.enableAppSwitcherProtectionAsync(1);
            switcherEnabled = true;
          }
        }
        if (!active) return;
        const conversationKey = await getOrFetchConversationKey(conversationId, currentUserId);
        selectedUrl.current = (await getBestVideoUrl(conversationId, item, conversationKey)) || item.mediaUrl;
        // Instant open when the preferred rendition is already decrypted in memory.
        const cachedUri = getSyncCachedMediaUri(selectedUrl.current, 'video', conversationKey);
        if (cachedUri && active) setUri(cachedUri);
        let localUri;
        try { localUri = await getDecryptedMediaUri(selectedUrl.current, { conversationKey, mediaType: 'video' }); }
        catch (error) {
          if (selectedUrl.current === item.mediaUrl) throw error;
          selectedUrl.current = item.mediaUrl;
          localUri = await getDecryptedMediaUri(item.mediaUrl, { conversationKey, mediaType: 'video' });
        }
        if (!localUri) throw new Error('ไม่สามารถโหลดวิดีโอได้');
        if (!active) return;
        if (active) setUri(localUri);
      } catch (error) {
        if (active) {
          showAlert('เปิดวิดีโอไม่สำเร็จ', error.message, { tone: 'danger' });
          callbacks.current.onClose();
        }
      }
    })();
    return () => {
      active = false;
      background.remove();
      preparation.finally(async () => {
        if (protectedVideo && ownsSession) {
          await purgeDecryptedVideo(item.mediaUrl);
          if (selectedUrl.current !== item.mediaUrl) await purgeDecryptedVideo(selectedUrl.current);
        }
        if (switcherEnabled) await ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
        if (captureEnabled) await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
        if (activeSession === key) activeSession = null;
      });
    };
  }, [item.id, item.mediaUrl, item.videoMode, conversationId, currentUserId, protectedVideo]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardOffset(Math.max(0, event?.endCoordinates?.height || 0));
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleSendReply = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed || isSending || !conversationId || !sendMessage) return;
    try {
      setIsSending(true);
      Keyboard.dismiss();
      await sendMessage(conversationId, trimmed, {
        replyTo: createReplySnapshot(item),
      });
      setReplyText('');
      setJustSent(true);
      setTimeout(() => setJustSent(false), 2400);
    } catch (error) {
      showAlert('ส่งข้อความไม่สำเร็จ', error?.message || 'กรุณาลองอีกครั้ง', { tone: 'danger' });
    } finally {
      setIsSending(false);
    }
  }, [replyText, isSending, conversationId, sendMessage, item]);

  if (!uri) {
    return (
      <Modal visible animationType="none" onRequestClose={onClose}>
        <GestureHandlerRootView style={[styles.sessionRoot, { paddingTop: insets.top }]}>
          <ActivityIndicator color="#fff" style={{ flex: 1 }} />
        </GestureHandlerRootView>
      </Modal>
    );
  }

  const bottomPad = keyboardOffset > 0
    ? Math.max(8, keyboardOffset - insets.bottom + 4)
    : Math.max(insets.bottom, 12);

  return (
    <Modal visible animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={[styles.sessionRoot, { paddingTop: insets.top }]}>
        <View style={styles.sessionHeader}>
          <Pressable accessibilityLabel="ปิดวิดีโอ" onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.sessionTitle}>วิดีโอ</Text>
          <Text style={styles.sessionMode}>{VIDEO_MODES[item.videoMode] || VIDEO_MODES.chat}</Text>
        </View>

        <VideoPlayback
          uri={uri}
          startMs={item.videoStartMs}
          endMs={item.videoEndMs}
          closeOnEnd={item.videoMode === 'once'}
          onClose={onClose}
          onReady={async () => {
            if (mine || !isProtectedViewMode(item.videoMode)) return;
            await recordMediaView(conversationId, item.id, currentUserId, { exclusive: item.videoMode === 'once' });
            if (item.videoMode === 'once') callbacks.current.onConsumed();
          }}
        />

        <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
          {justSent ? (
            <View style={styles.sentToast}>
              <Ionicons name="checkmark-circle" size={14} color="#34D399" />
              <Text style={styles.sentToastText}>ส่งข้อความแล้ว</Text>
            </View>
          ) : null}
          <View style={styles.inputCapsule}>
            <TextInput
              accessibilityLabel="พิมพ์ข้อความตอบกลับ"
              autoCapitalize="sentences"
              autoCorrect={false}
              editable={!isSending}
              multiline={false}
              onChangeText={setReplyText}
              onSubmitEditing={handleSendReply}
              placeholder="ตอบกลับ..."
              placeholderTextColor="rgba(255, 255, 255, 0.45)"
              returnKeyType="send"
              style={styles.replyInput}
              value={replyText}
            />
            {replyText.length > 0 ? (
              <Pressable accessibilityLabel="ลบข้อความทั้งหมด" hitSlop={8} onPress={() => setReplyText('')} style={styles.clearBtn}>
                <Ionicons color="rgba(255, 255, 255, 0.65)" name="close-circle" size={18} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="ส่งข้อความ"
              disabled={!replyText.trim() || isSending}
              hitSlop={8}
              onPress={handleSendReply}
              style={[styles.sendBtn, (!replyText.trim() || isSending) && styles.sendBtnDisabled]}
            >
              {isSending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons color="#FFFFFF" name="send" size={16} style={{ marginLeft: 2 }} />
              )}
            </Pressable>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export default function ChatVideoBubble({ item, conversationId, currentUserId, otherUserId, mine = false, onLongPress }) {
  const [open, setOpen] = useState(false);
  const [localConsumed, setLocalConsumed] = useState(false);
  const once = item.videoMode === 'once';
  const watchViewerId = mine ? otherUserId : (once ? currentUserId : null);
  const viewedAt = usePeerMediaView(
    conversationId,
    item.id,
    watchViewerId,
    Boolean(watchViewerId) && !item.pendingSync,
  );
  const openedByPeer = mine && Boolean(viewedAt);
  const consumed = !mine && once && (Boolean(viewedAt) || localConsumed);
  return <View style={{ width: 230, minHeight: 220 }}>
    <Pressable disabled={open} onPress={() => { if (!consumed && !item.pendingSync) setOpen(true); }}
      onLongPress={onLongPress} delayLongPress={220}
      accessibilityLabel="เปิดวิดีโอ" style={{ minHeight: 220, backgroundColor: 'transparent' }}>
      <ChatVideoCover item={item} conversationId={conversationId} currentUserId={currentUserId} mine={mine} consumed={consumed || openedByPeer} />
      {item.isUploading ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ActivityIndicator color="#fff" />
          <Text style={{ color: '#fff' }}>กำลังส่งวิดีโอ...</Text>
        </View>
      ) : null}
      {open && <ActivityIndicator color="#fff" style={{ position: 'absolute', alignSelf: 'center', top: '45%' }} />}
    </Pressable>
    {open && <Pressable onPress={() => setOpen(false)} style={{ padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons name="stop-circle-outline" size={16} color="#64748b" /><Text style={{ color: '#64748b' }}>ยกเลิกการเปิดวิดีโอ</Text>
    </Pressable>}
    {open && <VideoSession item={item} conversationId={conversationId} currentUserId={currentUserId} mine={mine}
      onConsumed={() => setLocalConsumed(true)} onClose={() => setOpen(false)} />}
  </View>;
}

const styles = StyleSheet.create({
  sessionRoot: {
    backgroundColor: '#000',
    flex: 1,
  },
  sessionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeBtn: {
    padding: 10,
  },
  sessionTitle: {
    color: '#fff',
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  sessionMode: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '600',
    paddingRight: 8,
  },
  playHint: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    backgroundColor: 'rgba(10, 12, 16, 0.78)',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  sentToast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sentToastText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  inputCapsule: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    paddingLeft: 16,
    paddingRight: 6,
  },
  replyInput: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 14.5,
    height: 38,
    paddingVertical: 0,
  },
  clearBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    marginRight: 4,
    width: 28,
  },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: '#3B5AFE',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginLeft: 8,
    width: 36,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
});
