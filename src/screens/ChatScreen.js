import { compareConversationsByActivity } from '../utils/conversationOrder';
import { chatPreviewText } from '../utils/chatPreviewText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurTargetView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../context/AppContext';
import { IosLikeAvatar, IosLikeHeader, IosLikeScreen, IconButton } from '../components/iosLike';
import ChatPreviewModal from '../components/ChatPreviewModal';
import FeatureIcon from '../components/FeatureIcon';
import { spacing, type, radius, useTheme } from '../theme';

const SWIPE_DELETE_WIDTH = 88;

function toDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  if (typeof timestamp === 'number') {
    const value = new Date(timestamp < 1e11 ? timestamp * 1000 : timestamp);
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof timestamp?.toDate === 'function') {
    try {
      const value = timestamp.toDate();
      return Number.isNaN(value.getTime()) ? null : value;
    } catch {
      return null;
    }
  }
  if (typeof timestamp?.seconds === 'number') {
    const value = new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds ? timestamp.nanoseconds / 1e6 : 0));
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof timestamp?._seconds === 'number') {
    const value = new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds ? timestamp._nanoseconds / 1e6 : 0));
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return new Date(parsed);
    const match = timestamp.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const now = new Date();
      now.setHours(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), 0, 0);
      return now;
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

function formatListTime(conversation, currentUserId, unreadCount = 0) {
  const messages = conversation.messages || [];
  const lastMsg = messages[messages.length - 1];
  const iSentLast = conversation.lastMessageSenderId === currentUserId
    || (lastMsg && (lastMsg.senderId === currentUserId || lastMsg.sender === 'me'));

  if (unreadCount > 1) {
    const date = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    const timeText = label === 'สักครู่' ? 'เมื่อสักครู่' : label;
    return `${unreadCount} ข้อความใหม่ · ${timeText || 'เมื่อสักครู่'}`;
  }

  if (unreadCount === 1 && !iSentLast) {
    const date = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    const timeText = label === 'สักครู่' ? 'เมื่อสักครู่' : (label.startsWith('เมื่อ') ? label : `เมื่อ ${label}`);
    const textSnippet = chatPreviewText(lastMsg, conversation.lastMessage);
    return textSnippet ? `${textSnippet} · ${timeText}` : timeText;
  }

  if (!iSentLast) {
    const date = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
    const label = formatRelativeLabel(date);
    if (label === 'สักครู่') return 'เมื่อสักครู่';
    return label ? `เมื่อ ${label}` : '';
  }

  const otherUserId = (conversation.participants || []).find((id) => id !== currentUserId);
  const otherUnread = otherUserId ? (conversation.unreadCounts?.[otherUserId] || 0) : 0;

  if (otherUnread === 0 && otherUserId) {
    const readTimestamp = conversation.readReceipts?.[otherUserId] || conversation.updatedAt;
    const readDate = toDate(readTimestamp);
    const label = formatRelativeLabel(readDate);
    if (label === 'สักครู่') return 'อ่านแล้วเมื่อสักครู่';
    return label ? `อ่านแล้วเมื่อ ${label}` : 'อ่านแล้ว';
  }

  const sentDate = toDate(conversation.lastMessageAt || lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
  const label = formatRelativeLabel(sentDate);
  if (label === 'สักครู่') return 'ส่งเมื่อสักครู่';
  return label ? `ส่งเมื่อ ${label}` : 'ส่งแล้ว';
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const { conversations = [], profile, removeConversation } = useApp();
  const params = useLocalSearchParams();
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [previewConversationId, setPreviewConversationId] = useState(null);
  const blurTargetRef = useRef(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (params?.chatId) router.push({ pathname: '/chat-room', params: { chatId: params.chatId } });
  }, [params?.chatId]);

  const currentUserId = profile?.id;
  const previewConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === previewConversationId) || null,
    [conversations, previewConversationId]
  );
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const unreadCount = conversation.unreadCounts?.[currentUserId] || conversation.unread || 0;
      if (unreadOnly && unreadCount === 0) return false;
      if (!normalizedQuery) return true;
      return `${conversation.name || ''} ${conversation.lastMessage || ''}`.toLowerCase().includes(normalizedQuery);
    }).sort(compareConversationsByActivity);
  }, [conversations, currentUserId, query, unreadOnly]);

  const handleDeleteConversation = useCallback((conversation) => {
    const otherUserId = conversation.profileId
      || conversation.participants?.find((participantId) => participantId !== currentUserId);
    Alert.alert(
      'ลบห้องสนทนา?',
      `การจับคู่และห้องสนทนากับ ${conversation.name || 'เพื่อน'} จะถูกนำออกจากรายการ`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบห้องสนทนา',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeConversation(conversation.id, otherUserId);
            } catch (err) {
              console.error('Failed to remove conversation:', err);
            }
          },
        },
      ]
    );
  }, [currentUserId, removeConversation]);

  const handlePreviewConversation = useCallback((conversation) => {
    if (conversation?.id) setPreviewConversationId(conversation.id);
  }, []);

  const handleOpenConversation = useCallback((conversation) => {
    if (conversation?.id) router.push({ pathname: '/chat-room', params: { chatId: conversation.id } });
  }, []);

  const renderConversation = useCallback(({ item }) => (
    <ConversationRow
      conversation={item}
      currentUserId={currentUserId}
      onDelete={handleDeleteConversation}
      onPreview={handlePreviewConversation}
      onPress={handleOpenConversation}
    />
  ), [currentUserId, handleDeleteConversation, handleOpenConversation, handlePreviewConversation]);

  const handleOpenPreviewChat = () => {
    const chatId = previewConversation?.id;
    setPreviewConversationId(null);
    if (chatId) router.push({ pathname: '/chat-room', params: { chatId } });
  };

  const isAndroid = Platform.OS === 'android';
  const screenContent = (
    <IosLikeScreen>
      <IosLikeHeader
        onRightPress={() => setQuery('')}
        rightIcon="square.and.pencil"
        subtitle={conversations.length ? `${conversations.length} ห้องสนทนา` : 'พื้นที่คุยของคุณ'}
        title="ข้อความ"
      />
      <FlatList
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        data={visibleConversations}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.line }]}>
              <FeatureIcon color={colors.inkSoft} name="magnifyingglass" size={19} />
              <TextInput
                autoCapitalize="none"
                onChangeText={setQuery}
                placeholder="ค้นหาชื่อหรือข้อความ"
                placeholderTextColor={colors.inkSoft}
                style={[styles.searchInput, { color: colors.ink }]}
                value={query}
              />
              {query ? <IconButton accessibilityLabel="ล้างการค้นหา" icon="xmark.circle.fill" onPress={() => setQuery('')} size={18} style={styles.clearButton} tintColor={colors.inkSoft} /> : null}
            </View>
            <View style={styles.filterRow}>
              <FilterButton active={!unreadOnly} icon="tray.full.fill" label="ทั้งหมด" onPress={() => setUnreadOnly(false)} />
              <FilterButton active={unreadOnly} icon="circle.fill" label="ยังไม่อ่าน" onPress={() => setUnreadOnly(true)} />
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}><FeatureIcon color={colors.primary} name={query || unreadOnly ? 'search' : 'message.fill'} size={30} /></View>
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>{query || unreadOnly ? 'ไม่พบข้อความ' : 'ยังไม่มีห้องสนทนา'}</Text>
            <Text style={[styles.emptyText, { color: colors.inkMuted }]}>{query || unreadOnly ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'เมื่อคุณรับคำขอถูกใจ ห้องสนทนาจะปรากฏที่นี่'}</Text>
          </View>
        )}
        renderItem={renderConversation}
        showsVerticalScrollIndicator={false}
      />
    </IosLikeScreen>
  );

  return (
    <>
      {isAndroid ? (
        <BlurTargetView ref={blurTargetRef} style={styles.blurTarget}>
          {screenContent}
        </BlurTargetView>
      ) : screenContent}
      <ChatPreviewModal
        accentColor={colors.primary}
        blurTarget={isAndroid ? blurTargetRef : undefined}
        conversation={previewConversation}
        currentUserId={currentUserId}
        onClose={() => setPreviewConversationId(null)}
        onOpenChat={handleOpenPreviewChat}
        visible={Boolean(previewConversation)}
      />
    </>
  );
}

function FilterButton({ active, icon, label, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.filterButton, { backgroundColor: active ? colors.primarySoft : colors.surfaceRaised, borderColor: active ? colors.primary : colors.line }, pressed && styles.pressed]}>
      <FeatureIcon color={active ? colors.primary : colors.inkMuted} name={icon} size={15} />
      <Text style={[styles.filterText, { color: active ? colors.primary : colors.inkMuted }]}>{label}</Text>
    </Pressable>
  );
}

function SwipeableConversationRow({ children, contentBackgroundColor, onDelete }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const gestureStartOffsetRef = useRef(0);
  const gestureOffsetRef = useRef(0);

  const settle = (open) => {
    const nextOffset = open ? -SWIPE_DELETE_WIDTH : 0;
    offsetRef.current = nextOffset;
    gestureOffsetRef.current = nextOffset;
    Animated.spring(translateX, {
      toValue: nextOffset,
      damping: 22,
      mass: 0.8,
      overshootClamping: true,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  };

  const updateDuringGesture = (dx) => {
    const nextOffset = Math.max(
      -SWIPE_DELETE_WIDTH,
      Math.min(0, gestureStartOffsetRef.current + dx)
    );
    gestureOffsetRef.current = nextOffset;
    translateX.setValue(nextOffset);
    return nextOffset;
  };

  const panResponder = useMemo(() => PanResponder.create({
    // Capture a horizontal drag before the nested Pressable or FlatList can
    // take the responder. Vertical movement remains available for scrolling.
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      Math.abs(gestureState.dx) > 8
        && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
    ),
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dx) > 8
        && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
    ),
    onPanResponderGrant: () => {
      gestureStartOffsetRef.current = offsetRef.current;
      gestureOffsetRef.current = offsetRef.current;
      translateX.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      updateDuringGesture(gestureState.dx);
    },
    onPanResponderRelease: (_, gestureState) => {
      const nextOffset = updateDuringGesture(gestureState.dx);
      settle(nextOffset <= -(SWIPE_DELETE_WIDTH * 0.45) || gestureState.vx < -0.45);
    },
    onPanResponderTerminate: () => settle(gestureOffsetRef.current <= -(SWIPE_DELETE_WIDTH * 0.45)),
    onPanResponderTerminationRequest: () => false,
  }), [translateX]);

  const deleteActionOpacity = translateX.interpolate({
    inputRange: [-SWIPE_DELETE_WIDTH, -16, 0],
    outputRange: [1, 0.5, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.swipeContainer}>
      <Animated.View style={[styles.swipeDeleteAction, { opacity: deleteActionOpacity }]}>
        <Pressable
          accessibilityLabel="ลบห้องสนทนา"
          accessibilityRole="button"
          onPress={() => {
            settle(false);
            onDelete?.();
          }}
          style={({ pressed }) => [styles.swipeDeleteButton, pressed && styles.swipeDeletePressed]}
        >
          <FeatureIcon color="#FFFFFF" name="trash" size={20} />
          <Text style={styles.swipeDeleteText}>ลบ</Text>
        </Pressable>
      </Animated.View>
      <Animated.View
        style={[
          styles.swipeContent,
          contentBackgroundColor ? { backgroundColor: contentBackgroundColor } : null,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const ConversationRow = React.memo(function ConversationRow({ conversation, currentUserId, onDelete, onPreview, onPress }) {
  const { colors, isDark } = useTheme();
  const unreadCount = conversation.unreadCounts?.[currentUserId] || conversation.unread || 0;
  const timeLabel = formatListTime(conversation, currentUserId, unreadCount);
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
    <SwipeableConversationRow contentBackgroundColor={colors.canvas} onDelete={() => onDelete?.(conversation)}>
      <Pressable
        accessibilityLabel={`คุยกับ ${conversation.name}`}
        accessibilityRole="button"
        delayLongPress={220}
        onLongPress={handleLongPress}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.conversationRow,
          {
            backgroundColor: pressed
              ? (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)')
              : colors.canvas,
            borderBottomColor: colors.line,
          },
        ]}
      >
        <IosLikeAvatar cacheScope={conversation.profileId} cacheVersion={conversation.participantProfiles?.[conversation.profileId]?.updatedAt} color={conversation.avatarColor} emoji={conversation.avatar} size={62} uri={conversation.avatarUri} />
        <View style={styles.conversationCopy}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }, unreadCount > 0 && styles.unreadName]}>{conversation.name}</Text>
            {unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}><Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
          </View>
          <Text numberOfLines={1} style={[styles.partnerSubtitle, { color: unreadCount > 0 ? colors.ink : colors.inkMuted }, unreadCount > 0 && styles.unreadPreview]}>{timeLabel}</Text>
        </View>
      </Pressable>
    </SwipeableConversationRow>
  );
}, areConversationRowPropsEqual);

function areConversationRowPropsEqual(previous, next) {
  return previous.conversation === next.conversation
    && previous.currentUserId === next.currentUserId
    && previous.onDelete === next.onDelete
    && previous.onPreview === next.onPreview
    && previous.onPress === next.onPress;
}

const styles = StyleSheet.create({
  blurTarget: { flex: 1 },
  content: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg },
  listHeader: { gap: spacing.md, paddingBottom: spacing.lg, paddingTop: spacing.sm },
  searchBox: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: type.body, paddingVertical: 0 },
  clearButton: { elevation: 0, height: 30, shadowOpacity: 0, width: 30 },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 38, paddingHorizontal: spacing.sm },
  filterText: { fontSize: type.caption, fontWeight: '700' },
  swipeContainer: { overflow: 'hidden', position: 'relative', width: '100%' },
  swipeContent: { width: '100%' },
  swipeDeleteAction: { alignItems: 'stretch', backgroundColor: '#D92D3F', bottom: 0, justifyContent: 'center', position: 'absolute', right: 0, top: 0, width: SWIPE_DELETE_WIDTH },
  swipeDeleteButton: { alignItems: 'center', flex: 1, justifyContent: 'center', width: SWIPE_DELETE_WIDTH },
  swipeDeletePressed: { opacity: 0.75 },
  swipeDeleteText: { color: '#FFFFFF', fontSize: type.caption, fontWeight: '800', marginTop: 3 },
  conversationRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  conversationCopy: { flex: 1, paddingRight: spacing.xs },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  conversationName: { flex: 1, fontSize: type.headline, fontWeight: '700' },
  unreadName: { fontWeight: '800' },
  partnerSubtitle: { fontSize: type.caption, marginTop: 5 },
  unreadPreview: { fontWeight: '700' },
  unreadBadge: { alignItems: 'center', borderRadius: radius.pill, minWidth: 22, paddingHorizontal: 6, paddingVertical: 3 },
  unreadBadgeText: { color: '#FFFFFF', fontSize: type.caption2, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  emptyIcon: { alignItems: 'center', borderRadius: radius.pill, height: 62, justifyContent: 'center', width: 62 },
  emptyTitle: { fontSize: type.headline, fontWeight: '800', marginTop: spacing.md },
  emptyText: { fontSize: type.caption, lineHeight: 18, marginTop: spacing.sm, textAlign: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
