import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../context/AppContext';
import { IosLikeAvatar, IosLikeHeader, IosLikeScreen, IconButton } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { spacing, type, radius, useTheme } from '../theme';

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
  if (typeof timestamp?.seconds === 'number') return new Date(timestamp.seconds * 1000);
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  return null;
}

function formatRelativeLabel(date) {
  if (!date) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  if (hours < 24) return `${hours} ชม. ที่แล้ว`;
  if (days === 1) return 'เมื่อวานนี้';
  if (days < 7) return `${days} วันที่แล้ว`;
  if (days < 30) return `${Math.ceil(days / 7)} สัปดาห์ที่แล้ว`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30))} เดือนที่แล้ว`;
  return `${Math.max(1, Math.floor(days / 365))} ปีที่แล้ว`;
}

function formatListTime(conversation, currentUserId, unreadCount) {
  const messages = conversation.messages || [];
  const lastMessage = messages[messages.length - 1];
  const lastDate = toDate(lastMessage?.createdAt || lastMessage?.time || conversation.updatedAt);
  const relative = formatRelativeLabel(lastDate);
  const iSentLast = lastMessage && (lastMessage.senderId === currentUserId || lastMessage.sender === 'me');
  if (unreadCount > 0 && !iSentLast) return `${conversation.lastMessage || lastMessage?.text || 'ข้อความใหม่'} · ${relative || 'เมื่อสักครู่'}`;
  if (!iSentLast) return relative ? `เมื่อ ${relative}` : '';
  const otherUserId = (conversation.participants || []).find((id) => id !== currentUserId);
  const otherUnread = otherUserId ? conversation.unreadCounts?.[otherUserId] || 0 : 0;
  return otherUnread === 0 ? `อ่านแล้วเมื่อ ${relative || 'สักครู่'}` : `ส่งเมื่อ ${relative || 'สักครู่'}`;
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const { conversations = [], profile } = useApp();
  const params = useLocalSearchParams();
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (params?.chatId) router.push({ pathname: '/chat-room', params: { chatId: params.chatId } });
  }, [params?.chatId]);

  const currentUserId = profile?.id;
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const unreadCount = conversation.unreadCounts?.[currentUserId] || conversation.unread || 0;
      if (unreadOnly && unreadCount === 0) return false;
      if (!normalizedQuery) return true;
      return `${conversation.name || ''} ${conversation.lastMessage || ''}`.toLowerCase().includes(normalizedQuery);
    });
  }, [conversations, currentUserId, query, unreadOnly]);

  return (
    <IosLikeScreen>
      <IosLikeHeader
        onRightPress={() => setQuery('')}
        rightIcon="square.and.pencil"
        subtitle={conversations.length ? `${conversations.length} ห้องสนทนา` : 'พื้นที่คุยของคุณ'}
        title="ข้อความ"
      />
      <FlatList
        contentContainerStyle={styles.content}
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
        renderItem={({ item }) => <ConversationRow conversation={item} currentUserId={currentUserId} onPress={() => router.push({ pathname: '/chat-room', params: { chatId: item.id } })} />}
        showsVerticalScrollIndicator={false}
      />
    </IosLikeScreen>
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

function ConversationRow({ conversation, currentUserId, onPress }) {
  const { colors } = useTheme();
  const unreadCount = conversation.unreadCounts?.[currentUserId] || conversation.unread || 0;
  const timeLabel = formatListTime(conversation, currentUserId, unreadCount);
  return (
    <Pressable accessibilityLabel={`คุยกับ ${conversation.name}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.conversationRow, { borderBottomColor: colors.line }, pressed && styles.pressed]}>
      <IosLikeAvatar color={conversation.avatarColor} emoji={conversation.avatar} size={62} uri={conversation.avatarUri} />
      <View style={styles.conversationCopy}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.conversationName, { color: colors.ink }, unreadCount > 0 && styles.unreadName]}>{conversation.name}</Text>
          {unreadCount > 0 ? <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}><Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
        </View>
        <Text numberOfLines={1} style={[styles.partnerSubtitle, { color: unreadCount > 0 ? colors.ink : colors.inkMuted }, unreadCount > 0 && styles.unreadPreview]}>{timeLabel}</Text>
      </View>
      <FeatureIcon color={colors.inkSoft} name="chevron.right" size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg },
  listHeader: { gap: spacing.md, paddingBottom: spacing.lg, paddingTop: spacing.sm },
  searchBox: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: type.body, paddingVertical: 0 },
  clearButton: { elevation: 0, height: 30, shadowOpacity: 0, width: 30 },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 38, paddingHorizontal: spacing.sm },
  filterText: { fontSize: type.caption, fontWeight: '700' },
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
