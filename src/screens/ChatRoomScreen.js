import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import { randomUUID } from 'expo-crypto';
import { stageVideoUpgrade, cancelVideoUpgrade, resumeVideoUpgrades } from '../services/videoUpgradeService';
import { exportChatVideo, discardVideoExport } from '../services/videoProcessingService';
import ChatVideoBubble from '../components/ChatVideoBubble';
import ChatVideoComposer from '../components/ChatVideoComposer';
import ChatCameraModal from '../components/ChatCameraModal';
import ChatMediaComposer from '../components/ChatMediaComposer';
import ChatProtectedImageBubble from '../components/ChatProtectedImageBubble';
import { pickChatVideo } from '../services/chatVideoService';
import { isProtectedMedia, validateChatVideo } from '../utils/chatVideoPolicy';
import { usePeerMediaView } from '../hooks/usePeerMediaView';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { useCall } from '../context/CallContext';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';
import ReplyPreview from '../components/ReplyPreview';
import MessageTimeSwipeArea from '../components/MessageTimeSwipeArea';
import { createReplySnapshot, resolveMessageReply } from '../utils/messageReply';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Animated, AppState, Easing, FlatList, Image, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { project, rubberband } from '../utils/motion';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { decryptConversationMessageList, mergeProfileRecords, toSafePublicProfile } from '../services/firestoreService';
import { secureDiscoveryConfigured, subscribeSecureProfile } from '../services/secureDiscoveryService';
import { setActiveConversation } from '../services/notificationService';
import {
  ensureConversationEncryption,
  getConversationKey,
  getOrCreateEncryptionIdentity,
  hasCurrentDeviceEnvelope,
  isValidConversationEncryption,
  getOrFetchConversationKey,
  peekCachedConversationKey,
} from '../services/chatEncryptionService';
import { useAppActions, useAppConversations, useAppFeed, useAppProfile } from '../context/AppContext';
import { useRemoteImage } from '../utils/useRemoteImage';
import { getMessageReactionSummary, recordReactionUsage, useDefaultMessageReaction, useQuickReactions } from '../utils/messageReactions';
import { radius, spacing, type, useTheme } from '../theme';
import FeatureIcon from '../components/FeatureIcon';
import { formatReadableDate } from '../utils/formatters';
import { canCancelMeetup, isMeetupExpired } from '../utils/meetupTime';
import InstagramMessageOverlay from '../components/InstagramMessageOverlay';
import ReactionDetailsModal from '../components/ReactionDetailsModal';
import VoiceMessageBubble from '../components/VoiceMessageBubble';
import CallMessageBubble from '../components/CallMessageBubble';
import DecryptedChatImage from '../components/DecryptedChatImage';
import StackedImageCards from '../components/StackedImageCards';
import AudioWaveformBar from '../components/AudioWaveformBar';
import ChatMediaPickerSheet, { MEDIA_PICKER_COLLAPSED_HEIGHT } from '../components/ChatMediaPickerSheet';
import ChatGiphyPickerSheet from '../components/ChatGiphyPickerSheet';
import SpotifyTrackSearchSheet from '../components/SpotifyTrackSearchSheet';
import TrackPreviewButton from '../components/TrackPreviewButton';
import ChatImageViewerModal from '../components/ChatImageViewerModal';
import ChatImageEditorModal from '../components/ChatImageEditorModal';
import { Image as ExpoImage } from 'expo-image';
import ReportModal from '../components/ReportModal';
import {
  extractFirstImageUrl,
  getPastedImageFromClipboard,
  checkClipboardForImage,
} from '../utils/chatImageUtils';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  cancelAudioRecording,
  formatAudioDuration,
  getRecordingStatus,
  meteringToLevel,
  pickChatImage,
  pickChatImages,
  startAudioRecording,
  stopAudioRecording,
  takeChatPhoto,
  uploadChatMedia,
  preCacheDecryptedMedia,
  getDecryptedMediaUri,
} from '../services/chatMediaService';
import { prefetchBrowseMusicTracks } from '../services/spotifyService';
import { getFlatListPerformanceConfig } from '../utils/deviceTier';
import { showAlert } from '../utils/appAlert';

const DOUBLE_TAP_WINDOW_MS = 320;
const MESSAGE_TIME_REVEAL_THRESHOLD = 28;
const MESSAGE_TIME_REVEAL_DURATION_MS = 1800;
const POPULAR_CHAT_EMOJIS = ['😊', '😂', '🥰', '👍', '❤️', '🔥', '🎉', '🥺', '✨', '🙏', '😍', '🤣', '😎', '🙌', '💯', '🥳', '😉', '👋', '😭', '💖'];

function toDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return isNaN(timestamp.getTime()) ? null : timestamp;
  if (typeof timestamp === 'number') {
    const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof timestamp.toDate === 'function') {
    try {
      const d = timestamp.toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof timestamp.seconds === 'number') {
    const d = new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds ? timestamp.nanoseconds / 1e6 : 0));
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof timestamp._seconds === 'number') {
    const d = new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds ? timestamp._nanoseconds / 1e6 : 0));
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!isNaN(parsed)) {
      return new Date(parsed);
    }
    const timeMatch = timestamp.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const d = new Date();
      d.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
      return d;
    }
  }
  return null;
}

function messageTimestamp(message) {
  return message.createdAt || message.time;
}

function preferCachedDecryption(messages, cachedMessages) {
  if (!Array.isArray(cachedMessages) || cachedMessages.length === 0) return messages;
  const cachedById = new Map();
  cachedMessages.forEach((message) => {
    if (message?.id) cachedById.set(message.id, message);
  });
  return messages.map((message) => {
    if (!message?.id || !message.decryptionFailed) return message;
    const cached = cachedById.get(message.id);
    if (!cached || cached.decryptionFailed || !cached.text) return message;
    return {
      ...message,
      text: cached.text,
      mediaUrl: cached.mediaUrl || message.mediaUrl,
      mediaUrls: cached.mediaUrls || message.mediaUrls,
      mediaType: cached.mediaType || message.mediaType,
      audioDuration: cached.audioDuration ?? message.audioDuration,
      decryptionFailed: false,
    };
  });
}

function format24Time(timestamp) {
  const date = toDate(timestamp);
  if (!date || isNaN(date.getTime())) return '';
  // Thailand is UTC+7 with no daylight saving time
  const thaiMillis = date.getTime() + 7 * 60 * 60 * 1000;
  const thaiDate = new Date(thaiMillis);
  const hours = String(thaiDate.getUTCHours()).padStart(2, '0');
  const minutes = String(thaiDate.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatRelativeTime(timestamp) {
  const date = toDate(timestamp);
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (isNaN(diffMs)) return '';

  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'สักครู่';
  }
  if (diffMin < 60) {
    return `${diffMin} นาทีที่แล้ว`;
  }
  if (diffHour < 24) {
    return `${diffHour} ชั่วโมงที่แล้ว`;
  }
  if (diffDay === 1) {
    return '1 วันที่แล้ว';
  }
  if (diffDay < 7) {
    return `${diffDay} วันที่แล้ว`;
  }
  if (diffDay < 30) {
    const weeks = Math.floor(diffDay / 7);
    return `${weeks} สัปดาห์ที่แล้ว`;
  }
  const months = Math.floor(diffDay / 30);
  if (months < 12) {
    return `${months || 1} เดือนที่แล้ว`;
  }
  return `${Math.floor(months / 12) || 1} ปีที่แล้ว`;
}

function formatStatusTime(item, mine, isLatest, otherReadAt, otherUnread, mediaViewedAt) {
  const sentDate = toDate(messageTimestamp(item));
  if (!sentDate) return '';
  const sentTime = format24Time(sentDate);

  if (mine && item.sendStatus === 'failed') return 'ส่งไม่สำเร็จ · แตะเพื่อลองใหม่';
  if (mine && isLatest) {
    if (item.sendStatus === 'queued') return 'รอเชื่อมต่อเพื่อส่ง';
    if (item.pendingSync) {
      return 'กำลังส่ง...';
    }
    if (isProtectedMedia(item)) {
      const viewedDate = toDate(mediaViewedAt);
      if (viewedDate) return `เปิดดูแล้วเมื่อ ${format24Time(viewedDate)}`;
      return `ส่งแล้วเมื่อ ${sentTime}`;
    }
    const readDate = toDate(otherReadAt);
    const isReadByOther = Boolean(
      (readDate && sentDate && readDate.getTime() >= sentDate.getTime())
      || (typeof otherUnread === 'number' && otherUnread === 0 && otherReadAt)
    );

    if (isReadByOther) {
      const readTime = readDate ? format24Time(readDate) : sentTime;
      return `อ่านแล้วเมื่อ ${readTime}`;
    }

    return `ส่งแล้วเมื่อ ${sentTime}`;
  }

  return '';
}

export default function ChatRoomScreen() {
  useEffect(() => { prefetchBrowseMusicTracks(); }, []);
  const { showImageModeration } = useToast();
  const { confirm } = useConfirm();
  const { activeCall, canCall, startVoiceCall, startVideoCall, acceptCall } = useCall();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { chatId } = useLocalSearchParams();
  const { allConversations, conversations } = useAppConversations();
  const { acceptedIncomingLikes, availableProfiles, matchedProfileIds, outgoingLikes } = useAppFeed();
  const { profile } = useAppProfile();
  const canUseSpotify = React.useMemo(() => isSpotifyFeatureAllowed(null, profile), [profile]);
  const {
    deleteMessageForMeInChat,
    getMeetupStats,
    markAsRead,
    reactToMessageInChat,
    removeConversation,
    blockUser,
    reportContent,
    sendMessage,
    cacheConversationMessages,
    toggleMeetupAcceptanceInChat,
    unsendMessageInChat,
    updateChatSettingsInChat,
  } = useAppActions();
  const currentUserId = profile?.id;
  const normalizedChatId = Array.isArray(chatId) ? chatId[0] : chatId;
  const chat = useMemo(
    () => conversations.find((conversation) => conversation.id === normalizedChatId)
      || (allConversations || []).find((conversation) => conversation.id === normalizedChatId)
      || null,
    [allConversations, conversations, normalizedChatId]
  );
  const markedReadRef = useRef(null);

  useEffect(() => {
    if (normalizedChatId) {
      setActiveConversation(normalizedChatId);
    }
    return () => {
      setActiveConversation(null);
    };
  }, [normalizedChatId]);

  const activeUnreadCount = chat?.unreadCounts?.[currentUserId] || 0;

  const myChatSettings = chat?.participantSettings?.[currentUserId] || {};
  const showPinnedMeetup = myChatSettings.showPinnedMeetup !== false;
  const isMuted = Boolean(myChatSettings.isMuted);

  const [actionMessage, setActionMessage] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [reactionDetailsMessage, setReactionDetailsMessage] = useState(null);

  const handleShowReactionDetails = useCallback((item) => {
    if (getMessageReactionSummary(item?.reactions).count > 0) setReactionDetailsMessage(item);
  }, []);

  const handleOpenReactionProfile = useCallback((userId) => {
    setReactionDetailsMessage(null);
    if (!userId) return;
    if (userId === currentUserId) {
      router.push('/profile');
      return;
    }
    router.push({
      pathname: '/discover-profile',
      params: { profileId: userId, id: userId, viewOnly: 'true' },
    });
  }, [currentUserId]);

  const reactionProfiles = useMemo(() => {
    const participantProfile = chat?.participantProfiles?.[currentUserId] || {};
    if (!currentUserId || !profile) return chat?.participantProfiles || {};
    return {
      ...(chat?.participantProfiles || {}),
      [currentUserId]: {
        ...participantProfile,
        id: currentUserId,
        name: profile.name || profile.nickname || participantProfile.name,
        nickname: profile.nickname || participantProfile.nickname,
        avatar: profile.avatar ?? participantProfile.avatar,
        avatarColor: profile.avatarColor ?? participantProfile.avatarColor,
        avatarUri: profile.avatarUri ?? participantProfile.avatarUri,
        updatedAt: profile.updatedAt ?? participantProfile.updatedAt,
      },
    };
  }, [chat?.participantProfiles, currentUserId, profile]);

  const handleTogglePinnedMeetup = async (nextValue) => {
    if (!chat?.id) return;
    try {
      await updateChatSettingsInChat(chat.id, { showPinnedMeetup: nextValue });
    } catch (e) {
      console.error('Update chat settings error:', e);
    }
  };

  const handleToggleMute = async (nextValue) => {
    if (!chat?.id) return;
    try {
      await updateChatSettingsInChat(chat.id, { isMuted: nextValue });
    } catch (e) {
      console.error('Update mute setting error:', e);
    }
  };

  const handleSelectMessage = useCallback((item) => {
    setActionMessage(item);
  }, []);

  const handleUnsend = useCallback(async (item) => {
    if (!chat?.id || !item?.id) return;
    setActionMessage(null);
    const ok = await confirm({
      title: 'ยกเลิกการส่ง?',
      body: 'ข้อความนี้จะหายจากห้องสนทนาของทั้งสองฝ่าย',
      confirmLabel: 'ยกเลิกการส่ง',
      icon: 'arrow.uturn.backward.circle',
    });
    if (!ok) return;
    try {
      await unsendMessageInChat(chat.id, item.id);
    } catch (error) {
      console.error('unsend message error:', error);
    }
  }, [chat?.id, confirm, unsendMessageInChat]);

  const defaultQuickReaction = useDefaultMessageReaction();
  const configuredQuickReactions = useQuickReactions();
  const emojiPanelEmojis = useMemo(() => Array.from(new Set([
    ...(configuredQuickReactions || []),
    ...POPULAR_CHAT_EMOJIS,
  ])), [configuredQuickReactions]);

  const handleReact = useCallback(async (item, emoji) => {
    if (!chat?.id || !item?.id || !emoji) return;
    setActionMessage(null);
    void recordReactionUsage(emoji);
    try {
      await reactToMessageInChat(chat.id, item.id, emoji);
    } catch (e) {
      console.error('react message error:', e);
    }
  }, [chat?.id, reactToMessageInChat]);

  const handleQuickReact = useCallback((item) => {
    handleReact(item, defaultQuickReaction);
  }, [handleReact, defaultQuickReaction]);

  const handleReply = useCallback((item) => {
    setActionMessage(null);
    setReplyingTo(item);
    // Do not call focus again when the composer already owns the IME. Calling
    // focus on an already focused TextInput can make Android briefly blink the
    // keyboard while the reply preview is being mounted.
    if (!inputRef.current?.isFocused?.()) {
      setTimeout(() => {
        if (!inputRef.current?.isFocused?.()) inputRef.current?.focus();
      }, 160);
    }
  }, []);

  const handleDeleteForMe = useCallback(async (item) => {
    if (!chat?.id || !item?.id) return;
    setActionMessage(null);
    const ok = await confirm({
      title: 'ลบสำหรับคุณ?',
      body: 'อีกฝ่ายจะยังเห็นข้อความนี้ตามปกติ',
      confirmLabel: 'ลบ',
      icon: 'trash.fill',
    });
    if (!ok) return;
    try {
      await deleteMessageForMeInChat(chat.id, item.id);
    } catch (error) {
      console.error('delete message error:', error);
    }
  }, [chat?.id, confirm, deleteMessageForMeInChat]);

  const [videoDraft, setVideoDraft] = useState(null);
  const handlePickVideo = async () => {
    try { const asset = await pickChatVideo(); if (asset) setMediaComposerDraft({ ...asset, type: 'video' }); }
    catch (error) { showAlert('เลือกวิดีโอไม่สำเร็จ', error.message, { tone: 'danger' }); }
  };
  const handleForward = useCallback(async (item, targetConversationId) => {
    setActionMessage(null);
    if (item?.mediaType === 'video') {
      showAlert('ไม่สามารถส่งต่อวิดีโอ', 'กรุณาเลือกวิดีโอจากเครื่องเพื่อส่งใหม่', { tone: 'danger' });
      return;
    }
    if ((!item?.text && !item?.mediaUrl) || !targetConversationId) return;
    try {
      const forwardOptions = {
        forwarded: true,
        forwardedFrom: { conversationId: chat?.id, messageId: item.id },
      };

      if (item.mediaUrl) {
        const mediaType = item.mediaType || (item.text === '[ข้อความเสียง]' ? 'audio' : 'image');
        forwardOptions.mediaType = mediaType;
        if (typeof item.audioDuration === 'number') {
          forwardOptions.audioDuration = item.audioDuration;
        }

        try {
          const currentKey = await getOrFetchConversationKey(chat?.id, currentUserId).catch(() => null);
          const localUri = await getDecryptedMediaUri(item.mediaUrl, {
            conversationKey: currentKey,
            mediaType,
          });

          if (localUri) {
            const targetKey = await getOrFetchConversationKey(targetConversationId, currentUserId).catch(() => null);
            const newDownloadUrl = await uploadChatMedia(localUri, {
              conversationId: targetConversationId,
              mediaType,
              conversationKey: targetKey,
            });
            forwardOptions.mediaUrl = newDownloadUrl;
            preCacheDecryptedMedia(newDownloadUrl, localUri, { conversationKey: targetKey, mediaType });
          } else {
            forwardOptions.mediaUrl = item.mediaUrl;
          }
        } catch (mediaErr) {
          console.warn('[handleForward] Media forward re-upload error, using original URL:', mediaErr);
          forwardOptions.mediaUrl = item.mediaUrl;
        }
      }

      const messageText = item.text || (item.mediaType === 'audio' ? '[ข้อความเสียง]' : '[รูปภาพ]');
      await sendMessage(targetConversationId, messageText, forwardOptions);
      showAlert('ส่งต่อแล้ว', 'ส่งข้อความไปยังห้องสนทนาที่เลือกเรียบร้อย', { tone: 'success' });
    } catch (error) {
      showAlert('ส่งต่อไม่สำเร็จ', error?.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    }
  }, [chat?.id, currentUserId, sendMessage]);

  useEffect(() => {
    if (!activeUnreadCount || !chat?.id) {
      markedReadRef.current = null;
      return;
    }
    const readKey = `${chat.id}:${activeUnreadCount}`;
    if (markedReadRef.current === readKey) return;
    markedReadRef.current = readKey;
    Promise.resolve(markAsRead(chat.id)).catch(() => {
      if (markedReadRef.current === readKey) markedReadRef.current = null;
    });
  }, [chat?.id, activeUnreadCount, markAsRead]);

  const onBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/chat');
    }
  };

  const flatListPerf = useMemo(() => getFlatListPerformanceConfig(), []);
  const [inputText, setInputText] = useState('');
  const [showQuickEmoji, setShowQuickEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const [previewImages, setPreviewImages] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [editingMedia, setEditingMedia] = useState(null);
  const [editingMediaUris, setEditingMediaUris] = useState([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mediaComposerDraft, setMediaComposerDraft] = useState(null);
  const [clipboardImageDetected, setClipboardImageDetected] = useState(false);

  const checkClipboard = useCallback(async () => {
    try {
      const res = await checkClipboardForImage();
      if (res?.hasImage) {
        setClipboardImageDetected(true);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    checkClipboard();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkClipboard();
      }
    });
    return () => appStateSub.remove();
  }, [checkClipboard]);

  const handlePasteClipboardImage = useCallback(async () => {
    try {
      const uri = await getPastedImageFromClipboard();
      if (uri) {
        setClipboardImageDetected(false);
        setSelectedImage({ uri });
      } else {
        showAlert('คลิปบอร์ด', 'ไม่พบรูปภาพหรือลิงก์รูปภาพที่คัดลอกมา', { tone: 'info' });
      }
    } catch (err) {
      showAlert('ไม่สามารถวางรูปได้', err?.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    }
  }, []);

  const handlePreviewImage = useCallback((url, allUrls) => {
    if (Array.isArray(allUrls) && allUrls.length > 0) {
      setPreviewImages(allUrls);
      const idx = allUrls.indexOf(url);
      const safeIdx = idx >= 0 ? idx : 0;
      setPreviewIndex(safeIdx);
      setPreviewImageUrl(allUrls[safeIdx] || url);
    } else if (url) {
      setPreviewImages([url]);
      setPreviewIndex(0);
      setPreviewImageUrl(url);
    }
  }, []);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isGiphyPickerOpen, setIsGiphyPickerOpen] = useState(false);
  const [isSpotifyPickerOpen, setIsSpotifyPickerOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const recordingTimerRef = useRef(null);
  const recordingMeterIntervalRef = useRef(null);

  const previewPlayer = useAudioPlayer(recordedAudio?.uri ? { uri: recordedAudio.uri } : null);
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const isPreviewPlaying = Boolean(previewStatus?.playing);
  const previewCurrentTime = previewStatus?.currentTime || 0;
  const previewDuration = previewStatus?.duration || recordedAudio?.duration || 0;
  const previewProgress = previewDuration > 0 ? Math.min(Math.max(previewCurrentTime / previewDuration, 0), 1) : 0;

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
      cancelAudioRecording();
    };
  }, []);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [isListAnchored, setIsListAnchored] = useState(false);
  const lastSeenMessageIdRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const bottomAnchoredRef = useRef(false);
  // The first Firestore snapshot replaces the cached conversation. Position
  // that snapshot instantly; only later messages should use an animated jump.
  const initialMessagesReadyRef = useRef(false);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const otherUserId = chat?.profileId || chat?.participants?.find((participantId) => participantId !== currentUserId);
  const otherReadAt = chat?.readReceipts?.[otherUserId] || null;
  const isReadByOther = (chat?.unreadCounts?.[otherUserId] || 0) === 0;

  const [directMessages, setDirectMessages] = useState(null);
  const [directMessagesRoomId, setDirectMessagesRoomId] = useState(normalizedChatId);
  const decryptedMessageCacheRef = useRef(new Map());
  const lastCachedMessagesSigRef = useRef('');
  const [olderMessages, setOlderMessages] = useState([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const oldestDocRef = useRef(null);
  const historyClearedAtRef = useRef(chat?.historyClearedAt?.[currentUserId] || null);
  historyClearedAtRef.current = chat?.historyClearedAt?.[currentUserId] || null;

  if (directMessagesRoomId !== normalizedChatId) {
    setDirectMessagesRoomId(normalizedChatId);
    setDirectMessages(null);
    decryptedMessageCacheRef.current = new Map();
    lastCachedMessagesSigRef.current = '';
    setOlderMessages([]);
    setIsLoadingOlder(false);
    setHasMoreOlder(false);
    oldestDocRef.current = null;
  }

  const scopedDirectMessages = directMessagesRoomId === normalizedChatId ? directMessages : null;
  const scopedOlderMessages = directMessagesRoomId === normalizedChatId ? olderMessages : [];

  useEffect(() => {
    if (!normalizedChatId) {
      setDirectMessages(null);
      return undefined;
    }

    let isSubscribed = true;
    let unsubscribe = () => {};
    let latestRawDocs = null;
    let key = currentUserId
      ? peekCachedConversationKey(normalizedChatId, currentUserId)
      : null;

    const applyDecrypted = (rawDocs, currentKey) => {
      const previousById = decryptedMessageCacheRef.current;
      const nextById = new Map();
      const decryptedList = rawDocs.map((doc) => {
        const stamp = [
          doc.ciphertext || '',
          doc.nonce || '',
          JSON.stringify(doc.reactions || {}),
          JSON.stringify(doc.hiddenFor || []),
          doc.isDeleted || '',
          doc.unsent || '',
        ].join(':');
        const cached = previousById.get(doc.id);
        if (cached?.stamp === stamp) {
          nextById.set(doc.id, cached);
          return cached.message;
        }
        const decodedList = decryptConversationMessageList(
          normalizedChatId,
          [doc],
          currentKey,
          currentUserId,
          historyClearedAtRef.current
        );
        if (!decodedList.length) return null;
        const decoded = decodedList[0];
        const entry = { stamp, message: decoded };
        nextById.set(doc.id, entry);
        return decoded;
      }).filter(Boolean);
      decryptedMessageCacheRef.current = nextById;
      if (isSubscribed) setDirectMessages(decryptedList);
    };

    try {
      const { db } = requireFirebase();
      const messagesRef = collection(db, 'conversations', normalizedChatId, 'messages');
      const messagesQuery = query(
        messagesRef,
        orderBy('createdAt', 'desc'),
        limit(40)
      );
      unsubscribe = onSnapshot(
        messagesQuery,
        (snapshot) => {
          try {
            if (snapshot.docs.length >= 40) {
              setHasMoreOlder(true);
              oldestDocRef.current = snapshot.docs[snapshot.docs.length - 1];
            } else {
              setHasMoreOlder(false);
              oldestDocRef.current = snapshot.docs[snapshot.docs.length - 1] || null;
            }
            const rawDocs = snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            })).reverse();
            latestRawDocs = rawDocs;
            applyDecrypted(rawDocs, key);
          } catch (err) {
            console.warn('ChatRoom direct messages decrypt error:', err?.message || err);
          }
        },
        (error) => {
          console.warn('ChatRoom direct messages listener error:', error?.message || error);
        }
      );
    } catch (err) {
      console.warn('ChatRoom direct listener setup failed:', err?.message || err);
    }

    if (currentUserId) {
      getOrFetchConversationKey(normalizedChatId, currentUserId)
        .then((fetchedKey) => {
          if (!isSubscribed || !fetchedKey) return;
          key = fetchedKey;
          if (latestRawDocs) applyDecrypted(latestRawDocs, key);
        })
        .catch(() => {});
    }

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, [normalizedChatId, currentUserId]);

  const loadOlderMessages = useCallback(async () => {
    if (isLoadingOlder || !hasMoreOlder || !oldestDocRef.current || !normalizedChatId) return;
    setIsLoadingOlder(true);
    try {
      const { db } = requireFirebase();
      const olderQuery = query(
        collection(db, 'conversations', normalizedChatId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(oldestDocRef.current),
        limit(30)
      );
      const snap = await getDocs(olderQuery);
      if (!snap.empty) {
        oldestDocRef.current = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < 30) {
          setHasMoreOlder(false);
        }
        const rawDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
        const currentKey = await getOrFetchConversationKey(normalizedChatId, currentUserId).catch(() => null);
        const historyCutoff = chat?.historyClearedAt?.[currentUserId] || null;
        const decrypted = decryptConversationMessageList(
          normalizedChatId,
          rawDocs,
          currentKey,
          currentUserId,
          historyCutoff
        );
        setOlderMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newBatch = decrypted.filter((m) => !existingIds.has(m.id));
          return [...newBatch, ...prev];
        });
      } else {
        setHasMoreOlder(false);
      }
    } catch (err) {
      console.warn('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [chat?.historyClearedAt, currentUserId, hasMoreOlder, isLoadingOlder, normalizedChatId]);

  const [localPendingMediaMessages, setLocalPendingMediaMessages] = useState([]);

  const effectiveMessages = useMemo(() => {
    const cachedMessages = Array.isArray(chat?.messages) ? chat.messages : [];
    const liveMessages = scopedDirectMessages !== null
      ? preferCachedDecryption([...scopedOlderMessages, ...scopedDirectMessages], cachedMessages)
      : cachedMessages;
    const base = liveMessages;
    const baseIds = new Set(base.map((b) => b?.id).filter(Boolean));
    const baseMediaUrls = new Set(base.map((b) => b?.mediaUrl).filter(Boolean));
    const pendingOptimistic = cachedMessages.filter(
      (m) => !baseIds.has(m.id) && !(m.mediaUrl && baseMediaUrls.has(m.mediaUrl)) && (m?.pendingSync || m?.senderId === currentUserId)
    );
    const pendingLocalMedia = localPendingMediaMessages.filter(
      (m) => !baseIds.has(m.id) && !(m.mediaUrl && baseMediaUrls.has(m.mediaUrl))
    );
    const combined = [...base, ...pendingOptimistic, ...pendingLocalMedia];
    const seenIds = new Set();
    const uniqueMessages = [];
    for (const msg of combined) {
      if (msg?.id && !seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        uniqueMessages.push(msg);
      }
    }
    return uniqueMessages.sort(
      (a, b) => (toDate(messageTimestamp(a))?.getTime() || 0) - (toDate(messageTimestamp(b))?.getTime() || 0)
    );
  }, [chat?.messages, currentUserId, localPendingMediaMessages, scopedDirectMessages, scopedOlderMessages]);

  useEffect(() => {
    if (!normalizedChatId || scopedDirectMessages === null || !cacheConversationMessages) return undefined;
    const liveMessages = [...scopedOlderMessages, ...scopedDirectMessages];
    const lastMessage = liveMessages[liveMessages.length - 1];
    const signature = `${normalizedChatId}:${liveMessages.length}:${lastMessage?.id || ''}:${lastMessage?.text || ''}`;
    if (signature === lastCachedMessagesSigRef.current) return undefined;
    const timer = setTimeout(() => {
      lastCachedMessagesSigRef.current = signature;
      cacheConversationMessages(normalizedChatId, liveMessages);
    }, 800);
    return () => clearTimeout(timer);
  }, [cacheConversationMessages, normalizedChatId, scopedDirectMessages, scopedOlderMessages]);

  const latestMessageId = effectiveMessages[effectiveMessages.length - 1]?.id || null;

  const [partnerProfileDirect, setPartnerProfileDirect] = useState(null);
  const [isBannerExpanded, setIsBannerExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAllMessageTimes, setShowAllMessageTimes] = useState(false);
  const allMessageTimesTimerRef = useRef(null);
  const timeDragAnim = useSharedValue(0);
  const handleTextInputChange = useCallback((text) => {
    // Preserve native typing/paste, including image URLs, without clearing the draft.
    setInputText(text);
  }, []);

  const revealAllMessageTimes = useCallback(() => {
    if (allMessageTimesTimerRef.current) {
      clearTimeout(allMessageTimesTimerRef.current);
      allMessageTimesTimerRef.current = null;
    }
    setShowAllMessageTimes(true);
  }, []);

  const hideAllMessageTimes = useCallback(() => {
    if (allMessageTimesTimerRef.current) {
      clearTimeout(allMessageTimesTimerRef.current);
    }
    allMessageTimesTimerRef.current = setTimeout(() => {
      setShowAllMessageTimes(false);
      allMessageTimesTimerRef.current = null;
    }, 400);
  }, []);

  const isMatchActive = useMemo(() => {
    if (!otherUserId) return true;
    if (chat?.id && !chat.isHidden) return true;
    if (matchedProfileIds?.includes(otherUserId)) return true;
    const isIncoming = (acceptedIncomingLikes || []).some((like) => like.id === otherUserId);
    const isOutgoing = (outgoingLikes || []).some((like) => like.id === otherUserId && like.status === 'accepted');
    return isIncoming || isOutgoing;
  }, [acceptedIncomingLikes, chat?.id, chat?.isHidden, matchedProfileIds, otherUserId, outgoingLikes]);

  const handleRemoveConversation = async () => {
    setIsSettingsOpen(false);
    const ok = await confirm({
      title: 'ยกเลิกการจับคู่และลบห้องสนทนา?',
      body: `การจับคู่และห้องสนทนากับ ${chat?.name || 'เพื่อน'} จะถูกนำออกจากรายการของคุณ`,
      confirmLabel: 'ลบห้องสนทนา',
      icon: 'trash.fill',
    });
    if (!ok) return;
    try {
      await removeConversation(chat?.id, otherUserId);
      router.replace('/chat');
    } catch (error) {
      console.error('removeConversation error:', error);
    }
  };

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState({
    reportedUserId: null,
    messageId: null,
    mediaUrl: null,
    messageText: null,
    isMessageReport: false,
  });

  const handleOpenReportUser = useCallback(() => {
    setIsSettingsOpen(false);
    const targetId = otherUserId
      || chat?.profileId
      || chat?.participants?.find((id) => id !== currentUserId)
      || (chat?.id?.startsWith('c-') ? chat.id.replace('c-', '').split('-').find((id) => id !== currentUserId) : null);

    setReportTarget({
      reportedUserId: targetId,
      messageId: null,
      mediaUrl: null,
      messageText: null,
      isMessageReport: false,
    });
    setTimeout(() => {
      setIsReportModalOpen(true);
    }, 120);
  }, [chat?.id, chat?.participants, chat?.profileId, currentUserId, otherUserId]);

  const handleOpenReportMessage = useCallback((item) => {
    setActionMessage(null);
    const targetId = otherUserId
      || item?.senderId
      || chat?.profileId
      || chat?.participants?.find((id) => id !== currentUserId)
      || (chat?.id?.startsWith('c-') ? chat.id.replace('c-', '').split('-').find((id) => id !== currentUserId) : null);

    setReportTarget({
      reportedUserId: targetId,
      messageId: item?.id,
      mediaUrl: item?.mediaUrl || null,
      messageText: item?.text || null,
      isMessageReport: true,
    });
    setTimeout(() => {
      setIsReportModalOpen(true);
    }, 120);
  }, [chat?.id, chat?.participants, chat?.profileId, currentUserId, otherUserId]);

  const handleBlockUserAction = useCallback(async () => {
    setIsSettingsOpen(false);
    const ok = await confirm({
      title: `บล็อก ${chat?.name || 'ผู้ใช้นี้'}?`,
      body: 'คุณจะไม่เห็นข้อความและการจับคู่กับผู้ใช้นี้อีกต่อไป และผู้ใช้นี้จะไม่สามารถส่งข้อความหาคุณได้',
      confirmLabel: 'บล็อกผู้ใช้',
      icon: 'person.fill.xmark',
    });
    if (!ok) return;
    try {
      await blockUser(otherUserId, chat?.id);
      showAlert('บล็อกผู้ใช้เรียบร้อยแล้ว', undefined, { tone: 'success' });
      router.replace('/chat');
    } catch (err) {
      showAlert('บล็อกไม่สำเร็จ', err?.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    }
  }, [blockUser, chat?.id, chat?.name, confirm, otherUserId]);

  const handleSubmitReport = useCallback(async ({ reason, details }) => {
    if (!reportTarget.reportedUserId && !otherUserId) return;
    await reportContent({
      reportedUserId: reportTarget.reportedUserId || otherUserId,
      conversationId: chat?.id,
      messageId: reportTarget.messageId,
      mediaUrl: reportTarget.mediaUrl,
      messageText: reportTarget.messageText,
      reason,
      details,
    });

    if (reportTarget.messageId && chat?.id) {
      deleteMessageForMeInChat(chat.id, reportTarget.messageId);
    }
  }, [chat?.id, deleteMessageForMeInChat, otherUserId, reportContent, reportTarget]);

  // Call-back from a call history bubble. Latest chat/permission are read from a ref so the
  // handler stays stable and the memoized message rows do not re-render on every chat update.
  const callTargetRef = useRef({ chat: null, canCall: false });
  useEffect(() => {
    callTargetRef.current = { chat, canCall };
  });
  const handleCallPress = useCallback((type) => {
    const { chat: target, canCall: allowed } = callTargetRef.current;
    if (!allowed || !target) return;
    if (type === 'video') startVideoCall(target, target.id);
    else startVoiceCall(target, target.id);
  }, [startVideoCall, startVoiceCall]);

  const handleOpenPartnerProfile = useCallback(() => {
    if (otherUserId) {
      router.push({
        pathname: '/discover-profile',
        params: { profileId: otherUserId, id: otherUserId, viewOnly: 'true' },
      });
    }
  }, [otherUserId]);

  useEffect(() => {
    setPartnerProfileDirect(null);
    if (!otherUserId) return;
    if (secureDiscoveryConfigured()) return subscribeSecureProfile(otherUserId, setPartnerProfileDirect,
      (reason) => console.warn('Partner profile lookup failed:', reason?.code || 'unavailable'));
    try {
      const { db } = requireFirebase();
      const unsub = onSnapshot(doc(db, 'profiles', otherUserId), (snap) => {
        if (snap.exists()) {
          setPartnerProfileDirect(toSafePublicProfile(snap.id, snap.data()));
        } else {
          setPartnerProfileDirect(null);
        }
      }, (error) => {
        console.warn('Realtime partner profile lookup error:', error?.message || error);
      });
      return () => unsub();
    } catch (e) {
      console.warn('Realtime partner profile lookup failed:', e);
    }
  }, [otherUserId]);

  const partnerProfile = useMemo(
    () => mergeProfileRecords(
      partnerProfileDirect,
      chat?.participantProfiles?.[otherUserId],
      availableProfiles.find((p) => p.id === otherUserId)
    ),
    [partnerProfileDirect, chat?.participantProfiles, availableProfiles, otherUserId]
  );
  const partnerMeetup = partnerProfile?.meetup
    || partnerProfile?.selectedMeetup
    || chat?.participantProfiles?.[otherUserId]?.meetup
    || chat?.meetup
    || null;

  const targetHostId = partnerProfile?.id || otherUserId;
  const meetupStats = useMemo(
    () => (partnerProfile && partnerMeetup ? getMeetupStats({ ...partnerProfile, meetup: partnerMeetup, id: targetHostId }) : null),
    [partnerProfile, partnerMeetup, targetHostId, getMeetupStats]
  );
  const isAcceptedByMe = Array.isArray(chat?.meetupAcceptedUsers)
    ? chat.meetupAcceptedUsers.includes(currentUserId)
    : false;
  const isMeetupDateExpired = useMemo(
    () => (!isAcceptedByMe && partnerMeetup ? isMeetupExpired(partnerMeetup) : false),
    [isAcceptedByMe, partnerMeetup]
  );
  const cancelCheck = useMemo(
    () => (partnerMeetup ? canCancelMeetup(partnerMeetup) : { allowed: true }),
    [partnerMeetup]
  );

  const handleToggleAcceptMeetup = async () => {
    if (!chat?.id || !otherUserId || !partnerMeetup) return;
    if (!isAcceptedByMe && isMeetupDateExpired) {
      showAlert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้', { tone: 'warning' });
      return;
    }
    if (isAcceptedByMe && !cancelCheck.allowed) {
      showAlert('ไม่สามารถยกเลิกได้', cancelCheck.reason || 'ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน', { tone: 'warning' });
      return;
    }
    try {
      await toggleMeetupAcceptanceInChat(chat.id, targetHostId, partnerMeetup.name || 'จุดนัดพบ', partnerMeetup);
    } catch (e) {
      console.warn('toggle meetup acceptance warning:', e?.message || e);
      showAlert('เกิดข้อผิดพลาด', e?.message || 'ไม่สามารถดำเนินการได้', { tone: 'danger' });
    }
  };

  const scrollToLatest = useCallback((animated = false, force = false) => {
    if (!listRef.current) return;
    const allowAnimated = Boolean(animated && bottomAnchoredRef.current && isListAnchored);
    const run = () => {
      try {
        listRef.current?.scrollToEnd({ animated: allowAnimated });
      } catch (_) {
        try {
          listRef.current?.scrollToOffset({ offset: 999999, animated: allowAnimated });
        } catch (_) {}
      }
      bottomAnchoredRef.current = true;
    };
    run();
    if (force) {
      requestAnimationFrame(run);
    }
  }, [isListAnchored]);

  const handleScroll = useCallback((event) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isScrolledUp = distanceFromBottom > 100;
    isNearBottomRef.current = !isScrolledUp;
    if (!isScrolledUp) {
      setNewMessagesBelow(0);
    }
    setShowScrollBottom(isScrolledUp);

    if (contentOffset.y < 80 && hasMoreOlder && !isLoadingOlder) {
      loadOlderMessages();
    }
  }, [hasMoreOlder, isLoadingOlder, loadOlderMessages]);

  const handleContentSizeChange = useCallback(() => {
    if (!bottomAnchoredRef.current) {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch (_) {
        try {
          listRef.current?.scrollToOffset({ offset: 999999, animated: false });
        } catch (_) {}
      }
      bottomAnchoredRef.current = true;
      setIsListAnchored(true);
      return;
    }
    if (isNearBottomRef.current) {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch (_) {
        try {
          listRef.current?.scrollToOffset({ offset: 999999, animated: false });
        } catch (_) {}
      }
    }
  }, []);

  const handleListLayout = useCallback(() => {
    if (!bottomAnchoredRef.current) {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch (_) {
        try {
          listRef.current?.scrollToOffset({ offset: 999999, animated: false });
        } catch (_) {}
      }
      bottomAnchoredRef.current = true;
      setIsListAnchored(true);
    } else if (isNearBottomRef.current) {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch (_) {
        try {
          listRef.current?.scrollToOffset({ offset: 999999, animated: false });
        } catch (_) {}
      }
    }
  }, []);

  const handleScrollToIndexFailed = useCallback((info) => {
    const wait = new Promise((resolve) => setTimeout(resolve, 80));
    wait.then(() => {
      try {
        listRef.current?.scrollToIndex({
          index: info.index,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (_) {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, info.index * 70),
          animated: true,
        });
      }
    });
  }, []);

  const handleListTouchStart = useCallback(() => {
    setIsMediaPickerOpen((open) => (open ? false : open));
    setIsGiphyPickerOpen((open) => (open ? false : open));
  }, []);

  useEffect(() => {
    Animated.timing(scrollAnim, {
      toValue: showScrollBottom ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showScrollBottom, scrollAnim]);

  useEffect(() => {
    setInputText('');
    setReplyingTo(null);
    setSending(false);
    setShowAllMessageTimes(false);
    setShowScrollBottom(false);
    setNewMessagesBelow(0);
    isNearBottomRef.current = true;
    bottomAnchoredRef.current = false;
    initialMessagesReadyRef.current = false;
    lastSeenMessageIdRef.current = null;
    setIsListAnchored(false);
    if (allMessageTimesTimerRef.current) {
      clearTimeout(allMessageTimesTimerRef.current);
      allMessageTimesTimerRef.current = null;
    }
    scrollToLatest(false, true);

    const safetyTimer = setTimeout(() => {
      if (!bottomAnchoredRef.current) {
        try {
          listRef.current?.scrollToEnd({ animated: false });
        } catch (_) {}
        bottomAnchoredRef.current = true;
      }
      setIsListAnchored(true);
    }, 80);

    return () => clearTimeout(safetyTimer);
  }, [chat?.id, scrollToLatest]);

  useEffect(() => () => {
    if (allMessageTimesTimerRef.current) clearTimeout(allMessageTimesTimerRef.current);
  }, []);

  useEffect(() => {
    if (!latestMessageId) {
      setIsListAnchored(true);
      return;
    }
    if (scopedDirectMessages === null || !initialMessagesReadyRef.current) {
      // The list may first contain cached messages and then be replaced by
      // the initial direct snapshot. Never animate that hydration pass.
      scrollToLatest(false, true);
      lastSeenMessageIdRef.current = latestMessageId;
      if (scopedDirectMessages !== null) {
        initialMessagesReadyRef.current = true;
      }
      return;
    }
    if (lastSeenMessageIdRef.current === latestMessageId) {
      return;
    }
    lastSeenMessageIdRef.current = latestMessageId;

    if (isNearBottomRef.current) {
      // New messages while already viewing the bottom — soft animate is OK.
      scrollToLatest(true, false);
    } else {
      setNewMessagesBelow((prev) => prev + 1);
    }
  }, [latestMessageId, scopedDirectMessages, scrollToLatest]);

  // Scroll to bottom on keyboard show to lift messages with keyboard
  useEffect(() => {
    const onKeyboardShow = () => {
      if (isNearBottomRef.current) {
        scrollToLatest(true, true);
      }
    };

    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      onKeyboardShow
    );
    const showSubAndroid = Platform.OS === 'android'
      ? Keyboard.addListener('keyboardDidShow', onKeyboardShow)
      : null;

    return () => {
      showSub.remove();
      if (showSubAndroid) showSubAndroid.remove();
    };
  }, [scrollToLatest]);

  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const highlightTimerRef = useRef(null);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  const handleScrollToMessage = useCallback((targetId) => {
    if (!targetId) return;
    const index = effectiveMessages.findIndex((m) => m.id === targetId);
    if (index !== -1 && listRef.current) {
      try {
        listRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      } catch (_) {
        listRef.current.scrollToOffset({
          offset: Math.max(0, index * 70),
          animated: true,
        });
      }

      // Re-trigger bounce and highlight even if tapping the same reply repeatedly
      setHighlightedMessageId(null);
      requestAnimationFrame(() => {
        setHighlightedMessageId(targetId);
      });

      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
        highlightTimerRef.current = null;
      }, 2000);
    }
  }, [effectiveMessages]);

  const handlePickImage = useCallback(() => {
    Keyboard.dismiss();
    setIsGiphyPickerOpen(false);
    setIsMediaPickerOpen((prev) => !prev);
  }, []);

  const handleStartRecording = useCallback(async () => {
    Keyboard.dismiss();
    setIsMediaPickerOpen(false);
    setIsGiphyPickerOpen(false);
    try {
      if (recordedAudio) {
        setRecordedAudio(null);
      }
      setRecordingLevels([]);
      await startAudioRecording();
      setIsRecordingAudio(true);
      setRecordingSeconds(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
      recordingMeterIntervalRef.current = setInterval(() => {
        const status = getRecordingStatus();
        if (status) {
          const level = meteringToLevel(status.metering);
          setRecordingLevels((prev) => {
            const next = [...prev, level];
            return next.length > 30 ? next.slice(-30) : next;
          });
        }
      }, 80);
    } catch (err) {
      showAlert('ไม่สามารถบันทึกเสียงได้', err.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    }
  }, [recordedAudio]);

  const handleStopToPreview = useCallback(async () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    const duration = recordingSeconds;
    const levelsSnapshot = recordingLevels;
    // Set placeholder immediately so voice bar stays visible during async stop
    setIsRecordingAudio(false);
    setRecordedAudio({ uri: null, duration, levels: levelsSnapshot, stopping: true });
    try {
      const res = await stopAudioRecording();
      if (!res?.uri) {
        setRecordedAudio(null);
        setRecordingSeconds(0);
        return;
      }
      const actualDuration = Math.max(duration, Math.round(res.duration || 0));
      if (actualDuration < 1) {
        showAlert('เสียงสั้นเกินไป', 'กรุณาบันทึกเสียงอย่างน้อย 1 วินาที', { tone: 'warning' });
        setRecordedAudio(null);
        setRecordingSeconds(0);
        return;
      }
      setRecordedAudio({
        uri: res.uri,
        duration: actualDuration,
        levels: levelsSnapshot,
      });
    } catch (err) {
      showAlert('ไม่สามารถหยุดการบันทึกได้', err.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
      setRecordedAudio(null);
    }
  }, [recordingLevels, recordingSeconds]);

  const handleTogglePreviewPlay = useCallback(() => {
    if (!previewPlayer) return;
    try {
      if (isPreviewPlaying) {
        previewPlayer.pause();
      } else {
        if (previewProgress >= 0.99) {
          previewPlayer.seekTo(0);
        }
        previewPlayer.play();
      }
    } catch (e) {
      console.warn('Preview play error:', e);
    }
  }, [isPreviewPlaying, previewPlayer, previewProgress]);

  const handleCancelRecording = useCallback(() => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    setIsRecordingAudio(false);
    setRecordedAudio(null);
    setRecordingSeconds(0);
    setRecordingLevels([]);
    if (previewPlayer && isPreviewPlaying) {
      try { previewPlayer.pause(); } catch {}
    }
    cancelAudioRecording();
  }, [previewPlayer, isPreviewPlaying]);

  const handleSendRecording = useCallback(async () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    if (previewPlayer && isPreviewPlaying) {
      try { previewPlayer.pause(); } catch {}
    }

    let audioUri = recordedAudio?.uri;
    let duration = recordedAudio?.duration || recordingSeconds;

    if (isRecordingAudio) {
      setIsRecordingAudio(false);
      const res = await stopAudioRecording();
      if (res?.uri) {
        audioUri = res.uri;
        duration = Math.max(duration, Math.round(res.duration || 0));
      }
    }

    setRecordedAudio(null);
    setRecordingSeconds(0);
    setRecordingLevels([]);

    if (!audioUri || !chat?.id) return;
    if (duration < 1) {
      showAlert('เสียงสั้นเกินไป', 'กรุณาบันทึกเสียงอย่างน้อย 1 วินาที', { tone: 'warning' });
      return;
    }

    const replySnapshot = replyingTo;
    setReplyingTo(null);

    // Optimistic: show voice message in chat immediately with local URI
    const tempId = `temp-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticAudio = {
      id: tempId,
      sender: 'me',
      senderId: currentUserId,
      text: '[ข้อความเสียง]',
      createdAt: Date.now(),
      time: Date.now(),
      mediaType: 'audio',
      mediaUrl: audioUri,
      audioDuration: duration,
      isUploading: true,
      pendingSync: true,
      replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
    };
    setLocalPendingMediaMessages((prev) => [...prev, optimisticAudio]);
    scrollToLatest(true, true);

    try {
      setUploadingMedia(true);
      const conversationKey = await getOrFetchConversationKey(chat.id, currentUserId);
      const downloadUrl = await uploadChatMedia(audioUri, {
        conversationId: chat.id,
        mediaType: 'audio',
        extension: 'm4a',
        conversationKey,
      });
      preCacheDecryptedMedia(downloadUrl, audioUri, { conversationKey, mediaType: 'audio' });
      await sendMessage(chat.id, '[ข้อความเสียง]', {
        mediaType: 'audio',
        mediaUrl: downloadUrl,
        audioDuration: duration,
        clientMessageId: tempId,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      });
      scrollToLatest(true, true);
    } catch (err) {
      showAlert('ส่งข้อความเสียงไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    } finally {
      setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
      setUploadingMedia(false);
    }
  }, [chat?.id, currentUserId, isPreviewPlaying, isRecordingAudio, previewPlayer, recordedAudio, recordingSeconds, replyingTo, scrollToLatest, sendMessage]);

  const handleSendVideo = useCallback(async (asset, mode, caption = '') => {
    if (!chat?.id || !currentUserId) throw new Error('ห้องแชตยังไม่พร้อมส่งวิดีโอ');
    if (!asset.needsExport) validateChatVideo(asset, mode);
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    const messageId = randomUUID();
    const messageText = (caption || '').trim() || '[วิดีโอ]';
    const clipDuration = Number.isFinite(asset.videoEdit?.endMs) && Number.isFinite(asset.videoEdit?.startMs)
      ? Math.max(1, asset.videoEdit.endMs - asset.videoEdit.startMs)
      : asset.duration;
    const optimisticVideo = {
      id: messageId,
      sender: 'me',
      senderId: currentUserId,
      text: messageText,
      createdAt: Date.now(),
      time: Date.now(),
      mediaType: 'video',
      mediaUrl: asset.uri,
      videoMode: mode,
      videoDuration: clipDuration,
      videoStartMs: asset.videoEdit?.startMs,
      videoEndMs: asset.videoEdit?.endMs,
      isUploading: true,
      pendingSync: true,
      replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
    };
    setLocalPendingMediaMessages((prev) => [...prev, optimisticVideo]);
    scrollToLatest(true, true);

    let exported;
    try {
      const conversationKeyPromise = getOrFetchConversationKey(chat.id, currentUserId);
      let uploadAsset = asset;
      if (asset.needsExport && asset.videoEdit) {
        exported = await exportChatVideo({ ...asset, duration: asset.duration }, asset.videoEdit, 'medium');
        uploadAsset = { ...asset, ...exported };
      }
      validateChatVideo(uploadAsset, mode);
      const conversationKey = await conversationKeyPromise;
      const mediaUrl = await uploadChatMedia(uploadAsset.uri, {
        conversationId: chat.id, mediaType: 'video', extension: 'mp4', conversationKey, videoDuration: uploadAsset.duration,
      });
      const sent = await sendMessage(chat.id, messageText, {
        clientMessageId: messageId,
        mediaType: 'video',
        mediaUrl,
        videoMode: mode,
        videoDuration: uploadAsset.duration,
        videoStartMs: 0,
        videoEndMs: uploadAsset.duration,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      });
      if (!sent) throw new Error('ไม่สามารถส่งวิดีโอได้');
      if (asset.upgradeSource) {
        void stageVideoUpgrade({
          userId: currentUserId,
          conversationId: chat.id,
          messageId,
          asset: asset.upgradeSource,
          edit: asset.videoEdit,
          mode,
        }).then(() => resumeVideoUpgrades(currentUserId)).catch((upgradeError) => {
          console.warn('[VideoUpgrade] Unable to stage clearer rendition:', upgradeError?.message || upgradeError);
        });
      }
    } catch (error) {
      await cancelVideoUpgrade(currentUserId, messageId);
      throw error;
    } finally {
      await discardVideoExport(exported);
      setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
  }, [chat?.id, currentUserId, replyingTo, scrollToLatest, sendMessage]);

  const handleSendImage = useCallback(async (imageUri, captionText, viewMode = 'chat') => {
    const uris = Array.isArray(imageUri) ? imageUri.filter(Boolean) : (imageUri ? [imageUri] : []);
    if (!uris.length || !chat?.id) return;
    setSelectedImage(null);
    setInputText('');
    setIsMediaPickerOpen(false);
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    const safeCaption = (captionText || '').trim();
    const stamp = Date.now();
    const pending = uris.map((uri, index) => ({
      id: `temp-img-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      uri,
      caption: index === 0 ? safeCaption : '',
    }));
    const pendingIds = new Set(pending.map((item) => item.id));

    setLocalPendingMediaMessages((prev) => [
      ...prev,
      ...pending.map((item, index) => ({
        id: item.id,
        sender: 'me',
        senderId: currentUserId,
        text: item.caption || '[รูปภาพ]',
        createdAt: stamp + index,
        time: stamp + index,
        mediaType: 'image',
        mediaUrl: item.uri,
        viewMode,
        isUploading: true,
        pendingSync: true,
        replyTo: index === 0 && replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      })),
    ]);
    scrollToLatest(true, true);

    let sentCount = 0;
    try {
      const conversationKey = await getOrFetchConversationKey(chat.id, currentUserId);
      const uploadResults = new Array(pending.length);
      let nextUploadIndex = 0;
      let uploadFailed = false;
      const startNextUpload = () => {
        if (uploadFailed || nextUploadIndex >= pending.length) return;
        const index = nextUploadIndex++;
        uploadResults[index] = uploadChatMedia(pending[index].uri, {
          conversationId: chat.id,
          mediaType: 'image',
          extension: 'jpg',
          conversationKey,
        }).then(
          (downloadUrl) => ({ ok: true, downloadUrl }),
          (error) => {
            uploadFailed = true;
            return { ok: false, error };
          }
        );
      };
      startNextUpload();
      startNextUpload();
      for (let index = 0; index < pending.length; index += 1) {
        const item = pending[index];
        const uploadResult = await uploadResults[index];
        if (!uploadResult.ok) throw uploadResult.error;
        const { downloadUrl } = uploadResult;
        preCacheDecryptedMedia(downloadUrl, item.uri, { conversationKey });
        await sendMessage(chat.id, item.caption || '[รูปภาพ]', {
          mediaType: 'image',
          viewMode,
          mediaUrl: downloadUrl,
          clientMessageId: item.id,
          replyTo: index === 0 && replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
        });
        sentCount += 1;
        setLocalPendingMediaMessages((prev) => prev.filter((message) => message.id !== item.id));
        startNextUpload();
      }
      scrollToLatest(true, true);
    } catch (err) {
      if (err.isModerationViolation || err.isModerationUnavailable) {
        showImageModeration(err);
        if (sentCount === 0) {
          setSelectedImage({ uri: uris[0], uris });
          setInputText(safeCaption);
          setReplyingTo(replySnapshot);
        }
      } else {
        showAlert('ส่งรูปภาพไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
      }
    } finally {
      setLocalPendingMediaMessages((prev) => prev.filter((message) => !pendingIds.has(message.id)));
    }
  }, [chat?.id, currentUserId, replyingTo, scrollToLatest, sendMessage, showImageModeration]);

  const handleSendGif = useCallback(
    async (gif) => {
      if (!gif?.url || !chat?.id) return;
      setIsGiphyPickerOpen(false);
      const replySnapshot = replyingTo;
      setReplyingTo(null);

      const tempId = `temp-gif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticMessage = {
        id: tempId,
        sender: 'me',
        senderId: currentUserId,
        text: '[GIF]',
        createdAt: Date.now(),
        time: Date.now(),
        mediaType: 'image',
        mediaUrl: gif.url,
        pendingSync: true,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      };

      setLocalPendingMediaMessages((prev) => [...prev, optimisticMessage]);
      scrollToLatest(true, true);

      try {
        await sendMessage(chat.id, '[GIF]', {
          mediaType: 'image',
          mediaUrl: gif.url,
          clientMessageId: tempId,
          replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
        });
        scrollToLatest(true, true);
      } catch (err) {
        showAlert('ส่ง GIF ไม่สำเร็จ', err?.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
      } finally {
        setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    },
    [chat?.id, currentUserId, replyingTo, scrollToLatest, sendMessage]
  );

  const handleSendTrack = useCallback(
    async (track) => {
      if (!track?.id || !chat?.id) return;
      setIsSpotifyPickerOpen(false);
      const replySnapshot = replyingTo;
      setReplyingTo(null);

      const trackName = String(track.name || 'Spotify').slice(0, 200);
      const plaintext = `🎵 ${trackName}`.slice(0, 1000);
      const tempId = `temp-track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const trackFields = {
        mediaType: 'track',
        trackId: String(track.id).slice(0, 64),
        trackName,
        artists: String(track.artists || '').slice(0, 200),
        albumArt: typeof track.albumArt === 'string' ? track.albumArt.slice(0, 2000) : '',
        ...(typeof track.previewUrl === 'string' && track.previewUrl
          ? { previewUrl: track.previewUrl.slice(0, 2000) }
          : {}),
        externalUrl: typeof track.externalUrl === 'string' && track.externalUrl
          ? track.externalUrl.slice(0, 500)
          : `https://open.spotify.com/track/${track.id}`,
        ...(Number.isFinite(Number(track.previewStartMs))
          ? { previewStartMs: Math.max(0, Math.round(Number(track.previewStartMs))) }
          : {}),
        ...(Number.isFinite(Number(track.previewEndMs))
          ? { previewEndMs: Math.max(0, Math.round(Number(track.previewEndMs))) }
          : {}),
      };
      const optimisticMessage = {
        id: tempId,
        sender: 'me',
        senderId: currentUserId,
        text: plaintext,
        createdAt: Date.now(),
        time: Date.now(),
        ...trackFields,
        pendingSync: true,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      };

      setLocalPendingMediaMessages((prev) => [...prev, optimisticMessage]);
      scrollToLatest(true, true);

      try {
        await sendMessage(chat.id, plaintext, {
          ...trackFields,
          clientMessageId: tempId,
          replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
        });
        scrollToLatest(true, true);
      } catch (err) {
        showAlert('ส่งเพลงไม่สำเร็จ', err?.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
      } finally {
        setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    },
    [chat?.id, currentUserId, replyingTo, scrollToLatest, sendMessage]
  );

  const handleOpenCamera = useCallback(async () => {
    Keyboard.dismiss();
    setIsMediaPickerOpen(false);
    setIsGiphyPickerOpen(false);
    setIsSpotifyPickerOpen(false);
    setCameraOpen(true);
  }, []);

  const handleSend = async () => {
    if (selectedImage?.uri) {
      await handleSendImage(selectedImage.uris || selectedImage.uri, inputText);
      return;
    }
    const trimmed = inputText.trim();
    if (!trimmed || sending || uploadingMedia || !chat?.id || !isMatchActive) return;

    isNearBottomRef.current = true;
    setShowScrollBottom(false);
    setNewMessagesBelow(0);
    setSending(true);
    setInputText('');
    setShowQuickEmoji(false);
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    scrollToLatest(true, true);
    try {
      await sendMessage(chat.id, trimmed, replySnapshot ? {
        replyTo: createReplySnapshot(replySnapshot),
      } : {});
      scrollToLatest(true, true);
    } catch (error) {
      setInputText(trimmed);
      setReplyingTo(replySnapshot);
      if (error?.code === 'E2EE_KEY_MISSING' || error?.code === 'E2EE_KEY_UNAVAILABLE') {
        showAlert('ยังส่งไม่สำเร็จ', error.message || 'กำลังเชื่อมกุญแจเข้ารหัส ลองส่งอีกครั้งได้เลย', { tone: 'warning' });
      }
    } finally {
      setSending(false);
    }
  };

  const replyMessagesById = useMemo(() => new Map(effectiveMessages.map(message => [message.id, message])), [effectiveMessages]);
  const renderMessage = useCallback(({ item, index }) => {
    item = resolveMessageReply(item, replyMessagesById);
    const previousMessage = effectiveMessages[index - 1];
    const currentMessageDate = toDate(messageTimestamp(item));
    const previousMessageDate = previousMessage ? toDate(messageTimestamp(previousMessage)) : null;
    const showDay = index === 0
      || !currentMessageDate
      || !previousMessageDate
      || currentMessageDate.toDateString() !== previousMessageDate.toDateString();

    return (
      <ChatMessageItem
        chat={chat}
        currentUserId={currentUserId}
        colors={colors}
        index={index}
        isActionActive={actionMessage?.id === item.id}
        isHighlighted={highlightedMessageId === item.id}
        isLatest={index === effectiveMessages.length - 1}
        item={item}
        onCallPress={handleCallPress}
        onOpenProfile={handleOpenPartnerProfile}
        onPreviewImage={handlePreviewImage}
        onQuickReact={handleQuickReact}
        onReply={handleReply}
        onScrollToMessage={handleScrollToMessage}
        onShowReactionDetails={handleShowReactionDetails}
        onSelectMessage={handleSelectMessage}
        otherReadAt={otherReadAt}
        otherUnread={chat?.unreadCounts?.[otherUserId]}
        otherUserId={otherUserId}
        showAllMessageTimes={showAllMessageTimes}
        showDay={showDay}
        styles={styles}
        timeDragAnim={timeDragAnim}
      />
    );
  }, [actionMessage?.id, highlightedMessageId, chat, currentUserId, colors, effectiveMessages, replyMessagesById, handleCallPress, handleOpenPartnerProfile, handlePreviewImage, handleQuickReact, handleScrollToMessage, handleSelectMessage, handleShowReactionDetails, otherReadAt, otherUserId, handleReply, showAllMessageTimes, styles, timeDragAnim]);

  if (!chat) {
    return (
      <SafeAreaView style={styles.roomContainer}>
        <View style={styles.roomHeader}>
          <Pressable accessibilityLabel="ย้อนกลับ" onPress={onBack} style={styles.backButton}>
            <FeatureIcon color={colors.ink} name="chevron.left" size={23} />
          </Pressable>
          <Text style={styles.roomName}>ไม่พบห้องสนทนา</Text>
        </View>
        <View style={styles.emptyRoom}>
          <Text style={styles.emptyTitle}>ไม่พบห้องสนทนา</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.roomContainer}>
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <View style={styles.roomHeader}>
          <Pressable accessibilityLabel="ย้อนกลับ" onPress={onBack} style={styles.backButton}>
            <FeatureIcon color={colors.ink} name="chevron.left" size={23} />
          </Pressable>
          <Pressable
            accessibilityLabel={`ดูโปรไฟล์ของ ${chat.name}`}
            accessibilityRole="button"
            onPress={handleOpenPartnerProfile}
            style={({ pressed }) => [styles.headerPartnerPressable, pressed && styles.pressed]}
          >
            <Avatar avatarColor={chat.avatarColor} cacheScope={chat.profileId} cacheVersion={chat.participantProfiles?.[chat.profileId]?.avatarRevision} colors={colors} emoji={chat.avatar} size={44} uri={chat.avatarUri} />
            <View style={styles.roomIdentity}>
              <Text numberOfLines={1} style={styles.roomName}>{chat.name}</Text>
              <Text numberOfLines={1} style={styles.roomSubtitle}>{chat.subtitle || 'เพื่อนใน CampusMate'}</Text>
            </View>
          </Pressable>
          <View style={styles.headerRightActions}>
            {activeCall && activeCall.conversationId === chat?.id && (activeCall.status === 'calling' || activeCall.status === 'ringing') && activeCall.callerId !== currentUserId ? (
              <Pressable
                accessibilityLabel="เข้าร่วมการโทร"
                accessibilityRole="button"
                onPress={() => acceptCall()}
                style={styles.headerJoinCallPill}
              >
                <FeatureIcon color="#FFFFFF" name="phone.fill" size={13} />
                <Text style={styles.headerJoinCallText}>เข้าร่วม</Text>
              </Pressable>
            ) : null}
            {canCall ? (
              <>
                <Pressable
                  accessibilityLabel="โทรด้วยเสียง"
                  accessibilityRole="button"
                  onPress={() => startVoiceCall(chat, chat?.id)}
                  style={({ pressed }) => [styles.headerCallBtn, pressed && styles.pressed]}
                >
                  <FeatureIcon color={colors.ink} name="phone.fill" size={17} />
                </Pressable>
                <Pressable
                  accessibilityLabel="วิดีโอคอล"
                  accessibilityRole="button"
                  onPress={() => startVideoCall(chat, chat?.id)}
                  style={({ pressed }) => [styles.headerCallBtn, pressed && styles.pressed]}
                >
                  <FeatureIcon color={colors.ink} name="video.fill" size={18} />
                </Pressable>
              </>
            ) : null}
            <Pressable
              accessibilityLabel="ตั้งค่าแชต"
              accessibilityRole="button"
              onPress={() => setIsSettingsOpen(true)}
              style={({ pressed }) => [styles.headerMoreBtn, pressed && styles.pressed]}
            >
              <FeatureIcon color={colors.ink} name="ellipsis" size={18} />
            </Pressable>
          </View>
        </View>

        {partnerMeetup && showPinnedMeetup ? (
          <View style={styles.pinnedMeetupContainer}>
            <View style={[styles.chatMeetupCard, !isBannerExpanded && styles.chatMeetupCardCompact]}>
              <View style={styles.chatMeetupHeader}>
                <Pressable
                  onPress={() => setIsBannerExpanded((curr) => !curr)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 }}
                >
                  <View style={styles.chatMeetupIcon}>
                    <FeatureIcon color={colors.primary} name="mappin.and.ellipse" size={14} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.chatMeetupEyebrow}>นัดหมาย</Text>
                      {meetupStats?.isFull ? (
                        <View style={styles.chatMeetupFullBadge}>
                          <Text style={styles.chatMeetupFullText}>เต็ม</Text>
                        </View>
                      ) : (
                        <View style={styles.chatMeetupOpenBadge}>
                          <Text style={styles.chatMeetupOpenText}>{meetupStats ? `${meetupStats.acceptedCount}/${meetupStats.maxPeople} คน` : ''}</Text>
                        </View>
                      )}
                    </View>
                    <Text numberOfLines={1} style={styles.chatMeetupTitle}>{partnerMeetup.name}</Text>
                    {!isBannerExpanded && partnerMeetup.schedule?.date ? (
                      <Text numberOfLines={1} style={styles.chatMeetupCompactTime}>
                        {formatReadableDate(partnerMeetup.schedule.date)}
                        {partnerMeetup.schedule?.startTime && partnerMeetup.schedule?.endTime ? ` · ${partnerMeetup.schedule.startTime}–${partnerMeetup.schedule.endTime} น.` : ''}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable
                    disabled={chat.encryptionPending || (!isAcceptedByMe && (isMeetupDateExpired || meetupStats?.isFull))}
                    onPress={isMeetupDateExpired ? () => showAlert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้', { tone: 'warning' }) : handleToggleAcceptMeetup}
                    style={({ pressed }) => [
                      styles.chatMeetupMiniBtn,
                      isAcceptedByMe && styles.chatMeetupMiniBtnAccepted,
                      !isAcceptedByMe && (isMeetupDateExpired || meetupStats?.isFull) && styles.chatMeetupMiniBtnDisabled,
                      pressed && !isMeetupDateExpired && styles.pressed,
                    ]}
                  >
                    <FeatureIcon
                      color="#FFFFFF"
                      name={isAcceptedByMe ? 'checkmark.circle.fill' : (isMeetupDateExpired ? 'clock.badge.xmark' : (meetupStats?.isFull ? 'xmark.circle' : 'person.badge.plus'))}
                      size={12}
                    />
                    <Text style={styles.chatMeetupMiniBtnText}>
                      {isAcceptedByMe ? 'ตอบรับแล้ว' : (isMeetupDateExpired ? 'เลยกำหนดแล้ว' : (meetupStats?.isFull ? 'เต็ม' : 'ยอมรับ'))}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setIsBannerExpanded((curr) => !curr)}
                    style={styles.expandToggleBtn}
                  >
                    <FeatureIcon
                      color={colors.inkSoft}
                      name={isBannerExpanded ? 'chevron.up' : 'chevron.down'}
                      size={13}
                    />
                  </Pressable>
                </View>
              </View>

              {isBannerExpanded ? (
                <View style={styles.chatMeetupExpandedBody}>
                  <View style={styles.chatMeetupMeta}>
                    {partnerMeetup.schedule?.date ? (
                      <View style={styles.chatMeetupInfoRow}>
                        <FeatureIcon color={colors.inkSoft} name="calendar" size={13} />
                        <Text style={styles.chatMeetupTime}>
                          วันที่: {formatReadableDate(partnerMeetup.schedule.date)}
                        </Text>
                      </View>
                    ) : null}

                    {partnerMeetup.schedule?.startTime && partnerMeetup.schedule?.endTime ? (
                      <View style={styles.chatMeetupInfoRow}>
                        <FeatureIcon color={colors.inkSoft} name="clock" size={13} />
                        <Text style={styles.chatMeetupTime}>
                          เวลา: {partnerMeetup.schedule.startTime} – {partnerMeetup.schedule.endTime} น.
                        </Text>
                      </View>
                    ) : null}

                    {meetupStats ? (
                      <View style={styles.chatMeetupInfoRow}>
                        <FeatureIcon color={colors.inkSoft} name="person.2.fill" size={13} />
                        <Text style={styles.chatMeetupCount}>
                          ผู้เข้าร่วม: {meetupStats.acceptedCount}/{meetupStats.maxPeople} คน
                        </Text>
                      </View>
                    ) : null}

                    {isAcceptedByMe && !cancelCheck.allowed ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <FeatureIcon color={colors.inkSoft} name="lock.fill" size={12} />
                        <Text style={{ fontSize: 11, color: colors.inkSoft }}>
                          ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Pressable
                    disabled={chat.encryptionPending || (!isAcceptedByMe && (isMeetupDateExpired || meetupStats?.isFull))}
                    onPress={isMeetupDateExpired ? () => showAlert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้', { tone: 'warning' }) : handleToggleAcceptMeetup}
                    style={({ pressed }) => [
                      styles.chatMeetupBtn,
                      isAcceptedByMe && styles.chatMeetupBtnAccepted,
                      !isAcceptedByMe && (isMeetupDateExpired || meetupStats?.isFull) && styles.chatMeetupBtnDisabled,
                      pressed && !isMeetupDateExpired && styles.pressed,
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <FeatureIcon
                        color="#FFFFFF"
                        name={isAcceptedByMe ? 'checkmark.circle.fill' : (isMeetupDateExpired ? 'clock.badge.xmark' : (meetupStats?.isFull ? 'xmark.circle' : 'person.badge.plus'))}
                        size={16}
                      />
                      <Text style={[styles.chatMeetupBtnText, isAcceptedByMe && styles.chatMeetupBtnTextAccepted]}>
                        {isAcceptedByMe ? 'ยอมรับนัดหมายแล้ว (แตะเพื่อยกเลิก)' : (isMeetupDateExpired ? 'นัดหมายนี้เลยกำหนดเวลาแล้ว' : (meetupStats?.isFull ? 'นัดหมายเต็มจำนวนแล้ว' : 'ยอมรับนัดหมาย'))}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.messageListWrapper}>
          <MessageTimeSwipeArea
            timeDragAnim={timeDragAnim}
            onReveal={revealAllMessageTimes}
            onHide={hideAllMessageTimes}
          >
            <FlatList
            contentContainerStyle={styles.messageList}
            style={{ flex: 1, opacity: isListAnchored || effectiveMessages.length === 0 ? 1 : 0 }}
            data={effectiveMessages}
            keyExtractor={(item) => item.id}
            keyboardDismissMode="none"
            keyboardShouldPersistTaps="handled"
            onLayout={handleListLayout}
            onScroll={handleScroll}
            onContentSizeChange={handleContentSizeChange}
            onScrollToIndexFailed={handleScrollToIndexFailed}
            scrollEventThrottle={16}
            ListHeaderComponent={(
              <View>
                {isLoadingOlder ? (
                  <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : null}
                <View style={chat.encryptionPending ? styles.e2eePendingBanner : styles.e2eeBanner}>
                  <FeatureIcon color={chat.encryptionPending ? '#A15C00' : colors.primary} name="lock.shield.fill" size={14} />
                  <Text style={chat.encryptionPending ? styles.e2eePendingText : styles.e2eeText}>
                    {chat.encryptionPending
                      ? 'กำลังเชื่อมกุญแจเข้ารหัส ส่งข้อความได้เลย ไม่ต้องรออัปเดตแอป'
                      : 'แชตนี้เข้ารหัสแบบต้นทางถึงปลายทาง'}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={(
              <View style={styles.emptyRoom}>
                <FeatureIcon color={colors.primary} name="hand.wave.fill" size={38} />
                <Text style={styles.emptyTitle}>เริ่มทักทายได้เลย</Text>
                <Text style={styles.emptyText}>ส่งข้อความแรกเพื่อเริ่มทำความรู้จักกัน</Text>
              </View>
            )}
            ref={listRef}
            renderItem={renderMessage}
            initialNumToRender={flatListPerf.initialNumToRender}
            maxToRenderPerBatch={flatListPerf.maxToRenderPerBatch}
            removeClippedSubviews={flatListPerf.removeClippedSubviews}
            showsVerticalScrollIndicator={false}
            onTouchStart={handleListTouchStart}
            updateCellsBatchingPeriod={flatListPerf.updateCellsBatchingPeriod}
            windowSize={flatListPerf.windowSize}
          />
          </MessageTimeSwipeArea>

          {showScrollBottom ? (
            <Animated.View
              style={[
                styles.scrollToBottomBtnContainer,
                {
                  opacity: scrollAnim,
                  transform: [
                    {
                      scale: scrollAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Pressable
                accessibilityLabel="เลื่อนลงข้อความล่าสุด"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => {
                  isNearBottomRef.current = true;
                  setShowScrollBottom(false);
                  setNewMessagesBelow(0);
                  scrollToLatest(true, true);
                }}
                style={({ pressed }) => [
                  styles.scrollToBottomBtn,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.line,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <FeatureIcon color={colors.primary} name="chevron.down" size={20} />
                {newMessagesBelow > 0 ? (
                  <View style={[styles.scrollBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.scrollBadgeText}>
                      {newMessagesBelow > 99 ? '99+' : newMessagesBelow}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </Animated.View>
          ) : null}
        </View>

        {replyingTo ? (
          <View style={styles.replyComposer}>
            <View style={styles.replyComposerCopy}>
              <Text style={styles.replyComposerTitle}>ตอบกลับข้อความ</Text>
              <ReplyPreview reply={replyingTo} conversationId={chat?.id} currentUserId={currentUserId} color={colors.inkSoft} />
            </View>
            <Pressable accessibilityLabel="ยกเลิกการตอบกลับ" onPress={() => setReplyingTo(null)} style={styles.replyComposerClose}>
              <FeatureIcon color={colors.inkSoft} name="xmark" size={12} />
            </Pressable>
          </View>
        ) : null}

        {!isMatchActive ? (
          <View style={{
            padding: 16,
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 13, color: colors.inkMuted, textAlign: 'center' }}>
              การจับคู่สิ้นสุดลงแล้ว คุณไม่สามารถส่งข้อความได้อีกต่อไป
            </Text>
          </View>
        ) : (
          <View style={styles.composerWrapper}>


            {/* Live Image Link Preview for URL typed or pasted in inputText */}
            {!selectedImage && inputText ? (() => {
              const pastedImgUrl = extractFirstImageUrl(inputText);
              if (!pastedImgUrl) return null;
              return (
                <View style={[styles.imagePreviewBar, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
                  <Image source={{ uri: pastedImgUrl }} style={styles.imagePreviewThumb} />
                  <View style={styles.imagePreviewInfo}>
                    <Text style={[styles.imagePreviewTitle, { color: colors.ink }]}>ตรวจพบลิงก์รูปภาพ</Text>
                    <Text numberOfLines={1} style={[styles.imagePreviewSubtitle, { color: colors.inkSoft }]}>
                      แตะส่ง หรือแตะแก้ไขรูปภาพนี้
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="แก้ไขรูปภาพนี้"
                    hitSlop={8}
                    onPress={() => {
                      setEditingMedia(pastedImgUrl);
                      setEditingMediaUris([pastedImgUrl]);
                    }}
                    style={styles.imagePreviewEdit}
                  >
                    <FeatureIcon color={colors.primary} name="slider.horizontal.3" size={16} />
                  </Pressable>
                </View>
              );
            })() : null}

            {clipboardImageDetected && !selectedImage ? (
              <View style={[styles.clipboardBanner, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
                <View style={styles.clipboardBannerLeft}>
                  <FeatureIcon color={colors.primary} name="doc.on.clipboard" size={18} />
                  <Text numberOfLines={1} style={[styles.clipboardBannerText, { color: colors.ink }]}>
                    ตรวจพบรูปภาพในคลิปบอร์ด
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="วางรูปภาพ"
                  onPress={async () => {
                    setClipboardImageDetected(false);
                    await handlePasteClipboardImage();
                  }}
                  style={[styles.clipboardPasteBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.clipboardPasteBtnText}>วางรูปภาพ</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="ปิดการแจ้งเตือนคลิปบอร์ด"
                  onPress={() => setClipboardImageDetected(false)}
                  style={styles.clipboardCloseBtn}
                >
                  <FeatureIcon color={colors.inkSoft} name="xmark" size={16} />
                </Pressable>
              </View>
            ) : null}

            {selectedImage ? (
              <View style={[styles.imagePreviewBar, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
                <Image source={{ uri: selectedImage.uri }} style={styles.imagePreviewThumb} />
                <View style={styles.imagePreviewInfo}>
                  <Text style={[styles.imagePreviewTitle, { color: colors.ink }]}>รูปภาพที่เลือก</Text>
                  <Text style={[styles.imagePreviewSubtitle, { color: colors.inkSoft }]}>แตะส่ง หรือพิมพ์คำอธิบายภาพ</Text>
                </View>
                <Pressable
                  accessibilityLabel="แก้ไขรูปภาพนี้"
                  hitSlop={8}
                  onPress={() => {
                    if (selectedImage?.uri) {
                      setEditingMedia(selectedImage.uri);
                      setEditingMediaUris(selectedImage.uris || [selectedImage.uri]);
                    }
                  }}
                  style={styles.imagePreviewEdit}
                >
                  <FeatureIcon color={colors.primary} name="slider.horizontal.3" size={16} />
                </Pressable>
                <Pressable
                  accessibilityLabel="ยกเลิกรูปภาพ"
                  hitSlop={8}
                  onPress={() => setSelectedImage(null)}
                  style={styles.imagePreviewClose}
                >
                  <FeatureIcon color={colors.inkSoft} name="xmark" size={16} />
                </Pressable>
              </View>
            ) : null}

            {showQuickEmoji ? (
              <View style={[styles.quickEmojiBar, { backgroundColor: colors.card, borderTopColor: colors.line }]}>
                <ScrollView
                  horizontal
                  keyboardShouldPersistTaps="always"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.quickEmojiContent}
                >
                  {emojiPanelEmojis.map((emoji) => (
                    <Pressable
                      key={emoji}
                      onPress={() => {
                        void recordReactionUsage(emoji);
                        setInputText((prev) => (prev || '') + emoji);
                        inputRef.current?.focus();
                      }}
                      style={({ pressed }) => [styles.quickEmojiButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.quickEmojiChar}>{emoji}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.composer}>
              {isRecordingAudio || recordedAudio ? (
                (() => {
                  const isStopping = !isRecordingAudio && Boolean(recordedAudio?.stopping);
                  return (
                  <View style={styles.voiceRecordingBarContainer}>
                  <Pressable
                    accessibilityLabel="ยกเลิกการบันทึกเสียง"
                    hitSlop={8}
                    onPress={handleCancelRecording}
                    style={({ pressed }) => [styles.voiceCancelCircleBtn, pressed && styles.pressed]}
                  >
                    <FeatureIcon color="#FFFFFF" name="xmark" size={16} />
                  </Pressable>

                  <View style={styles.voiceWaveCapsule}>
                    <Pressable
                      accessibilityLabel={
                        isRecordingAudio
                          ? 'หยุดบันทึกเสียงเพื่อฟังตัวอย่าง'
                          : isStopping
                          ? 'กำลังประมวลผล…'
                          : isPreviewPlaying
                          ? 'หยุดเล่น'
                          : 'ฟังตัวอย่างเสียง'
                      }
                      disabled={isStopping}
                      hitSlop={8}
                      onPress={isRecordingAudio ? handleStopToPreview : handleTogglePreviewPlay}
                      style={({ pressed }) => [styles.voiceControlWhiteCircle, isDark && styles.voiceControlWhiteCircleDark, pressed && styles.pressed]}
                    >
                      {isStopping ? (
                        <ActivityIndicator color={isDark ? '#FFFFFF' : '#3B5AFE'} size={14} />
                      ) : (
                        <FeatureIcon
                          color={isDark ? '#FFFFFF' : '#3B5AFE'}
                          name={isRecordingAudio ? 'square.fill' : (isPreviewPlaying ? 'pause.fill' : 'play.fill')}
                          size={isRecordingAudio ? 13 : 15}
                        />
                      )}
                    </Pressable>

                    <AudioWaveformBar
                      containerHeight={28}
                      isRecording={isRecordingAudio}
                      isPlaying={isPreviewPlaying}
                      levels={recordingLevels}
                      playProgress={previewProgress}
                    />

                    <View style={[styles.voiceDurationBadge, isDark && styles.voiceDurationBadgeDark]}>
                      <Text style={[styles.voiceDurationText, isDark && styles.voiceDurationTextDark]}>
                        {formatAudioDuration(isRecordingAudio ? recordingSeconds : (recordedAudio?.duration || recordingSeconds))}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    accessibilityLabel="ส่งข้อความเสียง"
                    disabled={uploadingMedia || isStopping}
                    hitSlop={8}
                    onPress={handleSendRecording}
                    style={({ pressed }) => [
                      styles.voiceSendCircleBtn,
                      (uploadingMedia || isStopping) && styles.sendDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <FeatureIcon color="#FFFFFF" name="paperplane.fill" size={17} />
                  </Pressable>
                </View>
                  );
                })()
              ) : (
                <View style={styles.inputCapsule}>
                  <Pressable
                    accessibilityLabel="เปิดกล้อง"
                    focusable={false}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={handleOpenCamera}
                    style={({ pressed }) => [styles.capsuleSmileyBtn, pressed && styles.pressed]}
                  >
                    <FeatureIcon
                      color={colors.ink}
                      name="camera.fill"
                      size={22}
                    />
                  </Pressable>

                  <TextInput
                    accessibilityLabel="พิมพ์ข้อความ"
                    autoCapitalize="sentences"
                    autoCorrect={true}
                    submitBehavior="newline"
                    contextMenuHidden={false}
                    maxLength={1000}
                    multiline
                    onChangeText={handleTextInputChange}
                    onFocus={() => {
                      isNearBottomRef.current = true;
                      setShowScrollBottom(false);
                      setNewMessagesBelow(0);
                      if (showQuickEmoji) setShowQuickEmoji(false);
                      if (isMediaPickerOpen) setIsMediaPickerOpen(false);
                      if (isGiphyPickerOpen) setIsGiphyPickerOpen(false);
                      scrollToLatest(true, true);
                    }}
                    placeholder={
                      selectedImage
                        ? 'เพิ่มคำอธิบายรูปภาพ...'
                        : 'ส่งข้อความ...'
                    }
                    placeholderTextColor={colors.inkSoft}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    cursorColor={colors.primary}
                    selectionColor={colors.primary}
                    ref={inputRef}
                    style={styles.capsuleTextInput}
                    value={inputText}
                  />

                  <View style={styles.capsuleTrailingContainer}>
                    {inputText.trim().length > 0 || selectedImage || replyingTo ? (
                      <Pressable
                        accessibilityLabel="ส่งข้อความ"
                        focusable={false}
                        disabled={sending || uploadingMedia || (!inputText.trim() && !selectedImage)}
                        onPress={handleSend}
                        style={({ pressed }) => [
                          styles.capsuleSendButton,
                          (sending || uploadingMedia || (!inputText.trim() && !selectedImage)) && styles.sendDisabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <FeatureIcon color="#FFFFFF" name="paperplane.fill" size={17} />
                      </Pressable>
                    ) : (
                      <View style={styles.capsuleActionsRow}>
                        <Pressable
                          accessibilityLabel="ส่งข้อความเสียง"
                          focusable={false}
                          hitSlop={6}
                          onPress={handleStartRecording}
                          style={({ pressed }) => [styles.capsuleActionIconBtn, pressed && styles.pressed]}
                        >
                          <FeatureIcon color={colors.ink} name="mic" size={22} />
                        </Pressable>

                        <Pressable
                          accessibilityLabel="ส่งรูปภาพ"
                          focusable={false}
                          hitSlop={6}
                          onPress={handlePickImage}
                          style={({ pressed }) => [styles.capsuleActionIconBtn, pressed && styles.pressed]}
                        >
                          <FeatureIcon color={colors.ink} name="photo" size={22} />
                        </Pressable>

                        <Pressable
                          accessibilityLabel="ค้นหาและส่ง GIF"
                          focusable={false}
                          hitSlop={6}
                          onPress={() => {
                            Keyboard.dismiss();
                            if (isMediaPickerOpen) setIsMediaPickerOpen(false);
                            if (showQuickEmoji) setShowQuickEmoji(false);
                            if (isSpotifyPickerOpen) setIsSpotifyPickerOpen(false);
                            setIsGiphyPickerOpen((prev) => !prev);
                          }}
                          style={({ pressed }) => [
                            styles.capsuleActionIconBtn,
                            isGiphyPickerOpen && { backgroundColor: colors.primarySoft, borderRadius: 12 },
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={[styles.gifCapsuleBadge, { borderColor: isGiphyPickerOpen ? colors.primary : colors.ink }]}>
                            <Text style={[styles.gifCapsuleBadgeText, { color: isGiphyPickerOpen ? colors.primary : colors.ink }]}>
                              GIF
                            </Text>
                          </View>
                        </Pressable>

                        {canUseSpotify ? (
                          <Pressable
                            accessibilityLabel="ค้นหาและส่งเพลง Spotify"
                            focusable={false}
                            hitSlop={6}
                            onPress={() => {
                              Keyboard.dismiss();
                              if (isMediaPickerOpen) setIsMediaPickerOpen(false);
                              if (showQuickEmoji) setShowQuickEmoji(false);
                              if (isGiphyPickerOpen) setIsGiphyPickerOpen(false);
                              // Defer open so keyboard teardown does not contend with Modal mount.
                              requestAnimationFrame(() => setIsSpotifyPickerOpen(true));
                            }}
                            style={({ pressed }) => [
                              styles.capsuleActionIconBtn,
                              isSpotifyPickerOpen && { backgroundColor: colors.primarySoft, borderRadius: 12 },
                              pressed && styles.pressed,
                            ]}
                          >
                            <FeatureIcon color={isSpotifyPickerOpen ? colors.primary : colors.ink} name="music.note" size={22} />
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {cameraOpen && <ChatCameraModal recipientName={chat?.name} recipientAvatar={chat?.avatarUri}
          onClose={() => setCameraOpen(false)}
          onCapture={(asset) => { setCameraOpen(false); setMediaComposerDraft(asset); }} />}
        {mediaComposerDraft && <ChatMediaComposer asset={mediaComposerDraft} recipientName={chat?.name} recipientAvatar={chat?.avatarUri}
          onClose={() => setMediaComposerDraft(null)}
          onSend={(asset, mode) => asset.type === 'video'
            ? handleSendVideo(asset, mode, asset.caption)
            : handleSendImage(asset.uris || asset.uri, asset.caption, mode)} />}
        {videoDraft && <ChatVideoComposer asset={videoDraft} onSend={handleSendVideo} onClose={() => setVideoDraft(null)} />}
      {isMediaPickerOpen ? (
        <View style={{ height: MEDIA_PICKER_COLLAPSED_HEIGHT + (insets.bottom || 0) }} />
      ) : null}

        {isGiphyPickerOpen && (
          <ChatGiphyPickerSheet
            colors={colors}
            isDark={isDark}
            isOpen={isGiphyPickerOpen}
            onClose={() => setIsGiphyPickerOpen(false)}
            onSelectGif={handleSendGif}
            onSelectEmoji={(emoji) => {
              setInputText((prev) => (prev || '') + emoji);
            }}
          />
        )}
        {isSpotifyPickerOpen ? (
          <SpotifyTrackSearchSheet
            colors={colors}
            onClose={() => setIsSpotifyPickerOpen(false)}
            onSelect={handleSendTrack}
            subtitle="แตะเพื่อส่งเพลงในแชต"
            title="ส่งเพลง Spotify"
            visible
          />
        ) : null}
      </KeyboardAvoidingView>
      {isMediaPickerOpen ? (
        <ChatMediaPickerSheet
          overlay
          onSelectVideo={handlePickVideo}
          colors={{ ...colors, bg: colors.canvas }}
          isOpen={isMediaPickerOpen}
          onClose={() => setIsMediaPickerOpen(false)}
          onOpenEditor={(uri, uris) => {
            setMediaComposerDraft({ uri, uris: uris?.length ? uris : [uri], type: 'image', edit: true });
            setEditingMediaUris(uris?.length ? uris : [uri]);
            setIsMediaPickerOpen(false);
          }}
          onSelectPhoto={(photoUri) => {
            if (photoUri) {
              setIsMediaPickerOpen(false);
              setMediaComposerDraft({ uri: Array.isArray(photoUri) ? photoUri[0] : photoUri, uris: Array.isArray(photoUri) ? photoUri : [photoUri], type: 'image' });
            }
          }}
          onSelectMedia={(selected) => {
            const list = Array.isArray(selected) ? selected : [selected];
            const first = list[0];
            if (!first?.uri) return;
            setIsMediaPickerOpen(false);
            setMediaComposerDraft({
              ...first,
              type: first.type || (first.mediaType === 'video' ? 'video' : 'image'),
              uri: first.uri,
              uris: list.map((entry) => entry.uri).filter(Boolean),
            });
          }}
          onSelectCamera={() => { setIsMediaPickerOpen(false); setCameraOpen(true); }}
          onSelectLibrary={async () => {
            try {
              const res = await pickChatImages();
              if (res?.length > 0) {
                const uris = res.map((r) => r.uri);
                setMediaComposerDraft({ uri: uris[0], uris, type: 'image' });
                setIsMediaPickerOpen(false);
              }
            } catch (err) {
              showAlert('ไม่สามารถเปิดคลังภาพได้', err.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
            }
          }}
        />
      ) : null}
      <ChatSettingsModal
        chat={chat}
        currentUserId={currentUserId}
        colors={colors}
        isMuted={isMuted}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onNavigateMeetup={() => {
          setIsSettingsOpen(false);
          router.push('/meetup');
        }}
        onNavigateProfile={() => {
          setIsSettingsOpen(false);
          if (otherUserId) {
            router.push({
              pathname: '/discover-profile',
              params: { profileId: otherUserId, id: otherUserId, viewOnly: 'true' },
            });
          }
        }}
        onRemoveConversation={handleRemoveConversation}
        onBlockUser={handleBlockUserAction}
        onReportUser={handleOpenReportUser}
        onToggleMute={handleToggleMute}
        onTogglePinnedMeetup={handleTogglePinnedMeetup}
        partnerMeetup={partnerMeetup}
        showPinnedMeetup={showPinnedMeetup}
      />

      <InstagramMessageOverlay
        conversations={conversations}
        currentConversationId={chat.id}
        currentUserId={currentUserId}
        isOpen={Boolean(actionMessage)}
        item={actionMessage}
        onClose={() => setActionMessage(null)}
        onDelete={handleDeleteForMe}
        onForward={handleForward}
        onReact={handleReact}
        onReply={handleReply}
        onReport={handleOpenReportMessage}
        onUnsend={handleUnsend}
        palette={{ accent: colors.primary, colors, isDark }}
      />
      <ReportModal
        colors={colors}
        isMessageReport={reportTarget.isMessageReport}
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={handleSubmitReport}
        targetName={chat?.name || 'ผู้ใช้นี้'}
      />
      <ReactionDetailsModal
        currentUserId={currentUserId}
        item={reactionDetailsMessage}
        onClose={() => setReactionDetailsMessage(null)}
        onOpenProfile={handleOpenReactionProfile}
        profiles={reactionProfiles}
        visible={Boolean(reactionDetailsMessage)}
      />

      {/* Fullscreen Interactive Image Preview Modal */}
      <ChatImageViewerModal
        conversationId={chat?.id}
        currentUserId={currentUserId}
        images={previewImages.length > 0 ? previewImages : (previewImageUrl ? [previewImageUrl] : [])}
        initialIndex={previewIndex}
        onClose={() => {
          setPreviewImageUrl(null);
          setPreviewImages([]);
        }}
        onSendMessage={async (text) => {
          if (chat?.id && text) {
            await sendMessage(chat.id, text);
          }
        }}
        partnerName={chat?.name}
        visible={Boolean(previewImageUrl)}
      />

      {/* Fullscreen Photo Editor Modal Before Sending */}
      <ChatImageEditorModal
        colors={colors}
        imageUri={editingMedia}
        imageUris={editingMediaUris}
        onClose={() => {
          setEditingMedia(null);
          setEditingMediaUris([]);
        }}
        onSend={(finalUris, caption) => {
          setEditingMedia(null);
          setEditingMediaUris([]);
          handleSendImage(finalUris, caption);
        }}
        visible={Boolean(editingMedia)}
      />
    </SafeAreaView>
  );
}

function ChatSettingsModal({
  chat,
  colors,
  isMuted,
  isOpen,
  onClose,
  onNavigateMeetup,
  onNavigateProfile,
  onRemoveConversation,
  onBlockUser,
  onReportUser,
  onToggleMute,
  onTogglePinnedMeetup,
  partnerMeetup,
  showPinnedMeetup,
}) {
  const translateY = useSharedValue(500);
  const fadeAnim = useSharedValue(0);
  const sheetHeight = useSharedValue(500);
  const dragContext = useSharedValue(0);
  const isClosingSV = useSharedValue(0);
  const isClosingRef = useRef(false);
  const pendingCloseCallbackRef = useRef(null);

  const finishClose = useCallback(() => {
    const callback = pendingCloseCallbackRef.current;
    pendingCloseCallbackRef.current = null;
    onClose();
    isClosingRef.current = false;
    isClosingSV.set(0);
    if (typeof callback === 'function') {
      setTimeout(callback, 80);
    }
  }, [isClosingSV, onClose]);

  const closeWithAnimation = useCallback((callback) => {
    if (isClosingRef.current || isClosingSV.get()) return;
    isClosingRef.current = true;
    isClosingSV.set(1);
    pendingCloseCallbackRef.current = typeof callback === 'function' ? callback : null;
    const height = Math.max(sheetHeight.get(), 500);
    translateY.set(withSpring(height, {
      duration: 300,
      dampingRatio: 1,
      overshootClamping: true,
    }, (finished) => {
      if (finished) scheduleOnRN(finishClose);
    }));
    fadeAnim.set(withTiming(0, { duration: 180 }));
  }, [fadeAnim, finishClose, isClosingSV, sheetHeight, translateY]);

  useEffect(() => {
    if (isOpen) {
      isClosingRef.current = false;
      isClosingSV.set(0);
      pendingCloseCallbackRef.current = null;
      translateY.set(500);
      fadeAnim.set(0);
      translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      fadeAnim.set(withTiming(1, { duration: 180 }));
    }
  }, [fadeAnim, isClosingSV, isOpen, translateY]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onStart(() => {
      dragContext.set(translateY.get());
    })
    .onUpdate((e) => {
      const next = dragContext.get() + e.translationY;
      const height = Math.max(sheetHeight.get(), 1);
      translateY.set(next >= 0 ? next : rubberband(next, height));
    })
    .onEnd((e, success) => {
      if (!success) {
        translateY.set(withSpring(0, {
          duration: 400,
          dampingRatio: 0.8,
          velocity: e.velocityY,
        }));
        return;
      }
      const height = Math.max(sheetHeight.get(), 1);
      const projected = translateY.get() + project(e.velocityY);
      if (projected > height * 0.4 || e.velocityY > 800) {
        if (isClosingSV.get()) return;
        isClosingSV.set(1);
        translateY.set(withSpring(height, {
          duration: 300,
          dampingRatio: 1,
          velocity: e.velocityY,
          overshootClamping: true,
        }, (finished) => {
          if (finished) scheduleOnRN(finishClose);
        }));
        fadeAnim.set(withTiming(0, { duration: 180 }));
      } else {
        translateY.set(withSpring(0, {
          duration: 400,
          dampingRatio: 0.8,
          velocity: e.velocityY,
        }));
      }
    }), [dragContext, fadeAnim, finishClose, isClosingSV, sheetHeight, translateY]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.get(),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  return (
    <Modal animationType="none" transparent visible={isOpen} onRequestClose={() => closeWithAnimation()}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Reanimated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.5)' },
            backdropStyle,
          ]}
        >
          <Pressable onPress={() => closeWithAnimation()} style={{ flex: 1 }} />
        </Reanimated.View>

        <Reanimated.View
          onLayout={(e) => {
            const height = e.nativeEvent?.layout?.height;
            if (height) sheetHeight.set(height);
          }}
          style={[
            {
              backgroundColor: colors.card,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              maxHeight: '88%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -6 },
              shadowOpacity: 0.16,
              shadowRadius: 20,
              zIndex: 10,
              elevation: 20,
            },
            sheetStyle,
          ]}
        >
          {/* Handle - Draggable bar */}
          <GestureDetector gesture={pan}>
            <View
              style={{ alignItems: 'center', justifyContent: 'center', width: '100%', paddingTop: 10, paddingBottom: 10 }}
            >
              <View style={{ width: 44, height: 5, borderRadius: 2.5, backgroundColor: colors.line }} />
            </View>
          </GestureDetector>

          <ScrollView
            bounces={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 36 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Title Header */}
            <View style={{ marginBottom: 18 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>
                ตั้งค่าห้องสนทนา
              </Text>
              <Text style={{ fontSize: 12, color: colors.inkMuted, marginTop: 2 }}>
                บันทึกการตั้งค่าเฉพาะบัญชีนี้ในฐานข้อมูล
              </Text>
            </View>

            {/* Setting 1: Toggle Meetup Banner */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                backgroundColor: colors.canvas,
                borderRadius: 18,
                marginBottom: 10,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 3 }}>
                  แสดงแถบจุดนัดหมายที่ปักหมุด
                </Text>
                <Text style={{ fontSize: 12, color: colors.inkMuted, lineHeight: 16 }}>
                  {showPinnedMeetup ? 'เปิดแสดงข้อมูลสถานที่และเวลาไว้ด้านบนของแชต' : 'ซ่อนแถบจุดนัดหมายไว้เพื่อเพิ่มพื้นที่อ่านข้อความ'}
                </Text>
              </View>
              <Switch
                ios_backgroundColor={colors.line}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor={colors.onPrimary}
                value={showPinnedMeetup}
                onValueChange={onTogglePinnedMeetup}
              />
            </View>

            {/* Setting 2: Mute Chat Notifications */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                backgroundColor: colors.canvas,
                borderRadius: 18,
                marginBottom: 10,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 3 }}>
                  ปิดการแจ้งเตือนแชตนี้
                </Text>
                <Text style={{ fontSize: 12, color: colors.inkMuted, lineHeight: 16 }}>
                  {isMuted ? 'ปิดเสียงและการแจ้งเตือนข้อความใหม่จากห้องนี้' : 'รับการแจ้งเตือนข้อความใหม่ตามปกติ'}
                </Text>
              </View>
              <Switch
                ios_backgroundColor={colors.line}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor={colors.onPrimary}
                value={isMuted}
                onValueChange={onToggleMute}
              />
            </View>

            {/* Setting 3: View Profile Shortcut */}
            <Pressable
              onPress={() => {
                closeWithAnimation(() => {
                  onNavigateProfile?.();
                });
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                backgroundColor: colors.canvas,
                borderRadius: 18,
                marginBottom: 10,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 2 }}>
                  ดูโปรไฟล์ของ {chat?.name || 'เพื่อน'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.inkMuted }}>
                  ดูข้อมูลส่วนตัว คณะ และกิจกรรมที่สนใจ
                </Text>
              </View>
              <Text style={{ fontSize: 18, color: colors.inkMuted, marginLeft: 8 }}>›</Text>
            </Pressable>

            {/* Setting 4: View Meetup Places */}
            {partnerMeetup ? (
              <Pressable
                onPress={() => {
                  closeWithAnimation(() => {
                    onNavigateMeetup?.();
                  });
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  backgroundColor: colors.canvas,
                  borderRadius: 18,
                  marginBottom: 16,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 2 }}>
                    ดูจุดนัดหมาย ({partnerMeetup.name})
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.inkMuted }}>
                    เปิดหน้ารวมสถานที่และแผนที่นัดหมายทั้งหมด
                  </Text>
                </View>
                <Text style={{ fontSize: 18, color: colors.inkMuted, marginLeft: 8 }}>›</Text>
              </Pressable>
            ) : null}

            {/* Safety: Report User */}
            {onReportUser ? (
              <Pressable
                onPress={() => {
                  closeWithAnimation(() => {
                    onReportUser?.();
                  });
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 13,
                  paddingHorizontal: 16,
                  backgroundColor: colors.canvas,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 75, 75, 0.4)',
                  borderRadius: 18,
                  marginBottom: 10,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <FeatureIcon color="#FF4B4B" name="exclamationmark.bubble" size={16} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FF4B4B', marginLeft: 8 }}>
                  รายงานผู้ใช้นี้
                </Text>
              </Pressable>
            ) : null}

            {/* Safety: Block User */}
            {onBlockUser ? (
              <Pressable
                onPress={() => {
                  closeWithAnimation(() => {
                    onBlockUser?.();
                  });
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 13,
                  paddingHorizontal: 16,
                  backgroundColor: colors.canvas,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 75, 75, 0.4)',
                  borderRadius: 18,
                  marginBottom: 10,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <FeatureIcon color="#FF4B4B" name="hand.raised" size={16} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FF4B4B', marginLeft: 8 }}>
                  บล็อกผู้ใช้นี้
                </Text>
              </Pressable>
            ) : null}

            {/* Destructive: Unmatch and Delete Conversation */}
            {onRemoveConversation ? (
              <Pressable
                onPress={() => {
                  closeWithAnimation(() => {
                    onRemoveConversation?.();
                  });
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 13,
                  paddingHorizontal: 16,
                  backgroundColor: '#FEE2E2',
                  borderRadius: 18,
                  marginBottom: 12,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <FeatureIcon color="#EF4444" name="trash" size={16} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#EF4444', marginLeft: 8 }}>
                  ยกเลิกการจับคู่และลบห้องสนทนา
                </Text>
              </Pressable>
            ) : null}

            {/* Done Button */}
            <Pressable
              onPress={() => closeWithAnimation()}
              style={({ pressed }) => ({
                backgroundColor: colors.primary,
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: 'center',
                marginTop: 4,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                เสร็จสิ้น
              </Text>
            </Pressable>
          </ScrollView>
        </Reanimated.View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ImageLinkPreview({ imageUrl, onPreviewImage, mine, colors }) {
  const [loadError, setLoadError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(1.33);

  useEffect(() => {
    if (!imageUrl) return;
    Image.getSize(
      imageUrl,
      (w, h) => {
        if (w > 0 && h > 0) {
          setAspectRatio(Math.min(Math.max(w / h, 0.65), 1.85));
        }
      },
      () => setLoadError(true)
    );
  }, [imageUrl]);

  if (loadError) return null;

  const cardWidth = 216;
  const cardHeight = Math.min(Math.max(Math.round(cardWidth / aspectRatio), 120), 250);

  return (
    <Pressable
      accessibilityLabel="ดูรูปภาพจากลิงก์"
      onPress={() => onPreviewImage?.(imageUrl)}
      style={({ pressed }) => [
        {
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: 6,
          backgroundColor: mine ? 'rgba(0, 0, 0, 0.20)' : 'rgba(0, 0, 0, 0.05)',
          width: cardWidth,
          height: cardHeight,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: mine ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.08)',
        },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Image
        source={{ uri: imageUrl }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        onError={() => setLoadError(true)}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 5,
          right: 6,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          borderRadius: 10,
          paddingHorizontal: 7,
          paddingVertical: 2.5,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3.5,
        }}
      >
        <FeatureIcon color="#FFFFFF" name="photo" size={10} />
        <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '600' }}>รูปภาพจากลิงก์</Text>
      </View>
    </Pressable>
  );
}

const ChatMessageItem = React.memo(function ChatMessageItem({
  chat,
  currentUserId,
  colors,
  index,
  isActionActive,
  isHighlighted,
  isLatest,
  item,
  onCallPress,
  onOpenProfile,
  onPreviewImage,
  onQuickReact,
  onReply,
  onScrollToMessage,
  onShowReactionDetails,
  onSelectMessage,
  otherReadAt,
  otherUnread,
  otherUserId,
  showAllMessageTimes,
  showDay,
  styles,
  timeDragAnim,
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isLatest) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, [isLatest]);
  const bubbleRef = useRef(null);
  const lastTapAtRef = useRef(0);
  const doubleTapTimerRef = useRef(null);
  const longPressRef = useRef(false);
  const currentImageSizeRef = useRef(null);
  const currentRatioRef = useRef(null);
  const mine = item.sender === 'me' || (Boolean(currentUserId) && item.senderId === currentUserId);
  const peerId = otherUserId || chat?.profileId;
  const mediaViewedAt = usePeerMediaView(
    chat?.id,
    item.id,
    peerId,
    mine && isLatest && isProtectedMedia(item) && !item.pendingSync,
  );
  const { retryFailedMessage } = useAppActions();
  const statusText = formatStatusTime(item, mine, isLatest, otherReadAt, otherUnread, mediaViewedAt);
  const { count: reactionCount, uniqueEmojis } = getMessageReactionSummary(item.reactions);

  const bounceAnim = useRef(new Animated.Value(1)).current;
  const highlightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isHighlighted) {
      bounceAnim.setValue(1);
      highlightAnim.setValue(0);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: 1.09,
            duration: 180,
            easing: Easing.out(Easing.back(2.5)),
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 0.96,
            duration: 140,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 1.03,
            duration: 120,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 1.0,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(highlightAnim, {
            toValue: 1,
            duration: 180,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.delay(650),
          Animated.timing(highlightAnim, {
            toValue: 0,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
  }, [isHighlighted, bounceAnim, highlightAnim]);

  useEffect(() => () => {
    if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
  }, []);

  const handleReplyFromSwipe = useCallback(() => {
    onReply?.(item);
  }, [item, onReply]);

  const replyPan = useMemo(() => Gesture.Pan()
    .activeOffsetX(16)
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      if (e.translationX >= MESSAGE_TIME_REVEAL_THRESHOLD) {
        scheduleOnRN(handleReplyFromSwipe);
      }
    }), [handleReplyFromSwipe]);

  const rowDragStyle = useAnimatedStyle(() => {
    const drag = timeDragAnim ? timeDragAnim.get() : 0;
    return {
      transform: [{
        translateX: interpolate(drag, [-48, 0], [mine ? -44 : -8, 0], Extrapolation.CLAMP),
      }],
    };
  });

  const gutterStyle = useAnimatedStyle(() => {
    const drag = timeDragAnim ? timeDragAnim.get() : 0;
    return {
      opacity: interpolate(drag, [-32, -4, 0], [1, 0.15, 0], Extrapolation.CLAMP),
      transform: [{
        translateX: interpolate(drag, [-48, 0], [mine ? 0 : -36, 0], Extrapolation.CLAMP),
      }],
    };
  });

  const handleLongPress = () => {
    longPressRef.current = true;
    lastTapAtRef.current = 0;
    if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
    const extraData = {
      imageSize: currentImageSizeRef.current,
      aspectRatio: currentRatioRef.current,
    };
    if (bubbleRef.current?.measureInWindow) {
      bubbleRef.current.measureInWindow((x, y, width, height) => {
        onSelectMessage({
          ...item,
          ...extraData,
          layout: { x, y, width, height },
        });
      });
    } else {
      onSelectMessage({
        ...item,
        ...extraData,
      });
    }
  };

  const handlePress = () => {
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }

    const now = Date.now();
    const elapsed = now - lastTapAtRef.current;
    if (elapsed > 0 && elapsed <= DOUBLE_TAP_WINDOW_MS) {
      lastTapAtRef.current = 0;
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      onQuickReact?.(item);
      return;
    }

    lastTapAtRef.current = now;
    if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
    doubleTapTimerRef.current = setTimeout(() => {
      lastTapAtRef.current = 0;
      doubleTapTimerRef.current = null;
    }, DOUBLE_TAP_WINDOW_MS);
  };

  return (
    <View>
      {showDay ? (
        <Text style={styles.dayDivider}>
          {toDate(messageTimestamp(item))?.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>
      ) : null}
      <Reanimated.View
        style={[
          styles.messageRow,
          mine && styles.messageRowMine,
          rowDragStyle,
        ]}
      >
        {!mine ? (
          <Pressable
            accessibilityLabel={`ดูโปรไฟล์ของ ${chat.name}`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={onOpenProfile}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Avatar avatarColor={chat.avatarColor} cacheScope={chat.profileId} cacheVersion={chat.participantProfiles?.[chat.profileId]?.avatarRevision} colors={colors} emoji={chat.avatar} size={28} uri={chat.avatarUri} />
          </Pressable>
        ) : null}
        <View style={[styles.messageGroup, mine && styles.messageGroupMine]}>
          <View style={[styles.messageContentRow, mine && styles.messageContentRowMine]}>
            <View style={[styles.messageStack, mine ? styles.messageStackMine : styles.messageStackOther]}>
              <Animated.View style={[styles.messageBubbleWithReaction, isActionActive && { opacity: 0 }, { transform: [{ scale: bounceAnim }] }]}>
              <GestureDetector gesture={replyPan}>
              <Pressable
                ref={bubbleRef}
                delayLongPress={220}
                onLongPress={handleLongPress}
                onPress={handlePress}
                onPressIn={() => {
                  longPressRef.current = false;
                }}
                style={({ pressed }) => [
                  styles.bubble,
                  mine ? styles.myBubble : styles.theirBubble,
                  (item.mediaUrl && (item.mediaType === 'image' || item.mediaType === 'gif' || item.mediaType === 'video' || !item.mediaType)) && styles.imageBubble,
                  (Array.isArray(item.mediaUrls) && item.mediaUrls.length > 1) && styles.stackedImageBubble,
                  item.mediaType === 'call' && styles.callBubbleWrapper,
                  pressed && styles.pressed,
                ]}
              >
                {item.forwarded ? <Text style={[styles.forwardedBubbleLabel, mine && styles.forwardedBubbleLabelMine]}>ส่งต่อ</Text> : null}
                {item.replyTo ? (
                  <Pressable
                    hitSlop={4}
                    onPress={() => {
                      const targetId = item.replyTo?.id || item.replyTo?.messageId;
                      if (targetId) onScrollToMessage?.(targetId);
                    }}
                    style={({ pressed }) => [
                      styles.replyBubble,
                      mine && styles.replyBubbleMine,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <FeatureIcon color={mine ? 'rgba(255,255,255,0.7)' : colors.inkSoft} name="arrowshape.turn.up.left.fill" size={10} />
                      <ReplyPreview reply={item.replyTo} conversationId={chat?.id} currentUserId={currentUserId} color={mine ? "#FFFFFF" : colors.inkSoft} />
                    </View>
                  </Pressable>
                ) : null}

                {/* Call Message Card */}
                {item.mediaType === 'call' ? (
                  <CallMessageBubble
                    colors={colors}
                    item={item}
                    mine={mine}
                    onCallPress={onCallPress}
                  />
                ) : null}

                {/* Voice Message */}
                {item.mediaType === 'video' && item.mediaUrl ? <ChatVideoBubble onLongPress={handleLongPress} item={item} conversationId={chat?.id} currentUserId={currentUserId} otherUserId={peerId} mine={mine} /> : null}
                {item.mediaType === 'image' && item.viewMode && item.viewMode !== 'chat' && item.mediaUrl ? <ChatProtectedImageBubble onLongPress={handleLongPress} item={item} conversationId={chat?.id} currentUserId={currentUserId} otherUserId={peerId} mine={mine} /> : null}
                {item.mediaType === 'audio' || item.audioUrl ? (
                  <VoiceMessageBubble
                    audioUrl={item.audioUrl || item.mediaUrl}
                    colors={colors}
                    conversationId={chat?.id}
                    duration={item.audioDuration}
                    isUploading={Boolean(item.isUploading)}
                    mine={mine}
                  />
                ) : null}

                {item.mediaType === 'track' ? (
                  <Pressable
                    onPress={() => {
                      const url = item.externalUrl || (item.trackId ? `https://open.spotify.com/track/${item.trackId}` : null);
                      if (url) Linking.openURL(url).catch(() => {});
                    }}
                    style={({ pressed }) => [
                      styles.trackBubble,
                      mine ? styles.trackBubbleMine : styles.trackBubbleTheirs,
                      pressed && { opacity: 0.88 },
                    ]}
                  >
                    {item.albumArt ? (
                      <ExpoImage contentFit="cover" source={{ uri: item.albumArt }} style={styles.trackBubbleArt} />
                    ) : (
                      <View style={[styles.trackBubbleArt, styles.trackBubbleArtFallback, { backgroundColor: mine ? 'rgba(255,255,255,0.2)' : colors.primarySoft }]}>
                        <FeatureIcon color={mine ? '#FFFFFF' : colors.primary} name="music.note" size={18} />
                      </View>
                    )}
                    <View style={styles.trackBubbleMeta}>
                      <Text numberOfLines={1} style={[styles.trackBubbleName, mine && styles.trackBubbleNameMine]}>
                        {item.trackName || item.text || 'Spotify'}
                      </Text>
                      <Text numberOfLines={1} style={[styles.trackBubbleArtists, mine && styles.trackBubbleArtistsMine]}>
                        {item.artists || 'Unknown'}
                      </Text>
                      <Text style={[styles.trackBubbleCta, mine && styles.trackBubbleCtaMine]}>เปิดฟังเต็มเพลง</Text>
                    </View>
                    <TrackPreviewButton
                      backgroundColor={mine ? 'rgba(255,255,255,0.22)' : colors.primarySoft}
                      color={mine ? '#FFFFFF' : colors.primary}
                      previewEndMs={item.previewEndMs}
                      previewStartMs={item.previewStartMs}
                      previewUrl={item.previewUrl}
                      size={34}
                      track={item}
                      trackArtists={item.artists}
                      trackName={item.trackName || item.text}
                      youtubeVideoId={item.youtubeVideoId}
                    />
                  </Pressable>
                ) : null}

                {/* Image Message / Stacked Image Cards */}
                {item.mediaUrl && ((!item.viewMode || item.viewMode === 'chat') && (item.mediaType === 'image' || item.mediaType === 'gif' || !item.mediaType)) ? (
                  Array.isArray(item.mediaUrls) && item.mediaUrls.length > 1 ? (
                    <StackedImageCards
                      conversationId={chat?.id}
                      currentUserId={currentUserId}
                      handleLongPress={handleLongPress}
                      isUploading={Boolean(item.isUploading)}
                      mediaUrls={item.mediaUrls}
                      mine={mine}
                      onPreviewImage={(resolvedUri, all) => onPreviewImage?.(resolvedUri, all || item.mediaUrls)}
                    />
                  ) : (
                    <View style={styles.bubbleImageContainer}>
                      <DecryptedChatImage
                        conversationId={chat?.id}
                        isUploading={Boolean(item.isUploading)}
                        mediaUrl={item.mediaUrl}
                        onAspectRatioMeasured={(ratio, size) => {
                          currentRatioRef.current = ratio;
                          currentImageSizeRef.current = size;
                        }}
                        onLongPress={handleLongPress}
                        onPress={(resolvedUri) => onPreviewImage?.(resolvedUri || item.mediaUrl)}
                        resizeMode="cover"
                        useDynamicSize
                      />
                    </View>
                  )
                ) : null}
                {/* Image Link Preview (if message text contains an image URL without attached media) */}
                {!item.mediaUrl && item.mediaType !== 'audio' && item.text ? (() => {
                  const linkedImageUrl = extractFirstImageUrl(item.text);
                  if (!linkedImageUrl) return null;
                  return (
                    <ImageLinkPreview
                      colors={colors}
                      imageUrl={linkedImageUrl}
                      mine={mine}
                      onPreviewImage={onPreviewImage}
                    />
                  );
                })() : null}

                {/* Text / Caption */}
                {item.mediaType !== 'call' && item.mediaType !== 'track' && item.text && item.text !== '[รูปภาพ]' && !item.text.startsWith('[รูปภาพ ') && item.text !== '[ข้อความเสียง]' && item.text !== '[วิดีโอ]' && item.text !== '[GIF]' && item.text.toUpperCase() !== '[GIF]' ? (
                  <Text
                    style={[
                      styles.bubbleText,
                      mine && styles.myBubbleText,
                      item.mediaUrl && styles.bubbleCaptionText,
                    ]}
                    textBreakStrategy={Platform.OS === 'android' ? 'highQuality' : undefined}
                  >
                    {item.text}
                  </Text>
                ) : null}
                {/* Highlight glow overlay on message bounce */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      borderRadius: 18,
                      backgroundColor: mine ? '#FFFFFF' : (colors.primary || '#EE6B5D'),
                      opacity: highlightAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, mine ? 0.38 : 0.28],
                      }),
                    },
                  ]}
                />
              </Pressable>
              </GestureDetector>
              {reactionCount ? (
                <View style={[styles.reactionLayer, mine ? styles.reactionLayerMine : styles.reactionLayerOther]}>
                  <Pressable
                  accessibilityLabel={`ดูรายละเอียดรีแอค ${reactionCount} คน`}
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => onShowReactionDetails?.(item)}
                  style={({ pressed }) => [pressed && styles.reactionBadgePressed]}
                >
                  <ReactionBadge count={reactionCount} colors={colors} emojis={uniqueEmojis} styles={styles} />
                  </Pressable>
                </View>
              ) : null}
            </Animated.View>
          </View>
          </View>
          {statusText ? (
            <Text accessibilityRole={item.sendStatus === 'failed' ? 'button' : undefined} onPress={item.sendStatus === 'failed' ? () => { void retryFailedMessage(chat?.id, item.id).catch(() => {}); } : undefined} style={[styles.messageTime, mine && styles.messageTimeMine]}>
              {statusText}
            </Text>
          ) : null}
        </View>

        {/* Swipe-to-reveal timestamp in right margin */}
        {timeDragAnim ? (
          <Reanimated.View
            pointerEvents="none"
            style={[styles.dragTimeGutter, gutterStyle]}
          >
            <Text numberOfLines={1} style={[styles.dragTimeText, { color: colors.inkSoft }]}>
              {format24Time(messageTimestamp(item))}
            </Text>
          </Reanimated.View>
        ) : null}
      </Reanimated.View>
    </View>
  );
}, areChatMessageItemPropsEqual);

function areChatMessageItemPropsEqual(previous, next) {
  const previousItem = previous.item;
  const nextItem = next.item;
  const previousChat = previous.chat;
  const nextChat = next.chat;
  const previousProfile = previousChat?.participantProfiles?.[previousChat?.profileId];
  const nextProfile = nextChat?.participantProfiles?.[nextChat?.profileId];

  if (
    previous.isActionActive !== next.isActionActive
    || previous.isHighlighted !== next.isHighlighted
    || previous.currentUserId !== next.currentUserId
    || previous.index !== next.index
    || previous.isLatest !== next.isLatest
    || previous.showDay !== next.showDay
    || previous.showAllMessageTimes !== next.showAllMessageTimes
    || previous.timeDragAnim !== next.timeDragAnim
    || previous.styles !== next.styles
    || previous.colors !== next.colors
    || previous.onCallPress !== next.onCallPress
    || previous.onOpenProfile !== next.onOpenProfile
    || previous.onPreviewImage !== next.onPreviewImage
    || previous.onQuickReact !== next.onQuickReact
    || previous.onReply !== next.onReply
    || previous.onShowReactionDetails !== next.onShowReactionDetails
    || previous.onSelectMessage !== next.onSelectMessage
    || previousChat?.id !== nextChat?.id
    || previousChat?.name !== nextChat?.name
    || previousChat?.avatar !== nextChat?.avatar
    || previousChat?.avatarColor !== nextChat?.avatarColor
    || previousChat?.avatarUri !== nextChat?.avatarUri
    || previousChat?.profileId !== nextChat?.profileId
    || previousProfile?.updatedAt !== nextProfile?.updatedAt
  ) return false;

  if (previous.isLatest || next.isLatest) {
    const previousReadAt = toDate(previous.otherReadAt)?.getTime() || 0;
    const nextReadAt = toDate(next.otherReadAt)?.getTime() || 0;
    if (previousReadAt !== nextReadAt) return false;
    if (previous.otherUnread !== next.otherUnread) return false;
    if (previous.otherUserId !== next.otherUserId) return false;
  }

  return previousItem?.id === nextItem?.id
    && previousItem?.sender === nextItem?.sender
    && previousItem?.text === nextItem?.text
    && previousItem?.mediaUrl === nextItem?.mediaUrl
    && JSON.stringify(previousItem?.mediaUrls || []) === JSON.stringify(nextItem?.mediaUrls || [])
    && previousItem?.mediaType === nextItem?.mediaType
    && previousItem?.viewMode === nextItem?.viewMode
    && previousItem?.videoMode === nextItem?.videoMode
    && Boolean(previousItem?.isUploading) === Boolean(nextItem?.isUploading)
    && previousItem?.sendStatus === nextItem?.sendStatus
    && Boolean(previousItem?.pendingSync) === Boolean(nextItem?.pendingSync)
    && Boolean(previousItem?.decryptionFailed) === Boolean(nextItem?.decryptionFailed)
    && previousItem?.unsent === nextItem?.unsent
    && previousItem?.isDeleted === nextItem?.isDeleted
    && previousItem?.audioUrl === nextItem?.audioUrl
    && previousItem?.audioDuration === nextItem?.audioDuration
    && previousItem?.forwarded === nextItem?.forwarded
    && JSON.stringify(previousItem?.reactions || {}) === JSON.stringify(nextItem?.reactions || {})
    && JSON.stringify(previousItem?.reactionTimes || {}) === JSON.stringify(nextItem?.reactionTimes || {})
    && JSON.stringify(previousItem?.replyTo || null) === JSON.stringify(nextItem?.replyTo || null)
    && (toDate(messageTimestamp(previousItem))?.getTime() || 0) === (toDate(messageTimestamp(nextItem))?.getTime() || 0);
}

function ReactionBadge({ count, colors, emojis, styles }) {
  const popAnim = useRef(new Animated.Value(1)).current;
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    popAnim.setValue(0.7);
    Animated.spring(popAnim, {
      toValue: 1,
      friction: 4,
      tension: 220,
      useNativeDriver: true,
    }).start();
  }, [count, emojis]);

  const visibleEmojis = (Array.isArray(emojis) ? emojis : []).filter(Boolean).slice(0, 2);
  const badgeWidth = Math.max(
    count > 1 ? 34 : 28,
    18 + (visibleEmojis.length * 13) + (count > 1 ? String(count).length * 6 : 0)
  );
  return (
    <Animated.View style={[styles.reactionBadge, { backgroundColor: colors.card, borderColor: colors.line, minWidth: badgeWidth, transform: [{ scale: popAnim }] }]}>
      <View style={styles.reactionBadgeEmojiGroup}>
        {visibleEmojis.map((emoji, index) => (
          <View key={`${emoji}-${index}`} style={[styles.reactionEmojiPill, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={styles.reactionBadgeEmoji}>{emoji}</Text>
          </View>
        ))}
      </View>
      {count > 1 ? (
        <View style={[styles.reactionBadgeCountPill, { backgroundColor: colors.surfaceRaised }]}>
          <Text style={[styles.reactionBadgeCount, { color: colors.inkMuted }]}>{count}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

function Avatar({ avatarColor, cacheScope, cacheVersion, colors, emoji, size, uri }) {
  const isUrl = typeof uri === 'string' && (uri.startsWith('http') || uri.startsWith('file://') || uri.startsWith('data:'));
  const remoteUri = useRemoteImage(isUrl ? uri : null, cacheVersion, cacheScope);
  const displayUri = remoteUri || (isUrl ? uri : null);
  const resolvedEmoji = emoji || (!isUrl && typeof uri === 'string' && uri.length <= 6 ? uri : null);
  return <ResolvedAvatar avatarColor={avatarColor} colors={colors} emoji={resolvedEmoji} size={size} uri={displayUri} />;
}

function ResolvedAvatar({ avatarColor, colors, emoji, size, uri }) {
  if (uri) {
    return (
      <ExpoImage
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: avatarColor || colors.primarySoft || colors.line,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {emoji ? (
        <Text style={{ fontSize: size * 0.52 }}>{emoji}</Text>
      ) : (
        <FeatureIcon color={colors.inkSoft} name="person.fill" size={size * 0.48} />
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  headerRightActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  headerJoinCallPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00BA51',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginRight: 6,
    gap: 4,
    shadowColor: '#00BA51',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 3,
  },
  headerJoinCallText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerCallBtn: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerMoreBtn: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  bubble: {
    borderRadius: 16,
    maxWidth: 260,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  callBubbleWrapper: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 0,
    maxWidth: 280,
  },
  bubbleText: {
    color: colors.ink,
    fontSize: 13.5,
    includeFontPadding: false,
    maxWidth: '100%',
    flexShrink: 1,
    lineHeight: 18.5,
  },
  composerWrapper: {
    backgroundColor: colors.canvas,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    width: '100%',
  },
  composer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  dayDivider: { ...type.caption2, color: colors.inkSoft, marginVertical: spacing.md, textAlign: 'center' },
  emptyRoom: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: spacing.xxxl },
  emptyText: { ...type.bodySmall, color: colors.inkSoft, textAlign: 'center' },
  emptyTitle: { ...type.headline, color: colors.ink, marginBottom: spacing.xs, marginTop: spacing.md },
  messageContentRow: { alignItems: 'flex-end', flexDirection: 'row', flexShrink: 1, gap: 4, maxWidth: '100%' },
  messageContentRowMine: { justifyContent: 'flex-end' },
  messageStack: { flexShrink: 1, maxWidth: '100%', minWidth: 0 },
  messageStackMine: { alignItems: 'flex-end' },
  messageStackOther: { alignItems: 'flex-start' },
  messageBubbleWithReaction: { flexShrink: 1, maxWidth: '100%', minWidth: 0, position: 'relative' },
  reactionLayer: { minHeight: 22, position: 'relative', zIndex: 2 },
  reactionLayerMine: { alignSelf: 'flex-start', marginLeft: 8, marginTop: 1 },
  reactionLayerOther: { alignSelf: 'flex-end', marginRight: 8, marginTop: 1 },
  messageGroup: { flexGrow: 0, flexShrink: 1, gap: 2, maxWidth: 300, minWidth: 0 },
  messageGroupMine: { alignItems: 'flex-end' },
  messageListWrapper: {
    flex: 1,
    position: 'relative',
    width: '100%',
  },
  scrollToBottomBtnContainer: {
    elevation: 6,
    position: 'absolute',
    right: 18,
    bottom: 16,
    zIndex: 99,
  },
  scrollToBottomBtn: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    elevation: 4,
    height: 44,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    width: 44,
  },
  scrollBadge: {
    alignItems: 'center',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -4,
    top: -4,
  },
  scrollBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  messageList: { alignSelf: 'center', maxWidth: 760, paddingBottom: spacing.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md, width: '100%' },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, marginBottom: 10, position: 'relative', width: '100%' },
  messageRowMine: { justifyContent: 'flex-end' },
  dragTimeGutter: {
    alignItems: 'flex-end',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: -48,
    top: 0,
    width: 46,
  },
  dragTimeText: {
    fontSize: 11,
    fontWeight: '500',
    includeFontPadding: false,
    textAlign: 'right',
  },
  messageTime: { ...type.caption2, color: colors.inkSoft, fontSize: 10.5, paddingHorizontal: spacing.xs },
  messageTimeMine: { textAlign: 'right' },
  myBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  myBubbleText: { color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
  forwardedBubbleLabel: { color: colors.inkSoft, fontSize: 10, fontWeight: '700', marginBottom: 3 },
  forwardedBubbleLabelMine: { color: 'rgba(255,255,255,0.72)' },
  replyBubble: { backgroundColor: colors.canvas, borderRadius: 10, marginBottom: 6, paddingHorizontal: 9, paddingVertical: 6 },
  replyBubbleMine: { backgroundColor: 'rgba(255,255,255,0.16)' },
  replyBubbleText: { color: colors.inkSoft, fontSize: 11.5, maxWidth: 220 },
  replyBubbleTextMine: { color: 'rgba(255,255,255,0.76)' },
  replyComposer: { alignItems: 'center', backgroundColor: colors.canvas, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  replyComposerClose: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 15, height: 30, justifyContent: 'center', width: 30 },
  replyComposerCopy: { backgroundColor: colors.card, borderRadius: radius.sm, flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  replyComposerText: { ...type.caption, color: colors.inkSoft, marginTop: 1 },
  replyComposerTitle: { ...type.caption, color: colors.primary, fontWeight: '800' },
  e2eeBanner: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  e2eePendingBanner: { alignItems: 'center', backgroundColor: 'rgba(255,149,0,0.12)', borderRadius: radius.sm, flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  e2eeText: { ...type.caption2, color: colors.primary, flex: 1 },
  e2eePendingText: { ...type.caption2, color: '#A15C00', flex: 1 },
  roomContainer: { backgroundColor: colors.canvas, flex: 1 },
  roomHeader: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  headerPartnerPressable: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  roomIdentity: { flex: 1 },
  roomName: { ...type.headline, color: colors.ink },
  roomSubtitle: { ...type.caption, color: colors.inkSoft },
  inputCapsule: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 46,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 4,
    width: '100%',
  },
  capsuleTrailingContainer: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  capsuleSmileyBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  capsuleTextInput: {
    ...type.body,
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    ...(Platform.OS === 'ios' ? { lineHeight: 20 } : {}),
    marginHorizontal: 4,
    maxHeight: 120,
    minHeight: 36,
    paddingHorizontal: 6,
    paddingVertical: Platform.OS === 'android' ? 6 : 8,
    textAlignVertical: 'center',
  },
  capsuleSendButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#3B5AFE',
    borderRadius: 18,
    elevation: 0,
    flexShrink: 0,
    height: 36,
    justifyContent: 'center',
    maxHeight: 36,
    maxWidth: 46,
    minHeight: 36,
    minWidth: 46,
    paddingHorizontal: 12,
  },
  sendDisabled: { opacity: 0.4 },
  quickEmojiBar: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    paddingVertical: 6,
    width: '100%',
  },
  quickEmojiContent: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  quickEmojiButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  quickEmojiChar: {
    fontSize: 22,
    includeFontPadding: false,
    textAlign: 'center',
  },
  reactionBadge: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 0,
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 3,
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 2,
  },
  reactionBadgePressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },
  reactionBadgeEmojiGroup: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  reactionEmojiPill: { alignItems: 'center', borderRadius: 9, height: 18, justifyContent: 'center', minWidth: 18, paddingHorizontal: 1 },
  reactionBadgeEmoji: {
    fontSize: 12,
    includeFontPadding: false,
    lineHeight: 15,
    textAlign: 'center',
  },
  reactionBadgeCount: {
    fontSize: 9,
    fontWeight: '700',
    includeFontPadding: false,
    minWidth: 8,
    textAlign: 'center',
  },
  reactionBadgeCountPill: { alignItems: 'center', borderRadius: 9, height: 18, justifyContent: 'center', minWidth: 18, paddingHorizontal: 3 },
  theirBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  pinnedMeetupContainer: {
    backgroundColor: colors.canvas,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    zIndex: 10,
  },
  chatMeetupCard: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  chatMeetupCardCompact: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  chatMeetupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chatMeetupIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  chatMeetupEyebrow: { ...type.caption2, color: colors.primary, fontWeight: '800' },
  chatMeetupTitle: { ...type.subheadline, color: colors.ink, fontWeight: '800' },
  chatMeetupCompactTime: { ...type.caption2, color: colors.inkMuted, marginTop: 1 },
  chatMeetupFullBadge: { backgroundColor: 'rgba(255,100,100,0.15)', borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  chatMeetupFullText: { ...type.caption2, color: '#FF453A', fontWeight: '800', fontSize: 10 },
  chatMeetupOpenBadge: { backgroundColor: colors.primarySoft, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  chatMeetupOpenText: { ...type.caption2, color: colors.primary, fontWeight: '800', fontSize: 10 },
  chatMeetupMiniBtn: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chatMeetupMiniBtnAccepted: { backgroundColor: '#34C759' },
  chatMeetupMiniBtnDisabled: { backgroundColor: colors.line, opacity: 0.6 },
  chatMeetupMiniBtnText: { ...type.caption, color: '#FFFFFF', fontWeight: '700' },
  expandToggleBtn: {
    alignItems: 'center',
    backgroundColor: colors.line,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  chatMeetupExpandedBody: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
  },
  chatMeetupMeta: { flexDirection: 'column', gap: 4, marginVertical: spacing.xs, paddingHorizontal: 2 },
  chatMeetupInfoRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  chatMeetupTime: { ...type.caption, color: colors.inkMuted },
  chatMeetupCount: { ...type.caption, color: colors.ink, fontWeight: '700' },
  chatMeetupBtn: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.full, justifyContent: 'center', marginTop: spacing.xs, paddingVertical: spacing.sm },
  chatMeetupBtnAccepted: { backgroundColor: '#34C759' },
  chatMeetupBtnDisabled: { backgroundColor: colors.line, opacity: 0.6 },
  chatMeetupBtnText: { ...type.subheadline, color: '#FFFFFF', fontWeight: '800' },
  chatMeetupBtnTextAccepted: { color: '#FFFFFF' },
  capsuleActionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingRight: 4,
  },
  capsuleActionIconBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  voiceRecordingBarContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  voiceCancelCircleBtn: {
    alignItems: 'center',
    backgroundColor: '#3B5AFE',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  voiceWaveCapsule: {
    alignItems: 'center',
    backgroundColor: '#3B5AFE',
    borderRadius: 22,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    paddingHorizontal: 8,
  },
  voiceControlWhiteCircle: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  voiceControlWhiteCircleDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  voiceDurationBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  voiceDurationBadgeDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  voiceDurationText: {
    color: '#3B5AFE',
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  voiceDurationTextDark: {
    color: '#FFFFFF',
  },
  voiceSendCircleBtn: {
    alignItems: 'center',
    backgroundColor: '#3B5AFE',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  inputCapsuleRecording: {
    borderColor: '#EF4444',
    borderWidth: 1.5,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  recordingPulseRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    gap: 8,
  },
  recordingDot: {
    backgroundColor: '#EF4444',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  recordingTimerText: {
    fontSize: 14,
    fontWeight: '700',
  },
  recordingPromptText: {
    fontSize: 12,
    marginLeft: 4,
  },
  recordingActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  capsuleIconBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  clipboardBanner: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  clipboardBannerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  clipboardBannerText: {
    ...type.bodySmall,
    flex: 1,
    fontWeight: '600',
  },
  clipboardPasteBtn: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  clipboardPasteBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  clipboardCloseBtn: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  imagePreviewBar: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  imagePreviewThumb: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  imagePreviewInfo: {
    flex: 1,
  },
  imagePreviewTitle: {
    ...type.bodySmall,
    fontWeight: '700',
  },
  imagePreviewSubtitle: {
    ...type.caption,
    marginTop: 2,
  },
  imagePreviewEdit: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised || 'rgba(0,0,0,0.05)',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    marginRight: 6,
    width: 28,
  },
  imagePreviewClose: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised || 'rgba(0,0,0,0.05)',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  imageBubble: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 0,
    elevation: 0,
    overflow: 'hidden',
    paddingHorizontal: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
  },
  stackedImageBubble: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 18,
    borderWidth: 0,
    elevation: 0,
    overflow: 'visible',
    paddingHorizontal: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
  },
  bubbleImageContainer: {
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  imageExpandBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 12,
    bottom: 8,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 24,
  },
  bubbleImage: {
    borderRadius: 18,
    height: 180,
    maxWidth: 240,
    width: 230,
  },
  bubbleCaptionText: {
    marginTop: 6,
    paddingHorizontal: 6,
  },
  fullscreenImageViewer: {
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
  },
  fullscreenHeader: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  fullscreenHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    width: '100%',
  },
  fullscreenCloseBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  fullscreenCounterBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  fullscreenCounterText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  fullscreenNavBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    marginTop: -22,
    position: 'absolute',
    top: '50%',
    width: 44,
    zIndex: 20,
  },
  fullscreenNavLeft: {
    left: 16,
  },
  fullscreenNavRight: {
    right: 16,
  },
  fullscreenImage: {
    height: '100%',
    width: '100%',
  },
  gifCapsuleBadge: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  trackBubble: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 10, maxWidth: 260, minWidth: 200, padding: 10 },
  trackBubbleMine: { backgroundColor: 'rgba(255,255,255,0.14)' },
  trackBubbleTheirs: { backgroundColor: 'rgba(15,27,51,0.04)' },
  trackBubbleArt: { borderRadius: 8, height: 52, width: 52 },
  trackBubbleArtFallback: { alignItems: 'center', justifyContent: 'center' },
  trackBubbleMeta: { flex: 1, minWidth: 0 },
  trackBubbleName: { color: '#25272B', fontSize: 14, fontWeight: '800' },
  trackBubbleNameMine: { color: '#FFFFFF' },
  trackBubbleArtists: { color: '#6B7078', fontSize: 12, fontWeight: '600', marginTop: 2 },
  trackBubbleArtistsMine: { color: 'rgba(255,255,255,0.75)' },
  trackBubbleCta: { color: '#3986E8', fontSize: 11, fontWeight: '800', marginTop: 4 },
  trackBubbleCtaMine: { color: 'rgba(255,255,255,0.9)' },
  gifCapsuleBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
