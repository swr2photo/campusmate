import { randomUUID } from 'expo-crypto';
import { stageVideoUpgrade, cancelVideoUpgrade, resumeVideoUpgrades } from '../services/videoUpgradeService';
import ChatVideoBubble from '../components/ChatVideoBubble';
import ChatVideoComposer from '../components/ChatVideoComposer';
import ChatCameraModal from '../components/ChatCameraModal';
import ChatMediaComposer from '../components/ChatMediaComposer';
import ChatProtectedImageBubble from '../components/ChatProtectedImageBubble';
import { pickChatVideo } from '../services/chatVideoService';
import { validateChatVideo } from '../utils/chatVideoPolicy';
import ReplyPreview from '../components/ReplyPreview';
import MessageTimeSwipeArea from '../components/MessageTimeSwipeArea';
import { createReplySnapshot, resolveMessageReply } from '../utils/messageReply';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { ActionSheetIOS, Alert, Animated, AppState, Image as RNImage, Keyboard, Modal, Platform, Pressable, Switch, Text as RNText, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Button,
  ContentUnavailableView,
  ContextMenu,
  Host,
  RNHostView,
  HStack,
  Image,
  List,
  ProgressView,
  ScrollView,
  Spacer,
  SwipeActions,
  Text,
  TextField,
  useNativeState,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  aspectRatio,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  controlSize,
  cornerRadius,
  defaultScrollAnchor,
  disabled,
  font,
  foregroundStyle,
  frame,
  id,
  labelStyle,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  multilineTextAlignment,
  offset,
  onTapGesture,
  onGeometryChange,
  onLongPressGesture,
  onSubmit,
  opacity,
  padding,
  resizable,
  rotationEffect,
  scaleEffect,
  scrollDismissesKeyboard,
  scrollIndicators,
  scrollPosition,
  scrollContentBackground,
  shadow,
  shapes,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { decryptConversationMessageList, mergeProfileRecords, toSafePublicProfile } from '../services/firestoreService';
import {
  ensureConversationEncryption,
  getConversationKey,
  getOrCreateEncryptionIdentity,
  hasCurrentDeviceEnvelope,
  isValidConversationEncryption,
  getOrFetchConversationKey,
} from '../services/chatEncryptionService';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { useApp } from '../context/AppContext';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate } from '../utils/formatters';
import { canCancelMeetup, isMeetupExpired } from '../utils/meetupTime';
import { getMessageReactionSummary, recordReactionUsage, useQuickReactions } from '../utils/messageReactions';
import InstagramMessageOverlay, { DEFAULT_MESSAGE_REACTION } from '../components/InstagramMessageOverlay';
import ReactionDetailsModal from '../components/ReactionDetailsModal';
import ChatMediaPickerSheet from '../components/ChatMediaPickerSheet';
import DecryptedChatImage from '../components/DecryptedChatImage';
import ChatImageViewerModal from '../components/ChatImageViewerModal';
import ChatImageEditorModal from '../components/ChatImageEditorModal';
import ReportModal from '../components/ReportModal';
import {
  getChatImageBubbleSize,
  measureImageAspectRatio,
  getCachedAspectRatio,
  getPastedImageFromClipboard,
  extractFirstImageUrl,
  hasSeenStackFlipHint,
  setStackFlipHintSeen,
} from '../utils/chatImageUtils';
import { setActiveConversation } from '../services/notificationService';
import {
  cancelAudioRecording,
  ensureAudioPlaybackMode,
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

const DOUBLE_TAP_WINDOW_MS = 320;
// Keep the context menu responsive while retaining a deliberate press-and-hold
// gesture (Android uses the same ~220ms threshold).
const LONG_PRESS_DURATION_SECONDS = 0.22;
const MESSAGE_TIME_REVEAL_THRESHOLD = 28;
const MESSAGE_TIME_REVEAL_DURATION_MS = 1800;
const POPULAR_CHAT_EMOJIS = ['😊', '😂', '🥰', '👍', '❤️', '🔥', '🎉', '🥺', '✨', '🙏', '😍', '🤣', '😎', '🙌', '💯', '🥳', '😉', '👋', '😭', '💖'];

const darkPalette = {
  background: '#0D0F12',
  surface: '#1A1D22',
  raised: '#242830',
  text: '#F8F9FC',
  secondary: '#A7AFBC',
  tertiary: '#6F7887',
  accent: '#FF6F61',
  accentSoft: 'rgba(255,111,97,0.16)',
  incoming: '#22262D',
  line: 'rgba(255,255,255,0.08)',
  white: '#FFFFFF',
};

const lightPalette = {
  background: '#F5F7FB',
  surface: '#FFFFFF',
  raised: '#EDF0F5',
  text: '#111827',
  secondary: '#667085',
  tertiary: '#98A2B3',
  accent: '#EE6B5D',
  accentSoft: 'rgba(238,107,93,0.14)',
  incoming: '#FFFFFF',
  line: 'rgba(17,24,39,0.08)',
  white: '#FFFFFF',
};

const avatarShape = shapes.circle();
const messageShape = shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' });
const imageBubbleShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });

const TOTAL_WAVE_BARS = 18;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 24;

function getWaveformBars(levels, isRecording) {
  const result = [];
  const len = (levels || []).length;
  for (let i = 0; i < TOTAL_WAVE_BARS; i++) {
    let norm = 0.2;
    if (len > 0) {
      const index = Math.max(0, len - TOTAL_WAVE_BARS + i);
      if (index >= 0 && index < len) {
        norm = levels[index];
      } else {
        norm = 0.15 + Math.sin((i / TOTAL_WAVE_BARS) * Math.PI) * 0.2;
      }
    } else if (isRecording) {
      norm = 0.18 + Math.abs(Math.sin((i + Date.now() / 200) * 0.5)) * 0.25;
    } else {
      const pattern = [0.25, 0.4, 0.7, 0.5, 0.85, 0.45, 0.6, 0.9, 0.65, 0.4, 0.75, 0.55, 0.35, 0.6, 0.8, 0.45, 0.7, 0.5];
      norm = pattern[i % pattern.length];
    }
    const barHeight = Math.round(MIN_BAR_HEIGHT + norm * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT));
    result.push(Math.max(MIN_BAR_HEIGHT, Math.min(MAX_BAR_HEIGHT, barHeight)));
  }
  return result;
}

function usePalette() {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

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

function messageDate(message) {
  return toDate(message.createdAt || message.time);
}

function messageTimestamp(message) {
  return message?.createdAt || message?.time || message?.timestamp;
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

function formatStatusTime(item, mine, isLatest, otherReadAt, otherUnread, showAllMessageTimes = false) {
  const sentDate = messageDate(item);
  if (!sentDate) return '';
  const sentTime = sentDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (mine && isLatest) {
    if (item.pendingSync) {
      return 'กำลังส่ง...';
    }
    const readDate = toDate(otherReadAt);
    const isReadByOther = Boolean(
      (readDate && sentDate && readDate.getTime() >= sentDate.getTime())
      || (typeof otherUnread === 'number' && otherUnread === 0 && otherReadAt)
    );

    if (isReadByOther) {
      const readTime = readDate ? readDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) : sentTime;
      return `อ่านแล้วเมื่อ ${readTime}`;
    }

    return `ส่งแล้วเมื่อ ${sentTime}`;
  }

  if (showAllMessageTimes) {
    return sentTime;
  }

  return '';
}

function isSameDay(messageA, messageB) {
  const dateA = messageDate(messageA);
  const dateB = messageDate(messageB);
  if (!dateA || !dateB) return false;
  return dateA.toDateString() === dateB.toDateString();
}

function formatDay(message) {
  const date = messageDate(message);
  return date ? date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

export default function ChatRoomScreen() {
  const { chatId, entryAnimation } = useLocalSearchParams();
  const {
    acceptedIncomingLikes,
    allConversations,
    availableProfiles,
    conversations,
    deleteMessageForMeInChat,
    getMeetupStats,
    markAsRead,
    matchedProfileIds,
    outgoingLikes,
    profile,
    reactToMessageInChat,
    removeConversation,
    blockUser,
    reportContent,
    sendMessage,
    toggleMeetupAcceptanceInChat,
    unsendMessageInChat,
    updateChatSettingsInChat,
  } = useApp();
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const currentUserId = profile?.id;
  const normalizedChatId = Array.isArray(chatId) ? chatId[0] : chatId;
  const isPopupEntry = entryAnimation === 'popup';
  const chatEntryProgress = useRef(new Animated.Value(isPopupEntry ? 0 : 1)).current;
  const chatEntryScale = chatEntryProgress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  const chatEntryTranslateY = chatEntryProgress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  useEffect(() => {
    if (!isPopupEntry) return undefined;
    const animation = Animated.spring(chatEntryProgress, {
      damping: 15,
      mass: 0.8,
      stiffness: 220,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [chatEntryProgress, isPopupEntry]);

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
    Alert.alert('ยกเลิกการส่ง?', 'ข้อความนี้จะหายจากห้องสนทนาของทั้งสองฝ่าย', [
      { style: 'cancel', text: 'ยกเลิก' },
      {
        onPress: () => unsendMessageInChat(chat.id, item.id).catch((error) => console.error('unsend message error:', error)),
        style: 'destructive',
        text: 'ยกเลิกการส่ง',
      },
    ]);
  }, [chat?.id, unsendMessageInChat]);

  const handleReact = useCallback(async (item, emoji) => {
    if (!chat?.id || !item?.id || !emoji) return;
    setActionMessage(null);
    try {
      await reactToMessageInChat(chat.id, item.id, emoji);
    } catch (e) {
      console.error('react message error:', e);
    }
  }, [chat?.id, reactToMessageInChat]);

  const handleQuickReact = useCallback((item) => {
    handleReact(item, DEFAULT_MESSAGE_REACTION);
  }, [handleReact]);

  const handleReply = useCallback((item) => {
    setActionMessage(null);
    setReplyingTo(item);
  }, []);

  const handleDeleteForMe = useCallback((item) => {
    if (!chat?.id || !item?.id) return;
    setActionMessage(null);
    Alert.alert('ลบสำหรับคุณ?', 'อีกฝ่ายจะยังเห็นข้อความนี้ตามปกติ', [
      { style: 'cancel', text: 'ยกเลิก' },
      {
        onPress: () => deleteMessageForMeInChat(chat.id, item.id).catch((error) => console.error('delete message error:', error)),
        style: 'destructive',
        text: 'ลบ',
      },
    ]);
  }, [chat?.id, deleteMessageForMeInChat]);

  const [videoDraft, setVideoDraft] = useState(null);
  const handlePickVideo = async () => {
    try { const asset = await pickChatVideo(); if (asset) setMediaComposerDraft({ ...asset, type: 'video' }); }
    catch (error) { Alert.alert('เลือกวิดีโอไม่สำเร็จ', error.message); }
  };
  const handleSendVideo = async (asset, mode, caption = '') => {
    validateChatVideo(asset, mode);
    if (!chat?.id || !currentUserId || chat.encryptionPending) throw new Error('ห้องแชตยังไม่พร้อมส่งวิดีโอ');
    const replySnapshot = replyingTo;
    const conversationKey = await getOrFetchConversationKey(chat.id, currentUserId);
    const mediaUrl = await uploadChatMedia(asset.uri, {
      conversationId: chat.id, mediaType: 'video', extension: 'mp4', conversationKey, videoDuration: asset.duration,
    });
    const messageId = randomUUID();
    if (asset.upgradeSource) await stageVideoUpgrade({ userId: currentUserId, conversationId: chat.id, messageId,
      asset: asset.upgradeSource, edit: asset.videoEdit, mode });
    try {
      const sent = await sendMessage(chat.id, caption.trim() || '[วิดีโอ]', { clientMessageId: messageId,
        mediaType: 'video', mediaUrl, videoMode: mode, videoDuration: asset.duration,
        videoStartMs: asset.videoEdit?.startMs, videoEndMs: asset.videoEdit?.endMs,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined });
      if (!sent) throw new Error('ไม่สามารถส่งวิดีโอได้');
      setReplyingTo(null);
    } catch (error) { await cancelVideoUpgrade(currentUserId, messageId); throw error; }
    void resumeVideoUpgrades(currentUserId);
  };

  const handleForward = useCallback(async (item, targetConversationId) => {
    setActionMessage(null);
    if (item?.mediaType === 'video') {
      Alert.alert('ไม่สามารถส่งต่อวิดีโอ', 'กรุณาเลือกวิดีโอจากเครื่องเพื่อส่งใหม่');
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
            preCacheDecryptedMedia(newDownloadUrl, localUri);
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
      Alert.alert('ส่งต่อแล้ว', 'ส่งข้อความไปยังห้องสนทนาที่เลือกเรียบร้อย');
    } catch (error) {
      Alert.alert('ส่งต่อไม่สำเร็จ', error?.message || 'กรุณาลองใหม่อีกครั้ง');
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

  const messageState = useNativeState('');
  const [hasText, setHasText] = useState(false);
  const [showQuickEmoji, setShowQuickEmoji] = useState(false);
  const configuredQuickReactions = useQuickReactions();
  const emojiPanelEmojis = useMemo(() => Array.from(new Set([
    ...(configuredQuickReactions || []),
    ...POPULAR_CHAT_EMOJIS,
  ])), [configuredQuickReactions]);
  const initialLatestId = useMemo(() => {
    const msgs = chat?.messages || [];
    return msgs[msgs.length - 1]?.id || chat?.lastMessageId || null;
  }, [chat?.lastMessageId, chat?.messages]);
  const scrollTarget = useNativeState(initialLatestId);
  const textFieldRef = useRef(null);
  const sendingRef = useRef(false);

  const handleScrollToMessage = useCallback((targetId) => {
    if (!targetId) return;
    try {
      if (scrollTarget && typeof scrollTarget.set === 'function') {
        scrollTarget.set(targetId);
      }
    } catch (_) {}
  }, [scrollTarget]);

  const handleInsertEmoji = useCallback((emoji) => {
    try {
      void recordReactionUsage(emoji);
      const current = (messageState.get() || '') + emoji;
      messageState.set(current);
      setHasText(Boolean(current && current.trim().length > 0));
      textFieldRef.current?.setText(current);
    } catch (_) {}
  }, [messageState]);
  const otherUserId = chat?.profileId || chat?.participants?.find((participantId) => participantId !== currentUserId);
  const partnerAvatar = chat?.avatarUri || chat?.avatar;
  const partnerAvatarUri = typeof partnerAvatar === 'string'
    && (partnerAvatar.startsWith('http') || partnerAvatar.startsWith('file://') || partnerAvatar.startsWith('data:'))
    ? partnerAvatar
    : null;
  const resolvedPartnerAvatar = useRemoteImage(
    partnerAvatarUri,
    chat?.participantProfiles?.[otherUserId]?.updatedAt,
    otherUserId
  );
  const otherReadAt = chat?.readReceipts?.[otherUserId] || null;
  const isReadByOther = (chat?.unreadCounts?.[otherUserId] || 0) === 0;

  const [directMessages, setDirectMessages] = useState(null);

  useEffect(() => {
    if (!normalizedChatId) {
      setDirectMessages(null);
      return;
    }

    let isSubscribed = true;
    let unsubscribe = () => {};

    const startListener = async () => {
      try {
        const { db } = requireFirebase();
        let key = null;
        if (currentUserId) {
          try {
            key = await getOrFetchConversationKey(normalizedChatId, currentUserId);
          } catch {
            key = null;
          }
        }

        if (!isSubscribed) return;

        const messagesRef = collection(db, 'conversations', normalizedChatId, 'messages');
        const messagesQuery = query(
          messagesRef,
          orderBy('createdAt', 'desc'),
          limit(40)
        );
        unsubscribe = onSnapshot(
          messagesQuery,
          async (snapshot) => {
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
              let currentKey = key;
              if (!currentKey && currentUserId) {
                try {
                  currentKey = await getOrFetchConversationKey(normalizedChatId, currentUserId);
                  if (currentKey) key = currentKey;
                } catch {}
              }
              const historyCutoff = chat?.historyClearedAt?.[currentUserId] || null;
              const decryptedList = decryptConversationMessageList(
                normalizedChatId,
                rawDocs,
                currentKey,
                currentUserId,
                historyCutoff
              );
              if (isSubscribed) {
                setDirectMessages(decryptedList);
              }
            } catch (err) {
              console.warn('ChatRoom direct messages decrypt error (iOS):', err?.message || err);
            }
          },
          (error) => {
            console.warn('ChatRoom direct messages listener error (iOS):', error?.message || error);
          }
        );
      } catch (err) {
        console.warn('ChatRoom direct listener setup failed (iOS):', err?.message || err);
      }
    };

    startListener();

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, [normalizedChatId, currentUserId]);

  const [olderMessages, setOlderMessages] = useState([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const oldestDocRef = useRef(null);

  useEffect(() => {
    setOlderMessages([]);
    setIsLoadingOlder(false);
    setHasMoreOlder(false);
    oldestDocRef.current = null;
  }, [normalizedChatId]);

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
      console.warn('Failed to load older messages (iOS):', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [chat?.historyClearedAt, currentUserId, hasMoreOlder, isLoadingOlder, normalizedChatId]);

  const [localPendingMediaMessages, setLocalPendingMediaMessages] = useState([]);

  const effectiveMessages = useMemo(() => {
    const directWithOlder = directMessages !== null
      ? [...olderMessages, ...directMessages]
      : null;
    const base = directWithOlder !== null ? directWithOlder : (chat?.messages || []);
    const baseIds = new Set(base.map((b) => b?.id).filter(Boolean));
    const baseMediaUrls = new Set(base.map((b) => b?.mediaUrl).filter(Boolean));
    const pendingOptimistic = (chat?.messages || []).filter(
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
  }, [chat?.messages, directMessages, localPendingMediaMessages, olderMessages]);

  const latestMessageId = effectiveMessages[effectiveMessages.length - 1]?.id || null;

  const [partnerProfileDirect, setPartnerProfileDirect] = React.useState(null);
  const [isBannerExpanded, setIsBannerExpanded] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [showAllMessageTimes, setShowAllMessageTimes] = React.useState(false);
  const [previewImageUrl, setPreviewImageUrl] = React.useState(null);
  const [previewImages, setPreviewImages] = React.useState([]);
  const [previewIndex, setPreviewIndex] = React.useState(0);
  const [editingMedia, setEditingMedia] = React.useState(null);
  const [editingMediaUris, setEditingMediaUris] = React.useState([]);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [mediaComposerDraft, setMediaComposerDraft] = React.useState(null);

  const handleTextFieldFocusChange = useCallback((focused) => {
    if (focused) {
      setShowQuickEmoji(false);
      setIsMediaPickerOpen(false);
    }
  }, []);

  const handleTextFieldChange = useCallback((val) => {
    const trimmed = (val || '').trim();
    if (trimmed.startsWith('data:image/')) {
      textFieldRef.current?.clear();
      messageState.set('');
      setHasText(false);
      setEditingMedia(trimmed);
      setEditingMediaUris([trimmed]);
      return;
    }
    const firstImgUrl = extractFirstImageUrl(trimmed);
    if (firstImgUrl && (trimmed === firstImgUrl || trimmed.length <= firstImgUrl.length + 6)) {
      textFieldRef.current?.clear();
      messageState.set('');
      setHasText(false);
      setEditingMedia(firstImgUrl);
      setEditingMediaUris([firstImgUrl]);
      return;
    }
    setHasText(Boolean(val && val.trim().length > 0));
  }, [messageState]);


  const handlePasteClipboardImage = useCallback(async () => {
    try {
      const uri = await getPastedImageFromClipboard();
      if (uri) {
        setClipboardImage(null);
        setMediaComposerDraft({ uri, uris: uris?.length ? uris : [uri], type: 'image', edit: true });
        setEditingMediaUris([uri]);
      } else {
        Alert.alert('คลิปบอร์ด', 'ไม่พบรูปภาพหรือลิงก์รูปภาพที่คัดลอกมา');
      }
    } catch (err) {
      Alert.alert('ไม่สามารถวางรูปได้', err?.message || 'กรุณาลองใหม่อีกครั้ง');
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
  const allMessageTimesTimerRef = useRef(null);
  const [messageListHeight, setMessageListHeight] = useState(0);
  const handleMessageListGeometry = useCallback(({ height }) => setMessageListHeight(height), []);
  const [tick, setTick] = React.useState(0);

  const revealAllMessageTimes = useCallback(() => {
    setShowAllMessageTimes(true);
    if (allMessageTimesTimerRef.current) clearTimeout(allMessageTimesTimerRef.current);
    allMessageTimesTimerRef.current = setTimeout(() => {
      setShowAllMessageTimes(false);
      allMessageTimesTimerRef.current = null;
    }, MESSAGE_TIME_REVEAL_DURATION_MS);
  }, []);

  const isMatchActive = useMemo(() => {
    if (!otherUserId) return true;
    if (chat?.id && !chat.isHidden) return true;
    if (matchedProfileIds?.includes(otherUserId)) return true;
    const isIncoming = (acceptedIncomingLikes || []).some((like) => like.id === otherUserId);
    const isOutgoing = (outgoingLikes || []).some((like) => like.id === otherUserId && like.status === 'accepted');
    return isIncoming || isOutgoing;
  }, [acceptedIncomingLikes, chat?.id, chat?.isHidden, matchedProfileIds, otherUserId, outgoingLikes]);

  const handleOpenPartnerProfile = useCallback(() => {
    if (otherUserId) {
      router.push({
        pathname: '/discover-profile',
        params: { profileId: otherUserId, id: otherUserId, viewOnly: 'true' },
      });
    }
  }, [otherUserId]);

  const handleRemoveConversation = () => {
    setIsSettingsOpen(false);
    Alert.alert(
      'ยกเลิกการจับคู่และลบห้องสนทนา?',
      `การจับคู่และห้องสนทนากับ ${chat?.name || 'เพื่อน'} จะถูกนำออกจากรายการของคุณ`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบห้องสนทนา',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeConversation(chat?.id, otherUserId);
              router.replace('/chat');
            } catch (error) {
              console.error('removeConversation error:', error);
            }
          },
        },
      ]
    );
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
    setReportTarget({
      reportedUserId: otherUserId,
      messageId: null,
      mediaUrl: null,
      messageText: null,
      isMessageReport: false,
    });
    setIsReportModalOpen(true);
  }, [otherUserId]);

  const handleOpenReportMessage = useCallback((item) => {
    setActionMessage(null);
    setReportTarget({
      reportedUserId: otherUserId,
      messageId: item?.id,
      mediaUrl: item?.mediaUrl || null,
      messageText: item?.text || null,
      isMessageReport: true,
    });
    setIsReportModalOpen(true);
  }, [otherUserId]);

  const handleBlockUserAction = useCallback(() => {
    setIsSettingsOpen(false);
    Alert.alert(
      `บล็อก ${chat?.name || 'ผู้ใช้นี้'}?`,
      'คุณจะไม่เห็นข้อความและการจับคู่กับผู้ใช้นี้อีกต่อไป และผู้ใช้นี้จะไม่สามารถส่งข้อความหาคุณได้',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'บล็อกผู้ใช้',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(otherUserId, chat?.id);
              Alert.alert('บล็อกผู้ใช้เรียบร้อยแล้ว');
              router.replace('/chat');
            } catch (err) {
              Alert.alert('บล็อกไม่สำเร็จ', err?.message || 'กรุณาลองใหม่อีกครั้ง');
            }
          },
        },
      ]
    );
  }, [blockUser, chat?.id, chat?.name, otherUserId]);

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

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!otherUserId) return;
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

  const handleToggleAcceptMeetup = async () => {
    if (!chat?.id || !otherUserId || !partnerMeetup) return;
    if (!isAcceptedByMe && isMeetupExpired(partnerMeetup)) {
      Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้');
      return;
    }
    if (isAcceptedByMe) {
      const cancelCheck = canCancelMeetup(partnerMeetup);
      if (!cancelCheck.allowed) {
        Alert.alert('ไม่สามารถยกเลิกได้', cancelCheck.reason || 'ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน');
        return;
      }
    }
    try {
      await toggleMeetupAcceptanceInChat(chat.id, targetHostId, partnerMeetup.name || 'จุดนัดพบ', partnerMeetup);
    } catch (e) {
      console.warn('toggle meetup acceptance warning:', e?.message || e);
      Alert.alert('เกิดข้อผิดพลาด', e?.message || 'ไม่สามารถดำเนินการได้');
    }
  };

  const scrollToLatest = useCallback(() => {
    try {
      if (latestMessageId && scrollTarget && typeof scrollTarget.set === 'function') {
        scrollTarget.set(latestMessageId);
      }
    } catch (_) {}
  }, [latestMessageId, scrollTarget]);

  useEffect(() => {
    if (!latestMessageId) return;
    scrollToLatest();
    const t1 = setTimeout(scrollToLatest, 40);
    const t2 = setTimeout(scrollToLatest, 120);
    const t3 = setTimeout(scrollToLatest, 250);
    const t4 = setTimeout(scrollToLatest, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [latestMessageId, effectiveMessages.length, scrollToLatest]);

  useEffect(() => {
    try {
      if (messageState && typeof messageState.set === 'function') {
        messageState.set('');
      }
    } catch (_) {}
    setReplyingTo(null);
    setShowAllMessageTimes(false);
    if (allMessageTimesTimerRef.current) {
      clearTimeout(allMessageTimesTimerRef.current);
      allMessageTimesTimerRef.current = null;
    }
    textFieldRef.current?.clear();
  }, [chat?.id]);

  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const isStopping = !isRecordingAudio && Boolean(recordedAudio?.stopping);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState([]);
  const recordingTimerRef = useRef(null);
  const recordingMeterIntervalRef = useRef(null);

  const previewPlayer = useAudioPlayer(recordedAudio?.uri ? { uri: recordedAudio.uri } : null);
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  const isPreviewPlaying = Boolean(previewStatus?.playing);
  const previewCurrentTime = previewStatus?.currentTime || 0;
  const previewDuration = previewStatus?.duration || recordedAudio?.duration || 0;
  const previewProgress = previewDuration > 0 ? Math.min(Math.max(previewCurrentTime / previewDuration, 0), 1) : 0;
  const waveformBars = useMemo(() => getWaveformBars(recordingLevels, isRecordingAudio), [recordingLevels, isRecordingAudio]);

  useEffect(() => () => {
    if (allMessageTimesTimerRef.current) clearTimeout(allMessageTimesTimerRef.current);
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingMeterIntervalRef.current) clearInterval(recordingMeterIntervalRef.current);
    cancelAudioRecording();
  }, []);

  const handlePickImage = useCallback(() => {
    Keyboard.dismiss();
    setIsMediaPickerOpen((prev) => !prev);
  }, []);

  const handleStartRecording = useCallback(async () => {
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
      Alert.alert('ไม่สามารถบันทึกเสียงได้', err.message || 'กรุณาลองใหม่อีกครั้ง');
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
        Alert.alert('เสียงสั้นเกินไป', 'กรุณาบันทึกเสียงอย่างน้อย 1 วินาที');
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
      Alert.alert('ไม่สามารถหยุดการบันทึกได้', err.message || 'กรุณาลองใหม่อีกครั้ง');
      setRecordedAudio(null);
    }
  }, [recordingLevels, recordingSeconds]);

  const handleTogglePreviewPlay = useCallback(async () => {
    if (!previewPlayer) return;
    try {
      await ensureAudioPlaybackMode();
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
      Alert.alert('เสียงสั้นเกินไป', 'กรุณาบันทึกเสียงอย่างน้อย 1 วินาที');
      return;
    }

    const replySnapshot = createReplySnapshot(replyingTo);
    setReplyingTo(null);
    // Optimistic: show voice message immediately in chat with local URI
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
      replyTo: replySnapshot,
    };
    setLocalPendingMediaMessages((prev) => [...prev, optimisticAudio]);
    setTimeout(() => scrollToLatest(), 50);

    try {
      const conversationKey = await getOrFetchConversationKey(chat.id, currentUserId);
      const downloadUrl = await uploadChatMedia(audioUri, {
        conversationId: chat.id,
        mediaType: 'audio',
        extension: 'm4a',
        conversationKey,
      });
      preCacheDecryptedMedia(downloadUrl, audioUri);
      await sendMessage(chat.id, '[ข้อความเสียง]', {
        mediaType: 'audio',
        mediaUrl: downloadUrl,
        audioDuration: duration,
        clientMessageId: tempId,
        replyTo: replySnapshot,
      });
      setTimeout(scrollToLatest, 60);
    } catch (err) {
      Alert.alert('ส่งข้อความเสียงไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }, [chat?.id, currentUserId, isPreviewPlaying, isRecordingAudio, previewPlayer, recordedAudio, recordingSeconds, replyingTo, scrollToLatest, sendMessage]);

  const handleSendImage = useCallback(async (photoUri, captionText, viewMode = 'chat') => {
    const uris = Array.isArray(photoUri) ? photoUri.filter(Boolean) : (photoUri ? [photoUri] : []);
    if (!uris.length || !chat?.id) return;
    setIsMediaPickerOpen(false);

    const replySnapshot = createReplySnapshot(replyingTo);
    setReplyingTo(null);
    const tempId = `temp-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeCaption = (captionText || '').trim();
    const isMulti = uris.length > 1;
    const defaultPlaceholder = isMulti ? `[รูปภาพ ${uris.length} รูป]` : '[รูปภาพ]';
    const messageText = safeCaption || defaultPlaceholder;

    const optimisticMessage = {
      id: tempId,
      sender: 'me',
      senderId: currentUserId,
      text: messageText,
      createdAt: Date.now(),
      time: Date.now(),
      mediaType: 'image',
      mediaUrl: uris[0],
      mediaUrls: uris,
      isUploading: true,
      pendingSync: true,
      replyTo: replySnapshot,
    };

    setLocalPendingMediaMessages((prev) => [...prev, optimisticMessage]);
    setTimeout(() => scrollToLatest(), 50);

    try {
      const conversationKey = await getOrFetchConversationKey(chat.id, currentUserId);
      const downloadUrls = await Promise.all(
        uris.map(async (u) => {
          const downloadUrl = await uploadChatMedia(u, {
            conversationId: chat.id,
            mediaType: 'image',
            extension: 'jpg',
            conversationKey,
          });
          preCacheDecryptedMedia(downloadUrl, u);
          return downloadUrl;
        })
      );

      await sendMessage(chat.id, messageText, {
        mediaType: 'image',
        viewMode,
        mediaUrl: downloadUrls[0],
        mediaUrls: downloadUrls,
        clientMessageId: tempId,
        replyTo: replySnapshot,
      });
      setTimeout(() => scrollToLatest(), 60);
    } catch (err) {
      Alert.alert(err.isModerationViolation ? 'ระบบความปลอดภัย' : 'ส่งรูปภาพไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }, [chat?.id, currentUserId, replyingTo, scrollToLatest, sendMessage]);

  const handleOpenCamera = useCallback(async () => {
    setCameraOpen(true);
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = (messageState.get() || '').trim();
    if (!trimmed || sendingRef.current || !chat?.id || chat.encryptionPending || !isMatchActive) return;
    sendingRef.current = true;
    messageState.set('');
    setHasText(false);
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    scrollToLatest();
    try {
      await textFieldRef.current?.clear();
      await sendMessage(chat.id, trimmed, replySnapshot ? {
        replyTo: createReplySnapshot(replySnapshot),
      } : {});
      setTimeout(scrollToLatest, 60);
      setTimeout(scrollToLatest, 200);
    } catch (error) {
      messageState.set(trimmed);
      setHasText(true);
      setReplyingTo(replySnapshot);
      await textFieldRef.current?.setText(trimmed);
    } finally {
      sendingRef.current = false;
    }
  }, [chat?.encryptionPending, chat?.id, isMatchActive, messageState, replyingTo, scrollToLatest, sendMessage]);

  // Keep the native modifier objects stable for the lifetime of the field.
  // Recreating the submit modifier while typing or selecting a reply can make
  // SwiftUI rebuild the hosted TextField and drop the first responder.
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  const textFieldModifiers = useMemo(
    () => [
      textFieldStyle('plain'),
      lineLimit(4),
      frame({ maxWidth: Infinity }),
      onSubmit(() => handleSendRef.current?.()),
    ],
    []
  );

  // Keep the SwiftUI child tree stable while typing, opening settings, or
  // changing other local state. List owns the native rows; this memo also
  // avoids rebuilding every message element on each parent render.
  const messageRows = useMemo(() => {
    const messagesById = new Map(effectiveMessages.map(message => [message.id, message]));
    const messages = effectiveMessages.map(message => resolveMessageReply(message, messagesById));
    if (!messages.length) return null;
    const otherUnread = chat?.unreadCounts?.[otherUserId];
    return messages.map((item, index) => (
      <MessageSwipeRow
        avatarColor={chat?.avatarColor}
        avatarEmoji={chat?.avatar}
        avatarUri={resolvedPartnerAvatar}
        conversationId={chat?.id}
        currentUserId={currentUserId}
        isLatest={index === messages.length - 1}
        item={item}
        key={item.id}
        onOpenProfile={handleOpenPartnerProfile}
        onPreviewImage={handlePreviewImage}
        onQuickReact={handleQuickReact}
        onReply={handleReply}
        onScrollToMessage={handleScrollToMessage}
        onShowReactionDetails={handleShowReactionDetails}
        onSelectMessage={handleSelectMessage}
        otherUnread={otherUnread}
        previousItem={messages[index - 1]}
        readAt={otherReadAt}
        showAllMessageTimes={showAllMessageTimes}
        tick={0}
      />
    ));
  }, [chat?.id, currentUserId, chat?.avatar, chat?.avatarColor, chat?.unreadCounts, effectiveMessages, handleOpenPartnerProfile, handlePreviewImage, handleQuickReact, handleScrollToMessage, handleSelectMessage, handleShowReactionDetails, otherReadAt, otherUserId, handleReply, resolvedPartnerAvatar, showAllMessageTimes]);

  // Only the newest row shows a ticking relative time, so refresh that single
  // element instead of rebuilding every row's element tree on each tick.
  const renderedMessageRows = useMemo(() => {
    if (!messageRows || !tick) return messageRows;
    const rows = messageRows.slice();
    const lastIndex = rows.length - 1;
    rows[lastIndex] = React.cloneElement(rows[lastIndex], { tick });
    return rows;
  }, [messageRows, tick]);

  if (!chat) {
    return (
       <View style={{ flex: 1, backgroundColor: palette.background }}>
       <TopBlur colorScheme={colorScheme} height={120} />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }}>
          <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ width: '100%' }}>
            <HStack alignment="center" spacing={12} modifiers={[padding({ top: 58, bottom: 12, horizontal: 16 }), frame({ maxWidth: Infinity })]}>
              <Button label="ย้อนกลับ" onPress={onBack} systemImage="chevron.left" modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly')]} />
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>ไม่พบห้องสนทนา</Text>
              </VStack>
            </HStack>
          </Host>
        </View>
        <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ flex: 1 }}>
          <VStack spacing={16} modifiers={[padding({ top: 180, horizontal: 24 }), frame({ maxWidth: Infinity })]}>
            <ContentUnavailableView description="ห้องสนทนานี้อาจถูกลบหรือไม่มีอยู่แล้ว" systemImage="bubble.left.and.exclamationmark.bubble.right" title="ไม่พบห้องสนทนา" />
          </VStack>
        </Host>
      </View>
    );
  }

  const insets = useSafeAreaInsets();
  const safeTop = Math.max(insets.top, 44);
  const baseHeaderHeight = 56 + safeTop;
  const shouldShowMeetupBanner = Boolean(partnerMeetup && showPinnedMeetup);
  const topHostHeight = shouldShowMeetupBanner
    ? (isBannerExpanded ? baseHeaderHeight + 174 : baseHeaderHeight + 62)
    : baseHeaderHeight;

  return (
    <Animated.View
      style={[
        { flex: 1, backgroundColor: palette.background },
        isPopupEntry && {
          opacity: chatEntryProgress,
          transform: [{ translateY: chatEntryTranslateY }, { scale: chatEntryScale }],
        },
      ]}
    >
      <View
        style={{ flex: 1, backgroundColor: palette.background }}
      >
      <MessageTimeSwipeArea onReveal={revealAllMessageTimes} style={{ top: topHostHeight, bottom: undefined, height: Math.max(0, messageListHeight - topHostHeight) }} />
      <TopBlur colorScheme={colorScheme} height={topHostHeight + 8} />
      
      {/* Pinned Top Header + Meetup Banner */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: topHostHeight, zIndex: 20 }}>
        <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ width: '100%', height: topHostHeight }}>
          <VStack spacing={6} modifiers={[padding({ top: safeTop + 4, bottom: 4, horizontal: 12 }), frame({ maxWidth: Infinity })]}>
            {/* Header row */}
            <HStack alignment="center" spacing={12} modifiers={[padding({ horizontal: 2 }), frame({ maxWidth: Infinity })]}>
              <Button label="ย้อนกลับ" onPress={onBack} systemImage="chevron.left" modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly')]} />
              <Button
                onPress={handleOpenPartnerProfile}
                modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' })]}
              >
                <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <ResolvedProfileAvatar avatarColor={chat.avatarColor} emoji={chat.avatar} size={42} uri={resolvedPartnerAvatar} />
                  <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                    <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>{chat.name}</Text>
                    <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(1)]}>{chat.subtitle || 'เพื่อนใน CampusMate'}</Text>
                  </VStack>
                </HStack>
              </Button>
              <Spacer />
              <Button
                label="ตั้งค่าแชต"
                onPress={() => setIsSettingsOpen(true)}
                systemImage="ellipsis"
                modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly'), tint(palette.text)]}
              />
            </HStack>

            {/* Pinned Meetup Banner (Sits directly underneath header) */}
            {shouldShowMeetupBanner && (
              <ChatMeetupBanner
                encryptionPending={chat.encryptionPending}
                isAcceptedByMe={isAcceptedByMe}
                isExpanded={isBannerExpanded}
                meetup={partnerMeetup}
                onToggleAccept={handleToggleAcceptMeetup}
                onToggleExpand={() => setIsBannerExpanded((curr) => !curr)}
                palette={palette}
                stats={meetupStats}
              />
            )}
          </VStack>
        </Host>
      </View>

      <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ flex: 1 }}>
        <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          <List
            modifiers={[
              listStyle('plain'),
              onGeometryChange(handleMessageListGeometry),
              scrollContentBackground('hidden'),
              background(palette.background),
              scrollIndicators('never', 'vertical'),
              scrollDismissesKeyboard('never'),
              defaultScrollAnchor('bottom'),
              scrollPosition(scrollTarget, { anchor: 'bottom' }),
            ]}
          >
            <VStack
              spacing={10}
              modifiers={[
                padding({
                  top: topHostHeight + 14,
                  bottom: 24,
                  horizontal: 14,
                }),
                frame({ maxWidth: Infinity }),
                listRowBackground(palette.background),
                listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
                listRowSeparator('hidden'),
              ]}
            >
              {hasMoreOlder ? (
                <Button
                  label={isLoadingOlder ? 'กำลังโหลดข้อความ...' : 'โหลดข้อความก่อนหน้า'}
                  onPress={loadOlderMessages}
                  systemImage={isLoadingOlder ? 'arrow.triangle.2.circlepath' : 'arrow.up.circle'}
                  modifiers={[
                    buttonStyle('plain'),
                    font({ textStyle: 'caption', weight: 'medium' }),
                    foregroundStyle(palette.accent),
                    disabled(isLoadingOlder),
                  ]}
                />
              ) : null}
              <HStack
                spacing={8}
                modifiers={[
                  padding({ horizontal: 12, vertical: 8 }),
                  background(
                    chat.encryptionPending ? 'rgba(255,149,0,0.12)' : palette.accentSoft,
                    shapes.roundedRectangle({ cornerRadius: 12, roundedCornerStyle: 'continuous' })
                  ),
                  frame({ maxWidth: Infinity }),
                ]}
              >
                <Image color={chat.encryptionPending ? '#A15C00' : palette.accent} size={14} systemName="lock.shield.fill" />
                <Text
                  modifiers={[
                    font({ textStyle: 'caption' }),
                    foregroundStyle(chat.encryptionPending ? '#A15C00' : palette.accent),
                    lineLimit(2),
                  ]}
                >
                  {chat.encryptionPending
                    ? 'กำลังรอคีย์จากผู้ร่วมสนทนา ข้อความเก่าจะแสดงเมื่อได้รับคีย์'
                    : 'แชตนี้เข้ารหัสแบบต้นทางถึงปลายทาง'}
                </Text>
              </HStack>
            </VStack>
            {renderedMessageRows || (
                <ContentUnavailableView description="ส่งข้อความแรกเพื่อเริ่มทำความรู้จักกัน" systemImage="hand.wave.fill" title="เริ่มทักทายได้เลย" />
              )}
          </List>

          {replyingTo ? (
            <HStack spacing={10} modifiers={[padding({ top: 8, horizontal: 18 }), frame({ maxWidth: Infinity }), background(palette.background)]}>
              <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 9 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.accent)]}>ตอบกลับข้อความ</Text>
                <ReplyPreview reply={replyingTo} conversationId={chat?.id} color={palette.secondary} />
              </VStack>
              <Button label="ยกเลิกการตอบกลับ" onPress={() => setReplyingTo(null)} systemImage="xmark" modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('small'), labelStyle('iconOnly')]} />
            </HStack>
          ) : null}

          {!isMatchActive ? (
            <HStack spacing={8} modifiers={[padding({ vertical: 14, horizontal: 16 }), frame({ maxWidth: Infinity }), background(palette.background)]}>
              <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(palette.secondary), frame({ maxWidth: Infinity, alignment: 'center' })]}>
                การจับคู่สิ้นสุดลงแล้ว คุณไม่สามารถส่งข้อความได้อีกต่อไป
              </Text>
            </HStack>
          ) : (isRecordingAudio || recordedAudio) ? (
            <HStack spacing={8} alignment="center" modifiers={[padding({ top: 8, bottom: isMediaPickerOpen ? 6 : 16, horizontal: 12 }), frame({ maxWidth: Infinity }), background(palette.background)]}>
              <Button
                label="ยกเลิกการบันทึกเสียง"
                onPress={handleCancelRecording}
                systemImage="xmark"
                modifiers={[
                  buttonStyle('plain'),
                  labelStyle('iconOnly'),
                  foregroundStyle('#FFFFFF'),
                  frame({ width: 40, height: 40 }),
                  background('#3B5AFE', shapes.circle()),
                ]}
              />

              <HStack
                spacing={6}
                alignment="center"
                modifiers={[
                  padding({ horizontal: 8 }),
                  frame({ maxWidth: Infinity, height: 44 }),
                  background('#3B5AFE', shapes.capsule()),
                ]}
              >
                <Button
                  label={isRecordingAudio ? 'หยุดบันทึกเสียงเพื่อฟังตัวอย่าง' : isStopping ? 'กำลังประมวลผล…' : isPreviewPlaying ? 'หยุดเล่น' : 'ฟังตัวอย่างเสียง'}
                  onPress={isRecordingAudio ? handleStopToPreview : handleTogglePreviewPlay}
                  systemImage={isRecordingAudio ? 'square.fill' : isStopping ? 'ellipsis' : isPreviewPlaying ? 'pause.fill' : 'play.fill'}
                  modifiers={[
                    buttonStyle('plain'),
                    labelStyle('iconOnly'),
                    foregroundStyle(isDark ? '#FFFFFF' : '#3B5AFE'),
                    frame({ width: 32, height: 32 }),
                    background(isDark ? 'rgba(255, 255, 255, 0.22)' : '#FFFFFF', shapes.circle()),
                    disabled(isStopping),
                  ]}
                />

                <HStack spacing={3} alignment="center" modifiers={[frame({ maxWidth: Infinity, height: 28, alignment: 'center' })]}>
                  {waveformBars.map((barHeight, idx) => {
                    const barProgress = (idx + 1) / TOTAL_WAVE_BARS;
                    const isFilled = isRecordingAudio || (isPreviewPlaying && previewProgress >= barProgress) || (!isPreviewPlaying && previewProgress >= barProgress && previewProgress > 0);
                    return (
                      <VStack
                        key={idx}
                        modifiers={[
                          frame({ width: 3, height: barHeight }),
                          background(
                            isFilled ? '#FFFFFF' : 'rgba(255, 255, 255, 0.45)',
                            shapes.roundedRectangle({ cornerRadius: 1.5 })
                          ),
                        ]}
                      />
                    );
                  })}
                </HStack>

                <Text
                  modifiers={[
                    padding({ horizontal: 9, vertical: 4 }),
                    background(isDark ? 'rgba(255, 255, 255, 0.22)' : '#FFFFFF', shapes.capsule()),
                    font({ size: 12, weight: 'bold' }),
                    foregroundStyle(isDark ? '#FFFFFF' : '#3B5AFE'),
                  ]}
                >
                  {formatAudioDuration(isRecordingAudio ? recordingSeconds : (recordedAudio?.duration || recordingSeconds))}
                </Text>
              </HStack>

              <Button
                label="ส่งข้อความเสียง"
                onPress={handleSendRecording}
                systemImage="paperplane.fill"
                modifiers={[
                  buttonStyle('plain'),
                  labelStyle('iconOnly'),
                  foregroundStyle('#FFFFFF'),
                  frame({ width: 40, height: 40 }),
                  background('#3B5AFE', shapes.circle()),
                  disabled(isStopping),
                ]}
              />
            </HStack>
          ) : (
            <VStack spacing={4} modifiers={[frame({ maxWidth: Infinity }), background(palette.background)]}>
              {showQuickEmoji ? (
                <ScrollView
                  axes="horizontal"
                  showsIndicators={false}
                  modifiers={[
                    frame({ height: 44, maxWidth: Infinity }),
                    background(palette.background),
                    padding({ horizontal: 8 }),
                  ]}
                >
                  <HStack spacing={10} alignment="center" modifiers={[padding({ horizontal: 6, vertical: 4 })]}>
                    {emojiPanelEmojis.map((emoji) => (
                      <Button
                        key={emoji}
                        label={emoji}
                        onPress={() => handleInsertEmoji(emoji)}
                        modifiers={[buttonStyle('plain'), font({ size: 22 })]}
                      />
                    ))}
                  </HStack>
                </ScrollView>
              ) : null}

              <HStack spacing={10} modifiers={[padding({ top: 4, bottom: isMediaPickerOpen ? 6 : 16, horizontal: 12 }), frame({ maxWidth: Infinity }), background(palette.background)]}>
                <HStack spacing={8} modifiers={[padding({ horizontal: 10, vertical: 5 }), frame({ maxWidth: Infinity, minHeight: 46 }), background(palette.surface, shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' }))]}>
                  <Button
                    label="เปิดกล้อง"
                    onPress={handleOpenCamera}
                    systemImage="camera.fill"
                    modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), foregroundStyle(palette.text)]}
                  />
                  <TextField
                    axis="vertical"
                    modifiers={textFieldModifiers}
                    maxLength={1000}
                    onFocusChange={handleTextFieldFocusChange}
                    onTextChange={handleTextFieldChange}
                    placeholder={chat.encryptionPending ? 'พิมพ์รอคีย์ได้...' : 'พิมพ์ข้อความ...'}
                    ref={textFieldRef}
                    text={messageState}
                  />
                  <ZStack alignment="center" modifiers={[frame({ width: 112, height: 38 })]}>
                    <HStack
                      spacing={10}
                      modifiers={[
                        padding({ trailing: 2 }),
                        opacity(hasText ? 0 : 1),
                        disabled(Boolean(hasText)),
                      ]}
                    >
                      <Button
                        label="ส่งข้อความเสียง"
                        onPress={handleStartRecording}
                        systemImage="mic"
                        modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), foregroundStyle(palette.text)]}
                      />
                      <Button
                        label="ส่งรูปภาพ"
                        onPress={handlePickImage}
                        systemImage="photo"
                        modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), foregroundStyle(palette.text)]}
                      />
                      <Button
                        label="อิโมจิ"
                        onPress={() => setShowQuickEmoji((prev) => !prev)}
                        systemImage="face.smiling"
                        modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), foregroundStyle(showQuickEmoji ? palette.accent : palette.text)]}
                      />
                    </HStack>
                    <Button
                      label="ส่งข้อความ"
                      onPress={handleSend}
                      systemImage="paperplane.fill"
                      modifiers={[
                        opacity(hasText || replyingTo ? 1 : 0),
                        disabled(chat.encryptionPending || !hasText),
                        buttonStyle('glassProminent'),
                        buttonBorderShape('capsule'),
                        controlSize('regular'),
                        labelStyle('iconOnly'),
                        tint('#3B5AFE'),
                      ]}
                    />
                  </ZStack>
                </HStack>
              </HStack>
            </VStack>
          )}
        </VStack>
      </Host>
      </View>

      {cameraOpen && <ChatCameraModal recipientName={chat?.name} recipientAvatar={resolvedPartnerAvatar}
        onClose={() => setCameraOpen(false)} onCapture={(asset) => { setCameraOpen(false); setMediaComposerDraft(asset); }} />}
      {mediaComposerDraft && <ChatMediaComposer asset={mediaComposerDraft} recipientName={chat?.name} recipientAvatar={resolvedPartnerAvatar}
        onClose={() => setMediaComposerDraft(null)}
        onSend={(asset, mode) => asset.type === 'video'
          ? handleSendVideo(asset, mode, asset.caption)
          : handleSendImage(asset.uris || asset.uri, asset.caption, mode)} />}
      {videoDraft && <ChatVideoComposer asset={videoDraft} onSend={handleSendVideo} onClose={() => setVideoDraft(null)} />}
      {isMediaPickerOpen && (
        <ChatMediaPickerSheet
            onSelectVideo={handlePickVideo}
          inline
          colors={{
            card: palette.surface,
            line: palette.line || 'rgba(255, 255, 255, 0.08)',
            ink: palette.text,
            inkSoft: palette.secondary || '#64748B',
            primary: '#3B5AFE',
            bg: palette.background,
          }}
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
              Alert.alert('ไม่สามารถเปิดคลังภาพได้', err.message || 'กรุณาลองใหม่อีกครั้ง');
            }
          }}
        />
      )}

      <ChatSettingsModal
        chat={chat}
        colorScheme={colorScheme}
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
        palette={palette}
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
        palette={palette}
      />
      <ReportModal
        colors={palette}
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
        colors={{
          card: palette.surface,
          line: palette.line || 'rgba(255, 255, 255, 0.08)',
          ink: palette.text,
          inkSoft: palette.secondary || '#64748B',
          primary: '#3B5AFE',
          bg: palette.background,
        }}
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
    </Animated.View>
  );
}

function ChatSettingsModal({
  chat,
  colorScheme,
  isMuted,
  isOpen,
  onBlockUser,
  onClose,
  onNavigateMeetup,
  onNavigateProfile,
  onRemoveConversation,
  onReportUser,
  onToggleMute,
  onTogglePinnedMeetup,
  palette,
  partnerMeetup,
  showPinnedMeetup,
}) {
  const isDark = colorScheme === 'dark';
  return (
    <Modal animationType="fade" transparent visible={isOpen} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: isDark ? '#1C1F26' : '#FFFFFF',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 36,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -6 },
            shadowOpacity: 0.16,
            shadowRadius: 20,
          }}
        >
          {/* Handle */}
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 44, height: 5, borderRadius: 2.5, backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }} />
          </View>

          {/* Title Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <View>
              <RNText style={{ fontSize: 18, fontWeight: '800', color: palette.text }}>
                ตั้งค่าห้องสนทนา
              </RNText>
              <RNText style={{ fontSize: 12, color: palette.secondary, marginTop: 2 }}>
                บันทึกการตั้งค่าเฉพาะบัญชีนี้ในฐานข้อมูล
              </RNText>
            </View>
            <Pressable
              onPress={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <SymbolView name="xmark" size={13} weight="bold" tintColor={palette.secondary} />
            </Pressable>
          </View>

          {/* Setting 1: Toggle Meetup Banner */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 14,
              paddingHorizontal: 16,
              backgroundColor: isDark ? '#252932' : '#F4F6F9',
              borderRadius: 18,
              marginBottom: 10,
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <RNText style={{ fontSize: 15, fontWeight: '700', color: palette.text, marginBottom: 3 }}>
                แสดงแถบจุดนัดหมายที่ปักหมุด
              </RNText>
              <RNText style={{ fontSize: 12, color: palette.secondary, lineHeight: 16 }}>
                {showPinnedMeetup ? 'เปิดแสดงข้อมูลสถานที่และเวลาไว้ด้านบนของแชต' : 'ซ่อนแถบจุดนัดหมายไว้เพื่อเพิ่มพื้นที่อ่านข้อความ'}
              </RNText>
            </View>
            <Switch
              trackColor={{ false: isDark ? '#3A3F4B' : '#CBD5E1', true: palette.accent }}
              thumbColor="#FFFFFF"
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
              backgroundColor: isDark ? '#252932' : '#F4F6F9',
              borderRadius: 18,
              marginBottom: 10,
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <RNText style={{ fontSize: 15, fontWeight: '700', color: palette.text, marginBottom: 3 }}>
                ปิดการแจ้งเตือนแชตนี้
              </RNText>
              <RNText style={{ fontSize: 12, color: palette.secondary, lineHeight: 16 }}>
                {isMuted ? 'ปิดเสียงและการแจ้งเตือนข้อความใหม่จากห้องนี้' : 'รับการแจ้งเตือนข้อความใหม่ตามปกติ'}
              </RNText>
            </View>
            <Switch
              trackColor={{ false: isDark ? '#3A3F4B' : '#CBD5E1', true: palette.accent }}
              thumbColor="#FFFFFF"
              value={isMuted}
              onValueChange={onToggleMute}
            />
          </View>

          {/* Setting 2: View Profile Shortcut */}
          <Pressable
            onPress={onNavigateProfile}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 14,
              paddingHorizontal: 16,
              backgroundColor: isDark ? '#252932' : '#F4F6F9',
              borderRadius: 18,
              marginBottom: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <RNText style={{ fontSize: 15, fontWeight: '700', color: palette.text, marginBottom: 2 }}>
                ดูโปรไฟล์ของ {chat?.name || 'เพื่อน'}
              </RNText>
              <RNText style={{ fontSize: 12, color: palette.secondary }}>
                ดูข้อมูลส่วนตัว คณะ และกิจกรรมที่สนใจ
              </RNText>
            </View>
            <RNText style={{ fontSize: 18, color: palette.secondary, marginLeft: 8 }}>›</RNText>
          </Pressable>

          {/* Setting 3: View Meetup Places */}
          {partnerMeetup ? (
            <Pressable
              onPress={onNavigateMeetup}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                backgroundColor: isDark ? '#252932' : '#F4F6F9',
                borderRadius: 18,
                marginBottom: 16,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <View style={{ flex: 1 }}>
                <RNText style={{ fontSize: 15, fontWeight: '700', color: palette.text, marginBottom: 2 }}>
                  ดูจุดนัดหมาย ({partnerMeetup.name})
                </RNText>
                <RNText style={{ fontSize: 12, color: palette.secondary }}>
                  เปิดหน้ารวมสถานที่และแผนที่นัดหมายทั้งหมด
                </RNText>
              </View>
              <RNText style={{ fontSize: 18, color: palette.secondary, marginLeft: 8 }}>›</RNText>
            </Pressable>
          ) : null}

          {/* Safety: Report User */}
          {onReportUser ? (
            <Pressable
              onPress={() => {
                onClose();
                onReportUser();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 13,
                paddingHorizontal: 16,
                backgroundColor: isDark ? 'rgba(255, 75, 75, 0.08)' : '#FFF1F2',
                borderWidth: 1,
                borderColor: 'rgba(255, 75, 75, 0.4)',
                borderRadius: 18,
                marginBottom: 10,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <SymbolView name="exclamationmark.bubble" size={16} tintColor="#FF4B4B" style={{ marginRight: 8 }} />
              <RNText style={{ fontSize: 15, fontWeight: '700', color: '#FF4B4B' }}>
                รายงานผู้ใช้นี้
              </RNText>
            </Pressable>
          ) : null}

          {/* Safety: Block User */}
          {onBlockUser ? (
            <Pressable
              onPress={() => {
                onClose();
                onBlockUser();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 13,
                paddingHorizontal: 16,
                backgroundColor: isDark ? 'rgba(255, 75, 75, 0.08)' : '#FFF1F2',
                borderWidth: 1,
                borderColor: 'rgba(255, 75, 75, 0.4)',
                borderRadius: 18,
                marginBottom: 10,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <SymbolView name="nosign" size={16} tintColor="#FF4B4B" style={{ marginRight: 8 }} />
              <RNText style={{ fontSize: 15, fontWeight: '700', color: '#FF4B4B' }}>
                บล็อกผู้ใช้นี้
              </RNText>
            </Pressable>
          ) : null}

          {/* Destructive: Unmatch and Delete Conversation */}
          {onRemoveConversation ? (
            <Pressable
              onPress={() => {
                onClose();
                onRemoveConversation();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 13,
                paddingHorizontal: 16,
                backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#FEE2E2',
                borderRadius: 18,
                marginBottom: 12,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <SymbolView name="trash" size={16} tintColor="#EF4444" style={{ marginRight: 8 }} />
              <RNText style={{ fontSize: 15, fontWeight: '700', color: '#EF4444' }}>
                ยกเลิกการจับคู่และลบห้องสนทนา
              </RNText>
            </Pressable>
          ) : null}

          {/* Done Button */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              backgroundColor: palette.accent,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              marginTop: 4,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <RNText style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
              เสร็จสิ้น
            </RNText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const IosVoiceBubble = React.memo(function IosVoiceBubble({
  audioDuration = 0,
  audioUrl,
  conversationId,
  handleLongPress,
  messageShape,
  mine,
  palette,
}) {
  const { uri: decryptedAudioUri } = useDecryptedMedia(audioUrl, {
    conversationId,
    mediaType: 'audio',
  });
  const effectiveAudioUrl = decryptedAudioUri || (audioUrl && !audioUrl.includes('.enc') ? audioUrl : null);
  const sourceRef = useRef(null);
  if (effectiveAudioUrl && sourceRef.current?.uri !== effectiveAudioUrl) {
    sourceRef.current = { uri: effectiveAudioUrl };
  } else if (!effectiveAudioUrl) {
    sourceRef.current = null;
  }
  const player = useAudioPlayer(sourceRef.current);
  const status = useAudioPlayerStatus(player);

  const isPlaying = Boolean(status?.playing);
  const currentTime = status?.currentTime || 0;
  const totalDuration = status?.duration || audioDuration || 0;
  const progress = totalDuration > 0 ? Math.min(Math.max(currentTime / totalDuration, 0), 1) : 0;

  const handleTogglePlay = useCallback(async () => {
    if (!player) return;
    try {
      await ensureAudioPlaybackMode();
      if (isPlaying) {
        player.pause();
      } else {
        if (progress >= 0.98) {
          player.seekTo(0);
        }
        player.play();
      }
    } catch (err) {
      console.warn('[IosVoiceBubble] playback error:', err);
    }
  }, [isPlaying, player, progress]);

  const displayedTime = isPlaying && currentTime > 0
    ? formatAudioDuration(currentTime)
    : formatAudioDuration(totalDuration);

  const activeColor = mine ? palette.white : palette.accent;
  const inactiveColor = mine ? 'rgba(255,255,255,0.4)' : (palette.line || 'rgba(0,0,0,0.12)');
  const textColor = mine ? palette.white : palette.text;
  const playCircleBg = mine ? 'rgba(255,255,255,0.22)' : (palette.accentSoft || 'rgba(59,90,254,0.12)');

  return (
    <HStack
      alignment="center"
      spacing={10}
      modifiers={[
        padding({ horizontal: 12, vertical: 8 }),
        background(mine ? palette.accent : palette.incoming, messageShape),
        onTapGesture(handleTogglePlay),
        onLongPressGesture(handleLongPress, LONG_PRESS_DURATION_SECONDS),
      ]}
    >
      <VStack
        alignment="center"
        modifiers={[
          frame({ width: 36, height: 36 }),
          background(playCircleBg, shapes.circle()),
        ]}
      >
        <Image
          color={activeColor}
          size={16}
          systemName={isPlaying ? 'pause.fill' : 'play.fill'}
        />
      </VStack>

      <VStack alignment="leading" spacing={4} modifiers={[frame({ minWidth: 130 })]}>
        <HStack alignment="center" spacing={2.5}>
          {[8, 14, 22, 16, 26, 12, 18, 28, 20, 14, 24, 18, 10, 16, 22, 12].map((h, i) => {
            const barProgress = (i + 1) / 16;
            const isFilled = progress >= barProgress;
            return (
              <VStack
                key={i}
                modifiers={[
                  frame({ width: 3, height: h }),
                  background(
                    isFilled ? activeColor : inactiveColor,
                    shapes.roundedRectangle({ cornerRadius: 1.5 })
                  ),
                ]}
              />
            );
          })}
        </HStack>

        <HStack alignment="center" spacing={4}>
          <Text
            modifiers={[
              font({ textStyle: 'caption2', weight: 'medium' }),
              foregroundStyle(textColor),
            ]}
          >
            {displayedTime}
          </Text>
          <Spacer />
          <Image
            color={mine ? 'rgba(255,255,255,0.7)' : (palette.secondary || '#64748B')}
            size={11}
            systemName="mic"
          />
        </HStack>
      </VStack>
    </HStack>
  );
});

const IosImageBubble = React.memo(function IosImageBubble({
  conversationId,
  currentUserId,
  handleLongPress,
  isUploading = false,
  mediaUrl,
  onPreviewImage,
}) {
  const { uri, loading } = useDecryptedMedia(mediaUrl, {
    conversationId,
    currentUserId,
    mediaType: 'image',
  });
  const isDirectImage = Boolean(
    mediaUrl && (
      mediaUrl.startsWith('file://') ||
      mediaUrl.startsWith('content://') ||
      mediaUrl.startsWith('data:') ||
      mediaUrl.startsWith('ph://') ||
      mediaUrl.startsWith('assets-library://') ||
      !mediaUrl.includes('.enc')
    )
  );
  const displayUri = uri || (isDirectImage ? mediaUrl : null);

  const [bubbleSize, setBubbleSize] = useState(() => {
    const cachedRatio = getCachedAspectRatio(displayUri || mediaUrl);
    return getChatImageBubbleSize(cachedRatio || 1);
  });

  useEffect(() => {
    const target = displayUri || mediaUrl;
    if (!target) return;
    const cachedRatio = getCachedAspectRatio(target);
    if (cachedRatio) {
      setBubbleSize(getChatImageBubbleSize(cachedRatio));
      return;
    }
    measureImageAspectRatio(target, (ratio) => {
      setBubbleSize(getChatImageBubbleSize(ratio));
    });
  }, [displayUri, mediaUrl]);

  if (loading && !displayUri) {
    return (
      <VStack
        alignment="center"
        spacing={8}
        modifiers={[
          frame({ width: bubbleSize.width, height: bubbleSize.height }),
          background('rgba(255, 255, 255, 0.05)', imageBubbleShape),
          clipShape('roundedRectangle', 18),
          cornerRadius(18),
        ]}
      >
        <ProgressView modifiers={[tint('#3B5AFE')]} />
      </VStack>
    );
  }

  if (!displayUri && !loading && !isUploading) {
    return (
      <VStack
        alignment="center"
        spacing={6}
        modifiers={[
          padding({ horizontal: 16, vertical: 20 }),
          frame({ width: bubbleSize.width, height: 140 }),
          background('rgba(255, 255, 255, 0.05)', imageBubbleShape),
          clipShape('roundedRectangle', 18),
          cornerRadius(18),
          onLongPressGesture(handleLongPress, LONG_PRESS_DURATION_SECONDS),
        ]}
      >
        <Image color="#98A2B3" size={24} systemName="photo.badge.exclamationmark" />
        <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle('#98A2B3'), multilineTextAlignment('center')]}>
          รูปภาพหมดอายุหรือไม่สามารถเข้าถึงได้
        </Text>
      </VStack>
    );
  }

  return (
    <ZStack
      alignment="center"
      modifiers={[
        frame({ width: bubbleSize.width, height: bubbleSize.height }),
        clipShape('roundedRectangle', 18),
        cornerRadius(18),
        shadow({ radius: 3, x: 0, y: 1, color: 'rgba(0, 0, 0, 0.12)' }),
        onTapGesture(() => {
          if (!isUploading) {
            onPreviewImage?.(displayUri || mediaUrl);
          }
        }),
        onLongPressGesture(handleLongPress, LONG_PRESS_DURATION_SECONDS),
      ]}
    >
      {displayUri ? (
        <Image
          uiImage={displayUri}
          modifiers={[
            resizable(),
            aspectRatio({ contentMode: 'fill' }),
            frame({ width: bubbleSize.width, height: bubbleSize.height }),
            clipShape('roundedRectangle', 18),
            cornerRadius(18),
          ]}
        />
      ) : null}

      {isUploading ? (
        <VStack
          alignment="center"
          spacing={6}
          modifiers={[
            frame({ width: bubbleSize.width, height: bubbleSize.height }),
            background('rgba(0, 0, 0, 0.55)', imageBubbleShape),
            clipShape('roundedRectangle', 18),
            cornerRadius(18),
          ]}
        >
          <ProgressView modifiers={[tint('#FFFFFF')]} />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle('#FFFFFF')]}>
            กำลังส่งรูปภาพ...
          </Text>
        </VStack>
      ) : null}
    </ZStack>
  );
});

const IosCardLayer = React.memo(function IosCardLayer({
  conversationId,
  currentUserId,
  height = 180,
  mediaUrl,
  overlayColor,
  width = 230,
}) {
  const { uri, loading } = useDecryptedMedia(mediaUrl, {
    conversationId,
    currentUserId,
    mediaType: 'image',
  });
  const isLocal = Boolean(
    mediaUrl && (
      mediaUrl.startsWith('file://') ||
      mediaUrl.startsWith('content://') ||
      mediaUrl.startsWith('data:') ||
      mediaUrl.startsWith('ph://') ||
      mediaUrl.startsWith('assets-library://')
    )
  );
  const displayUri = uri || (isLocal ? mediaUrl : null);

  return (
    <ZStack
      alignment="center"
      modifiers={[
        frame({ width, height }),
        clipShape('roundedRectangle', 18),
        cornerRadius(18),
      ]}
    >
      {displayUri ? (
        <Image
          uiImage={displayUri}
          modifiers={[
            resizable(),
            aspectRatio({ contentMode: 'fill' }),
            frame({ width, height }),
            clipShape('roundedRectangle', 18),
            cornerRadius(18),
          ]}
        />
      ) : (
        <VStack
          alignment="center"
          spacing={4}
          modifiers={[
            frame({ width, height }),
            background('rgba(255, 255, 255, 0.08)', shapes.roundedRectangle({ cornerRadius: 18 })),
            clipShape('roundedRectangle', 18),
            cornerRadius(18),
          ]}
        >
          {loading ? (
            <ProgressView modifiers={[tint('#3B5AFE')]} />
          ) : (
            <Image color="#98A2B3" size={24} systemName="photo" />
          )}
        </VStack>
      )}
      {overlayColor ? (
        <VStack
          modifiers={[
            frame({ width, height }),
            background(overlayColor, shapes.roundedRectangle({ cornerRadius: 18 })),
            clipShape('roundedRectangle', 18),
            cornerRadius(18),
          ]}
        />
      ) : null}
    </ZStack>
  );
});

const IosStackedImageCards = React.memo(function IosStackedImageCards({
  conversationId,
  currentUserId,
  handleLongPress,
  isUploading = false,
  mediaUrls = [],
  mine = false,
  onPreviewImage,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [showFlipHint, setShowFlipHint] = useState(false);
  const total = Array.isArray(mediaUrls) ? mediaUrls.length : 0;

  useEffect(() => {
    let active = true;
    hasSeenStackFlipHint().then((seen) => {
      if (active && !seen) {
        setShowFlipHint(true);
        setStackFlipHintSeen();
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const [bubbleSize, setBubbleSize] = useState(() => {
    const cachedRatio = getCachedAspectRatio(mediaUrls?.[0]);
    return getChatImageBubbleSize(cachedRatio || 1);
  });

  useEffect(() => {
    const target = mediaUrls?.[activeIndex] || mediaUrls?.[0];
    if (!target) return;
    const cachedRatio = getCachedAspectRatio(target);
    if (cachedRatio) {
      setBubbleSize(getChatImageBubbleSize(cachedRatio));
      return;
    }
    measureImageAspectRatio(target, (ratio) => {
      setBubbleSize(getChatImageBubbleSize(ratio));
    });
  }, [mediaUrls, activeIndex]);

  if (total <= 1) {
    return (
      <IosImageBubble
        conversationId={conversationId}
        currentUserId={currentUserId}
        handleLongPress={handleLongPress}
        isUploading={isUploading}
        mediaUrl={mediaUrls?.[0]}
        onPreviewImage={(url) => onPreviewImage?.(url, mediaUrls)}
      />
    );
  }

  const nextIndex1 = (activeIndex + 1) % total;
  const nextIndex2 = (activeIndex + 2) % total;

  const cardWidth = bubbleSize.width;
  const cardHeight = bubbleSize.height;
  const deckWidth = cardWidth + 12;
  const deckHeight = cardHeight + 12;
  const bottomBarWidth = Math.max(140, cardWidth - 16);

  return (
    <ZStack
      alignment="center"
      modifiers={[
        frame({ width: deckWidth, height: deckHeight }),
        padding({ horizontal: 6, vertical: 6 }),
      ]}
    >
      {/* Layer 3: Deepest card (shown if 3 or more photos) */}
      {total >= 3 ? (
        <VStack
          modifiers={[
            rotationEffect(mine ? -5.5 : 5.5),
            offset({ x: mine ? -8 : 8, y: 3 }),
            scaleEffect(0.92),
            opacity(0.75),
            shadow({ radius: 3, x: 0, y: 2, color: 'rgba(0, 0, 0, 0.25)' }),
          ]}
        >
          <IosCardLayer
            conversationId={conversationId}
            currentUserId={currentUserId}
            height={cardHeight}
            mediaUrl={mediaUrls[nextIndex2]}
            overlayColor="rgba(0, 0, 0, 0.28)"
            width={cardWidth}
          />
        </VStack>
      ) : null}

      {/* Layer 2: Middle card (shown if 2 or more photos) */}
      {total >= 2 ? (
        <VStack
          modifiers={[
            rotationEffect(mine ? 3.5 : -3.5),
            offset({ x: mine ? 6 : -6, y: 1.5 }),
            scaleEffect(0.96),
            opacity(0.88),
            shadow({ radius: 4, x: 0, y: 2, color: 'rgba(0, 0, 0, 0.22)' }),
          ]}
        >
          <IosCardLayer
            conversationId={conversationId}
            currentUserId={currentUserId}
            height={cardHeight}
            mediaUrl={mediaUrls[nextIndex1]}
            overlayColor="rgba(0, 0, 0, 0.14)"
            width={cardWidth}
          />
        </VStack>
      ) : null}

      {/* Layer 1: Front Active Card */}
      <ZStack
        alignment="center"
        modifiers={[
          frame({ width: cardWidth, height: cardHeight }),
          clipShape('roundedRectangle', 18),
          cornerRadius(18),
          shadow({ radius: 6, x: 0, y: 3, color: 'rgba(0, 0, 0, 0.30)' }),
          onTapGesture(() => {
            if (!isUploading) {
              if (showFlipHint) {
                setShowFlipHint(false);
                setStackFlipHintSeen();
              }
              setActiveIndex((prev) => (prev + 1) % total);
            }
          }),
          onLongPressGesture(handleLongPress, LONG_PRESS_DURATION_SECONDS),
        ]}
      >
        <IosCardLayer
          conversationId={conversationId}
          currentUserId={currentUserId}
          height={cardHeight}
          mediaUrl={mediaUrls[activeIndex]}
          width={cardWidth}
        />

        {/* Top-right glass pill counter badge */}
        <VStack
          alignment="trailing"
          modifiers={[
            frame({ width: cardWidth, height: cardHeight, alignment: 'topTrailing' }),
            padding({ top: 8, trailing: 8 }),
          ]}
        >
          <HStack
            alignment="center"
            spacing={4}
            modifiers={[
              padding({ horizontal: 8, vertical: 4 }),
              background('rgba(0, 0, 0, 0.62)', shapes.capsule()),
              shadow({ radius: 3, x: 0, y: 1, color: 'rgba(0, 0, 0, 0.3)' }),
            ]}
          >
            <Image color="#FFFFFF" size={10} systemName="square.stack.fill" />
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>
              {`${activeIndex + 1}/${total}`}
            </Text>
          </HStack>
        </VStack>

        {/* Bottom bar with hint and expand button */}
        <VStack
          modifiers={[
            frame({ width: cardWidth, height: cardHeight, alignment: 'bottom' }),
            padding({ bottom: 8, leading: 8, trailing: 8 }),
          ]}
        >
          <HStack alignment="center" modifiers={[frame({ width: bottomBarWidth })]}>
            {showFlipHint ? (
              <HStack
                alignment="center"
                spacing={3}
                modifiers={[
                  padding({ horizontal: 6, vertical: 3 }),
                  background('rgba(0, 0, 0, 0.50)', shapes.capsule()),
                ]}
              >
                <Image color="rgba(255, 255, 255, 0.85)" size={9} systemName="hand.tap.fill" />
                <Text modifiers={[font({ size: 9, weight: 'medium' }), foregroundStyle('rgba(255, 255, 255, 0.90)')]}>
                  แตะเพื่อเลื่อน
                </Text>
              </HStack>
            ) : null}
            <Spacer />
            {!isUploading ? (
              <Button
                label="ขยายภาพ"
                onPress={() => onPreviewImage?.(mediaUrls[activeIndex], mediaUrls)}
                systemImage="arrow.up.left.and.arrow.down.right"
                modifiers={[
                  buttonStyle('plain'),
                  labelStyle('iconOnly'),
                  foregroundStyle('#FFFFFF'),
                  frame({ width: 28, height: 28 }),
                  background('rgba(0, 0, 0, 0.58)', shapes.circle()),
                  shadow({ radius: 3, x: 0, y: 1, color: 'rgba(0, 0, 0, 0.25)' }),
                ]}
              />
            ) : null}
          </HStack>
        </VStack>

        {/* Uploading Overlay */}
        {isUploading ? (
          <VStack
            alignment="center"
            spacing={6}
            modifiers={[
              frame({ width: cardWidth, height: cardHeight }),
              background('rgba(0, 0, 0, 0.55)', imageBubbleShape),
              clipShape('roundedRectangle', 18),
              cornerRadius(18),
            ]}
          >
            <ProgressView modifiers={[tint('#FFFFFF')]} />
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle('#FFFFFF')]}>
              กำลังส่งรูปภาพ...
            </Text>
          </VStack>
        ) : null}
      </ZStack>
    </ZStack>
  );
});

const MessageBubble = React.memo(function MessageBubble({ avatarColor, avatarEmoji, avatarUri, conversationId, currentUserId, isLatest, item, onOpenProfile, onPreviewImage, onQuickReact, onScrollToMessage, onSelectMessage, onShowReactionDetails, otherUnread, readAt, showAllMessageTimes }) {
  const palette = usePalette();
  const mine = item.sender === 'me';
  const statusText = formatStatusTime(item, mine, isLatest, readAt, otherUnread, showAllMessageTimes);
  const { count: reactionCount, uniqueEmojis } = getMessageReactionSummary(item.reactions);
  const lastTapAtRef = useRef(0);
  const doubleTapTimerRef = useRef(null);
  const longPressAtRef = useRef(0);

  useEffect(() => () => {
    if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
  }, []);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - longPressAtRef.current < 500) {
      longPressAtRef.current = 0;
      return;
    }

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
  }, [item, onQuickReact]);

  const handleLongPress = useCallback(() => {
    longPressAtRef.current = Date.now();
    lastTapAtRef.current = 0;
    if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
    onSelectMessage?.(item);
  }, [item, onSelectMessage]);

  const messageRow = (
    <HStack alignment="bottom" spacing={7} modifiers={[frame({ maxWidth: Infinity, alignment: mine ? 'trailing' : 'leading' })]}>
      {mine ? <Spacer /> : null}
      {!mine ? (
        <Button
          modifiers={[buttonStyle('plain')]}
          onPress={onOpenProfile}
        >
          <ResolvedProfileAvatar avatarColor={avatarColor} emoji={avatarEmoji} size={28} uri={avatarUri} />
        </Button>
      ) : null}
      <VStack alignment={mine ? 'trailing' : 'leading'} spacing={3} modifiers={[frame({ maxWidth: 300, alignment: mine ? 'trailing' : 'leading' })]}>
        {item.forwarded ? (
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>ส่งต่อ</Text>
        ) : null}
        {item.replyTo ? (
          <Button
            modifiers={[buttonStyle('plain')]}
            onPress={() => {
              const targetId = item.replyTo?.id || item.replyTo?.messageId;
              if (targetId) onScrollToMessage?.(targetId);
            }}
          >
            <HStack spacing={4} alignment="center" modifiers={[padding({ horizontal: 9, vertical: 5 }), background(palette.raised, shapes.roundedRectangle({ cornerRadius: 9 }))]}>
              <Image color={palette.secondary} size={10} systemName="arrowshape.turn.up.left.fill" />
              <ReplyPreview reply={item.replyTo} conversationId={conversationId} color={palette.secondary} />
            </HStack>
          </Button>
        ) : null}
        <VStack
          alignment={mine ? 'trailing' : 'leading'}
          spacing={3}
          modifiers={[frame({ maxWidth: 300, alignment: mine ? 'trailing' : 'leading' })]}
        >
          {item.mediaType === 'video' && item.mediaUrl ? (
            <VStack modifiers={[frame({ width: 230, height: 100 })]}><RNHostView>
              <ChatVideoBubble onLongPress={handleLongPress} item={item} conversationId={conversationId} currentUserId={currentUserId} mine={mine} />
            </RNHostView></VStack>
          ) : null}
          {item.mediaType === 'image' && item.viewMode && item.viewMode !== 'chat' && item.mediaUrl ? <RNHostView><ChatProtectedImageBubble onLongPress={handleLongPress} item={item} conversationId={conversationId} currentUserId={currentUserId} mine={mine} /></RNHostView> : null}
          {/* Voice Message */}
          {item.mediaType === 'audio' || item.audioUrl ? (
            <IosVoiceBubble
              audioDuration={item.audioDuration}
              audioUrl={item.audioUrl || item.mediaUrl}
              conversationId={conversationId}
              currentUserId={currentUserId}
              handleLongPress={handleLongPress}
              messageShape={messageShape}
              mine={mine}
              palette={palette}
            />
          ) : null}

          {/* Image Message */}
          {item.mediaUrl && ((!item.viewMode || item.viewMode === 'chat') && (item.mediaType === 'image' || !item.mediaType)) ? (
            item.mediaUrls && item.mediaUrls.length > 1 ? (
              <IosStackedImageCards
                conversationId={conversationId}
                currentUserId={currentUserId}
                handleLongPress={handleLongPress}
                isUploading={Boolean(item.isUploading)}
                mediaUrls={item.mediaUrls}
                mine={mine}
                onPreviewImage={onPreviewImage}
              />
            ) : (
              <IosImageBubble
                conversationId={conversationId}
                currentUserId={currentUserId}
                handleLongPress={handleLongPress}
                isUploading={Boolean(item.isUploading)}
                mediaUrl={item.mediaUrl}
                onPreviewImage={onPreviewImage}
              />
            )
          ) : null}
          {/* Image Link Preview (if message text contains an image URL without attached media) */}
          {!item.mediaUrl && item.mediaType !== 'audio' && item.text ? (() => {
            const linkedImageUrl = extractFirstImageUrl(item.text);
            if (!linkedImageUrl) return null;
            return (
              <IosImageBubble
                conversationId={conversationId}
                currentUserId={currentUserId}
                handleLongPress={handleLongPress}
                mediaUrl={linkedImageUrl}
                onPreviewImage={onPreviewImage}
              />
            );
          })() : null}

          {/* Text Bubble */}
          {item.text && item.text !== '[รูปภาพ]' && item.text !== '[ข้อความเสียง]' && !item.text.startsWith('[รูปภาพ ') ? (
            <Text
              modifiers={[
                onTapGesture(handleTap),
                onLongPressGesture(handleLongPress, LONG_PRESS_DURATION_SECONDS),
                padding({ horizontal: 12, vertical: 7 }),
                background(mine ? palette.accent : palette.incoming, messageShape),
                font({ textStyle: 'subheadline', weight: 'regular' }),
                multilineTextAlignment('leading'),
                foregroundStyle(mine ? palette.white : palette.text),
              ]}
            >
              {item.text}
            </Text>
          ) : null}
          {reactionCount ? (
            <HStack
              alignment="center"
              modifiers={[
                frame({ maxWidth: Infinity, alignment: mine ? 'leading' : 'trailing' }),
                padding({ top: 1 }),
              ]}
            >
              <ReactionBadge
                count={reactionCount}
                emojis={uniqueEmojis}
                onPress={() => onShowReactionDetails?.(item)}
                palette={palette}
              />
            </HStack>
          ) : null}
        </VStack>
        {!showAllMessageTimes && statusText ? (
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'regular' }), foregroundStyle(palette.tertiary)]}>
            {statusText}
          </Text>
        ) : null}
      </VStack>
      {!mine ? <Spacer /> : null}
      {showAllMessageTimes ? <Text modifiers={[frame({ width: 76, alignment: 'trailing' }), font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary)]}>{messageDate(item)?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) || ''}</Text> : null}
    </HStack>
  );
  return messageRow;
}, (previous, next) => (
  previous.conversationId === next.conversationId
  && previous.currentUserId === next.currentUserId
  && previous.avatarColor === next.avatarColor
  && previous.avatarEmoji === next.avatarEmoji
  && previous.avatarUri === next.avatarUri
  && previous.isLatest === next.isLatest
  && previous.showAllMessageTimes === next.showAllMessageTimes
  && previous.item.id === next.item.id
  && previous.item.sender === next.item.sender
  && previous.item.text === next.item.text
  && previous.item.mediaUrl === next.item.mediaUrl
  && JSON.stringify(previous.item.mediaUrls || []) === JSON.stringify(next.item.mediaUrls || [])
  && previous.item.mediaType === next.item.mediaType
  && previous.item.isUploading === next.item.isUploading
  && previous.item.audioUrl === next.item.audioUrl
  && previous.item.audioDuration === next.item.audioDuration
  && previous.item.forwarded === next.item.forwarded
  && previous.onOpenProfile === next.onOpenProfile
  && previous.onPreviewImage === next.onPreviewImage
  && previous.onQuickReact === next.onQuickReact
  && previous.onScrollToMessage === next.onScrollToMessage
  && previous.onSelectMessage === next.onSelectMessage
  && previous.onShowReactionDetails === next.onShowReactionDetails
  && previous.tick === next.tick
  && JSON.stringify(previous.item.reactions || {}) === JSON.stringify(next.item.reactions || {})
  && JSON.stringify(previous.item.reactionTimes || {}) === JSON.stringify(next.item.reactionTimes || {})
  && JSON.stringify(previous.item.replyTo || null) === JSON.stringify(next.item.replyTo || null)
  && toDate(previous.readAt)?.getTime() === toDate(next.readAt)?.getTime()
  && previous.otherUnread === next.otherUnread
  && messageDate(previous.item)?.getTime() === messageDate(next.item)?.getTime()
));

const MessageSwipeRow = React.memo(function MessageSwipeRow({ avatarColor, avatarEmoji, avatarUri, conversationId, currentUserId, isLatest, item, onOpenProfile, onPreviewImage, onQuickReact, onReply, onScrollToMessage, onSelectMessage, onShowReactionDetails, otherUnread, previousItem, readAt, showAllMessageTimes, tick }) {
  const palette = usePalette();
  const messagesAreOnDifferentDays = previousItem && !isSameDay(previousItem, item);
  const rowModifiers = [
    id(item.id),
    padding({ vertical: 5, leading: 14, trailing: 36 }),
    frame({ maxWidth: Infinity }),
    listRowBackground(palette.background),
    listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
    listRowSeparator('hidden'),
  ];
  const messageContent = (
    <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
      {(!previousItem || messagesAreOnDifferentDays) ? <DayDivider label={formatDay(item)} /> : null}
      <MessageBubble
        avatarColor={avatarColor}
        avatarEmoji={avatarEmoji}
        avatarUri={avatarUri}
        conversationId={conversationId}
        currentUserId={currentUserId}
        isLatest={isLatest}
        item={item}
        onOpenProfile={onOpenProfile}
        onPreviewImage={onPreviewImage}
        onQuickReact={onQuickReact}
        onScrollToMessage={onScrollToMessage}
        onSelectMessage={onSelectMessage}
        onShowReactionDetails={onShowReactionDetails}
        otherUnread={otherUnread}
        readAt={readAt}
        showAllMessageTimes={showAllMessageTimes}
        tick={tick}
      />
    </VStack>
  );

  return (
    <SwipeActions modifiers={rowModifiers}>
      {messageContent}
      <SwipeActions.Actions edge="trailing" allowsFullSwipe={true}>
        <Button
          label="ตอบกลับ"
          onPress={() => onReply?.(item)}
          systemImage="arrowshape.turn.up.left.fill"
          modifiers={[tint(palette.secondary)]}
        />
      </SwipeActions.Actions>
    </SwipeActions>
  );
}, (previous, next) => (
  previous.conversationId === next.conversationId
  && previous.currentUserId === next.currentUserId
  && previous.avatarColor === next.avatarColor
  && previous.avatarEmoji === next.avatarEmoji
  && previous.avatarUri === next.avatarUri
  && previous.isLatest === next.isLatest
  && previous.item.id === next.item.id
  && previous.item.sender === next.item.sender
  && previous.item.text === next.item.text
  && previous.item.mediaUrl === next.item.mediaUrl
  && JSON.stringify(previous.item.mediaUrls || []) === JSON.stringify(next.item.mediaUrls || [])
  && previous.item.mediaType === next.item.mediaType
  && previous.item.isUploading === next.item.isUploading
  && previous.item.audioUrl === next.item.audioUrl
  && previous.item.audioDuration === next.item.audioDuration
  && previous.item.forwarded === next.item.forwarded
  && previous.onQuickReact === next.onQuickReact
  && previous.onOpenProfile === next.onOpenProfile
  && previous.onPreviewImage === next.onPreviewImage
  && previous.onScrollToMessage === next.onScrollToMessage
  && previous.onSelectMessage === next.onSelectMessage
  && previous.onShowReactionDetails === next.onShowReactionDetails
  && previous.onReply === next.onReply
  && previous.showAllMessageTimes === next.showAllMessageTimes
  && previous.previousItem?.id === next.previousItem?.id
  && previous.tick === next.tick
  && JSON.stringify(previous.item.reactions || {}) === JSON.stringify(next.item.reactions || {})
  && JSON.stringify(previous.item.reactionTimes || {}) === JSON.stringify(next.item.reactionTimes || {})
  && JSON.stringify(previous.item.replyTo || null) === JSON.stringify(next.item.replyTo || null)
  && toDate(previous.readAt)?.getTime() === toDate(next.readAt)?.getTime()
  && previous.otherUnread === next.otherUnread
  && messageDate(previous.item)?.getTime() === messageDate(next.item)?.getTime()
));

function ReactionBadge({ count, emojis, onPress, palette }) {
  const visibleEmojis = (Array.isArray(emojis) ? emojis : []).filter(Boolean).slice(0, 2);
  const badgeWidth = Math.max(
    count > 1 ? 34 : 28,
    18 + (visibleEmojis.length * 13) + (count > 1 ? String(count).length * 6 : 0)
  );
  const badge = (
    <HStack
      alignment="center"
      spacing={2}
      modifiers={[
        padding({ horizontal: 3, vertical: 1 }),
        frame({ minWidth: badgeWidth, height: 22 }),
        background(palette.surface, shapes.capsule()),
        shadow({ color: 'black', opacity: 0.18, radius: 4, x: 0, y: 1 }),
      ]}
    >
      {visibleEmojis.map((emoji, index) => (
        <Text
          key={`${emoji}-${index}`}
          modifiers={[
            frame({ width: 18, height: 18, alignment: 'center' }),
            background(palette.raised, shapes.circle()),
            font({ size: 11 }),
          ]}
        >
          {emoji}
        </Text>
      ))}
      {count > 1 ? (
        <Text
          modifiers={[
            padding({ horizontal: 4, vertical: 1 }),
            background(palette.raised, shapes.capsule()),
            font({ size: 9, weight: 'semibold' }),
            foregroundStyle(palette.secondary),
          ]}
        >
          {count}
        </Text>
      ) : null}
    </HStack>
  );
  if (!onPress) return badge;
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain')]}
    >
      {badge}
    </Button>
  );
}

function DayDivider({ label }) {
  const palette = usePalette();
  return (
    <Text modifiers={[padding({ horizontal: 11, vertical: 6 }), background(palette.raised, shapes.capsule()), font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
      {label}
    </Text>
  );
}

function ProfileAvatar({ avatarColor, cacheScope, cacheVersion, emoji, size, uri }) {
  const isUrl = typeof uri === 'string' && (uri.startsWith('http') || uri.startsWith('file://') || uri.startsWith('data:'));
  const remoteUri = useRemoteImage(isUrl ? uri : null, cacheVersion, cacheScope);
  const resolvedEmoji = emoji || (!isUrl && typeof uri === 'string' && uri.length <= 6 ? uri : null);
  return <ResolvedProfileAvatar avatarColor={avatarColor} emoji={resolvedEmoji} size={size} uri={remoteUri} />;
}

function ResolvedProfileAvatar({ avatarColor, emoji, size, uri }) {
  const palette = usePalette();
  const bgColor = avatarColor || palette.raised;
  if (uri) {
    return (
      <Image
        uiImage={uri}
        modifiers={[
          resizable(),
          aspectRatio({ contentMode: 'fill' }),
          frame({ width: size, height: size }),
          clipped(),
          clipShape('circle'),
        ]}
      />
    );
  }
  if (emoji) {
    return (
      <ZStack modifiers={[frame({ width: size, height: size }), background(bgColor, shapes.circle()), clipShape('circle')]}>
        <Text modifiers={[font({ size: size * 0.52 })]}>{emoji}</Text>
      </ZStack>
    );
  }
  return (
    <Image
      color={avatarColor || palette.secondary}
      size={size * 0.48}
      systemName="person.fill"
      modifiers={[
        frame({ width: size, height: size }),
        background(bgColor, shapes.circle()),
        clipped(),
        clipShape('circle'),
      ]}
    />
  );
}

function TopBlur({ colorScheme, height = 110 }) {
  return (
    <MaskedView
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height, zIndex: 10 }}
      maskElement={<LinearGradient colors={['#FFFFFF', '#FFFFFF', '#FFFFFF00']} locations={[0, 0.84, 1]} style={{ flex: 1 }} />}
    >
      <BlurView intensity={colorScheme === 'dark' ? 36 : 46} style={{ flex: 1 }} tint={colorScheme} />
    </MaskedView>
  );
}

function ChatMeetupBanner({ encryptionPending, isAcceptedByMe, isExpanded, meetup, onToggleAccept, onToggleExpand, palette, stats }) {
  if (!meetup) return null;
  const isExpired = !isAcceptedByMe && isMeetupExpired(meetup);
  const cancelCheck = isAcceptedByMe ? canCancelMeetup(meetup) : { allowed: true };
  return (
    <VStack
      spacing={isExpanded ? 10 : 0}
      modifiers={[
        padding({ horizontal: 12, vertical: isExpanded ? 10 : 8 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.surface, shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' })),
        shadow({ color: 'black', opacity: 0.08, radius: 8, x: 0, y: 2 }),
      ]}
    >
      {/* Pinned Header / Compact Bar */}
      <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
        <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <VStack modifiers={[frame({ width: 28, height: 28 }), background(palette.accentSoft, shapes.circle())]}>
            <Image color={palette.accent} size={14} systemName="mappin.and.ellipse" />
          </VStack>
          <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <HStack spacing={4} alignment="center">
              <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(palette.accent)]}>
                นัดหมาย
              </Text>
              {stats?.isFull ? (
                <Text modifiers={[padding({ horizontal: 6, vertical: 1 }), background('rgba(255,100,100,0.15)', shapes.capsule()), font({ size: 9, weight: 'bold' }), foregroundStyle('#FF453A')]}>
                  เต็ม
                </Text>
              ) : (
                <Text modifiers={[padding({ horizontal: 6, vertical: 1 }), background(palette.accentSoft, shapes.capsule()), font({ size: 9, weight: 'bold' }), foregroundStyle(palette.accent)]}>
                  {stats ? `${stats.acceptedCount}/${stats.maxPeople} คน` : ''}
                </Text>
              )}
            </HStack>
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>
              {meetup.name}
            </Text>
            {!isExpanded && meetup.schedule?.date ? (
              <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(1)]}>
                {formatReadableDate(meetup.schedule.date)}
                {meetup.schedule?.startTime && meetup.schedule?.endTime ? ` · ${meetup.schedule.startTime}–${meetup.schedule.endTime} น.` : ''}
              </Text>
            ) : null}
          </VStack>
        </HStack>

        {/* Action button & expand chevron */}
        <HStack alignment="center" spacing={6}>
          <Button
            label={isAcceptedByMe ? 'ตอบรับแล้ว' : (isExpired ? 'เลยกำหนดแล้ว' : (stats?.isFull ? 'เต็ม' : 'ยอมรับ'))}
            onPress={isExpired ? () => Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้') : onToggleAccept}
            disabled={encryptionPending || (!isAcceptedByMe && (isExpired || stats?.isFull))}
            systemImage={isAcceptedByMe ? 'checkmark.circle.fill' : (isExpired ? 'clock.badge.xmark' : (stats?.isFull ? 'xmark.circle' : 'person.badge.plus'))}
            modifiers={[
              buttonStyle(isAcceptedByMe ? 'glass' : 'glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(isAcceptedByMe ? '#34C759' : ((stats?.isFull || isExpired) ? palette.secondary : palette.accent)),
            ]}
          />
          <Button
            label={isExpanded ? 'ย่อ' : 'ขยาย'}
            onPress={onToggleExpand}
            systemImage={isExpanded ? 'chevron.up' : 'chevron.down'}
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('circle'),
              controlSize('small'),
              labelStyle('iconOnly'),
              tint(palette.secondary),
            ]}
          />
        </HStack>
      </HStack>

      {/* Expanded full details */}
      {isExpanded && (
        <VStack spacing={8} modifiers={[padding({ top: 4, horizontal: 2 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <VStack alignment="leading" spacing={5} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            {meetup.schedule?.date ? (
              <HStack alignment="center" spacing={6}>
                <Image color={palette.secondary} size={12} systemName="calendar" />
                <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                  วันที่: {formatReadableDate(meetup.schedule.date)}
                </Text>
              </HStack>
            ) : null}

            {meetup.schedule?.startTime && meetup.schedule?.endTime ? (
              <HStack alignment="center" spacing={6}>
                <Image color={palette.secondary} size={12} systemName="clock" />
                <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                  เวลา: {meetup.schedule.startTime} – {meetup.schedule.endTime} น.
                </Text>
              </HStack>
            ) : null}

            {stats ? (
              <HStack alignment="center" spacing={6}>
                <Image color={palette.secondary} size={12} systemName="person.2.fill" />
                <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.text)]}>
                  ผู้เข้าร่วม: {stats.acceptedCount}/{stats.maxPeople} คน
                </Text>
              </HStack>
            ) : null}

            {isAcceptedByMe && !cancelCheck.allowed ? (
              <HStack alignment="center" spacing={6} modifiers={[padding({ top: 2 })]}>
                <Image color={palette.secondary} size={11} systemName="lock.fill" />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                  ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน
                </Text>
              </HStack>
            ) : null}
          </VStack>

          <Button
            label={isAcceptedByMe ? 'ยอมรับนัดหมายแล้ว (แตะเพื่อยกเลิก)' : (isExpired ? 'นัดหมายนี้เลยกำหนดเวลาแล้ว' : (stats?.isFull ? 'นัดหมายเต็มจำนวนแล้ว' : 'ยอมรับนัดหมาย'))}
            onPress={isExpired ? () => Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้') : onToggleAccept}
            disabled={encryptionPending || (!isAcceptedByMe && (isExpired || stats?.isFull))}
            systemImage={isAcceptedByMe ? 'checkmark.circle.fill' : (isExpired ? 'clock.badge.xmark' : (stats?.isFull ? 'xmark.circle' : 'person.badge.plus'))}
            modifiers={[
              buttonStyle(isAcceptedByMe ? 'glass' : 'glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(isAcceptedByMe ? '#34C759' : ((stats?.isFull || isExpired) ? palette.secondary : palette.accent)),
              frame({ maxWidth: Infinity }),
            ]}
          />
        </VStack>
      )}
    </VStack>
  );
}
