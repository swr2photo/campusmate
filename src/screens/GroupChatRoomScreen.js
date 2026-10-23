import { Pressable } from '../components/NativePressable';
import { useChatImageOutbox } from '../context/ChatImageOutboxContext';
import ChatImageUploadBubble from '../components/ChatImageUploadBubble';
import { RUST_BACKEND } from '../services/rust/backend';
import NativeCard from '../components/NativeCard';
import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { mergeGroupMessages, messageMillis, receiveGroupWindow } from '../utils/groupChatTimeline';
import { getOfflineQueue, getFailedOfflineOperations, subscribeOfflineQueueChanges } from '../services/offlineStorage';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppProfile } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import FeatureIcon from '../components/FeatureIcon';
import { IosLikeAvatar } from '../components/iosLike';
import AudioWaveformBar from '../components/AudioWaveformBar';
import ChatCameraModal from '../components/ChatCameraModal';
import ChatMediaComposer from '../components/ChatMediaComposer';
import ChatMediaPickerSheet, { MEDIA_PICKER_COLLAPSED_HEIGHT } from '../components/ChatMediaPickerSheet';
import ChatProtectedImageBubble from '../components/ChatProtectedImageBubble';
import ChatGiphyPickerSheet from '../components/ChatGiphyPickerSheet';
import SpotifyTrackSearchSheet from '../components/SpotifyTrackSearchSheet';
import TrackPreviewButton from '../components/TrackPreviewButton';
import TrackShareCard from '../components/TrackShareCard';
import VoiceMessageBubble from '../components/VoiceMessageBubble';
import { radius, spacing, type, useTheme } from '../theme';
import {
  leaveParty, loadOlderGroupMessages, rotatePartyKey, sendGroupImage, sendGroupText,
  subscribeGroupChat, subscribeGroupEpochs, subscribeGroupMessages,
  markGroupRead, subscribeGroupReadReceipts,
  retryGroupMessage, sendGroupAudio, sendGroupGif, sendGroupTrack, updateGroupProfile,
} from '../services/partyService';
import { uploadRawImage } from '../services/rust/media';
import { decryptGroupMessage, getGroupKeys, preparePartyRotation } from '../services/groupChatEncryption';
import { uploadGroupAudio, uploadGroupImage } from '../services/groupChatMedia';
import {
  cancelAudioRecording, formatAudioDuration, getDecryptedMediaUri, getRecordingStatus, meteringToLevel,
  pickChatImages, startAudioRecording, stopAudioRecording,
} from '../services/chatMediaService';
import { isEncryptedMediaUrl } from '../utils/imagePolicy';
import { isProtectedViewMode } from '../utils/chatVideoPolicy';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';
import { getPublicProfilesByIds } from '../services/firestoreService';
import { GlassBackground, useLiquidGlass, useSheetGlassTint } from '../components/LiquidGlassSurface';

function GroupImage({ url, keyBytes, colors }) {
  const [uri, setUri] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUri(null);
    setFailed(false);
    if (!url || !keyBytes) { setFailed(true); return undefined; }
    getDecryptedMediaUri(url, { conversationKey: keyBytes, mediaType: 'image' })
      .then((nextUri) => { if (active) { setUri(nextUri); setFailed(!nextUri); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url, keyBytes]);
  if (failed) return <Text style={{ color: colors.danger }}>เปิดรูปภาพนี้ไม่ได้</Text>;
  if (!uri) return <ActivityIndicator color={colors.primary} />;
  return <Image source={{ uri }} style={styles.image} contentFit="cover" />;
}

export default function GroupChatRoomScreen() {
  const params = useLocalSearchParams();
  const partyId = Array.isArray(params.partyId) ? params.partyId[0] : params.partyId;
  const { colors, isDark } = useTheme();
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();
  const insets = useSafeAreaInsets();
  const { confirm } = useConfirm();
  const { profile } = useAppProfile();
  const userId = profile?.id;
  const { messages: imageUploadMessages, enqueue: enqueueImages } = useChatImageOutbox(partyId, 'group');
  const [chat, setChat] = useState(null);
  const [epochs, setEpochs] = useState([]);
  const [keys, setKeys] = useState({});
  const [history, setHistory] = useState({ recent: [], older: [], cursor: null, hasMore: false, loadedOlder: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [memberNames, setMemberNames] = useState({});
  const [memberAvatars, setMemberAvatars] = useState({});
  const [membersOpen, setMembersOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftUri, setDraftUri] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaDraft, setMediaDraft] = useState(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const recordingTimerRef = useRef(null);
  const recordingMeterIntervalRef = useRef(null);
  const canUseSpotify = useMemo(() => isSpotifyFeatureAllowed(null, profile), [profile]);
  const previewPlayer = useAudioPlayer(recordedAudio?.uri ? { uri: recordedAudio.uri } : null);
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const isPreviewPlaying = Boolean(previewStatus?.playing);
  const previewDuration = previewStatus?.duration || recordedAudio?.duration || 0;
  const previewProgress = previewDuration > 0 ? Math.min(Math.max((previewStatus?.currentTime || 0) / previewDuration, 0), 1) : 0;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState({ chat: false, messages: false, keys: false });
  const [outbox, setOutbox] = useState([]);
  const [receipts, setReceipts] = useState({});
  const [retry, setRetry] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    cancelAudioRecording();
  }, []);
  const sessionRef = useRef('');
  sessionRef.current = `${userId}:${partyId}:${retry}`;
  const listRef = useRef(null);
  const initialScrollDone = useRef(false);
  const nearLatest = useRef(true);
  const [isListAnchored, setIsListAnchored] = useState(false);

  useEffect(() => {
    if (!partyId || !userId) return undefined;
    let active = true;
    initialScrollDone.current = false;
    nearLatest.current = true;
    setIsListAnchored(false);
    setHistory({ recent: [], older: [], cursor: null, hasMore: false, loadedOlder: false });
    setChat(null); setEpochs([]); setKeys({}); setError(''); setReceipts({}); setMemberNames({}); setMemberAvatars({});
    setReady({ chat: false, messages: false, keys: false });
    const onError = (reason) => {
      if (!active) return;
      setError(reason?.message || 'โหลดแชตกลุ่มไม่ได้');
      if (String(reason?.code).includes('permission-denied')) {
        setChat(null); setKeys({}); setEpochs([]);
        setReady({ chat: true, messages: true, keys: true });
      }
    };
    const offChat = subscribeGroupChat(partyId, (value) => {
      if (!active) return;
      setChat(value); setReady((old) => ({ ...old, chat: true }));
      if (!value) setError('ไม่พบแชตกลุ่มนี้');
    }, onError);
    const offEpochs = subscribeGroupEpochs(partyId, (value) => { if (active) setEpochs(value); }, onError);
    const offMessages = subscribeGroupMessages(partyId, (recent, cursor, hasMore) => {
      if (!active) return;
      setHistory((old) => receiveGroupWindow(old, recent, cursor, hasMore));
      setReady((old) => ({ ...old, messages: true }));
    }, onError);
    const offReads = subscribeGroupReadReceipts(partyId, (value) => { if (active) setReceipts(value); }, onError);
    const timer = setTimeout(() => {
      if (!initialScrollDone.current) {
        listRef.current?.scrollToEnd({ animated: false });
        initialScrollDone.current = true;
      }
      setIsListAnchored(true);
    }, 120);
    return () => { clearTimeout(timer); active = false; offChat(); offEpochs(); offMessages(); offReads(); };
  }, [partyId, userId, retry]);

  useEffect(() => {
    let active = true;
    setOutbox([]);
    const load = async (changedUserId = userId) => {
      if (changedUserId !== userId || !userId) return;
      const [pending, failed] = await Promise.all([getOfflineQueue(userId), getFailedOfflineOperations(userId)]);
      if (!active) return;
      setOutbox([...failed, ...pending].filter((item) => item.type === 'sendGroupMessage' && item.payload.partyId === partyId)
        .map((item) => ({ ...item.payload.record, id: item.payload.id, clientSentAt: item.payload.clientSentAt,
          operationId: item.id, pendingSync: true, sendStatus: item.failedAt ? 'failed' : 'queued' })));
    };
    const off = subscribeOfflineQueueChanges((id) => { void load(id).catch(() => {}); });
    void load().catch(() => setError('อ่านคิวส่งข้อความไม่ได้'));
    return () => { active = false; off(); };
  }, [userId, partyId]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!epochs.length || !partyId || !userId) return;
    let active = true;
    getGroupKeys(partyId, userId, epochs).then((loaded) => {
      if (active) { setKeys(loaded); setReady((old) => ({ ...old, keys: true })); }
    }).catch((reason) => { if (active) setError(reason?.message || 'อ่านกุญแจแชตไม่ได้'); });
    return () => { active = false; };
  }, [epochs, partyId, userId]);

  useEffect(() => {
    if (!chat?.memberIds?.length) return;
    let active = true;
    getPublicProfilesByIds(chat.memberIds).then((profiles) => {
      if (!active) return;
      setMemberNames(Object.fromEntries(profiles.map((entry) => [entry.id, entry.nickname || entry.name || 'สมาชิกในตี้'])));
      setMemberAvatars(Object.fromEntries(profiles.map((entry) => [entry.id, entry.avatarUri || entry.photoURL || null])));
    })
      .catch(() => { if (active) { setMemberNames({}); setMemberAvatars({}); } });
    return () => { active = false; };
  }, [chat?.memberIds?.join('|')]);

  const visibleMessages = useMemo(() => {
    const base = mergeGroupMessages(outbox, history.older, history.recent);
    const confirmed = new Set(base.filter(item => !item.pendingSync).map(item => item.id));
    const pending = imageUploadMessages.filter(item => !confirmed.has(item.id));
    return mergeGroupMessages(base, pending).map((item) => item.imageOutbox ? item : keys[item.epoch]
      ? decryptGroupMessage(item, keys) : { ...item, text: 'กำลังโหลดกุญแจข้อความ', keyPending: true });
  }, [history.recent, history.older, imageUploadMessages, keys, outbox]);
  const lastReadable = [...visibleMessages].reverse().find((message) => !message.pendingSync && !message.keyPending && !message.decryptionFailed && message.createdAt?.toMillis);
  useEffect(() => {
    if (!focused || !foreground || !atBottom || !lastReadable || !chat?.memberIds?.includes(userId)) return undefined;
    if ((receipts[userId]?.lastReadMessageAt?.toMillis?.() || 0) >= messageMillis(lastReadable)) return undefined;
    const timer = setTimeout(() => { void markGroupRead(partyId, userId, lastReadable).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [focused, foreground, atBottom, lastReadable?.id, receipts, chat, partyId, userId]);
  const latestMessageId = history.recent[0]?.id;
  useEffect(() => {
    if (!latestMessageId || !initialScrollDone.current || !nearLatest.current) return undefined;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [latestMessageId]);
  useEffect(() => {
    if (!Object.keys(keys).length) return;
    const failures = visibleMessages.filter((item) => item.decryptionFailed).length;
    if (failures) console.warn('[GroupChat] message_decryption_failed', { partyId, failures });
  }, [visibleMessages, keys, partyId]);
  const currentKey = keys[chat?.currentEpoch];
  const canSend = Boolean(chat && !chat.rekeyRequired && currentKey && chat.memberIds?.includes(userId));

  const loadHistory = async () => {
    if (!history.hasMore || !history.cursor || loadingOlder) return;
    setLoadingOlder(true);
    const session = sessionRef.current;
    try {
      const page = await loadOlderGroupMessages(partyId, history.cursor);
      if (sessionRef.current !== session) return;
      setHistory((old) => ({
        ...old, older: mergeGroupMessages(old.older, page.messages), cursor: page.cursor,
        hasMore: page.hasMore, loadedOlder: true,
      }));
    } catch (reason) { setError(reason?.message || 'โหลดข้อความเก่าไม่ได้'); }
    finally { if (sessionRef.current === session) setLoadingOlder(false); }
  };

  const sendText = async () => {
    if (!canSend || !draft.trim() || busy) return;
    setBusy(true);
    try {
      const message = await sendGroupText(partyId, userId, chat.currentEpoch, draft, currentKey);
      setOutbox((old) => mergeGroupMessages(old, [message]));
      setDraft('');
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่งข้อความไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const remember = (message) => {
    if (message) setOutbox((old) => mergeGroupMessages(old, [message]));
  };

  const sendPhotos = async (uris, caption, viewMode = 'chat') => {
    const list = (Array.isArray(uris) ? uris : [uris]).filter(Boolean);
    if (!canSend || !list.length) return;
    if (RUST_BACKEND) {
      try {
        enqueueImages(partyId, list, caption, viewMode, undefined, 'group');
        setMediaPickerOpen(false); setGifOpen(false); setMusicOpen(false); setError('');
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      } catch (reason) { setError(reason?.message || 'ส่งรูปภาพไม่สำเร็จ'); }
      return;
    }
    setMediaPickerOpen(false);
    setGifOpen(false);
    setMusicOpen(false);
    setUploadingMedia(true);
    try {
      for (let index = 0; index < list.length; index += 1) {
        const url = await uploadGroupImage(partyId, currentKey, list[index]);
        remember(await sendGroupImage(partyId, userId, chat.currentEpoch, url, currentKey, {
          caption: index === 0 ? caption : '',
          viewMode,
        }));
      }
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่งรูปภาพไม่สำเร็จ'); }
    finally { setUploadingMedia(false); }
  };

  const stagePhotos = (uris, extra = {}) => {
    const list = (Array.isArray(uris) ? uris : [uris]).filter(Boolean);
    if (!list.length) return;
    setMediaPickerOpen(false);
    setCameraOpen(false);
    setMediaDraft({ uri: list[0], uris: list, type: 'image', ...extra });
  };

  const sendGif = async (gif) => {
    if (!canSend || !gif?.url) return;
    setGifOpen(false);
    setBusy(true);
    try {
      remember(await sendGroupGif(partyId, userId, chat.currentEpoch, gif, currentKey));
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่ง GIF ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const sendTrack = async (track) => {
    if (!canSend || !track?.id) return;
    setMusicOpen(false);
    setBusy(true);
    try {
      remember(await sendGroupTrack(partyId, userId, chat.currentEpoch, track, currentKey));
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่งเพลงไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const startRecording = async () => {
    if (!canSend || busy || uploadingMedia) return;
    setGifOpen(false);
    setMusicOpen(false);
    setMediaPickerOpen(false);
    try {
      setRecordingLevels([]);
      await startAudioRecording();
      setIsRecordingAudio(true);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
      if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
      recordingMeterIntervalRef.current = setInterval(() => {
        const status = getRecordingStatus();
        if (!status) return;
        const level = meteringToLevel(status.metering);
        setRecordingLevels((previous) => {
          const next = [...previous, level];
          return next.length > 30 ? next.slice(-30) : next;
        });
      }, 80);
    } catch (reason) { setError(reason?.message || 'ไม่สามารถบันทึกเสียงได้'); }
  };

  const stopRecordingPreview = async () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    const duration = recordingSeconds;
    const levels = recordingLevels;
    setIsRecordingAudio(false);
    setRecordedAudio({ uri: null, duration, levels, stopping: true });
    try {
      const result = await stopAudioRecording();
      const actual = Math.max(duration, Math.round(result?.duration || 0));
      if (!result?.uri || actual < 1) {
        setRecordedAudio(null);
        setRecordingSeconds(0);
        if (result?.uri) setError('กรุณาบันทึกเสียงอย่างน้อย 1 วินาที');
        return;
      }
      setRecordedAudio({ uri: result.uri, duration: actual, levels });
    } catch (reason) {
      setRecordedAudio(null);
      setError(reason?.message || 'ไม่สามารถหยุดการบันทึกได้');
    }
  };

  const cancelRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    setIsRecordingAudio(false);
    setRecordedAudio(null);
    setRecordingSeconds(0);
    setRecordingLevels([]);
    if (previewPlayer && isPreviewPlaying) {
      try { previewPlayer.pause(); } catch (_) {}
    }
    cancelAudioRecording();
  };

  const togglePreview = () => {
    if (!previewPlayer || !recordedAudio?.uri) return;
    try {
      if (isPreviewPlaying) previewPlayer.pause();
      else {
        if (previewProgress >= 0.99) previewPlayer.seekTo(0);
        previewPlayer.play();
      }
    } catch (_) {}
  };

  const sendRecording = async () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    if (previewPlayer && isPreviewPlaying) {
      try { previewPlayer.pause(); } catch (_) {}
    }
    let audioUri = recordedAudio?.uri;
    let duration = recordedAudio?.duration || recordingSeconds;
    if (isRecordingAudio) {
      setIsRecordingAudio(false);
      const result = await stopAudioRecording();
      if (result?.uri) {
        audioUri = result.uri;
        duration = Math.max(duration, Math.round(result.duration || 0));
      }
    }
    setRecordedAudio(null);
    setRecordingSeconds(0);
    setRecordingLevels([]);
    if (!audioUri || duration < 1 || !canSend) {
      if (duration < 1) setError('กรุณาบันทึกเสียงอย่างน้อย 1 วินาที');
      return;
    }
    setUploadingMedia(true);
    try {
      const mediaUrl = await uploadGroupAudio(partyId, currentKey, audioUri);
      remember(await sendGroupAudio(partyId, userId, chat.currentEpoch, { mediaUrl, audioDuration: duration }, currentKey));
      setError('');
    } catch (reason) { setError(reason?.message || 'ส่งข้อความเสียงไม่สำเร็จ'); }
    finally { setUploadingMedia(false); }
  };

  const rotate = async () => {
    if (!chat?.rekeyRequired || busy) return;
    setBusy(true);
    try {
      const grants = await preparePartyRotation(partyId, chat.memberIds, userId);
      await rotatePartyKey(partyId, grants);
      setError('');
    } catch (reason) { setError(reason?.message || 'เปลี่ยนกุญแจกลุ่มไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    const approved = await confirm({
      title: 'ออกจากตี้', body: 'เมื่อออกแล้ว คุณจะไม่สามารถอ่านหรือส่งข้อความใหม่ในแชตกลุ่มนี้',
      cancelLabel: 'อยู่ต่อ', confirmLabel: 'ออกจากตี้', icon: 'person.fill.xmark',
    });
    if (!approved) return;
    setBusy(true);
    try { await leaveParty(partyId); router.back(); }
    catch (reason) { setError(reason?.message || 'ออกจากตี้ไม่สำเร็จ'); setBusy(false); }
  };

  const isHost = Boolean(chat?.hostId && chat.hostId === userId);

  const openProfileEditor = () => {
    setDraftTitle(chat?.title || '');
    setDraftUri(chat?.avatarUri || '');
    setProfileOpen(true);
  };

  const pickGroupPhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    const uri = picked.assets?.[0]?.uri;
    if (!picked.canceled && uri) setDraftUri(uri);
  };

  const saveProfile = async () => {
    const title = draftTitle.trim();
    if (!title) {
      setError('ชื่อกลุ่มต้องไม่ว่าง');
      return;
    }
    setSavingProfile(true);
    setError('');
    try {
      let avatarUri = draftUri || '';
      if (avatarUri && !/^https:\/\//i.test(avatarUri)) {
        const uploaded = await uploadRawImage('gallery', avatarUri);
        avatarUri = uploaded?.url || '';
        if (!avatarUri) throw new Error('อัปโหลดรูปกลุ่มไม่สำเร็จ');
      }
      const saved = await updateGroupProfile(partyId, { title, avatarUri });
      setChat((current) => (current ? {
        ...current,
        title: saved?.title || title,
        avatarUri: saved?.avatarUri ?? avatarUri,
      } : current));
      setProfileOpen(false);
    } catch (reason) {
      setError(reason?.message || 'บันทึกชื่อกลุ่มไม่สำเร็จ');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="กลับ" onPress={() => router.back()} style={[styles.headerButton, { backgroundColor: colors.card }]}>
          <FeatureIcon name="chevron.left" size={22} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isHost ? 'แก้ไขชื่อและรูปกลุ่ม' : 'ดูรายชื่อสมาชิก'}
          onPress={isHost ? openProfileEditor : () => setMembersOpen(true)}
          style={styles.headerIdentity}
        >
          <IosLikeAvatar cacheScope={`group:${partyId}`} color={colors.primarySoft} icon="person.3.fill" size={44} uri={chat?.avatarUri || null} />
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.ink }]}>{chat?.title || 'แชตกลุ่มของตี้'}</Text>
            <Text numberOfLines={1} style={[styles.headerSub, { color: colors.inkMuted }]}>{chat?.memberCount || 0} คน · เข้ารหัส</Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="สมาชิกในตี้" onPress={() => setMembersOpen(true)} style={[styles.headerButton, { backgroundColor: colors.card }]}>
          <FeatureIcon name="ellipsis" size={18} color={colors.ink} />
        </Pressable>
      </View>
      {chat?.rekeyRequired ? <View style={[styles.banner, { backgroundColor: colors.amberSoft }]}>
        <Text style={[styles.bannerText, { color: colors.ink }]}>สมาชิกออกจากตี้ กรุณาเปลี่ยนกุญแจก่อนส่งข้อความใหม่</Text>
        <Pressable onPress={rotate} disabled={busy} accessibilityRole="button"><Text style={{ color: colors.primary, fontWeight: '800' }}>เปลี่ยนกุญแจ</Text></Pressable>
      </View> : null}
      {error ? <View style={styles.banner}><Text style={[styles.error, { color: colors.danger, flex: 1 }]}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRetry((old) => old + 1)}><Text style={{ color: colors.primary }}>ลองใหม่</Text></Pressable></View> : null}
      <FlatList
        ref={listRef}
        data={ready.keys ? visibleMessages : []}
        keyExtractor={(item) => item.id}
        style={{ flex: 1, opacity: isListAnchored || visibleMessages.length === 0 ? 1 : 0 }}
        contentContainerStyle={styles.messages}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={() => {
          if (!initialScrollDone.current && visibleMessages.length) {
            listRef.current?.scrollToEnd({ animated: false });
            initialScrollDone.current = true;
            setIsListAnchored(true);
          }
        }}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          nearLatest.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 90;
          setAtBottom(nearLatest.current);
        }}
        scrollEventThrottle={100}
        ListHeaderComponent={history.hasMore ? <Pressable accessibilityRole="button" disabled={loadingOlder} onPress={loadHistory} style={styles.moreHistory}>
          {loadingOlder ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '800' }}>โหลดข้อความก่อนหน้า</Text>}
        </Pressable> : null}
        renderItem={({ item }) => {
          if (item.imageOutbox) return <ChatImageUploadBubble item={item} />;
          const mine = item.senderId === userId;
          const timeLabel = item.sendStatus === 'failed' ? 'ส่งไม่สำเร็จ' : item.pendingSync ? 'รอส่ง' :
            `${new Date(messageMillis(item)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}${mine ? ` · อ่านแล้ว ${Object.entries(receipts).filter(([id, receipt]) => id !== userId && chat?.memberIds?.includes(id) && (receipt.lastReadMessageAt?.toMillis?.() || 0) >= messageMillis(item)).length} คน` : ''}`;
          return (
            <View style={[styles.messageRow, mine ? styles.messageRowMine : null]}>
              {!mine ? <IosLikeAvatar cacheScope={item.senderId} color={colors.primarySoft} icon="person.fill" size={28} uri={memberAvatars[item.senderId] || null} /> : null}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, (item.mediaType === 'track' || isProtectedViewMode(item.viewMode)) && styles.trackBubble, { backgroundColor: item.mediaType === 'track' || isProtectedViewMode(item.viewMode) ? 'transparent' : (mine ? colors.primary : colors.card), borderColor: colors.line }]}>
                {!mine ? <Text style={[styles.sender, { color: item.mediaType === 'track' ? colors.ink : colors.primary }]}>{memberNames[item.senderId] || 'สมาชิกในตี้'}</Text> : null}
                {item.mediaType === 'track' ? (
                  <TrackShareCard albumArt={item.albumArt} artists={item.artists} name={item.trackName || item.text} size={200}>
                    <TrackPreviewButton fill backgroundColor="transparent" color="#FFFFFF" previewUrl={item.previewUrl} size={36} track={item} trackArtists={item.artists} trackName={item.trackName || item.text} />
                  </TrackShareCard>
                ) : null}
                {item.mediaType === 'audio' ? (
                  <VoiceMessageBubble audioUrl={item.mediaUrl} colors={colors} conversationKey={keys[item.epoch]} duration={item.audioDuration} mine={mine} />
                ) : null}
                {item.mediaType === 'image' && item.mediaUrl && !item.decryptionFailed && isProtectedViewMode(item.viewMode) ? (
                  <ChatProtectedImageBubble conversationId={partyId} conversationKey={keys[item.epoch]} currentUserId={userId} item={item} mine={mine} />
                ) : null}
                {item.mediaType === 'image' && item.mediaUrl && !item.decryptionFailed && !isProtectedViewMode(item.viewMode) ? (
                  isEncryptedMediaUrl(item.mediaUrl)
                    ? <GroupImage url={item.mediaUrl} keyBytes={keys[item.epoch]} colors={colors} />
                    : <Image source={{ uri: item.mediaUrl }} style={styles.gif} contentFit="cover" />
                ) : null}
                {item.mediaType === 'image' && item.text && item.text !== '[รูปภาพ]' && item.text !== '[GIF]' ? (
                  <Text style={[styles.body, { color: mine && !isProtectedViewMode(item.viewMode) ? '#FFFFFF' : colors.ink }]}>{item.text}</Text>
                ) : null}
                {item.mediaType !== 'track' && item.mediaType !== 'audio' && item.mediaType !== 'image' ? (
                  <Text style={[styles.body, { color: mine ? '#FFFFFF' : colors.ink }]}>{item.text || (item.decryptionFailed ? 'ไม่สามารถถอดรหัสข้อความนี้ได้' : '')}</Text>
                ) : null}
                <Text style={[styles.time, { color: item.mediaType === 'track' || !mine ? colors.inkMuted : 'rgba(255,255,255,0.72)' }]}>{timeLabel}</Text>
                {mine && item.sendStatus === 'failed' ? <Pressable accessibilityRole="button" onPress={() => {
                  if (!canSend) { setError('กรุณารอเตรียมกุญแจกลุ่มก่อนส่งใหม่'); return; }
                  void retryGroupMessage(partyId, userId, chat.currentEpoch, item, currentKey).catch((reason) => setError(reason.message));
                }}><Text style={styles.retry}>ลองส่งใหม่</Text></Pressable> : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<View style={styles.empty}>{!ready.chat || !ready.messages || !ready.keys ? <ActivityIndicator color={colors.primary} /> : <FeatureIcon name="bubble.left.and.bubble.right.fill" size={30} color={colors.inkMuted} />}<Text style={{ color: colors.inkMuted }}>{error ? 'โหลดแชตไม่สำเร็จ' : !ready.chat || !ready.messages || !ready.keys ? 'กำลังโหลดแชตและกุญแจ' : 'เริ่มสนทนากับสมาชิกในตี้'}</Text></View>}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.composer, { borderTopColor: colors.line }]}>
          {isRecordingAudio || recordedAudio ? (
            <View style={styles.voiceBar}>
              <Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกการบันทึกเสียง" onPress={cancelRecording} style={styles.voiceCircle}>
                <FeatureIcon color="#FFFFFF" name="xmark" size={16} />
              </Pressable>
              <View style={styles.voiceWave}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isRecordingAudio ? 'หยุดเพื่อฟังตัวอย่าง' : 'ฟังตัวอย่างเสียง'}
                  disabled={Boolean(recordedAudio?.stopping)}
                  onPress={isRecordingAudio ? stopRecordingPreview : togglePreview}
                  style={[styles.voiceControl, isDark && styles.voiceControlDark]}
                >
                  {recordedAudio?.stopping ? <ActivityIndicator color={isDark ? '#FFFFFF' : '#3B5AFE'} size={14} /> : (
                    <FeatureIcon color={isDark ? '#FFFFFF' : '#3B5AFE'} name={isRecordingAudio ? 'square.fill' : (isPreviewPlaying ? 'pause.fill' : 'play.fill')} size={14} />
                  )}
                </Pressable>
                <AudioWaveformBar containerHeight={28} isPlaying={isPreviewPlaying} isRecording={isRecordingAudio} levels={recordingLevels} playProgress={previewProgress} />
                <View style={[styles.voiceTime, isDark && styles.voiceControlDark]}>
                  <Text style={{ color: isDark ? '#FFFFFF' : '#3B5AFE', fontSize: 12, fontWeight: '700' }}>
                    {formatAudioDuration(isRecordingAudio ? recordingSeconds : (recordedAudio?.duration || recordingSeconds))}
                  </Text>
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="ส่งข้อความเสียง" disabled={uploadingMedia || Boolean(recordedAudio?.stopping)} onPress={sendRecording} style={[styles.voiceCircle, (uploadingMedia || recordedAudio?.stopping) && styles.sendDisabled]}>
                {uploadingMedia ? <ActivityIndicator color="#FFFFFF" size={14} /> : <FeatureIcon color="#FFFFFF" name="paperplane.fill" size={16} />}
              </Pressable>
            </View>
          ) : (
            <View style={[styles.capsule, { backgroundColor: colors.card, borderColor: colors.line }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="เปิดกล้อง" disabled={!canSend || busy || uploadingMedia} onPress={() => { setGifOpen(false); setMusicOpen(false); setMediaPickerOpen(false); setCameraOpen(true); }} style={styles.capsuleIcon}>
                <FeatureIcon name="camera.fill" size={22} color={canSend ? colors.ink : colors.inkSoft} />
              </Pressable>
              <TextInput
                accessibilityLabel="พิมพ์ข้อความ"
                editable={canSend && !busy && !uploadingMedia}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={1000}
                multiline
                onChangeText={setDraft}
                placeholder={canSend ? 'ส่งข้อความ...' : 'กำลังเตรียมกุญแจแชต'}
                placeholderTextColor={colors.inkSoft}
                style={[styles.capsuleInput, { color: colors.ink }]}
                value={draft}
              />
              {draft.trim() ? (
                <Pressable accessibilityRole="button" accessibilityLabel="ส่งข้อความ" disabled={!canSend || busy} onPress={sendText} style={[styles.sendButton, (!canSend || busy) && styles.sendDisabled]}>
                  <FeatureIcon name="paperplane.fill" size={16} color="#FFFFFF" />
                </Pressable>
              ) : (
                <View style={styles.capsuleActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel="ส่งรูปภาพ" disabled={!canSend || busy || uploadingMedia} onPress={() => { setGifOpen(false); setMusicOpen(false); setMediaPickerOpen((open) => !open); }} style={styles.capsuleIcon}>
                    <FeatureIcon name="photo" size={22} color={mediaPickerOpen ? colors.primary : (canSend ? colors.ink : colors.inkSoft)} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="อัดเสียง" disabled={!canSend || busy || uploadingMedia} onPress={startRecording} style={styles.capsuleIcon}>
                    <FeatureIcon name="mic" size={22} color={canSend ? colors.ink : colors.inkSoft} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="ส่ง GIF" disabled={!canSend || busy} onPress={() => { setMusicOpen(false); setMediaPickerOpen(false); setGifOpen((open) => !open); }} style={styles.capsuleIcon}>
                    <View style={[styles.gifBadge, { borderColor: gifOpen ? colors.primary : colors.ink }]}>
                      <Text style={[styles.gifBadgeText, { color: gifOpen ? colors.primary : colors.ink }]}>GIF</Text>
                    </View>
                  </Pressable>
                  {canUseSpotify ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="ส่งเพลง" disabled={!canSend || busy} onPress={() => { setGifOpen(false); setMediaPickerOpen(false); setMusicOpen(true); }} style={styles.capsuleIcon}>
                      <FeatureIcon name="music.note" size={22} color={musicOpen ? colors.primary : colors.ink} />
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>
          )}
        </View>
        {gifOpen ? (
          <ChatGiphyPickerSheet colors={colors} isDark={isDark} isOpen={gifOpen} onClose={() => setGifOpen(false)} onSelectGif={sendGif} onSelectEmoji={(emoji) => setDraft((value) => `${value || ''}${emoji}`)} />
        ) : null}
        {musicOpen ? (
          <SpotifyTrackSearchSheet colors={colors} onClose={() => setMusicOpen(false)} onSelect={sendTrack} subtitle="แตะเพื่อส่งเพลงในแชตกลุ่ม" title="ส่งเพลง" visible />
        ) : null}
        {mediaPickerOpen ? <View style={{ height: MEDIA_PICKER_COLLAPSED_HEIGHT + (insets.bottom || 0) }} /> : null}
      </KeyboardAvoidingView>
      {cameraOpen ? (
        <ChatCameraModal
          recipientAvatar={chat?.avatarUri}
          recipientName={chat?.title}
          onClose={() => setCameraOpen(false)}
          onCapture={(asset) => {
            setCameraOpen(false);
            if (asset?.type === 'video') {
              setError('แชตกลุ่มส่งรูปภาพจากกล้องและคลังรูป');
              return;
            }
            stagePhotos(asset?.uris || asset?.uri);
          }}
        />
      ) : null}
      {mediaDraft ? (
        <ChatMediaComposer
          asset={mediaDraft}
          recipientAvatar={chat?.avatarUri}
          recipientName={chat?.title}
          onClose={() => setMediaDraft(null)}
          onSend={(asset, mode) => {
            if (asset?.type === 'video') {
              setError('แชตกลุ่มส่งรูปภาพจากกล้องและคลังรูป');
              return undefined;
            }
            return sendPhotos(asset?.uris || asset?.uri, asset?.caption, mode);
          }}
        />
      ) : null}
      {mediaPickerOpen ? (
        <ChatMediaPickerSheet
          overlay
          colors={{ ...colors, bg: colors.canvas }}
          isOpen={mediaPickerOpen}
          onClose={() => setMediaPickerOpen(false)}
          onOpenEditor={(uri, uris) => stagePhotos(uris?.length ? uris : [uri], { edit: true })}
          onSelectCamera={() => { setMediaPickerOpen(false); setCameraOpen(true); }}
          onSelectLibrary={async () => {
            try {
              const picked = await pickChatImages();
              if (picked?.length) stagePhotos(picked.map((item) => item.uri));
            } catch (reason) {
              setError(reason?.message || 'ไม่สามารถเปิดคลังภาพได้');
            }
          }}
          onSelectMedia={(selected) => {
            const list = (Array.isArray(selected) ? selected : [selected]).filter((item) => item?.uri);
            if (!list.length) return;
            if (list.some((item) => item.type === 'video' || item.mediaType === 'video')) {
              setError('แชตกลุ่มส่งรูปภาพจากกล้องและคลังรูป');
              setMediaPickerOpen(false);
              return;
            }
            stagePhotos(list.map((item) => item.uri));
          }}
        />
      ) : null}
      <Modal transparent visible={profileOpen} animationType="fade" onRequestClose={() => !savingProfile && setProfileOpen(false)}>
        <View style={styles.modalBackdrop}>
          <NativeCard style={[styles.membersPanel, { backgroundColor: glass ? 'transparent' : colors.card }]}>
            <GlassBackground style={{ borderRadius: radius.xl }} tintColor={glassTint} />
            <Text style={[styles.membersTitle, { color: colors.ink }]}>ชื่อและรูปกลุ่ม</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="เลือกรูปกลุ่ม" disabled={savingProfile} onPress={pickGroupPhoto} style={styles.photoPicker}>
              <IosLikeAvatar cacheScope={`group-draft:${partyId}`} color={colors.primarySoft} icon="person.3.fill" size={88} uri={draftUri || null} />
              <View style={[styles.photoBadge, { backgroundColor: colors.primary }]}>
                <FeatureIcon name="camera.fill" size={14} color="#FFFFFF" />
              </View>
            </Pressable>
            <TextInput
              accessibilityLabel="ชื่อกลุ่ม"
              maxLength={80}
              onChangeText={setDraftTitle}
              placeholder="ชื่อกลุ่ม"
              placeholderTextColor={colors.inkSoft}
              style={[styles.nameInput, { borderColor: colors.line, color: colors.ink }]}
              value={draftTitle}
            />
            {draftUri ? <Pressable accessibilityRole="button" disabled={savingProfile} onPress={() => setDraftUri('')}><Text style={{ color: colors.inkMuted }}>เอารูปออก</Text></Pressable> : null}
            <View style={styles.profileActions}>
              <Pressable accessibilityRole="button" disabled={savingProfile} onPress={() => setProfileOpen(false)} style={[styles.membersClose, { backgroundColor: colors.primarySoft, flex: 1 }]}>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>ยกเลิก</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={savingProfile || !draftTitle.trim()} onPress={saveProfile} style={[styles.membersClose, styles.saveButton, (!draftTitle.trim() || savingProfile) && styles.sendDisabled]}>
                {savingProfile ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>บันทึก</Text>}
              </Pressable>
            </View>
          </NativeCard>
        </View>
      </Modal>
      <Modal transparent visible={membersOpen} animationType="fade" onRequestClose={() => setMembersOpen(false)}>
        <View style={styles.modalBackdrop}>
          <NativeCard style={[styles.membersPanel, { backgroundColor: glass ? 'transparent' : colors.card }]}>
            <GlassBackground style={{ borderRadius: radius.xl }} tintColor={glassTint} />
            <Text style={[styles.membersTitle, { color: colors.ink }]}>สมาชิกในตี้</Text>
            <ScrollView>
              {(chat?.memberIds || []).map((id) => <View key={id} style={[styles.memberRow, { borderBottomColor: colors.line }]}>
                <IosLikeAvatar cacheScope={id} color={colors.primarySoft} icon="person.fill" size={36} uri={memberAvatars[id] || null} />
                <Text style={[styles.memberName, { color: colors.ink }]}>{memberNames[id] || 'สมาชิกในตี้'}{id === chat?.hostId ? ' · เจ้าของตี้' : ''}</Text>
              </View>)}
            </ScrollView>
            {!isHost ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setMembersOpen(false); leave(); }} style={[styles.membersClose, { backgroundColor: colors.dangerSoft || 'rgba(255,59,48,0.12)' }]}>
              <Text style={{ color: colors.danger, fontWeight: '800' }}>ออกจากตี้</Text>
            </Pressable> : null}
            <Pressable accessibilityRole="button" onPress={() => setMembersOpen(false)} style={[styles.membersClose, { backgroundColor: colors.primarySoft }]}>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>ปิด</Text>
            </Pressable>
          </NativeCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  headerButton: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  headerIdentity: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: type.headline, fontWeight: '700' },
  headerSub: { fontSize: type.caption, marginTop: 1 },
  banner: { padding: 12, flexDirection: 'row', gap: 9, alignItems: 'center' },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 17 },
  error: { fontSize: 12, paddingHorizontal: 15, paddingVertical: 7 },
  messages: { padding: spacing.md, flexGrow: 1, gap: 10 },
  moreHistory: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, maxWidth: '100%' },
  messageRowMine: { justifyContent: 'flex-end' },
  bubble: { borderRadius: 16, maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 7 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  sender: { fontSize: 11, fontWeight: '800', marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 20 },
  time: { fontSize: 11, marginTop: 4 },
  retry: { color: '#FFFFFF', fontWeight: '800', marginTop: 4 },
  image: { width: 220, height: 220, borderRadius: radius.md },
  empty: { alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 160, gap: 10 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  capsule: { alignItems: 'flex-end', borderRadius: 24, borderWidth: 1, flexDirection: 'row', minHeight: 46, paddingLeft: 4, paddingRight: 5, paddingVertical: 4 },
  capsuleIcon: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  capsuleInput: { flex: 1, fontSize: 15, marginHorizontal: 4, maxHeight: 120, minHeight: 36, paddingHorizontal: 6, paddingVertical: Platform.OS === 'android' ? 6 : 8 },
  capsuleActions: { alignItems: 'center', flexDirection: 'row' },
  gifBadge: { alignItems: 'center', borderRadius: 6, borderWidth: 1.5, height: 20, justifyContent: 'center', paddingHorizontal: 4 },
  gifBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  gif: { borderRadius: 12, height: 160, width: 200 },
  trackBubble: { backgroundColor: 'transparent', borderWidth: 0, maxWidth: 220, paddingHorizontal: 0, paddingVertical: 0 },
  voiceBar: { alignItems: 'center', flexDirection: 'row', gap: 8, width: '100%' },
  voiceCircle: { alignItems: 'center', backgroundColor: '#3B5AFE', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  voiceWave: { alignItems: 'center', backgroundColor: '#3B5AFE', borderRadius: 22, flex: 1, flexDirection: 'row', gap: 6, height: 44, paddingHorizontal: 8 },
  voiceControl: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  voiceControlDark: { backgroundColor: 'rgba(255,255,255,0.22)' },
  voiceTime: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, minWidth: 44, paddingHorizontal: 8, paddingVertical: 4 },
  sendButton: { alignItems: 'center', backgroundColor: '#3B5AFE', borderRadius: 18, height: 36, justifyContent: 'center', width: 46 },
  sendDisabled: { opacity: 0.4 },
  photoPicker: { alignSelf: 'center', marginBottom: 16, position: 'relative' },
  photoBadge: { alignItems: 'center', borderRadius: 14, bottom: 0, height: 28, justifyContent: 'center', position: 'absolute', right: 0, width: 28 },
  nameInput: { borderRadius: radius.lg, borderWidth: 1, fontSize: 16, marginBottom: 10, minHeight: 46, paddingHorizontal: 14 },
  profileActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  saveButton: { backgroundColor: '#3B5AFE', flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 25 },
  membersPanel: { borderRadius: radius.xl, padding: 17, maxHeight: '70%' },
  membersTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  memberName: { flex: 1, fontSize: 14 },
  membersClose: { marginTop: 12, borderRadius: radius.lg, alignItems: 'center', padding: 11 },
});
