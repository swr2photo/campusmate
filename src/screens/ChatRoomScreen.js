import { randomUUID } from 'expo-crypto';
import { stageVideoUpgrade, cancelVideoUpgrade, resumeVideoUpgrades } from '../services/videoUpgradeService';
import ChatVideoBubble from '../components/ChatVideoBubble';
import ChatVideoComposer from '../components/ChatVideoComposer';
import ChatCameraModal from '../components/ChatCameraModal';
import ChatMediaComposer from '../components/ChatMediaComposer';
import ChatProtectedImageBubble from '../components/ChatProtectedImageBubble';
import { pickChatVideo } from '../services/chatVideoService';
import { validateChatVideo } from '../utils/chatVideoPolicy';
import { useToast } from '../context/ToastContext';
import { useCall } from '../context/CallContext';
import ReplyPreview from '../components/ReplyPreview';
import MessageTimeSwipeArea from '../components/MessageTimeSwipeArea';
import { createReplySnapshot, resolveMessageReply } from '../utils/messageReply';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { decryptConversationMessageList, mergeProfileRecords, toSafePublicProfile } from '../services/firestoreService';
import { setActiveConversation } from '../services/notificationService';
import {
  ensureConversationEncryption,
  getConversationKey,
  getOrCreateEncryptionIdentity,
  hasCurrentDeviceEnvelope,
  isValidConversationEncryption,
  getOrFetchConversationKey,
} from '../services/chatEncryptionService';
import { useApp } from '../context/AppContext';
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
import ChatMediaPickerSheet from '../components/ChatMediaPickerSheet';
import ChatGiphyPickerSheet from '../components/ChatGiphyPickerSheet';
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

function formatStatusTime(item, mine, isLatest, otherReadAt, otherUnread) {
  const sentDate = toDate(messageTimestamp(item));
  if (!sentDate) return '';
  const sentTime = format24Time(sentDate);

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
      const readTime = readDate ? format24Time(readDate) : sentTime;
      return `อ่านแล้วเมื่อ ${readTime}`;
    }

    return `ส่งแล้วเมื่อ ${sentTime}`;
  }

  return '';
}

export default function ChatRoomScreen() {
  const { showImageModeration } = useToast();
  const { activeCall, startVoiceCall, startVideoCall, acceptCall } = useCall();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { chatId } = useLocalSearchParams();
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
    Alert.alert('ยกเลิกการส่ง?', 'ข้อความนี้จะหายจากห้องสนทนาของทั้งสองฝ่าย', [
      { style: 'cancel', text: 'ยกเลิก' },
      {
        onPress: () => unsendMessageInChat(chat.id, item.id).catch((error) => console.error('unsend message error:', error)),
        style: 'destructive',
        text: 'ยกเลิกการส่ง',
      },
    ]);
  }, [chat?.id, unsendMessageInChat]);

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
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isGiphyPickerOpen, setIsGiphyPickerOpen] = useState(false);
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
  const isNearBottomRef = useRef(true);
  // The first Firestore snapshot replaces the cached conversation. Position
  // that snapshot instantly; only later messages should use an animated jump.
  const initialMessagesReadyRef = useRef(false);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const otherUserId = chat?.profileId || chat?.participants?.find((participantId) => participantId !== currentUserId);
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
      console.warn('Failed to load older messages:', err);
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

  const [partnerProfileDirect, setPartnerProfileDirect] = useState(null);
  const [isBannerExpanded, setIsBannerExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAllMessageTimes, setShowAllMessageTimes] = useState(false);
  const allMessageTimesTimerRef = useRef(null);
  const timeDragAnim = useRef(new Animated.Value(0)).current;
  const [tick, setTick] = useState(0);
  const handleTextInputChange = useCallback((text) => {
    // Preserve native typing/paste, including image URLs, without clearing the draft.
    setInputText(text);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(timer);
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

  const handleOpenPartnerProfile = useCallback(() => {
    if (otherUserId) {
      router.push({
        pathname: '/discover-profile',
        params: { profileId: otherUserId, id: otherUserId, viewOnly: 'true' },
      });
    }
  }, [otherUserId]);

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
      Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้');
      return;
    }
    if (isAcceptedByMe && !cancelCheck.allowed) {
      Alert.alert('ไม่สามารถยกเลิกได้', cancelCheck.reason || 'ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน');
      return;
    }
    try {
      await toggleMeetupAcceptanceInChat(chat.id, targetHostId, partnerMeetup.name || 'จุดนัดพบ', partnerMeetup);
    } catch (e) {
      console.warn('toggle meetup acceptance warning:', e?.message || e);
      Alert.alert('เกิดข้อผิดพลาด', e?.message || 'ไม่สามารถดำเนินการได้');
    }
  };

  const scrollToLatest = useCallback((animated = true, force = false) => {
    if (!listRef.current) return;
    const run = () => {
      try {
        listRef.current?.scrollToEnd({ animated });
      } catch (_) {
        try {
          listRef.current?.scrollToOffset({ offset: 999999, animated });
        } catch (_) {}
      }
    };
    requestAnimationFrame(run);
    if (force) {
      setTimeout(run, 50);
      setTimeout(run, 150);
      setTimeout(run, 300);
    }
  }, []);

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
    if (isNearBottomRef.current) {
      scrollToLatest(false, true);
    }
  }, [scrollToLatest]);

  const handleListLayout = useCallback(() => {
    if (isNearBottomRef.current) {
      scrollToLatest(false, true);
    }
  }, [scrollToLatest]);

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
    initialMessagesReadyRef.current = false;
    if (allMessageTimesTimerRef.current) {
      clearTimeout(allMessageTimesTimerRef.current);
      allMessageTimesTimerRef.current = null;
    }
    scrollToLatest(false, true);
  }, [chat?.id, scrollToLatest]);

  useEffect(() => () => {
    if (allMessageTimesTimerRef.current) clearTimeout(allMessageTimesTimerRef.current);
  }, []);

  useEffect(() => {
    if (!latestMessageId) return;
    if (directMessages === null || !initialMessagesReadyRef.current) {
      // The list may first contain cached messages and then be replaced by
      // the initial direct snapshot. Never animate that hydration pass.
      scrollToLatest(false, true);
      if (directMessages !== null) {
        initialMessagesReadyRef.current = true;
      }
      return;
    }
    if (isNearBottomRef.current) {
      scrollToLatest(true, true);
    } else {
      setNewMessagesBelow((prev) => prev + 1);
    }
  }, [directMessages, latestMessageId, scrollToLatest]);

  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const initialContainerHeightRef = useRef(0);

  // Track Android keyboard height to prevent keyboard from covering the chat input in edge-to-edge mode
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onShow = (e) => {
      const kh = e?.endCoordinates?.height || 0;
      if (kh > 0) {
        try {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        } catch (_) {}
        setAndroidKeyboardHeight(kh);
        if (isNearBottomRef.current) {
          scrollToLatest(true, true);
        }
      }
    };

    const onHide = () => {
      try {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      } catch (_) {}
      setAndroidKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToLatest]);

  const handleContainerLayout = useCallback((e) => {
    const h = e.nativeEvent?.layout?.height;
    if (!h) return;
    if (!initialContainerHeightRef.current || (androidKeyboardHeight === 0 && h > initialContainerHeightRef.current)) {
      initialContainerHeightRef.current = h;
    }
    setContainerHeight(h);
  }, [androidKeyboardHeight]);

  const windowShrinkage = Math.max(
    0,
    (initialContainerHeightRef.current || 0) - (containerHeight || 0)
  );

  const androidKeyboardOffset = Platform.OS === 'android' && androidKeyboardHeight > 0
    ? Math.max(0, androidKeyboardHeight - windowShrinkage - (windowShrinkage > 0 ? 0 : (insets?.bottom || 0))) + 10
    : 0;

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
      Alert.alert('เสียงสั้นเกินไป', 'กรุณาบันทึกเสียงอย่างน้อย 1 วินาที');
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
      preCacheDecryptedMedia(downloadUrl, audioUri);
      await sendMessage(chat.id, '[ข้อความเสียง]', {
        mediaType: 'audio',
        mediaUrl: downloadUrl,
        audioDuration: duration,
        clientMessageId: tempId,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      });
      scrollToLatest(true, true);
    } catch (err) {
      Alert.alert('ส่งข้อความเสียงไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
      setUploadingMedia(false);
    }
  }, [chat?.id, currentUserId, isPreviewPlaying, isRecordingAudio, previewPlayer, recordedAudio, recordingSeconds, replyingTo, scrollToLatest, sendMessage]);

  const handleSendImage = useCallback(async (imageUri, captionText, viewMode = 'chat') => {
    const uris = Array.isArray(imageUri) ? imageUri.filter(Boolean) : (imageUri ? [imageUri] : []);
    if (!uris.length || !chat?.id) return;
    setUploadingMedia(true);
    setSelectedImage(null);
    setInputText('');
    setIsMediaPickerOpen(false);
    const replySnapshot = replyingTo;
    setReplyingTo(null);

    const tempId = `temp-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeCaption = (captionText || '').trim();
    const isMulti = uris.length > 1;
    const defaultPlaceholder = isMulti ? `[รูปภาพ ${uris.length} รูป]` : '[รูปภาพ]';

    const optimisticMessage = {
      id: tempId,
      sender: 'me',
      senderId: currentUserId,
      text: safeCaption || defaultPlaceholder,
      createdAt: Date.now(),
      time: Date.now(),
      mediaType: 'image',
      mediaUrl: uris[0],
      mediaUrls: uris,
      isUploading: true,
      pendingSync: true,
      replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
    };

    setLocalPendingMediaMessages((prev) => [...prev, optimisticMessage]);
    scrollToLatest(true, true);

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

      await sendMessage(chat.id, safeCaption || (downloadUrls.length > 1 ? `[รูปภาพ ${downloadUrls.length} รูป]` : '[รูปภาพ]'), {
        mediaType: 'image',
        viewMode,
        mediaUrl: downloadUrls[0],
        mediaUrls: downloadUrls,
        clientMessageId: tempId,
        replyTo: replySnapshot ? createReplySnapshot(replySnapshot) : undefined,
      });
      scrollToLatest(true, true);
    } catch (err) {
      if (err.isModerationViolation || err.isModerationUnavailable) {
        showImageModeration(err);
        setSelectedImage({ uri: uris[0], uris });
        setInputText(safeCaption);
        setReplyingTo(replySnapshot);
      } else {
        Alert.alert('ส่งรูปภาพไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setLocalPendingMediaMessages((prev) => prev.filter((m) => m.id !== tempId));
      setUploadingMedia(false);
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
        Alert.alert('ส่ง GIF ไม่สำเร็จ', err?.message || 'กรุณาลองใหม่อีกครั้ง');
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
    setCameraOpen(true);
  }, []);

  const handleSend = async () => {
    if (selectedImage?.uri) {
      await handleSendImage(selectedImage.uris || selectedImage.uri, inputText);
      return;
    }
    const trimmed = inputText.trim();
    if (!trimmed || sending || uploadingMedia || !chat?.id || chat.encryptionPending || !isMatchActive) return;

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
        onOpenProfile={handleOpenPartnerProfile}
        onPreviewImage={handlePreviewImage}
        onQuickReact={handleQuickReact}
        onReply={handleReply}
        onScrollToMessage={handleScrollToMessage}
        onShowReactionDetails={handleShowReactionDetails}
        onSelectMessage={handleSelectMessage}
        otherReadAt={otherReadAt}
        otherUnread={chat?.unreadCounts?.[otherUserId]}
        showAllMessageTimes={showAllMessageTimes}
        showDay={showDay}
        styles={styles}
        tick={index === effectiveMessages.length - 1 ? tick : 0}
        timeDragAnim={timeDragAnim}
      />
    );
  }, [actionMessage?.id, highlightedMessageId, chat, currentUserId, colors, effectiveMessages, replyMessagesById, handleOpenPartnerProfile, handlePreviewImage, handleQuickReact, handleScrollToMessage, handleSelectMessage, handleShowReactionDetails, otherReadAt, otherUserId, handleReply, showAllMessageTimes, styles, tick, timeDragAnim]);

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
    <SafeAreaView onLayout={handleContainerLayout} style={styles.roomContainer}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={[{ flex: 1 }, Platform.OS === 'android' && { paddingBottom: androidKeyboardOffset }]}
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
            <Avatar avatarColor={chat.avatarColor} cacheScope={chat.profileId} cacheVersion={chat.participantProfiles?.[chat.profileId]?.updatedAt} colors={colors} emoji={chat.avatar} size={44} uri={chat.avatarUri} />
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
                    onPress={isMeetupDateExpired ? () => Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้') : handleToggleAcceptMeetup}
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
                    onPress={isMeetupDateExpired ? () => Alert.alert('ไม่สามารถตอบรับได้', 'นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้') : handleToggleAcceptMeetup}
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
            data={effectiveMessages}
            keyExtractor={(item) => item.id}
            keyboardDismissMode="none"
            keyboardShouldPersistTaps="handled"
            onLayout={handleListLayout}
            onScroll={handleScroll}
            onContentSizeChange={handleContentSizeChange}
            onScrollToIndexFailed={(info) => {
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
            }}
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
                      ? 'กำลังรอคีย์จากผู้ร่วมสนทนา ข้อความเก่าจะแสดงเมื่อได้รับคีย์'
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
            initialNumToRender={40}
            maxToRenderPerBatch={15}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            onTouchStart={() => {
              if (isMediaPickerOpen) setIsMediaPickerOpen(false);
              if (isGiphyPickerOpen) setIsGiphyPickerOpen(false);
            }}
            updateCellsBatchingPeriod={50}
            windowSize={11}
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
              <ReplyPreview reply={replyingTo} conversationId={chat?.id} color={colors.inkSoft} />
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

                  <Pressable
                    accessibilityLabel="เปิดแผงอิโมจิ"
                    focusable={false}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => setShowQuickEmoji((prev) => !prev)}
                    style={({ pressed }) => [styles.capsuleSmileyBtn, showQuickEmoji && { backgroundColor: colors.primarySoft, borderRadius: 12 }, pressed && styles.pressed]}
                  >
                    <FeatureIcon color={showQuickEmoji ? colors.primary : colors.ink} name="face.smiling" size={22} />
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
                        : chat.encryptionPending
                        ? 'พิมพ์รอคีย์ได้...'
                        : 'ส่งข้อความ...'
                    }
                    placeholderTextColor={colors.inkSoft}
                    ref={inputRef}
                    style={styles.capsuleTextInput}
                    value={inputText}
                  />

                  <View style={styles.capsuleTrailingContainer}>
                    {inputText.trim().length > 0 || selectedImage || replyingTo ? (
                      <Pressable
                        accessibilityLabel="ส่งข้อความ"
                        focusable={false}
                        disabled={sending || uploadingMedia || chat.encryptionPending || (!inputText.trim() && !selectedImage)}
                        onPress={handleSend}
                        style={({ pressed }) => [
                          styles.capsuleSendButton,
                          (sending || uploadingMedia || chat.encryptionPending || (!inputText.trim() && !selectedImage)) && styles.sendDisabled,
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
                          accessibilityLabel="วางรูปภาพจากคลิปบอร์ด"
                          focusable={false}
                          hitSlop={6}
                          onPress={handlePasteClipboardImage}
                          style={({ pressed }) => [styles.capsuleActionIconBtn, pressed && styles.pressed]}
                        >
                          <FeatureIcon color={colors.ink} name="doc.on.clipboard" size={21} />
                        </Pressable>

                        <Pressable
                          accessibilityLabel="ค้นหาและส่ง GIF"
                          focusable={false}
                          hitSlop={6}
                          onPress={() => {
                            Keyboard.dismiss();
                            if (isMediaPickerOpen) setIsMediaPickerOpen(false);
                            if (showQuickEmoji) setShowQuickEmoji(false);
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
      {isMediaPickerOpen && (
          <ChatMediaPickerSheet
            onSelectVideo={handlePickVideo}
            inline
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
                Alert.alert('ไม่สามารถเปิดคลังภาพได้', err.message || 'กรุณาลองใหม่อีกครั้ง');
              }
            }}
          />
        )}

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
      </KeyboardAvoidingView>
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
  const translateY = useRef(new Animated.Value(500)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);

  const closeWithAnimation = useCallback((callback) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 600,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
      isClosingRef.current = false;
      if (typeof callback === 'function') {
        setTimeout(callback, 80);
      }
    });
  }, [onClose, translateY, fadeAnim]);

  useEffect(() => {
    if (isOpen) {
      isClosingRef.current = false;
      translateY.setValue(500);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 260,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen, translateY, fadeAnim]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => (
      gestureState.dy > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        translateY.setValue(gestureState.dy);
      } else {
        translateY.setValue(gestureState.dy * 0.15);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 70 || gestureState.vy > 0.5) {
        closeWithAnimation();
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      Animated.spring(translateY, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 280,
        useNativeDriver: true,
      }).start();
    },
  }), [closeWithAnimation, translateY]);

  return (
    <Modal animationType="none" transparent visible={isOpen} onRequestClose={() => closeWithAnimation()}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(0,0,0,0.5)',
              opacity: fadeAnim,
            },
          ]}
        >
          <Pressable onPress={() => closeWithAnimation()} style={{ flex: 1 }} />
        </Animated.View>

        <Animated.View
          style={{
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
            transform: [{ translateY }],
          }}
        >
          {/* Handle - Draggable bar */}
          <View
            {...panResponder.panHandlers}
            style={{ alignItems: 'center', justifyContent: 'center', width: '100%', paddingTop: 10, paddingBottom: 10 }}
          >
            <View style={{ width: 44, height: 5, borderRadius: 2.5, backgroundColor: colors.line }} />
          </View>

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
                trackColor={{ false: colors.line, true: colors.primary }}
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
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor="#FFFFFF"
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
        </Animated.View>
      </View>
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
  onOpenProfile,
  onPreviewImage,
  onQuickReact,
  onReply,
  onScrollToMessage,
  onShowReactionDetails,
  onSelectMessage,
  otherReadAt,
  otherUnread,
  showAllMessageTimes,
  showDay,
  styles,
  tick,
  timeDragAnim,
}) {
  const bubbleRef = useRef(null);
  const lastTapAtRef = useRef(0);
  const doubleTapTimerRef = useRef(null);
  const longPressRef = useRef(false);
  const replySwipeTriggeredRef = useRef(false);
  const currentImageSizeRef = useRef(null);
  const currentRatioRef = useRef(null);
  const mine = item.sender === 'me' || (Boolean(currentUserId) && item.senderId === currentUserId);
  const statusText = formatStatusTime(item, mine, isLatest, otherReadAt, otherUnread, showAllMessageTimes);
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

  const replyFromSwipe = useCallback((distance) => {
    if (distance < MESSAGE_TIME_REVEAL_THRESHOLD || replySwipeTriggeredRef.current) return;
    replySwipeTriggeredRef.current = true;
    onReply?.(item);
  }, [item, onReply]);

  const replyPanResponder = useMemo(() => {
    const isHorizontalRightSwipe = (gestureState) => (
      gestureState.dx > 16 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4
    );
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gestureState) => isHorizontalRightSwipe(gestureState),
      onMoveShouldSetPanResponder: (_, gestureState) => isHorizontalRightSwipe(gestureState),
      onPanResponderGrant: () => {
        replySwipeTriggeredRef.current = false;
      },
      onPanResponderMove: (_, gestureState) => {
        replyFromSwipe(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        replyFromSwipe(gestureState.dx);
      },
      onPanResponderTerminate: () => {
        replySwipeTriggeredRef.current = false;
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [replyFromSwipe]);

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
      <Animated.View
        style={[
          styles.messageRow,
          mine && styles.messageRowMine,
          timeDragAnim && {
            transform: [
              {
                translateX: timeDragAnim.interpolate({
                  inputRange: [-48, 0],
                  outputRange: [mine ? -44 : -8, 0],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
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
            <Avatar avatarColor={chat.avatarColor} cacheScope={chat.profileId} cacheVersion={chat.participantProfiles?.[chat.profileId]?.updatedAt} colors={colors} emoji={chat.avatar} size={28} uri={chat.avatarUri} />
          </Pressable>
        ) : null}
        <View style={[styles.messageGroup, mine && styles.messageGroupMine]}>
          <View style={[styles.messageContentRow, mine && styles.messageContentRowMine]}>
            <View style={[styles.messageStack, mine ? styles.messageStackMine : styles.messageStackOther]}>
              <Animated.View style={[styles.messageBubbleWithReaction, isActionActive && { opacity: 0 }, { transform: [{ scale: bounceAnim }] }]}>
              <Pressable
                {...replyPanResponder.panHandlers}
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
                  (item.mediaUrl && (item.mediaType === 'image' || item.mediaType === 'gif' || !item.mediaType)) && styles.imageBubble,
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
                      <ReplyPreview reply={item.replyTo} conversationId={chat?.id} color={mine ? "#FFFFFF" : colors.inkSoft} />
                    </View>
                  </Pressable>
                ) : null}

                {/* Call Message Card */}
                {item.mediaType === 'call' ? (
                  <CallMessageBubble
                    colors={colors}
                    item={item}
                    mine={mine}
                    onCallPress={(type) => {
                      if (type === 'video') startVideoCall(chat, chat?.id);
                      else startVoiceCall(chat, chat?.id);
                    }}
                  />
                ) : null}

                {/* Voice Message */}
                {item.mediaType === 'video' && item.mediaUrl ? <ChatVideoBubble onLongPress={handleLongPress} item={item} conversationId={chat?.id} currentUserId={currentUserId} mine={mine} /> : null}
                {item.mediaType === 'image' && item.viewMode && item.viewMode !== 'chat' && item.mediaUrl ? <ChatProtectedImageBubble onLongPress={handleLongPress} item={item} conversationId={chat?.id} currentUserId={currentUserId} mine={mine} /> : null}
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
                {item.mediaType !== 'call' && item.text && item.text !== '[รูปภาพ]' && !item.text.startsWith('[รูปภาพ ') && item.text !== '[ข้อความเสียง]' && item.text !== '[วิดีโอ]' && item.text !== '[GIF]' && item.text.toUpperCase() !== '[GIF]' ? (
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
            <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>
              {statusText}
            </Text>
          ) : null}
        </View>

        {/* Swipe-to-reveal timestamp in right margin */}
        {timeDragAnim ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.dragTimeGutter,
              {
                opacity: timeDragAnim.interpolate({
                  inputRange: [-32, -4, 0],
                  outputRange: [1, 0.15, 0],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateX: timeDragAnim.interpolate({
                      inputRange: [-48, 0],
                      outputRange: [mine ? 0 : -36, 0],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            <Text numberOfLines={1} style={[styles.dragTimeText, { color: colors.inkSoft }]}>
              {format24Time(messageTimestamp(item))}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
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
    if (previous.tick !== next.tick) return false;
  }

  return previousItem?.id === nextItem?.id
    && previousItem?.sender === nextItem?.sender
    && previousItem?.text === nextItem?.text
    && previousItem?.mediaUrl === nextItem?.mediaUrl
    && JSON.stringify(previousItem?.mediaUrls || []) === JSON.stringify(nextItem?.mediaUrls || [])
    && previousItem?.mediaType === nextItem?.mediaType
    && previousItem?.isUploading === nextItem?.isUploading
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
  replyBubble: { borderLeftColor: colors.inkSoft, borderLeftWidth: 2, marginBottom: 5, paddingLeft: 7 },
  replyBubbleMine: { borderLeftColor: 'rgba(255,255,255,0.72)' },
  replyBubbleText: { color: colors.inkSoft, fontSize: 11.5, maxWidth: 220 },
  replyBubbleTextMine: { color: 'rgba(255,255,255,0.76)' },
  replyComposer: { alignItems: 'center', backgroundColor: colors.canvas, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  replyComposerClose: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 15, height: 30, justifyContent: 'center', width: 30 },
  replyComposerCopy: { borderLeftColor: colors.primary, borderLeftWidth: 3, flex: 1, paddingLeft: spacing.sm },
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
  gifCapsuleBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
