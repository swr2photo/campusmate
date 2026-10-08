import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import RNText from '../components/AppText';
import { compareConversationsByActivity } from '../utils/conversationOrder';
import { chatPreviewText } from '../utils/chatPreviewText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { Host, HStack, Image, Spacer, TextField, useNativeState, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, buttonBorderShape, buttonStyle, controlSize, foregroundStyle, frame, labelStyle, padding, shapes, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { openChatRoom } from '../utils/openChatRoom';
import { SymbolView } from 'expo-symbols';
import { useAppActions, useAppConversations, useAppProfile } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import ChatPreviewModal from '../components/ChatPreviewModal';
import { warmChatPreviewMedia } from '../services/chatPreviewMedia';
import { GroupChatRow, GroupChatInboxStatus } from '../components/GroupChatListSection';
import useGroupChatInbox from '../hooks/useGroupChatInbox';
import { IosLikeAvatar } from '../components/iosLike';
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { project, rubberband } from '../utils/motion';

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

const DELETE_CONFIRM_DELAY_MS = 280;
const SWIPE_DELETE_WIDTH = 88;

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

function formatRelativeLabel(date) {
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) return 'สักครู่';
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  if (diffHour < 24) return `${diffHour} ชม. ที่แล้ว`;
  if (diffDay === 1) return 'เมื่อวานนี้';
  if (diffDay < 7) return `${diffDay} วันที่แล้ว`;
  if (diffDay < 30) return `${Math.ceil(diffDay / 7)} สัปดาห์ที่แล้ว`;
  if (diffMonth < 12) return `${diffMonth || 1} เดือนที่แล้ว`;
  return `${diffYear} ปีที่แล้ว`;
}

function formatConversationTime(conversation, currentUserId, unreadCount = 0) {
  const messages = conversation.messages || [];
  const lastMsg = messages[messages.length - 1];
  const iSentLast = conversation.lastMessageSenderId === currentUserId
    || (lastMsg && (lastMsg.senderId === currentUserId || lastMsg.sender === 'me'));

  // If there are multiple unread messages from the other person
  if (unreadCount > 1) {
    const date = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    const timeText = label === 'สักครู่' ? 'เมื่อสักครู่' : label;
    return `${unreadCount} ข้อความใหม่ · ${timeText || 'เมื่อสักครู่'}`;
  }

  // If there is exactly 1 unread message from the other person
  if (unreadCount === 1 && !iSentLast) {
    const date = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    const timeText = label === 'สักครู่' ? 'เมื่อสักครู่' : (label.startsWith('เมื่อ') ? label : `เมื่อ ${label}`);
    const textSnippet = chatPreviewText(lastMsg, conversation.lastMessage);
    return textSnippet ? `${textSnippet} · ${timeText}` : timeText;
  }

  // If the other person sent the last message (and already read)
  if (!iSentLast) {
    const date = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    if (label === 'สักครู่') return 'เมื่อสักครู่';
    return label ? `เมื่อ ${label}` : '';
  }

  // Current user sent the last message
  if (lastMsg?.sendStatus === 'failed') return 'ส่งไม่สำเร็จ';
  if (lastMsg?.pendingSync) return 'รอส่ง';
  const otherUserId = (conversation.participants || []).find((id) => id !== currentUserId);
  const otherUnread = otherUserId ? (conversation.unreadCounts?.[otherUserId] || 0) : 0;

  if (otherUnread === 0 && otherUserId) {
    // Other person has read it — show read time from readReceipts or updatedAt
    const readTimestamp = conversation.readReceipts?.[otherUserId] || conversation.updatedAt;
    const readDate = toDate(readTimestamp);
    const label = formatRelativeLabel(readDate);
    if (label === 'สักครู่') return 'อ่านแล้วเมื่อสักครู่';
    return label ? `อ่านแล้วเมื่อ ${label}` : 'อ่านแล้ว';
  }

  // Sent but not read yet
  const sentDate = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
  const label = formatRelativeLabel(sentDate);
  if (label === 'สักครู่') return 'ส่งเมื่อสักครู่';
  return label ? `ส่งเมื่อ ${label}` : 'ส่งแล้ว';
}

export default function ChatScreen() {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { conversations } = useAppConversations();
  const { profile } = useAppProfile();
  const { removeConversation } = useAppActions();
  const { confirm } = useConfirm();
  const params = useLocalSearchParams();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [previewConversationId, setPreviewConversationId] = useState(null);
  const searchState = useNativeState('');
  const searchInputRef = useRef(null);
  const deletePromptTimerRef = useRef(null);

  useEffect(() => () => {
    if (deletePromptTimerRef.current) {
      clearTimeout(deletePromptTimerRef.current);
    }
  }, []);
  
  useEffect(() => {
    if (params?.chatId) {
      openChatRoom(params.chatId, { pathname });
    }
  }, [params?.chatId, pathname]);

  const currentUserId = profile?.id;
  const groupInbox = useGroupChatInbox(currentUserId, query, unreadOnly);
  const previewConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === previewConversationId) || null,
    [conversations, previewConversationId]
  );
  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (unreadOnly && !((conversation.unreadCounts?.[currentUserId] || conversation.unread || 0) > 0)) return false;
      if (!normalized) return true;
      return `${conversation.name || ''} ${conversation.lastMessage || ''}`.toLowerCase().includes(normalized);
    }).sort(compareConversationsByActivity);
  }, [conversations, currentUserId, query, unreadOnly]);

  const handleDeleteConversation = useCallback((conversation) => {
    if (!conversation?.id) return;

    const otherUserId = conversation.profileId
      || conversation.participants?.find((participantId) => participantId !== currentUserId);

    if (deletePromptTimerRef.current) {
      clearTimeout(deletePromptTimerRef.current);
    }

    // Let the native swipe action finish closing before presenting the confirm sheet.
    // Otherwise SwiftUI can animate the List row away underneath the popup.
    deletePromptTimerRef.current = setTimeout(() => {
      deletePromptTimerRef.current = null;
      void (async () => {
        const ok = await confirm({
          title: 'ลบห้องสนทนา?',
          body: `การจับคู่และห้องสนทนากับ ${conversation.name || 'เพื่อน'} จะถูกนำออกจากรายการ`,
          confirmLabel: 'ลบห้องสนทนา',
          icon: 'trash.fill',
        });
        if (!ok) return;
        try {
          await removeConversation(conversation.id, otherUserId);
        } catch (err) {
          console.error('Failed to remove conversation:', err);
        }
      })();
    }, DELETE_CONFIRM_DELAY_MS);
  }, [confirm, currentUserId, removeConversation]);

  const handlePreviewConversation = useCallback((conversation) => {
    if (conversation?.id) setPreviewConversationId(conversation.id);
  }, []);

  const handleOpenConversation = useCallback((conversation) => {
    if (conversation?.id) {
      openChatRoom(conversation.id, { pathname });
    }
  }, [pathname]);

  const handleOpenPreviewChat = () => {
    const chatId = previewConversation?.id;
    setPreviewConversationId(null);
    if (chatId) openChatRoom(chatId, { pathname, entryAnimation: 'popup' });
  };

  const renderConversation = useCallback(({ item }) => (
    <ConversationRow
      colorScheme={colorScheme}
      conversation={item}
      currentUserId={currentUserId}
      onDelete={handleDeleteConversation}
      onPreview={handlePreviewConversation}
      onPress={handleOpenConversation}
    />
  ), [colorScheme, currentUserId, handleDeleteConversation, handleOpenConversation, handlePreviewConversation]);

  const renderListHeader = useCallback(() => (
    <View>
    <View style={{ width: '100%', height: 124 }}>
      <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ width: '100%', height: 124 }}>
        <VStack
          alignment="leading"
          spacing={16}
          modifiers={[padding({ bottom: 16 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}
        >
          <HStack spacing={10} modifiers={[padding({ horizontal: 15, vertical: 11 }), frame({ maxWidth: Infinity, minHeight: 50 }), background(palette.surface, shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' }))]}>
            <Image color={palette.tertiary} size={18} systemName="magnifyingglass" />
            <TextField
              onTextChange={setQuery}
              placeholder="ค้นหาชื่อหรือข้อความ"
              ref={searchInputRef}
              text={searchState}
              modifiers={[textFieldStyle('plain'), frame({ maxWidth: Infinity })]}
            />
            {query ? (
              <Button
                onPress={() => {
                  setQuery('');
                  searchState.set('');
                  searchInputRef.current?.clear?.();
                }}
                modifiers={[buttonStyle('plain'), frame({ width: 28, height: 28 }), accessibilityLabel('ล้างการค้นหา')]}
              >
                <Image color={palette.tertiary} size={18} systemName="xmark.circle.fill" />
              </Button>
            ) : null}
          </HStack>

          <HStack spacing={10}>
            <FilterButton active={!unreadOnly} label="กล่องข้อความ" onPress={() => setUnreadOnly(false)} systemImage="tray.full.fill" />
            <FilterButton active={unreadOnly} label="ยังไม่ได้อ่าน" onPress={() => setUnreadOnly(true)} systemImage="circle.fill" />
          </HStack>
        </VStack>
      </Host>
    </View>

    </View>
  ), [colorScheme, currentUserId, palette, query, searchState, unreadOnly]);

  const renderListEmpty = useCallback(() => (
    <View style={{ width: '100%', height: 250, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
      <SymbolView name={query || unreadOnly ? 'magnifyingglass' : 'message.fill'} size={54} tintColor={palette.secondary} />
      <RNText style={{ color: palette.text, fontSize: 22, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
        {query || unreadOnly ? 'ไม่พบข้อความ' : 'ยังไม่มีแชตคู่'}
      </RNText>
      <RNText style={{ color: palette.secondary, fontSize: 15, fontWeight: '500', marginTop: 8, textAlign: 'center' }}>
        {query || unreadOnly ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'เมื่อคุณรับคำขอถูกใจ ห้องสนทนาจะปรากฏที่นี่'}
      </RNText>
    </View>
  ), [palette, query, unreadOnly]);

  const scrollY = useRef(new Animated.Value(0)).current;

  const largeHeaderOpacity = scrollY.interpolate({
    inputRange: [0, 40],
    outputRange: [1, 0],
    extrapolate: 'clamp'
  });
  
  const largeHeaderTranslateY = scrollY.interpolate({
    inputRange: [0, 40],
    outputRange: [0, -20],
    extrapolate: 'clamp'
  });

  const smallHeaderOpacity = scrollY.interpolate({
    inputRange: [30, 60],
    outputRange: [0, 1],
    extrapolate: 'clamp'
  });

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, opacity: largeHeaderOpacity, transform: [{ translateY: largeHeaderTranslateY }] }} pointerEvents="box-none">
        <TopBlur colorScheme={colorScheme} />
        <Host colorScheme={colorScheme} seedColor={palette.accent} style={{ width: '100%', height: 104 }}>
          <HStack modifiers={[padding({ top: 46, bottom: 14, horizontal: 20 }), frame({ maxWidth: Infinity })]}>
            <VStack alignment="leading" spacing={0}>
              <Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
                ข้อความ
              </Text>
            </VStack>
            <Spacer />
            <Button
              label="New Chat"
              systemImage="square.and.pencil"
              modifiers={[
                buttonStyle('glass'),
                buttonBorderShape('circle'),
                controlSize('large'),
                labelStyle('iconOnly'),
                tint(palette.accent),
              ]}
            />
          </HStack>
        </Host>
      </Animated.View>

      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 95, zIndex: 21, opacity: smallHeaderOpacity, paddingTop: 45, paddingHorizontal: 20 }} pointerEvents="box-none">
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: -20 }}>
          <MaskedView style={{ flex: 1 }} maskElement={<LinearGradient colors={['#FFFFFF', '#FFFFFF00']} locations={[0.6, 1]} style={{ flex: 1 }} />}>
            <BlurView intensity={100} tint="prominent" style={{ flex: 1 }} />
          </MaskedView>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <RNText style={{ fontSize: 17, fontWeight: '600', color: colorScheme === 'dark' ? '#fff' : '#000', position: 'absolute' }}>
            ข้อความ
          </RNText>
          <View style={{ flex: 1 }} />
          <Pressable style={{ width: 34, height: 34, backgroundColor: palette.accentSoft, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name="square.and.pencil" size={18} tintColor={palette.accent} />
          </Pressable>
        </View>
      </Animated.View>

      <Animated.FlatList
        contentContainerStyle={{ paddingBottom: 36, paddingHorizontal: 20, paddingTop: 124 }}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        data={[...groupInbox.items, ...visibleConversations].sort(compareConversationsByActivity)}
        keyExtractor={(item) => `${item.kind === 'group' ? 'group' : 'direct'}:${item.id}`}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={renderListEmpty}
        ListHeaderComponent={renderListHeader}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        renderItem={(props) => props.item.kind === 'group' ? <GroupChatRow group={props.item} /> : renderConversation(props)}
        ListFooterComponent={<GroupChatInboxStatus inbox={groupInbox} />}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      />

      <ChatPreviewModal
        accentColor={palette.accent}
        conversation={previewConversation}
        currentUserId={currentUserId}
        onClose={() => setPreviewConversationId(null)}
        onOpenChat={handleOpenPreviewChat}
        visible={Boolean(previewConversation)}
      />
    </View>
  );
}

function FilterButton({ active, label, onPress, systemImage }) {
  const palette = usePalette();
  return (
    <Button
      label={label}
      onPress={onPress}
      systemImage={systemImage}
      modifiers={[buttonStyle(active ? 'glassProminent' : 'glass'), buttonBorderShape('capsule'), controlSize('regular'), active ? tint(palette.accent) : tint(palette.secondary)]}
    />
  );
}

function SwipeableConversationRow({ children, contentBackgroundColor, onDelete }) {
  const translateX = useSharedValue(0);
  const context = useSharedValue(0);

  const settle = (open) => {
    translateX.set(withSpring(open ? -SWIPE_DELETE_WIDTH : 0, {
      duration: 400,
      dampingRatio: 0.8,
      overshootClamping: true,
    }));
  };

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-8, 8])
    .onStart(() => {
      context.set(translateX.get());
    })
    .onUpdate((e) => {
      const next = context.get() + e.translationX;
      if (next > 0) {
        translateX.set(0);
      } else if (next < -SWIPE_DELETE_WIDTH) {
        translateX.set(-SWIPE_DELETE_WIDTH + rubberband(next + SWIPE_DELETE_WIDTH, SWIPE_DELETE_WIDTH));
      } else {
        translateX.set(next);
      }
    })
    .onEnd((e, success) => {
      const projected = success
        ? translateX.get() + project(e.velocityX)
        : translateX.get();
      const shouldOpen = projected < -(SWIPE_DELETE_WIDTH * 0.45);
      translateX.set(withSpring(shouldOpen ? -SWIPE_DELETE_WIDTH : 0, {
        duration: 400,
        dampingRatio: 0.8,
        velocity: success ? e.velocityX : 0,
        overshootClamping: true,
      }));
    }), [context, translateX]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const deleteActionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.get(),
      [-SWIPE_DELETE_WIDTH, -16, 0],
      [1, 0.5, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={{ overflow: 'hidden', position: 'relative', width: '100%' }}>
      <Reanimated.View style={[{ alignItems: 'stretch', backgroundColor: '#D92D3F', bottom: 0, justifyContent: 'center', position: 'absolute', right: 0, top: 0, width: SWIPE_DELETE_WIDTH }, deleteActionStyle]}>
        <Pressable
          accessibilityLabel="ลบห้องสนทนา"
          accessibilityRole="button"
          onPress={() => {
            settle(false);
            onDelete?.();
          }}
          style={({ pressed }) => [{ alignItems: 'center', flex: 1, justifyContent: 'center', width: SWIPE_DELETE_WIDTH }, pressed && { opacity: 0.75 }]}
        >
          <SymbolView name="trash.fill" size={20} tintColor="#FFFFFF" />
          <RNText style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginTop: 3 }}>ลบ</RNText>
        </Pressable>
      </Reanimated.View>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[{ backgroundColor: contentBackgroundColor, width: '100%' }, rowStyle]}>
          {children}
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

function ConversationRow({ conversation, currentUserId, onDelete, onPreview, onPress }) {
  const palette = usePalette();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const unreadCount = conversation.unreadCounts?.[currentUserId] || conversation.unread || 0;
  const timeLabel = formatConversationTime(conversation, currentUserId, unreadCount);
  const isHighlight = unreadCount > 0 || timeLabel.startsWith('ส่ง') || timeLabel.startsWith('อ่าน');
  const longPressAtRef = useRef(0);

  const handlePress = () => {
    const now = Date.now();
    if (now - longPressAtRef.current < 500) {
      longPressAtRef.current = 0;
      return;
    }
    onPress?.(conversation);
  };

  const handleLongPress = () => {
    longPressAtRef.current = Date.now();
    onPreview?.(conversation);
  };

  return (
    <SwipeableConversationRow contentBackgroundColor={palette.background} onDelete={() => onDelete?.(conversation)}>
      <Pressable
        accessibilityLabel={`คุยกับ ${conversation.name}`}
        accessibilityRole="button"
        delayLongPress={220}
        onLongPress={handleLongPress}
        onPressIn={() => { void warmChatPreviewMedia(conversation, currentUserId).catch(() => {}); }}
        onPress={handlePress}
        style={({ pressed }) => [{
          alignItems: 'center',
          backgroundColor: pressed
            ? (palette.background === '#000000' || palette.background === '#14171B' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
            : palette.background,
          flexDirection: 'row',
          gap: 13,
          minHeight: 84,
          paddingVertical: 10,
          width: '100%',
        }]}
      >
        <IosLikeAvatar
          cacheScope={conversation.profileId}
          cacheVersion={conversation.participantProfiles?.[conversation.profileId]?.avatarRevision}
          color={conversation.avatarColor}
          emoji={conversation.avatar}
          size={62}
          uri={conversation.avatarUri}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText numberOfLines={1} style={{ color: palette.text, fontSize: 17, fontWeight: unreadCount ? '700' : '600' }}>
            {conversation.name}
          </RNText>
          {timeLabel ? (
            <RNText numberOfLines={1} style={{ color: unreadCount ? palette.text : (isHighlight ? palette.accent : palette.secondary), fontSize: 15, fontWeight: unreadCount ? '700' : (isHighlight ? '600' : '400'), marginTop: 4 }}>
              {timeLabel}
            </RNText>
          ) : null}
        </View>
      </Pressable>
    </SwipeableConversationRow>
  );
}

function TopBlur({ colorScheme }) {
  return (
    <MaskedView style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 110, zIndex: 10 }} maskElement={<LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />}>
      <BlurView intensity={colorScheme === 'dark' ? 32 : 42} style={{ flex: 1 }} tint={colorScheme} />
    </MaskedView>
  );
}
