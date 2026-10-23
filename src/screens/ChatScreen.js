import { Pressable } from '../components/NativePressable';
import Text from '../components/AppText';
import ConversationInboxStatus from '../components/ConversationInboxStatus';
import { AppTextInput as TextInput } from '../components/AppText';
import SearchField from '../components/SearchField';
import { useIsTabPreview } from '../context/TabPreviewContext';
import FilterSegment from '../components/FilterSegment';
import AvatarStatusRing from '../components/status/AvatarStatusRing';
import { presenceStatus } from '../utils/userStatus';
import { compareConversationsByActivity } from '../utils/conversationOrder';

import { chatMemberSettings, chatUnreadState, latestChatSnippet, formatInboxTimestamp, chatReadStatus } from '../utils/inboxPresentation';
import { useChatPresence } from '../context/ChatPresenceContext';
import { showAlert } from '../utils/appAlert';
import React, { useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { project, rubberband } from '../utils/motion';
import { BlurTargetView } from 'expo-blur';
import { router, Stack, useLocalSearchParams, usePathname } from 'expo-router';
import { openChatRoom } from '../utils/openChatRoom';
import { useConfirm } from '../context/ConfirmContext';
import TabsBlurTargetContext from '../context/TabsBlurTargetContext';
import { useAppActions, useAppConversations, useAppProfile } from '../context/AppContext';
import { IosLikeAvatar, IosLikeHeader, IosLikeScreen, IconButton } from '../components/iosLike';
import ChatPreviewModal from '../components/ChatPreviewModal';
import { warmChatPreviewMedia } from '../services/chatPreviewMedia';
import FeatureIcon from '../components/FeatureIcon';
import { GroupChatRow, GroupChatInboxStatus } from '../components/GroupChatListSection';
import useGroupChatInbox from '../hooks/useGroupChatInbox';
import { spacing, type, radius, useTheme } from '../theme';
import { TourTarget } from '../context/AppTourContext';
import { prefetchBrowseMusicTracks } from '../services/spotifyService';

const SWIPE_DELETE_WIDTH = 88;

export default function ChatScreen() {
  // Background warm-up only: a slow/cold function (deadline-exceeded) must not
  // become an unhandled promise rejection. The search sheet retries on open.
  useEffect(() => { void prefetchBrowseMusicTracks().catch(() => {}); }, []);
  const { colors, isDark } = useTheme();
  const { confirm } = useConfirm();
  const conversationInbox = useAppConversations();
  const { conversations = [] } = conversationInbox;
  const { profile } = useAppProfile();
  const { markAsRead, removeConversation, retryConversations, updateChatSettingsInChat } = useAppActions();
  const params = useLocalSearchParams();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [previewConversationId, setPreviewConversationId] = useState(null);
  const blurTargetRef = useRef(null);
  const tabsBlurTargetRef = useContext(TabsBlurTargetContext);

  useEffect(() => {
    if (params?.chatId) openChatRoom(params.chatId, { pathname });
  }, [params?.chatId, pathname]);

  const currentUserId = profile?.id;
  const groupInbox = useGroupChatInbox(currentUserId, query, unreadOnly);
  const previewConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === previewConversationId) || null,
    [conversations, previewConversationId]
  );
  // The TextInput stays controlled by `query`; the list filter trails behind it
  // so typing never waits for the whole conversation list to recompute.
  const visibleConversations = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (unreadOnly && !chatUnreadState(conversation, currentUserId).unread) return false;
      if (!normalizedQuery) return true;
      return `${conversation.name || ''} ${conversation.lastMessage || ''}`.toLowerCase().includes(normalizedQuery);
    }).sort((a, b) => Number(chatMemberSettings(b, currentUserId).isPinned === true) - Number(chatMemberSettings(a, currentUserId).isPinned === true) || compareConversationsByActivity(a, b));
  }, [conversations, currentUserId, deferredQuery, unreadOnly]);

  const unreadConversationsCount = useMemo(() => {
    return conversations.reduce((count, conv) => {
      return chatUnreadState(conv, currentUserId).unread ? count + 1 : count;
    }, 0);
  }, [conversations, currentUserId]);

  const filterTabs = useMemo(() => [
    { id: 'all', label: 'ทั้งหมด' },
    { id: 'unread', label: 'ยังไม่อ่าน', badgeCount: unreadConversationsCount },
  ], [unreadConversationsCount]);

  const handleInboxSetting = useCallback(async (conversation, settings) => {
    try { await updateChatSettingsInChat(conversation.id, settings); }
    catch { showAlert('บันทึกการตั้งค่าแชตไม่สำเร็จ', 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', { tone: 'danger' }); }
  }, [updateChatSettingsInChat]);

  const handleDeleteConversation = useCallback(async (conversation) => {
    if (conversation.kind === 'group') {
      const ok = await confirm({
        title: 'ออกจากแชตกลุ่ม?',
        body: `คุณต้องการออกจากแชตกลุ่ม "${conversation.title || 'ตี้'}" หรือไม่`,
        confirmLabel: 'ออกจากกลุ่ม',
        icon: 'person.fill.xmark',
      });
      if (!ok) return;
      try {
        const { leaveParty } = await import('../services/partyService');
        await leaveParty(conversation.id, currentUserId);
      } catch (err) {
        console.error('Failed to leave group chat:', err);
      }
      return;
    }
    const otherUserId = conversation.profileId
      || conversation.participants?.find((participantId) => participantId !== currentUserId);
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
  }, [confirm, currentUserId, removeConversation]);

  const handlePreviewConversation = useCallback((conversation) => {
    if (conversation?.id) setPreviewConversationId(conversation.id);
  }, []);

  const handleOpenConversation = useCallback((conversation) => {
    if (!conversation?.id) return;
    if (conversation.kind === 'group') {
      router.push({ pathname: '/group-chat', params: { partyId: conversation.id } });
    } else {
      if (chatUnreadState(conversation, currentUserId).unread) {
        void markAsRead(conversation.id);
      }
      openChatRoom(conversation.id, { pathname });
    }
  }, [currentUserId, markAsRead, pathname]);

  const renderConversation = useCallback(({ item }) => (
    <ConversationRow
      conversation={item}
      currentUserId={currentUserId}
      onDelete={handleDeleteConversation}
      onPreview={handlePreviewConversation}
      onPress={handleOpenConversation}
      onMarkUnread={(conversation) => handleInboxSetting(conversation, { markedUnread: true })}
      onTogglePin={(conversation) => handleInboxSetting(conversation, { isPinned: chatMemberSettings(conversation, currentUserId).isPinned !== true })}
    />
  ), [currentUserId, handleDeleteConversation, handleInboxSetting, handleOpenConversation, handlePreviewConversation]);

  const handleOpenPreviewChat = () => {
    const chatId = previewConversation?.id;
    setPreviewConversationId(null);
    if (chatId) {
      if (chatUnreadState(previewConversation, currentUserId).unread) {
        void markAsRead(chatId);
      }
      openChatRoom(chatId, { pathname });
    }
  };

  const isAndroid = Platform.OS === 'android';
  const isTabPreview = useIsTabPreview();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = (Platform.OS === 'ios' && Boolean(Platform.isPad)) || windowWidth >= 700;
  const screenContent = (
    <IosLikeScreen>
      {isAndroid ? <IosLikeHeader title="ข้อความ" /> : null}
      <FlatList
        contentContainerStyle={[styles.content, isTablet && styles.tabletContent]}
        contentInsetAdjustmentBehavior="automatic"
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        data={[...groupInbox.items, ...visibleConversations].sort(compareConversationsByActivity)}
        keyExtractor={(item) => `${item.kind === 'group' ? 'group' : 'direct'}:${item.id}`}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <TourTarget id="chat.search" style={styles.listHeader}>
            {isAndroid ? (
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder="ค้นหาชื่อหรือข้อความ"
                onClear={() => setQuery('')}
              />
            ) : null}
            <View style={styles.tabsContainer}>
              <FilterSegment
                activeTab={unreadOnly ? 'unread' : 'all'}
                onChangeTab={(tabId) => setUnreadOnly(tabId === 'unread')}
                tabs={filterTabs}
              />
            </View>
          </TourTarget>
        )}
        ListEmptyComponent={<ConversationInboxStatus inbox={conversationInbox} retry={retryConversations} empty filtered={Boolean(query || unreadOnly)} groupLoading={groupInbox.loading} groupError={groupInbox.error} />}
        renderItem={renderConversation}
        ListFooterComponent={(
          <>
            {groupInbox.items.length + visibleConversations.length > 0 ? (
              <ConversationInboxStatus inbox={conversationInbox} retry={retryConversations} />
            ) : null}
            {groupInbox.items.length + visibleConversations.length > 0 || groupInbox.error ? (
              <GroupChatInboxStatus inbox={groupInbox} />
            ) : null}
          </>
        )}
        showsVerticalScrollIndicator={false}
      />
    </IosLikeScreen>
  );

  return (
    <>
      {/* iOS: native UISearchController in the navigation bar (system Liquid Glass
          on iOS 26+). Skipped in neighbour-tab previews, where it would attach to
          the hosting tab's navigation bar. */}
      {isAndroid || isTabPreview ? null : (
        <Stack.SearchBar
          autoCapitalize="none"
          cancelButtonText="ยกเลิก"
          hideWhenScrolling
          onCancelButtonPress={() => setQuery('')}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          placeholder="ค้นหาชื่อหรือข้อความ"
          placement="stacked"
          textColor={colors.ink}
          tintColor={colors.primary}
        />
      )}
      {isAndroid ? (
        <BlurTargetView ref={blurTargetRef} style={styles.blurTarget}>
          {screenContent}
        </BlurTargetView>
      ) : screenContent}
      <ChatPreviewModal
        accentColor={colors.primary}
        blurTarget={isAndroid ? (tabsBlurTargetRef || blurTargetRef) : undefined}
        conversation={previewConversation}
        currentUserId={currentUserId}
        onClose={() => setPreviewConversationId(null)}
        onOpenChat={handleOpenPreviewChat}
        onMarkUnread={(conversation) => handleInboxSetting(conversation, { markedUnread: true })}
        onTogglePin={(conversation) => handleInboxSetting(conversation, { isPinned: chatMemberSettings(conversation, currentUserId).isPinned !== true })}
        onDelete={handleDeleteConversation}
        visible={Boolean(previewConversation)}
      />
    </>
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
    <View style={styles.swipeContainer}>
      <Reanimated.View style={[styles.swipeDeleteAction, deleteActionStyle]}>
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
      </Reanimated.View>
      <GestureDetector gesture={pan}>
        <Reanimated.View
          style={[
            styles.swipeContent,
            contentBackgroundColor ? { backgroundColor: contentBackgroundColor } : null,
            rowStyle,
          ]}
        >
          {children}
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const ConversationRow = React.memo(function ConversationRow({
  conversation,
  currentUserId,
  onDelete,
  onPreview,
  onPress,
  onMarkUnread,
  onTogglePin,
}) {
  const { colors, isDark } = useTheme();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const isGroup = conversation.kind === 'group';
  const { count: unreadCount, unread } = chatUnreadState(conversation, currentUserId);
  const pinned = chatMemberSettings(conversation, currentUserId).isPinned === true;
  const presence = useChatPresence(conversation.id);
  const timeLabel = formatInboxTimestamp(conversation.lastMessageAt || conversation.messages?.at(-1)?.createdAt);
  const snippet = latestChatSnippet(conversation, currentUserId);
  const readStatus = chatReadStatus(conversation, currentUserId);
  const displayName = isGroup ? (conversation.title || 'แชตกลุ่มของตี้') : conversation.name;
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
    if (isGroup) {
      handlePress();
      return;
    }
    longPressAtRef.current = Date.now();
    onPreview?.(conversation);
  };
  return (
    <SwipeableConversationRow contentBackgroundColor={colors.canvas} onDelete={() => onDelete?.(conversation)}>
      <Pressable
        accessibilityLabel={isGroup ? `แชตกลุ่ม ${displayName}${unreadCount > 0 ? ' มีข้อความที่ยังไม่อ่าน' : ''}` : `คุยกับ ${conversation.name}${readStatus ? `, ${readStatus}` : ''}`}
        accessibilityRole="button"
        delayLongPress={220}
        onLongPress={handleLongPress}
        onPressIn={() => {
          if (!isGroup) void warmChatPreviewMedia(conversation, currentUserId).catch(() => {});
        }}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.conversationRow,
          {
            backgroundColor: pressed
              ? (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)')
              : colors.canvas,
          },
        ]}
      >
        {/* Ring shows real presence only (mint ripple online, moon when away). */}
        <AvatarStatusRing status={isGroup ? null : presenceStatus(presence)} size={56}>
          <IosLikeAvatar
            cacheScope={isGroup ? `group:${conversation.id}` : conversation.profileId}
            cacheVersion={isGroup ? undefined : conversation.participantProfiles?.[conversation.profileId]?.avatarRevision}
            color={isGroup ? colors.primarySoft : conversation.avatarColor}
            emoji={isGroup ? undefined : conversation.avatar}
            icon={isGroup ? 'person.3.fill' : undefined}
            size={56}
            uri={isGroup ? undefined : conversation.avatarUri}
          />
        </AvatarStatusRing>
        <View style={styles.conversationCopy}>
          <View style={styles.conversationHeading}>
            <Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }, unread && styles.unreadName]}>{displayName}</Text>
            {pinned ? <FeatureIcon name="pin.fill" size={12} color={colors.accentText} /> : null}
            <Text style={[styles.conversationTime, { color: colors.inkMuted }]}>{timeLabel}</Text>
          </View>
          <View style={styles.conversationPreviewRow}>
            <Text numberOfLines={1} style={[styles.partnerSubtitle, { color: unread ? colors.ink : colors.inkMuted }, unread && styles.unreadPreview]}>{snippet}</Text>
            {unread ? <View accessibilityLabel={unreadCount > 0 ? `${unreadCount} ข้อความที่ยังไม่อ่าน` : 'ทำเครื่องหมายว่ายังไม่อ่าน'} style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              {unreadCount > 0 ? <Text style={styles.unreadCount}>{unreadCount > 99 ? '99+' : unreadCount}</Text> : null}
            </View> : null}
          </View>
          {readStatus ? <Text numberOfLines={1} style={[styles.readStatus, { color: colors.inkMuted }]}>{readStatus}</Text> : null}
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
    && previous.onPress === next.onPress
    && previous.onMarkUnread === next.onMarkUnread
    && previous.onTogglePin === next.onTogglePin;
}

const styles = StyleSheet.create({
  blurTarget: { flex: 1 },
  content: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg },
  tabletContent: { alignSelf: 'center', maxWidth: 960, width: '100%' },
  listHeader: { gap: spacing.md, paddingBottom: spacing.lg, paddingTop: spacing.sm },
  tabsContainer: { width: '100%', marginTop: 2 },
  searchBox: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: type.body, paddingVertical: 0 },
  clearButton: { elevation: 0, height: 30, shadowOpacity: 0, width: 30 },
  swipeContainer: { borderRadius: 16, marginVertical: 3, overflow: 'hidden', position: 'relative', width: '100%' },
  swipeContent: { width: '100%' },
  swipeDeleteAction: { alignItems: 'stretch', backgroundColor: '#D92D3F', bottom: 0, justifyContent: 'center', position: 'absolute', right: 0, top: 0, width: SWIPE_DELETE_WIDTH },
  swipeDeleteButton: { alignItems: 'center', flex: 1, justifyContent: 'center', width: SWIPE_DELETE_WIDTH },
  swipeDeletePressed: { opacity: 0.75 },
  swipeDeleteText: { color: '#FFFFFF', fontSize: type.caption, fontWeight: '800', marginTop: 3 },
  conversationRow: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', gap: 14, paddingHorizontal: 8, paddingVertical: 10 },
  conversationCopy: { flex: 1, minWidth: 0, paddingRight: spacing.xs, justifyContent: 'center' },
  conversationHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  conversationPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  conversationName: { flex: 1, minWidth: 0, fontSize: type.headline, fontWeight: '700' },
  conversationTime: { flexShrink: 0, fontSize: 11 },
  readStatus: { fontSize: 12, marginTop: 3 },
  unreadBadge: { minWidth: 10, minHeight: 10, borderRadius: 12, paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center' },
  unreadCount: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  unreadName: { fontWeight: '800' },
  partnerSubtitle: { flex: 1, minWidth: 0, fontSize: type.caption },
  unreadPreview: { fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  emptyIcon: { alignItems: 'center', borderRadius: radius.pill, height: 62, justifyContent: 'center', width: 62 },
  emptyTitle: { fontSize: type.headline, fontWeight: '800', marginTop: spacing.md },
  emptyText: { fontSize: type.caption, lineHeight: 18, marginTop: spacing.sm, textAlign: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
