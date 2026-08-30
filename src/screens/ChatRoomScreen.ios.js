import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Keyboard, Modal, Pressable, Switch, Text as RNText, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Button,
  ContentUnavailableView,
  ContextMenu,
  Host,
  HStack,
  Image,
  ScrollView,
  Spacer,
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
  font,
  foregroundStyle,
  frame,
  id,
  labelStyle,
  lineLimit,
  multilineTextAlignment,
  onLongPressGesture,
  onSubmit,
  padding,
  resizable,
  scrollDismissesKeyboard,
  scrollIndicators,
  scrollPosition,
  scrollTargetLayout,
  shadow,
  shapes,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { useApp } from '../context/AppContext';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate } from '../utils/formatters';
import InstagramMessageOverlay from '../components/InstagramMessageOverlay';

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

function formatStatusTime(item, mine, isLatest, otherReadAt) {
  const sentDate = messageDate(item);
  if (!sentDate) return '';
  const sentTime = sentDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!isLatest || !mine) return sentTime;

  const readDate = toDate(otherReadAt);
  const isReadByOther = Boolean(
    readDate && sentDate && readDate.getTime() >= sentDate.getTime()
  );
  return isReadByOther ? `อ่านแล้ว · ${sentTime}` : `ส่งแล้ว · ${sentTime}`;
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
  const { chatId } = useLocalSearchParams();
  const {
    availableProfiles,
    conversations,
    deleteMessageForMeInChat,
    getMeetupStats,
    markAsRead,
    profile,
    reactToMessageInChat,
    sendMessage,
    toggleMeetupAcceptanceInChat,
    unsendMessageInChat,
    updateChatSettingsInChat,
  } = useApp();
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const currentUserId = profile?.id;
  const normalizedChatId = Array.isArray(chatId) ? chatId[0] : chatId;
  const chat = useMemo(
    () => conversations.find((conversation) => conversation.id === normalizedChatId) || null,
    [conversations, normalizedChatId]
  );
  const markedReadRef = useRef(null);

  const activeUnreadCount = chat?.unreadCounts?.[currentUserId] || 0;

  const myChatSettings = chat?.participantSettings?.[currentUserId] || {};
  const showPinnedMeetup = myChatSettings.showPinnedMeetup !== false;
  const isMuted = Boolean(myChatSettings.isMuted);

  const [actionMessage, setActionMessage] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

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

  const handleForward = useCallback(async (item, targetConversationId) => {
    setActionMessage(null);
    if (!item?.text || !targetConversationId) return;
    try {
      await sendMessage(targetConversationId, item.text, {
        forwarded: true,
        forwardedFrom: { conversationId: chat?.id, messageId: item.id },
      });
      Alert.alert('ส่งต่อแล้ว', 'ส่งข้อความไปยังห้องสนทนาที่เลือกเรียบร้อย');
    } catch (error) {
      Alert.alert('ส่งต่อไม่สำเร็จ', 'กรุณาลองใหม่อีกครั้ง');
    }
  }, [chat?.id, sendMessage]);

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
  const scrollTarget = useNativeState(null);
  const textFieldRef = useRef(null);
  const sendingRef = useRef(false);
  const partnerAvatar = chat?.avatarUri || chat?.avatar;
  const resolvedPartnerAvatar = useRemoteImage(partnerAvatar);
  const otherUserId = chat?.profileId || chat?.participants?.find((participantId) => participantId !== currentUserId);
  const otherReadAt = chat?.readReceipts?.[otherUserId] || null;
  const isReadByOther = (chat?.unreadCounts?.[otherUserId] || 0) === 0;
  const latestMessageId = chat?.messages?.[chat?.messages.length - 1]?.id || null;

  const [partnerProfileDirect, setPartnerProfileDirect] = React.useState(null);
  const [isBannerExpanded, setIsBannerExpanded] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [tick, setTick] = React.useState(0);

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
          setPartnerProfileDirect({ id: snap.id, ...snap.data() });
        }
      });
      return () => unsub();
    } catch (e) {
      console.warn('Realtime partner profile lookup failed:', e);
    }
  }, [otherUserId]);

  const partnerProfile = useMemo(
    () => (
      partnerProfileDirect
      || chat?.participantProfiles?.[otherUserId]
      || availableProfiles.find((p) => p.id === otherUserId)
      || null
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
    try {
      await toggleMeetupAcceptanceInChat(chat.id, targetHostId, partnerMeetup.name);
    } catch (e) {
      console.error('toggle meetup acceptance error:', e);
    }
  };

  const scrollToLatest = () => {
    if (latestMessageId) scrollTarget.set(latestMessageId);
  };

  useEffect(() => {
    const timer = setTimeout(scrollToLatest, 40);
    return () => clearTimeout(timer);
  }, [latestMessageId]);

  useEffect(() => {
    messageState.set('');
    setReplyingTo(null);
    textFieldRef.current?.clear();
  }, [chat?.id]);

  const handleSend = async () => {
    const trimmed = (messageState.get() || '').trim();
    if (!trimmed || sendingRef.current || !chat?.id) return;
    sendingRef.current = true;
    messageState.set('');
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    try {
      await textFieldRef.current?.clear();
      await sendMessage(chat.id, trimmed, replySnapshot ? {
        replyTo: {
          id: replySnapshot.id,
          senderId: replySnapshot.senderId || '',
          text: replySnapshot.text,
        },
      } : {});
    } catch (error) {
      messageState.set(trimmed);
      setReplyingTo(replySnapshot);
      await textFieldRef.current?.setText(trimmed);
    } finally {
      sendingRef.current = false;
    }
  };

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
    <Pressable onPress={Keyboard.dismiss} style={{ flex: 1, backgroundColor: palette.background }}>
      <TopBlur colorScheme={colorScheme} height={topHostHeight + 8} />
      
      {/* Pinned Top Header + Meetup Banner */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: topHostHeight, zIndex: 20 }}>
        <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ width: '100%', height: topHostHeight }}>
          <VStack spacing={6} modifiers={[padding({ top: safeTop + 4, bottom: 4, horizontal: 12 }), frame({ maxWidth: Infinity })]}>
            {/* Header row */}
            <HStack alignment="center" spacing={12} modifiers={[padding({ horizontal: 2 }), frame({ maxWidth: Infinity })]}>
              <Button label="ย้อนกลับ" onPress={onBack} systemImage="chevron.left" modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly')]} />
              <ProfileAvatar avatarColor={chat.avatarColor} emoji={chat.avatar} size={42} uri={resolvedPartnerAvatar} />
              <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>{chat.name}</Text>
                <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(1)]}>{chat.subtitle || 'เพื่อนใน CampusMate'}</Text>
              </VStack>
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
          <ScrollView
            modifiers={[
              scrollIndicators('never', 'vertical'),
              scrollDismissesKeyboard('interactively'),
              scrollPosition(scrollTarget, { anchor: 'bottom' }),
            ]}
            showsIndicators={false}
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
                scrollTargetLayout(),
              ]}
            >
              {(chat.messages || []).length ? chat.messages.map((item, index) => (
                <VStack key={item.id} spacing={8} modifiers={[id(item.id), frame({ maxWidth: Infinity })]}>
                  {index === 0 || !isSameDay(chat.messages[index - 1], item) ? <DayDivider label={formatDay(item)} /> : null}
                  <MessageBubble
                    avatarColor={chat.avatarColor}
                    avatarEmoji={chat.avatar}
                    avatarUri={resolvedPartnerAvatar}
                    isLatest={index === chat.messages.length - 1}
                    item={item}
                    onSelectMessage={handleSelectMessage}
                    readAt={otherReadAt}
                    tick={index === chat.messages.length - 1 ? tick : 0}
                  />
                </VStack>
              )) : (
                <ContentUnavailableView description="ส่งข้อความแรกเพื่อเริ่มทำความรู้จักกัน" systemImage="hand.wave.fill" title="เริ่มทักทายได้เลย" />
              )}
            </VStack>
          </ScrollView>

          {replyingTo ? (
            <HStack spacing={10} modifiers={[padding({ top: 8, horizontal: 18 }), frame({ maxWidth: Infinity }), background(palette.background)]}>
              <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 9 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.accent)]}>ตอบกลับข้อความ</Text>
                <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.secondary), lineLimit(1)]}>{replyingTo.text}</Text>
              </VStack>
              <Button label="ยกเลิกการตอบกลับ" onPress={() => setReplyingTo(null)} systemImage="xmark" modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('small'), labelStyle('iconOnly')]} />
            </HStack>
          ) : null}

          <HStack spacing={10} modifiers={[padding({ top: 10, bottom: 18, horizontal: 14 }), frame({ maxWidth: Infinity }), background(palette.background)]}>
            <HStack spacing={8} modifiers={[padding({ horizontal: 15, vertical: 8 }), frame({ maxWidth: Infinity, minHeight: 48 }), background(palette.surface, shapes.roundedRectangle({ cornerRadius: 22, roundedCornerStyle: 'continuous' }))]}>
              <TextField
                axis="vertical"
                maxLength={1000}
                onFocusChange={(focused) => focused && setTimeout(scrollToLatest, 40)}
                placeholder="พิมพ์ข้อความ..."
                ref={textFieldRef}
                text={messageState}
                modifiers={[textFieldStyle('plain'), lineLimit(4), frame({ maxWidth: Infinity }), onSubmit(handleSend)]}
              />
            </HStack>
            <Button
              label="ส่งข้อความ"
              onPress={handleSend}
              systemImage="arrow.up"
              modifiers={[buttonStyle('glassProminent'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly'), tint(palette.accent)]}
            />
          </HStack>
        </VStack>
      </Host>

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
        onToggleMute={handleToggleMute}
        onTogglePinnedMeetup={handleTogglePinnedMeetup}
        palette={palette}
        partnerMeetup={partnerMeetup}
        showPinnedMeetup={showPinnedMeetup}
      />

      <InstagramMessageOverlay
        conversations={conversations}
        currentConversationId={chat.id}
        isOpen={Boolean(actionMessage)}
        item={actionMessage}
        onClose={() => setActionMessage(null)}
        onDelete={handleDeleteForMe}
        onForward={handleForward}
        onReact={handleReact}
        onReply={handleReply}
        onUnsend={handleUnsend}
        palette={palette}
      />
    </Pressable>
  );
}

function ChatSettingsModal({
  chat,
  colorScheme,
  isMuted,
  isOpen,
  onClose,
  onNavigateMeetup,
  onNavigateProfile,
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
              <RNText style={{ fontSize: 14, fontWeight: '700', color: palette.secondary }}>✕</RNText>
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

          {/* Done Button */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              backgroundColor: palette.accent,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              marginTop: partnerMeetup ? 0 : 6,
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

const MessageBubble = React.memo(function MessageBubble({ avatarColor, avatarEmoji, avatarUri, isLatest, item, onSelectMessage, readAt }) {
  const palette = usePalette();
  const mine = item.sender === 'me';
  const statusText = formatStatusTime(item, mine, isLatest, readAt);
  const reactions = item.reactions || {};
  const reactionValues = Object.values(reactions);
  const uniqueEmojis = Array.from(new Set(reactionValues));
  const reactionString = uniqueEmojis.join('') + (reactionValues.length > 1 ? ` ${reactionValues.length}` : '');

  return (
    <HStack alignment="bottom" spacing={7} modifiers={[frame({ maxWidth: Infinity, alignment: mine ? 'trailing' : 'leading' })]}>
      {mine ? <Spacer /> : null}
      {!mine ? <ResolvedProfileAvatar avatarColor={avatarColor} emoji={avatarEmoji} size={28} uri={avatarUri} /> : null}
      <VStack alignment={mine ? 'trailing' : 'leading'} spacing={3} modifiers={[frame({ maxWidth: 260, alignment: mine ? 'trailing' : 'leading' })]}>
        {item.forwarded ? (
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>ส่งต่อ</Text>
        ) : null}
        {item.replyTo ? (
          <Text modifiers={[padding({ horizontal: 9, vertical: 5 }), background(palette.raised, shapes.roundedRectangle({ cornerRadius: 9 })), font({ textStyle: 'caption2' }), foregroundStyle(palette.secondary), lineLimit(1)]}>
            {item.replyTo.text}
          </Text>
        ) : null}
        <Text
          modifiers={[
            onLongPressGesture(() => onSelectMessage?.(item), 0.35),
            padding({ horizontal: 12, vertical: 7 }),
            background(mine ? '#EA4335' : palette.incoming, messageShape),
            font({ textStyle: 'subheadline', weight: 'regular' }),
            multilineTextAlignment('leading'),
            foregroundStyle(mine ? palette.white : palette.text),
          ]}
        >
          {item.text}
        </Text>
        {reactionString ? (
          <HStack alignment="center" spacing={2} modifiers={[padding({ horizontal: 7, vertical: 2 }), background(palette.raised, shapes.capsule()), shadow({ radius: 2, y: 1 })]}>
            <Text modifiers={[font({ size: 11.5 })]}>{reactionString}</Text>
          </HStack>
        ) : null}
        {statusText ? (
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'regular' }), foregroundStyle(palette.tertiary)]}>
            {statusText}
          </Text>
        ) : null}
      </VStack>
    </HStack>
  );
}, (previous, next) => (
  previous.avatarColor === next.avatarColor
  && previous.avatarEmoji === next.avatarEmoji
  && previous.avatarUri === next.avatarUri
  && previous.isLatest === next.isLatest
  && previous.item.id === next.item.id
  && previous.item.sender === next.item.sender
  && previous.item.text === next.item.text
  && previous.item.forwarded === next.item.forwarded
  && previous.tick === next.tick
  && JSON.stringify(previous.item.reactions || {}) === JSON.stringify(next.item.reactions || {})
  && JSON.stringify(previous.item.replyTo || null) === JSON.stringify(next.item.replyTo || null)
  && toDate(previous.readAt)?.getTime() === toDate(next.readAt)?.getTime()
  && messageDate(previous.item)?.getTime() === messageDate(next.item)?.getTime()
));

function DayDivider({ label }) {
  const palette = usePalette();
  return (
    <Text modifiers={[padding({ horizontal: 11, vertical: 6 }), background(palette.raised, shapes.capsule()), font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
      {label}
    </Text>
  );
}

function ProfileAvatar({ avatarColor, emoji, size, uri }) {
  const isUrl = typeof uri === 'string' && (uri.startsWith('http') || uri.startsWith('file://') || uri.startsWith('data:'));
  const remoteUri = useRemoteImage(isUrl ? uri : null);
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

function ChatMeetupBanner({ isAcceptedByMe, isExpanded, meetup, onToggleAccept, onToggleExpand, palette, stats }) {
  if (!meetup) return null;
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
            label={isAcceptedByMe ? 'ตอบรับแล้ว' : (stats?.isFull ? 'เต็ม' : 'ยอมรับ')}
            onPress={onToggleAccept}
            disabled={!isAcceptedByMe && stats?.isFull}
            systemImage={isAcceptedByMe ? 'checkmark.circle.fill' : (stats?.isFull ? 'xmark.circle' : 'person.badge.plus')}
            modifiers={[
              buttonStyle(isAcceptedByMe ? 'glass' : 'glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(isAcceptedByMe ? '#34C759' : (stats?.isFull ? palette.secondary : palette.accent)),
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
          </VStack>

          <Button
            label={isAcceptedByMe ? 'ยอมรับนัดหมายแล้ว (แตะเพื่อยกเลิก)' : (stats?.isFull ? 'นัดหมายเต็มจำนวนแล้ว' : 'ยอมรับนัดหมาย')}
            onPress={onToggleAccept}
            disabled={!isAcceptedByMe && stats?.isFull}
            systemImage={isAcceptedByMe ? 'checkmark.circle.fill' : (stats?.isFull ? 'xmark.circle' : 'person.badge.plus')}
            modifiers={[
              buttonStyle(isAcceptedByMe ? 'glass' : 'glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('small'),
              tint(isAcceptedByMe ? '#34C759' : (stats?.isFull ? palette.secondary : palette.accent)),
              frame({ maxWidth: Infinity }),
            ]}
          />
        </VStack>
      )}
    </VStack>
  );
}
