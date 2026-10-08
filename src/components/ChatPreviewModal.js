import Text from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import FeatureIcon from './FeatureIcon';
import { IosLikeAvatar } from './iosLike';
import DecryptedChatImage from './DecryptedChatImage';
import VoiceMessageBubble from './VoiceMessageBubble';
import { ChatVideoCover } from './ChatVideoBubble';
import ChatProtectedImageBubble from './ChatProtectedImageBubble';
import { radius, shadow, spacing, type, useTheme } from '../theme';
import { getOrFetchConversationKey, peekCachedConversationKey } from '../services/chatEncryptionService';
import { decryptConversationMessageList } from '../services/firestoreService';
import { requireFirebase } from '../services/dbService';
import { warmChatPreviewMedia } from '../services/chatPreviewMedia';

function toDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  if (typeof timestamp?.toDate === 'function') {
    try {
      const date = timestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  if (typeof timestamp === 'number') {
    const date = new Date(timestamp < 1e11 ? timestamp * 1000 : timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof timestamp?.seconds === 'number') {
    const date = new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1e6);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof timestamp?._seconds === 'number') {
    const date = new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1e6);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
}

function formatMessageTime(message) {
  const date = toDate(message?.createdAt || message?.time);
  if (!date || isNaN(date.getTime())) return '';
  const thaiMillis = date.getTime() + 7 * 60 * 60 * 1000;
  const thaiDate = new Date(thaiMillis);
  const hours = String(thaiDate.getUTCHours()).padStart(2, '0');
  const minutes = String(thaiDate.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

const PreviewMessage = React.memo(function PreviewMessage({ accentColor, colors, conversation, conversationKey, currentUserId, item }) {
  const mine = item?.senderId === currentUserId || item?.sender === 'me';
  const text = typeof item?.text === 'string' && item.text.trim()
    ? item.text
    : 'ไม่สามารถแสดงข้อความนี้ได้';
  const time = formatMessageTime(item);
  const bubbleTextColor = mine ? '#FFFFFF' : colors.ink;
  const replyColor = mine ? 'rgba(255,255,255,0.76)' : colors.inkSoft;
  const imageMediaUrl = item?.mediaUrl || (Array.isArray(item?.mediaUrls) ? item.mediaUrls[0] : null);

  const isImage = Boolean(
    (imageMediaUrl && (item?.mediaType === 'image' || item?.mediaType === 'gif' || !item?.mediaType) && !item?.audioUrl)
    || item?.mediaType === 'image'
    || item?.mediaType === 'gif'
    || item?.text === '[GIF]'
    || item?.text?.toUpperCase() === '[GIF]'
    || (typeof item?.mediaUrl === 'string' && (item.mediaUrl.includes('giphy.com') || item.mediaUrl.includes('.gif')))
  );
  const isAudio = Boolean(
    item?.mediaType === 'audio' || item?.audioUrl || (item?.mediaUrl && item?.mediaType === 'audio')
  );
  const textVal = item?.text?.trim?.() || '';
  const hasCaptionText = Boolean(
    textVal &&
    textVal !== '[รูปภาพ]' &&
    !textVal.startsWith('[รูปภาพ ') &&
    textVal !== '[ข้อความเสียง]' &&
    textVal !== '[วิดีโอ]' &&
    textVal !== '[GIF]' &&
    textVal.toUpperCase() !== '[GIF]'
  );

  const replyDisplayText = item?.replyTo ? (
    item.replyTo.mediaType === 'audio' || item.replyTo.audioUrl || item.replyTo.text === '[ข้อความเสียง]'
      ? '🎤 ข้อความเสียง'
      : item.replyTo.text === '[GIF]' || item.replyTo.text?.toUpperCase() === '[GIF]'
        ? '👾 GIF'
        : item.replyTo.mediaUrl || item.replyTo.mediaType === 'image' || item.replyTo.mediaType === 'gif' || item.replyTo.text === '[รูปภาพ]'
          ? (item.replyTo.text && item.replyTo.text !== '[รูปภาพ]' && item.replyTo.text !== '[GIF]' ? `📷 ${item.replyTo.text}` : '📷 รูปภาพ')
          : item.replyTo.text
  ) : null;

  return (
    <View style={[styles.messageRow, mine && styles.messageRowMine]}>
      {!mine ? (
        <IosLikeAvatar
          cacheScope={conversation.profileId}
          cacheVersion={conversation.participantProfiles?.[conversation.profileId]?.avatarRevision}
          color={conversation.avatarColor}
          emoji={conversation.avatar}
          size={26}
          uri={conversation.avatarUri}
        />
      ) : null}
      <View style={[styles.messageGroup, mine && styles.messageGroupMine]}>
        <View
          style={[
            styles.messageBubble,
            mine && styles.messageBubbleMine,
            !mine && [styles.messageBubbleOther, { backgroundColor: colors.card }],
            mine && { backgroundColor: accentColor },
            isImage && !hasCaptionText && styles.imageOnlyBubble,
          ]}
        >
          {item?.forwarded ? <Text style={[styles.messageMeta, { color: replyColor }]}>ส่งต่อ</Text> : null}
          {replyDisplayText ? (
            <View style={[styles.replyQuote, { borderLeftColor: replyColor }]}>
              <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.replyText, { color: replyColor }]}>
                {replyDisplayText}
              </Text>
            </View>
          ) : null}

          {isImage && (item.viewMode === 'once' || item.viewMode === 'replay') ? (
            <ChatProtectedImageBubble item={item} conversationId={conversation?.id} currentUserId={currentUserId} mine={mine} previewOnly />
          ) : isImage ? (
            <View style={styles.previewImageContainer}>
              <DecryptedChatImage
                conversationId={conversation?.id}
                conversationKey={conversationKey}
                currentUserId={currentUserId}
                isUploading={Boolean(item?.isUploading)}
                mediaUrl={imageMediaUrl}
                resizeMode="cover"
                style={styles.previewImage}
              />
            </View>
          ) : null}

          {item.mediaType === 'video' ? <ChatVideoCover item={item} conversationId={conversation?.id} currentUserId={currentUserId} mine={mine} /> : null}
          {isAudio ? (
            <View style={styles.previewAudioContainer}>
              <VoiceMessageBubble
                audioUrl={item.audioUrl || item.mediaUrl}
                colors={{ primary: accentColor }}
                conversationId={conversation?.id}
                currentUserId={currentUserId}
                duration={item.audioDuration || item.mediaDuration || 0}
                isUploading={Boolean(item?.isUploading)}
                mine={mine}
              />
            </View>
          ) : null}

          {hasCaptionText ? (
            <Text style={[styles.messageText, { color: bubbleTextColor }, isImage && styles.captionText]}>
              {item.text}
            </Text>
          ) : (!isImage && !isAudio && item.mediaType !== 'video' ? (
            <Text style={[styles.messageText, { color: bubbleTextColor }]}>{text}</Text>
          ) : null)}
        </View>
        {time ? <Text style={[styles.messageTime, { color: colors.inkSoft }, mine && styles.messageTimeMine]}>{time}</Text> : null}
      </View>
    </View>
  );
});

export default function ChatPreviewModal({ accentColor, blurTarget, conversation, currentUserId, onClose, onOpenChat, visible }) {
  const { colors, isDark } = useTheme();
  const chatAccent = accentColor || colors.primary;
  const blurIntensity = isDark ? 8 : 10;
  const androidBlurMethod = Platform.OS === 'android' && blurTarget
    ? 'dimezisBlurViewSdk31Plus'
    : undefined;
  const blurReductionFactor = Platform.OS === 'android' ? 1 : undefined;
  const listRef = useRef(null);
  const [presentedConversation, setPresentedConversation] = useState(conversation || null);
  const [isRendered, setIsRendered] = useState(Boolean(visible && conversation));
  const renderedRef = useRef(Boolean(visible && conversation));
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const backdropOpacity = useSharedValue(visible ? 1 : 0);
  const popupScale = useSharedValue(visible ? 1 : 0.86);
  const popupTranslateY = useSharedValue(visible ? 0 : 14);
  const activeConversation = conversation || presentedConversation;

  const [fetchedMessages, setFetchedMessages] = useState(null);
  const [previewKey, setPreviewKey] = useState(null);
  const historyCutoffMs = toDate(activeConversation?.historyClearedAt?.[currentUserId])?.getTime() || 0;
  const previewIdentity = `${currentUserId || ''}:${activeConversation?.id || ''}:${historyCutoffMs}`;
  const conversationKey = previewKey?.identity === previewIdentity ? previewKey.key
    : (currentUserId && activeConversation?.id ? peekCachedConversationKey(activeConversation.id, currentUserId) : null);

  useEffect(() => {
    if (!visible || !activeConversation?.id || !currentUserId) return;
    let active = true;
    void warmChatPreviewMedia(activeConversation, currentUserId).catch(() => {});
    getOrFetchConversationKey(activeConversation.id, currentUserId)
      .then((key) => { if (active) setPreviewKey({ identity: previewIdentity, key }); })
      .catch(() => {});
    return () => { active = false; };
  }, [visible, previewIdentity]);

  useEffect(() => {
    if (conversation) setPresentedConversation(conversation);
  }, [conversation]);

  useEffect(() => {
    if (!visible || !activeConversation?.id) {
      setFetchedMessages(null);
      return;
    }
    if (
      Array.isArray(activeConversation?.messages)
      && activeConversation.messages.length >= 8
    ) {
      return;
    }

    let isSubscribed = true;
    (async () => {
      try {
        const { db } = requireFirebase();
        const messagesRef = collection(db, 'conversations', activeConversation.id, 'messages');
        const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(10));
        const [snapshot, fetchedKey] = await Promise.all([
          getDocs(q),
          currentUserId ? getOrFetchConversationKey(activeConversation.id, currentUserId).catch(() => null) : null,
        ]);
        if (!isSubscribed) return;

        const rawDocs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })).reverse();
        const historyCutoff = activeConversation?.historyClearedAt?.[currentUserId] || null;
        const key = fetchedKey || (currentUserId
          ? peekCachedConversationKey(activeConversation.id, currentUserId)
          : null);
        const apply = (currentKey) => {
          const decryptedList = decryptConversationMessageList(
            activeConversation.id,
            rawDocs,
            currentKey,
            currentUserId,
            historyCutoff
          );
          if (isSubscribed) {
            setFetchedMessages({ identity: previewIdentity, messages: decryptedList });
            void warmChatPreviewMedia({ id: activeConversation.id, messages: decryptedList }, currentUserId).catch(() => {});
          }
        };
        apply(key);
      } catch (err) {
        console.warn('ChatPreviewModal fetch messages fallback warning:', err?.message || err);
      }
    })();

    return () => {
      isSubscribed = false;
    };
  }, [activeConversation?.historyClearedAt, activeConversation?.id, activeConversation?.lastMessageId, activeConversation?.messagesPreviewOnly, currentUserId, visible]);

  const unmountPreview = useCallback(() => {
    if (visibleRef.current) return;
    renderedRef.current = false;
    setIsRendered(false);
    setPresentedConversation(null);
  }, []);

  useEffect(() => {
    cancelAnimation(backdropOpacity);
    cancelAnimation(popupScale);
    cancelAnimation(popupTranslateY);

    if (visible && activeConversation) {
      renderedRef.current = true;
      setIsRendered(true);
      backdropOpacity.set(0);
      popupScale.set(0.86);
      popupTranslateY.set(14);
      backdropOpacity.set(withTiming(1, { duration: 170 }));
      popupScale.set(withSpring(1, { duration: 400, dampingRatio: 0.8 }));
      popupTranslateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      return undefined;
    }

    if (!renderedRef.current) return undefined;

    backdropOpacity.set(withTiming(0, { duration: 140, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    popupScale.set(withTiming(0.86, { duration: 140, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    popupTranslateY.set(withTiming(14, { duration: 140, easing: Easing.bezier(0.23, 1, 0.32, 1) }, (finished) => {
      if (finished) scheduleOnRN(unmountPreview);
    }));

    return undefined;
  }, [activeConversation?.id, backdropOpacity, popupScale, popupTranslateY, unmountPreview, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
  }));

  const popupStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
    transform: [
      { translateY: popupTranslateY.get() },
      { scale: popupScale.get() },
    ],
  }));

  // Keep the preview compact enough to show complete bubbles instead of
  // clipping the oldest bubble at the top when the square card scrolls.
  const messages = useMemo(() => {
    const list = fetchedMessages?.identity === previewIdentity
      ? fetchedMessages.messages
      : (Array.isArray(activeConversation?.messages) ? activeConversation.messages : []);
    return list.slice(-8);
  }, [activeConversation?.messages, fetchedMessages, previewIdentity]);

  useEffect(() => {
    if (!visible || !activeConversation?.id) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: false });
    });
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 60);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [activeConversation?.id, messages.length, visible]);

  const renderPreviewMessage = useCallback(({ item }) => (
    <PreviewMessage
      accentColor={chatAccent}
      colors={colors}
      conversation={activeConversation}
      conversationKey={conversationKey}
      currentUserId={currentUserId}
      item={item}
    />
  ), [activeConversation, chatAccent, colors, conversationKey, currentUserId]);

  const shouldRender = Boolean(activeConversation && (visible || isRendered));
  if (!shouldRender) return null;

  const modalVisible = visible || isRendered;

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={modalVisible}
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, backdropStyle]}
        >
          <BlurView
            blurMethod={androidBlurMethod}
            blurReductionFactor={blurReductionFactor}
            blurTarget={blurTarget}
            intensity={blurIntensity}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            tint="dark"
          />
          <View style={[StyleSheet.absoluteFill, styles.overlayShade]} />
        </Animated.View>
        <Pressable
          accessibilityLabel="แตะด้านนอกเพื่อปิดตัวอย่างแชต"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[styles.popupContainer, popupStyle]}>
          <Pressable accessible={false} onPress={onOpenChat} style={styles.popupCard}>
            <SafeAreaView edges={[]} style={[styles.sheet, { backgroundColor: colors.canvas, borderColor: colors.line }]}>
              {Platform.OS === 'ios' ? <View style={[styles.grabber, { backgroundColor: colors.inkSoft }]} /> : null}
              <FlatList
                contentContainerStyle={[styles.messageList, !messages.length && styles.emptyMessageList]}
                data={messages}
                keyExtractor={(item, index) => String(item?.id || `preview-message-${index}`)}
                ListEmptyComponent={(
                  <View style={styles.emptyState}>
                    <FeatureIcon color={chatAccent} name={activeConversation.encryptionPending ? 'lock.fill' : 'message.fill'} size={28} />
                    <Text style={[styles.emptyTitle, { color: colors.ink }]}>
                      {activeConversation.encryptionPending ? 'กำลังรอคีย์เพื่อแสดงข้อความ' : 'ยังไม่มีข้อความในบทสนทนา'}
                    </Text>
                  </View>
                )}
                initialNumToRender={10}
                ref={listRef}
                renderItem={renderPreviewMessage}
                showsVerticalScrollIndicator={false}
                style={styles.messageListViewport}
                windowSize={5}
              />

            </SafeAreaView>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(0,0,0,0.16)', flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  overlayShade: { backgroundColor: 'rgba(7,9,12,0.10)' },
  popupContainer: { alignSelf: 'center', aspectRatio: 1, maxWidth: 380, width: '100%' },
  popupCard: { flex: 1, width: '100%' },
  sheet: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, flex: 1, minHeight: 0, overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...shadow.card },
  grabber: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.42)', borderRadius: radius.pill, height: 4, marginBottom: spacing.sm, width: 42 },
  messageListViewport: { flex: 1, minHeight: 0, width: '100%' },
  messageList: { paddingBottom: spacing.sm, paddingTop: spacing.xs, width: '100%' },
  emptyMessageList: { flexGrow: 1, justifyContent: 'center', minHeight: 100 },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, marginBottom: 10, width: '100%' },
  messageRowMine: { justifyContent: 'flex-end' },
  messageGroup: { alignItems: 'flex-start', flex: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  messageGroupMine: { alignItems: 'flex-end' },
  messageBubble: { borderRadius: 16, maxWidth: 260, minWidth: 0, paddingHorizontal: 12, paddingVertical: 7 },
  messageBubbleMine: { alignSelf: 'flex-end', borderBottomRightRadius: 4, minWidth: 42 },
  messageBubbleOther: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  imageOnlyBubble: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    elevation: 0,
    overflow: 'hidden',
    paddingHorizontal: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
  },
  previewImageContainer: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    height: 140,
    overflow: 'hidden',
    width: 200,
  },
  previewImage: {
    height: '100%',
    width: '100%',
  },
  previewAudioContainer: {
    maxWidth: 220,
    minWidth: 175,
    paddingVertical: 2,
  },
  captionText: {
    marginTop: 6,
    paddingBottom: 2,
    paddingHorizontal: 4,
  },
  messageMeta: { color: 'rgba(255,255,255,0.68)', fontSize: type.micro, fontWeight: '700', marginBottom: 3 },
  replyQuote: { borderLeftColor: 'rgba(255,255,255,0.65)', borderLeftWidth: 2, marginBottom: 5, paddingLeft: 7 },
  replyText: { color: 'rgba(255,255,255,0.74)', fontSize: 11.5 },
  messageText: { flexShrink: 1, fontSize: 13.5, includeFontPadding: false, lineHeight: 18.5, maxWidth: '100%' },
  messageTime: { fontSize: 10.5, includeFontPadding: false, paddingHorizontal: spacing.xs },
  messageTimeMine: { textAlign: 'right' },
  emptyState: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { color: '#FFFFFF', fontSize: type.body, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
