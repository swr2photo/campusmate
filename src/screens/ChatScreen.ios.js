import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, useColorScheme, View, Animated, Text as RNText } from 'react-native';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Button,
  ContentUnavailableView,
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
  accessibilityLabel,
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
  labelStyle,
  lineLimit,
  padding,
  resizable,
  scrollDismissesKeyboard,
  scrollIndicators,
  shapes,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useApp } from '../context/AppContext';
import { useRemoteImage } from '../utils/useRemoteImage';

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
  const iSentLast = lastMsg && (lastMsg.senderId === currentUserId || lastMsg.sender === 'me');

  // If there are multiple unread messages from the other person
  if (unreadCount > 1) {
    const date = toDate(lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    const timeText = label === 'สักครู่' ? 'เมื่อสักครู่' : label;
    return `${unreadCount} ข้อความใหม่ · ${timeText || 'เมื่อสักครู่'}`;
  }

  // If there is exactly 1 unread message from the other person
  if (unreadCount === 1 && !iSentLast) {
    const date = toDate(lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    const timeText = label === 'สักครู่' ? 'เมื่อสักครู่' : (label.startsWith('เมื่อ') ? label : `เมื่อ ${label}`);
    const textSnippet = (lastMsg?.text || conversation.lastMessage || '').trim();
    return textSnippet ? `${textSnippet} · ${timeText}` : timeText;
  }

  // If the other person sent the last message (and already read)
  if (!iSentLast) {
    const date = toDate(lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    if (label === 'สักครู่') return 'เมื่อสักครู่';
    return label ? `เมื่อ ${label}` : '';
  }

  // Current user sent the last message
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
  const sentDate = toDate(lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
  const label = formatRelativeLabel(sentDate);
  if (label === 'สักครู่') return 'ส่งเมื่อสักครู่';
  return label ? `ส่งเมื่อ ${label}` : 'ส่งแล้ว';
}

export default function ChatScreen() {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { conversations, profile } = useApp();
  const params = useLocalSearchParams();
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const searchState = useNativeState('');
  const searchInputRef = useRef(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  
  useEffect(() => {
    if (params?.chatId) {
      router.push({ pathname: '/chat-room', params: { chatId: params.chatId } });
    }
  }, [params?.chatId]);

  const currentUserId = profile?.id;
  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (unreadOnly && !(conversation.unreadCounts?.[currentUserId] > 0)) return false;
      if (!normalized) return true;
      return `${conversation.name || ''} ${conversation.lastMessage || ''}`.toLowerCase().includes(normalized);
    });
  }, [conversations, currentUserId, query, unreadOnly]);

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

      <Animated.ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        <Host colorScheme={colorScheme} seedColor={palette.accent} matchContents={{ vertical: true }}>
          <VStack alignment="leading" spacing={16} modifiers={[padding({ top: 124, bottom: 36, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
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
                  modifiers={[buttonStyle('plain'), frame({ width: 28, height: 28 }), accessibilityLabel('ลบการค้นหา')]}
                >
                  <Image color={palette.tertiary} size={18} systemName="xmark.circle.fill" />
                </Button>
              ) : null}
            </HStack>

            <HStack spacing={10}>
              <FilterButton active={!unreadOnly} label="กล่องข้อความ" onPress={() => setUnreadOnly(false)} systemImage="tray.full.fill" />
              <FilterButton active={unreadOnly} label="ยังไม่ได้อ่าน" onPress={() => setUnreadOnly(true)} systemImage="circle.fill" />
            </HStack>

            {visibleConversations.length ? visibleConversations.map((conversation) => (
              <ConversationRow
                conversation={conversation}
                currentUserId={currentUserId}
                key={conversation.id}
                onPress={() => router.push({ pathname: '/chat-room', params: { chatId: conversation.id } })}
                unreadCount={conversation.unreadCounts?.[currentUserId] || 0}
              />
            )) : (
              <VStack spacing={12} modifiers={[padding({ vertical: 60 }), frame({ maxWidth: Infinity, alignment: 'center' })]}>
                <Image color={palette.secondary} size={54} systemName={query || unreadOnly ? "magnifyingglass" : "message.fill"} />
                <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(palette.text)]}>
                  {query || unreadOnly ? 'ไม่พบข้อความ' : 'ยังไม่มีห้องสนทนา'}
                </Text>
                <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(palette.secondary), frame({ maxWidth: 280, alignment: 'center' })]}>
                  {query || unreadOnly ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'เมื่อคุณรับคำขอถูกใจ ห้องสนทนาจะปรากฏที่นี่'}
                </Text>
              </VStack>
            )}
          </VStack>
        </Host>
      </Animated.ScrollView>
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

function ConversationRow({ conversation, currentUserId, onPress, unreadCount }) {
  const palette = usePalette();
  const timeLabel = formatConversationTime(conversation, currentUserId, unreadCount);
  const isHighlight = unreadCount > 0 || timeLabel.startsWith('ส่ง') || timeLabel.startsWith('อ่าน');
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <HStack spacing={13} modifiers={[padding({ vertical: 10 }), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`คุยกับ ${conversation.name}`)]}>
        <ProfileAvatar avatarColor={conversation.avatarColor} emoji={conversation.avatar} size={62} uri={conversation.avatarUri} />
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'headline', weight: unreadCount ? 'bold' : 'semibold' }), foregroundStyle(palette.text), lineLimit(1), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            {conversation.name}
          </Text>
          {timeLabel ? (
            <Text modifiers={[font({ textStyle: 'subheadline', weight: unreadCount ? 'bold' : (isHighlight ? 'semibold' : 'regular') }), foregroundStyle(unreadCount ? palette.text : (isHighlight ? palette.accent : palette.secondary)), lineLimit(1), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              {timeLabel}
            </Text>
          ) : null}
        </VStack>
      </HStack>
    </Button>
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

function TopBlur({ colorScheme }) {
  return (
    <MaskedView style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 110, zIndex: 10 }} maskElement={<LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />}>
      <BlurView intensity={colorScheme === 'dark' ? 32 : 42} style={{ flex: 1 }} tint={colorScheme} />
    </MaskedView>
  );
}
