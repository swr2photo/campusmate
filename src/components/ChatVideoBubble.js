import { getBestVideoUrl } from '../services/videoUpgradeService';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as ScreenCapture from 'expo-screen-capture';
import { getDecryptedMediaUri, purgeDecryptedVideo } from '../services/chatMediaService';
import { getOrFetchConversationKey } from '../services/chatEncryptionService';
import { claimOnceVideo, watchOnceVideo } from '../services/chatVideoService';
import { VIDEO_MODES } from '../utils/chatVideoPolicy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';

// Serialise native capture acquisition/release, including rapid close/reopen.
let activeSession = null;

function VideoThumbnail({ uri, blurred }) {
  const player = useVideoPlayer(uri, instance => { instance.muted = true; });
  const [thumbnail, setThumbnail] = useState(null);
  useEffect(() => {
    let active = true;
    const generate = async () => {
      try {
        const frames = await player.generateThumbnailsAsync(0);
        if (active) setThumbnail(frames[0] || null);
      } catch { /* Keep the neutral placeholder if a preview cannot be decoded. */ }
    };
    const sub = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') generate(); });
    if (player.status === 'readyToPlay') generate();
    return () => { active = false; sub.remove(); };
  }, [player]);
  return thumbnail ? <Image source={thumbnail} blurRadius={blurred ? 32 : 0} contentFit="cover"
    style={{ position: 'absolute', width: '100%', height: '100%' }} /> : null;
}

function VideoTimeline({ duration, progress = 0, startMs = 0, endMs = duration }) {
  const total = Math.max(1, Number(duration) || 1);
  const start = Math.max(0, Math.min(total, Number(startMs) || 0));
  const end = Math.max(start, Math.min(total, Number(endMs) || total));
  const played = Math.max(start, Math.min(end, Number(progress) || 0));
  return <View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, right: 0, height: 4, zIndex: 4 }}>
    <View style={{ flex: 1, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.32)' }}>
      <View style={{ position: 'absolute', left: `${start / total * 100}%`, right: `${(total - end) / total * 100}%`, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.2)' }} />
      <View style={{ position: 'absolute', left: `${start / total * 100}%`, width: `${Math.max(0, (played - start) / total * 100)}%`, top: 0, bottom: 0, backgroundColor: '#fff' }} />
    </View>
    <View style={{ position: 'absolute', left: `${start / total * 100}%`, top: -2, width: 2, height: 8, borderRadius: 2, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', left: `${Math.max(0, end / total * 100 - 0.5)}%`, top: -2, width: 2, height: 8, borderRadius: 2, backgroundColor: '#fff' }} />
  </View>;
}

// A passive cover never starts playback or claims a view-once receipt.
export function ChatVideoCover({ item, conversationId, currentUserId, mine = false, consumed = false }) {
  const { uri, loading } = useDecryptedMedia(item.mediaUrl, { conversationId, currentUserId, mediaType: 'video' });
  const protectedMode = item.videoMode === 'once' || item.videoMode === 'replay';
  return <View style={{ width: 230, height: 220, paddingTop: 10 }}>
    <VideoTimeline duration={item.videoDuration} startMs={item.videoStartMs} endMs={item.videoEndMs || item.videoDuration} />
    <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' }}>
      {uri ? <VideoThumbnail uri={uri} blurred={protectedMode} /> : null}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#05070d55' }}>
      {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name={consumed ? 'checkmark-circle-outline' : 'play-circle-outline'} size={42} color="#fff" />}
      <Text style={{ color: '#fff', fontWeight: '700', marginTop: 9 }}>{consumed ? 'เปิดดูแล้ว' : mine ? 'วิดีโอที่ส่ง' : 'วิดีโอ'}</Text>
      <Text style={{ color: '#fff', marginTop: 5 }}>{Math.ceil((item.videoDuration || 0) / 1000)} วินาที</Text>
      <Text style={{ color: '#e2e8f0', marginTop: 5 }}>{VIDEO_MODES[item.videoMode] || VIDEO_MODES.chat}</Text>
      </View>
    </View>
  </View>;
}

function VideoPlayback({ uri, once, onClose, onReady }) {
  const callbacks = useRef({ onClose, onReady });
  callbacks.current = { onClose, onReady };
  const [authorized, setAuthorized] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
  });
  useEffect(() => {
    let active = true;
    let starting = false;
    const handleStatus = async ({ status, error }) => {
      if (status === 'error' && active) {
        Alert.alert('เล่นวิดีโอไม่สำเร็จ', error?.message || 'ไม่สามารถอ่านไฟล์วิดีโอนี้ได้ กรุณาลองอีกครั้ง');
        callbacks.current.onClose();
      }
      if (status !== 'readyToPlay' || starting || !active) return;
      if (player.duration > 0) setDuration(player.duration * 1000);
      starting = true;
      try {
        await callbacks.current.onReady();
        if (active) { setAuthorized(true); player.play(); }
      } catch (error) {
        if (active) { Alert.alert('เปิดวิดีโอไม่สำเร็จ', error.message); callbacks.current.onClose(); }
      }
    };
    const end = player.addListener('playToEnd', () => { if (once) callbacks.current.onClose(); });
    const progress = player.addListener('timeUpdate', ({ currentTime }) => setPosition(currentTime * 1000));
    const status = player.addListener('statusChange', handleStatus);
    if (player.duration > 0) setDuration(player.duration * 1000);
    handleStatus({ status: player.status });
    return () => { active = false; end.remove(); progress.remove(); status.remove(); };
  }, [player, once]);
  if (!authorized) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  return <View style={{ flex: 1 }}>
    <VideoView player={player} style={{ flex: 1 }} contentFit="contain"
      nativeControls={authorized && !once} allowsPictureInPicture={false} allowsVideoFrameAnalysis={false}
      fullscreenOptions={{ enable: false }} />
    <VideoTimeline duration={duration || 1} progress={position} />
  </View>;
}

function VideoSession({ item, conversationId, currentUserId, onClose, onConsumed }) {
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState(null);
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
        selectedUrl.current = await getBestVideoUrl(conversationId, item, conversationKey);
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
          Alert.alert('เปิดวิดีโอไม่สำเร็จ', error.message);
          callbacks.current.onClose();
        }
      }
    })();
    return () => {
      active = false;
      background.remove();
      // Wait for in-flight acquisition before releasing protection or deleting the cache.
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
  // On Android the modal inherits FLAG_SECURE when its window is created.
  if (!uri) return null;
  return <Modal visible animationType="none" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16 }}>
      <Pressable accessibilityLabel="ปิดวิดีโอ" onPress={onClose} style={{ padding: 10 }}>
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>
      <Text style={{ color: '#fff', fontSize: 16 }}>วิดีโอ</Text>
      </View>
      <VideoPlayback uri={uri} once={item.videoMode === 'once'} onClose={onClose} onReady={async () => {
        if (item.videoMode === 'once') {
          await claimOnceVideo(conversationId, item.id, currentUserId);
          callbacks.current.onConsumed();
        }
      }} />
      <Text style={{ color: '#fff', textAlign: 'center', padding: 12 }}>{VIDEO_MODES[item.videoMode] || VIDEO_MODES.chat}</Text>
    </View>
  </Modal>;
}

export default function ChatVideoBubble({ item, conversationId, currentUserId, mine = false, onLongPress }) {
  const [open, setOpen] = useState(false);
  const [consumed, setConsumed] = useState(false);
  useEffect(() => {
    if (item.videoMode !== 'once' || item.pendingSync || !currentUserId) return;
    return watchOnceVideo(conversationId, item.id, currentUserId, () => setConsumed(true));
  }, [conversationId, item.id, item.videoMode, item.pendingSync, currentUserId]);
  return <View style={{ width: 230, minHeight: 220 }}>
    <Pressable disabled={open} onPress={() => { if (!consumed && !item.pendingSync) setOpen(true); }}
      onLongPress={onLongPress} delayLongPress={220}
      accessibilityLabel="เปิดวิดีโอ" style={{ minHeight: 220, backgroundColor: 'transparent' }}>
      <ChatVideoCover item={item} conversationId={conversationId} currentUserId={currentUserId} mine={mine} consumed={consumed} />
      {open && <ActivityIndicator color="#fff" />}
    </Pressable>
    {open && <Pressable onPress={() => setOpen(false)} style={{ padding: 8 }}>
      <Ionicons name="stop-circle-outline" size={16} color="#64748b" /><Text style={{ color: '#64748b' }}>ยกเลิกการเปิดวิดีโอ</Text>
    </Pressable>}
    {open && <VideoSession item={item} conversationId={conversationId} currentUserId={currentUserId}
      onConsumed={() => setConsumed(true)} onClose={() => setOpen(false)} />}
  </View>;
}
