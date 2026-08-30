import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { doc, onSnapshot } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { useApp } from '../context/AppContext';
import { useRemoteImage } from '../utils/useRemoteImage';
import { radius, spacing, type, useTheme } from '../theme';
import { formatReadableDate } from '../utils/formatters';
import InstagramMessageOverlay from '../components/InstagramMessageOverlay';

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
  const sentDate = toDate(messageTimestamp(item));
  if (!sentDate) return '';
  const sentTime = sentDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!isLatest || !mine) return sentTime;

  const readDate = toDate(otherReadAt);
  const isReadByOther = Boolean(
    readDate && sentDate && readDate.getTime() >= sentDate.getTime()
  );
  return isReadByOther ? `อ่านแล้ว · ${sentTime}` : `ส่งแล้ว · ${sentTime}`;
}

export default function ChatRoomScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
    setTimeout(() => inputRef.current?.focus(), 160);
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

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const otherUserId = chat?.profileId || chat?.participants?.find((participantId) => participantId !== currentUserId);
  const otherReadAt = chat?.readReceipts?.[otherUserId] || null;
  const isReadByOther = (chat?.unreadCounts?.[otherUserId] || 0) === 0;
  const latestMessageId = chat?.messages?.[chat?.messages.length - 1]?.id || null;

  const [partnerProfileDirect, setPartnerProfileDirect] = useState(null);
  const [isBannerExpanded, setIsBannerExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [, setTick] = useState(0);

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

  const scrollToLatest = useCallback((animated = false) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    setInputText('');
    setReplyingTo(null);
    setSending(false);
    scrollToLatest(false);
  }, [chat?.id, scrollToLatest]);

  useEffect(() => {
    if (!latestMessageId) return;
    scrollToLatest(true);
  }, [latestMessageId, scrollToLatest]);

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || sending || !chat?.id) return;

    setSending(true);
    setInputText('');
    const replySnapshot = replyingTo;
    setReplyingTo(null);
    try {
      await sendMessage(chat.id, trimmed, replySnapshot ? {
        replyTo: {
          id: replySnapshot.id,
          senderId: replySnapshot.senderId || '',
          text: replySnapshot.text,
        },
      } : {});
      scrollToLatest(true);
    } catch (error) {
      setInputText(trimmed);
      setReplyingTo(replySnapshot);
    } finally {
      setSending(false);
    }
  };

  if (!chat) {
    return (
      <SafeAreaView style={styles.roomContainer}>
        <View style={styles.roomHeader}>
          <Pressable accessibilityLabel="ย้อนกลับ" onPress={onBack} style={styles.backButton}>
            <SymbolView name="chevron.left" size={23} tintColor={colors.ink} />
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.roomHeader}>
          <Pressable accessibilityLabel="ย้อนกลับ" onPress={onBack} style={styles.backButton}>
            <SymbolView name="chevron.left" size={23} tintColor={colors.ink} />
          </Pressable>
          <Avatar avatarColor={chat.avatarColor} colors={colors} emoji={chat.avatar} size={44} uri={chat.avatarUri} />
          <View style={styles.roomIdentity}>
            <Text numberOfLines={1} style={styles.roomName}>{chat.name}</Text>
            <Text numberOfLines={1} style={styles.roomSubtitle}>{chat.subtitle || 'เพื่อนใน CampusMate'}</Text>
          </View>
          <Pressable
            accessibilityLabel="ตั้งค่าแชต"
            accessibilityRole="button"
            onPress={() => setIsSettingsOpen(true)}
            style={({ pressed }) => [styles.headerMoreBtn, pressed && styles.pressed]}
          >
            <SymbolView name="ellipsis" size={18} tintColor={colors.ink} />
          </Pressable>
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
                    <SymbolView name="mappin.and.ellipse" size={14} tintColor={colors.primary} />
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
                    disabled={!isAcceptedByMe && meetupStats?.isFull}
                    onPress={handleToggleAcceptMeetup}
                    style={({ pressed }) => [
                      styles.chatMeetupMiniBtn,
                      isAcceptedByMe && styles.chatMeetupMiniBtnAccepted,
                      !isAcceptedByMe && meetupStats?.isFull && styles.chatMeetupMiniBtnDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <SymbolView
                      name={isAcceptedByMe ? 'checkmark.circle.fill' : (meetupStats?.isFull ? 'xmark.circle' : 'person.badge.plus')}
                      size={12}
                      tintColor="#FFFFFF"
                    />
                    <Text style={styles.chatMeetupMiniBtnText}>
                      {isAcceptedByMe ? 'ตอบรับแล้ว' : (meetupStats?.isFull ? 'เต็ม' : 'ยอมรับ')}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setIsBannerExpanded((curr) => !curr)}
                    style={styles.expandToggleBtn}
                  >
                    <SymbolView
                      name={isBannerExpanded ? 'chevron.up' : 'chevron.down'}
                      size={13}
                      tintColor={colors.inkSoft}
                    />
                  </Pressable>
                </View>
              </View>

              {isBannerExpanded ? (
                <View style={styles.chatMeetupExpandedBody}>
                  <View style={styles.chatMeetupMeta}>
                    {partnerMeetup.schedule?.date ? (
                      <View style={styles.chatMeetupInfoRow}>
                        <SymbolView name="calendar" size={13} tintColor={colors.inkSoft} />
                        <Text style={styles.chatMeetupTime}>
                          วันที่: {formatReadableDate(partnerMeetup.schedule.date)}
                        </Text>
                      </View>
                    ) : null}

                    {partnerMeetup.schedule?.startTime && partnerMeetup.schedule?.endTime ? (
                      <View style={styles.chatMeetupInfoRow}>
                        <SymbolView name="clock" size={13} tintColor={colors.inkSoft} />
                        <Text style={styles.chatMeetupTime}>
                          เวลา: {partnerMeetup.schedule.startTime} – {partnerMeetup.schedule.endTime} น.
                        </Text>
                      </View>
                    ) : null}

                    {meetupStats ? (
                      <View style={styles.chatMeetupInfoRow}>
                        <SymbolView name="person.2.fill" size={13} tintColor={colors.inkSoft} />
                        <Text style={styles.chatMeetupCount}>
                          ผู้เข้าร่วม: {meetupStats.acceptedCount}/{meetupStats.maxPeople} คน
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Pressable
                    disabled={!isAcceptedByMe && meetupStats?.isFull}
                    onPress={handleToggleAcceptMeetup}
                    style={({ pressed }) => [
                      styles.chatMeetupBtn,
                      isAcceptedByMe && styles.chatMeetupBtnAccepted,
                      !isAcceptedByMe && meetupStats?.isFull && styles.chatMeetupBtnDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <SymbolView
                        name={isAcceptedByMe ? 'checkmark.circle.fill' : (meetupStats?.isFull ? 'xmark.circle' : 'person.badge.plus')}
                        size={16}
                        tintColor="#FFFFFF"
                      />
                      <Text style={[styles.chatMeetupBtnText, isAcceptedByMe && styles.chatMeetupBtnTextAccepted]}>
                        {isAcceptedByMe ? 'ยอมรับนัดหมายแล้ว (แตะเพื่อยกเลิก)' : (meetupStats?.isFull ? 'นัดหมายเต็มจำนวนแล้ว' : 'ยอมรับนัดหมาย')}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <FlatList
          contentContainerStyle={styles.messageList}
          data={chat.messages || []}
          keyExtractor={(item) => item.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onTouchStart={Keyboard.dismiss}
          ListEmptyComponent={(
            <View style={styles.emptyRoom}>
              <SymbolView name="hand.wave.fill" size={38} tintColor={colors.primary} />
              <Text style={styles.emptyTitle}>เริ่มทักทายได้เลย</Text>
              <Text style={styles.emptyText}>ส่งข้อความแรกเพื่อเริ่มทำความรู้จักกัน</Text>
            </View>
          )}
          ref={listRef}
          renderItem={({ item, index }) => (
            <ChatMessageItem
              chat={chat}
              colors={colors}
              index={index}
              item={item}
              onSelectMessage={handleSelectMessage}
              otherReadAt={otherReadAt}
              showDay={index === 0 || new Date(toDate(messageTimestamp(chat.messages[index - 1]))).toDateString() !== new Date(toDate(messageTimestamp(item))).toDateString()}
              styles={styles}
            />
          )}
          showsVerticalScrollIndicator={false}
        />

        {replyingTo ? (
          <View style={styles.replyComposer}>
            <View style={styles.replyComposerCopy}>
              <Text style={styles.replyComposerTitle}>ตอบกลับข้อความ</Text>
              <Text numberOfLines={1} style={styles.replyComposerText}>{replyingTo.text}</Text>
            </View>
            <Pressable accessibilityLabel="ยกเลิกการตอบกลับ" onPress={() => setReplyingTo(null)} style={styles.replyComposerClose}>
              <SymbolView name="xmark" size={12} tintColor={colors.inkSoft} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            maxLength={1000}
            multiline
            onChangeText={setInputText}
            onFocus={() => scrollToLatest(false)}
            placeholder="พิมพ์ข้อความ..."
            placeholderTextColor={colors.inkSoft}
            ref={inputRef}
            style={styles.textInput}
            value={inputText}
          />
          <Pressable disabled={!inputText.trim() || sending} onPress={handleSend} style={({ pressed }) => [styles.sendButton, (!inputText.trim() || sending) && styles.sendDisabled, pressed && styles.pressed]}>
            <SymbolView name="arrow.up" size={20} tintColor="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ChatSettingsModal
        chat={chat}
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
        onToggleMute={handleToggleMute}
        onTogglePinnedMeetup={handleTogglePinnedMeetup}
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
        palette={{ accent: colors.primary }}
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
  onToggleMute,
  onTogglePinnedMeetup,
  partnerMeetup,
  showPinnedMeetup,
}) {
  return (
    <Modal animationType="fade" transparent visible={isOpen} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.card,
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
            <View style={{ width: 44, height: 5, borderRadius: 2.5, backgroundColor: colors.line }} />
          </View>

          {/* Title Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>
                ตั้งค่าห้องสนทนา
              </Text>
              <Text style={{ fontSize: 12, color: colors.inkMuted, marginTop: 2 }}>
                บันทึกการตั้งค่าเฉพาะบัญชีนี้ในฐานข้อมูล
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.primarySoft,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.inkMuted }}>✕</Text>
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

          {/* Setting 2: View Profile Shortcut */}
          <Pressable
            onPress={onNavigateProfile}
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

          {/* Done Button */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              marginTop: partnerMeetup ? 0 : 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
              เสร็จสิ้น
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChatMessageItem({
  chat,
  colors,
  index,
  item,
  onSelectMessage,
  otherReadAt,
  showDay,
  styles,
}) {
  const bubbleRef = useRef(null);
  const mine = item.sender === 'me';
  const statusText = formatStatusTime(item, mine, index === chat.messages.length - 1, otherReadAt);
  const reactions = item.reactions || {};
  const reactionValues = Object.values(reactions);
  const uniqueEmojis = Array.from(new Set(reactionValues));
  const reactionString = uniqueEmojis.join('') + (reactionValues.length > 1 ? ` ${reactionValues.length}` : '');

  const handlePress = () => {
    if (bubbleRef.current?.measureInWindow) {
      bubbleRef.current.measureInWindow((x, y, width, height) => {
        onSelectMessage({
          ...item,
          layout: { x, y, width, height },
        });
      });
    } else {
      onSelectMessage(item);
    }
  };

  return (
    <View>
      {showDay ? (
        <Text style={styles.dayDivider}>
          {toDate(messageTimestamp(item))?.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>
      ) : null}
      <View style={[styles.messageRow, mine && styles.messageRowMine]}>
        {!mine ? (
          <Avatar avatarColor={chat.avatarColor} colors={colors} emoji={chat.avatar} size={28} uri={chat.avatarUri} />
        ) : null}
        <View style={[styles.messageGroup, mine && styles.messageGroupMine]}>
          <Pressable
            ref={bubbleRef}
            delayLongPress={220}
            onLongPress={handlePress}
            style={({ pressed }) => [
              styles.bubble,
              mine ? styles.myBubble : styles.theirBubble,
              pressed && styles.pressed,
            ]}
          >
            {item.forwarded ? <Text style={[styles.forwardedBubbleLabel, mine && styles.forwardedBubbleLabelMine]}>ส่งต่อ</Text> : null}
            {item.replyTo ? (
              <View style={[styles.replyBubble, mine && styles.replyBubbleMine]}>
                <Text numberOfLines={1} style={[styles.replyBubbleText, mine && styles.replyBubbleTextMine]}>{item.replyTo.text}</Text>
              </View>
            ) : null}
            <Text style={[styles.bubbleText, mine && styles.myBubbleText]}>{item.text}</Text>
          </Pressable>
          {reactionString ? (
            <View style={[styles.reactionBadge, mine ? styles.reactionBadgeMine : styles.reactionBadgeTheir]}>
              <Text style={styles.reactionBadgeText}>{reactionString}</Text>
            </View>
          ) : null}
          {statusText ? (
            <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>
              {statusText}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Avatar({ avatarColor, colors, emoji, size, uri }) {
  const isUrl = typeof uri === 'string' && (uri.startsWith('http') || uri.startsWith('file://') || uri.startsWith('data:'));
  const remoteUri = useRemoteImage(isUrl ? uri : null);
  const resolvedEmoji = emoji || (!isUrl && typeof uri === 'string' && uri.length <= 6 ? uri : null);
  return <ResolvedAvatar avatarColor={avatarColor} colors={colors} emoji={resolvedEmoji} size={size} uri={remoteUri} />;
}

function ResolvedAvatar({ avatarColor, colors, emoji, size, uri }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        }}
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
        <SymbolView name="person.fill" size={size * 0.48} tintColor={colors.inkSoft} />
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
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
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  bubbleText: {
    color: colors.ink,
    fontSize: 13.5,
    lineHeight: 18.5,
  },
  composer: { alignItems: 'flex-end', backgroundColor: colors.canvas, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  dayDivider: { ...type.caption2, color: colors.inkSoft, marginVertical: spacing.md, textAlign: 'center' },
  emptyRoom: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: spacing.xxxl },
  emptyText: { ...type.bodySmall, color: colors.inkSoft, textAlign: 'center' },
  emptyTitle: { ...type.headline, color: colors.ink, marginBottom: spacing.xs, marginTop: spacing.md },
  messageGroup: { flexShrink: 1, gap: 2 },
  messageGroupMine: { alignItems: 'flex-end' },
  messageList: { paddingBottom: spacing.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, marginBottom: 10 },
  messageRowMine: { justifyContent: 'flex-end' },
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
  roomContainer: { backgroundColor: colors.canvas, flex: 1 },
  roomHeader: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  roomIdentity: { flex: 1 },
  roomName: { ...type.headline, color: colors.ink },
  roomSubtitle: { ...type.caption, color: colors.inkSoft },
  sendButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  sendDisabled: { opacity: 0.4 },
  textInput: { ...type.body, backgroundColor: colors.card, borderColor: colors.line, borderRadius: 20, borderWidth: 1, color: colors.ink, flex: 1, maxHeight: 100, minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: 8 },
  reactionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  reactionBadgeMine: {
    alignSelf: 'flex-end',
  },
  reactionBadgeTheir: {
    alignSelf: 'flex-start',
  },
  reactionBadgeText: {
    fontSize: 11.5,
    color: colors.ink,
  },
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
});
