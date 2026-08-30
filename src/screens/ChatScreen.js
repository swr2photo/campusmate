import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useApp } from '../context/AppContext';
import { useRemoteImage } from '../utils/useRemoteImage';
import { radius, spacing, type, useTheme } from '../theme';

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

function formatTime(timestamp) {
  const date = toDate(timestamp);
  return date ? date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
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
    const readTimestamp = conversation.readReceipts?.[otherUserId] || conversation.updatedAt;
    const readDate = toDate(readTimestamp);
    const label = formatRelativeLabel(readDate);
    if (label === 'สักครู่') return 'อ่านแล้วเมื่อสักครู่';
    return label ? `อ่านแล้วเมื่อ ${label}` : 'อ่านแล้ว';
  }

  const sentDate = toDate(lastMsg?.createdAt || lastMsg?.time || conversation.updatedAt);
  const label = formatRelativeLabel(sentDate);
  if (label === 'สักครู่') return 'ส่งเมื่อสักครู่';
  return label ? `ส่งเมื่อ ${label}` : 'ส่งแล้ว';
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { conversations, profile } = useApp();
  const params = useLocalSearchParams();
  const [query, setQuery] = useState('');
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

  const visibleConversations = useMemo(() => conversations.filter((conversation) => (
    `${conversation.name || ''} ${conversation.lastMessage || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [conversations, query]);

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={visibleConversations}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <View style={styles.titleRow}>
              <View>
                <Text style={styles.title}>ข้อความ</Text>
                <Text style={styles.subtitle}>{conversations.length ? `${conversations.length} ห้องสนทนา` : 'พื้นที่คุยของคุณ'}</Text>
              </View>
              <View style={styles.composeIcon}><SymbolView name="square.and.pencil" size={23} tintColor={colors.primary} /></View>
            </View>
            <View style={styles.searchBox}>
              <SymbolView name="magnifyingglass" size={18} tintColor={colors.inkSoft} />
              <TextInput
                onChangeText={setQuery}
                placeholder="ค้นหาชื่อหรือข้อความ"
                placeholderTextColor={colors.inkSoft}
                style={styles.searchInput}
                value={query}
              />
              {query ? (
                <Pressable
                  accessibilityLabel="ล้างการค้นหา"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setQuery('')}
                  style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.6 }]}
                >
                  <SymbolView name="xmark.circle.fill" size={18} tintColor={colors.inkSoft} />
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <SymbolView name="bubble.left.and.bubble.right" size={44} tintColor={colors.inkSoft} />
            <Text style={styles.emptyTitle}>ยังไม่มีห้องสนทนา</Text>
            <Text style={styles.emptyText}>เมื่อคุณรับคำขอถูกใจ ห้องสนทนาจะปรากฏที่นี่</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const unreadCount = item.unreadCounts?.[profile?.id] || 0;
          const timeLabel = formatListTime(item, profile?.id, unreadCount);
          const isHighlight = unreadCount > 0 || timeLabel.startsWith('ส่ง') || timeLabel.startsWith('อ่าน');
          return (
            <Pressable onPress={() => router.push({ pathname: '/chat-room', params: { chatId: item.id } })} style={({ pressed }) => [styles.conversationRow, pressed && styles.pressed]}>
              <Avatar avatarColor={item.avatarColor} colors={colors} emoji={item.avatar} size={62} uri={item.avatarUri} />
              <View style={styles.conversationCopy}>
                <View style={styles.conversationTitleRow}>
                  <Text numberOfLines={1} style={[styles.conversationName, unreadCount > 0 && { fontWeight: '800' }]}>{item.name}</Text>
                </View>
                {timeLabel ? (
                  <Text numberOfLines={1} style={[styles.partnerSubtitle, unreadCount > 0 ? { color: colors.ink, fontWeight: '700' } : (isHighlight ? { color: colors.primary, fontWeight: '600' } : null)]}>
                    {timeLabel}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        showsVerticalScrollIndicator={false}
      />
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
  composeIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  container: { backgroundColor: colors.canvas, flex: 1 },
  conversationCopy: { flex: 1 },
  conversationName: { ...type.body, color: colors.ink, flex: 1, fontWeight: '700' },
  conversationRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  conversationTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl * 1.5 },
  emptyText: { ...type.bodySmall, color: colors.inkSoft, marginTop: spacing.xs, textAlign: 'center' },
  emptyTitle: { ...type.headline, color: colors.ink, marginTop: spacing.md },
  listContent: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  listHeader: { marginBottom: spacing.lg },
  listTime: { ...type.caption, color: colors.inkSoft },
  partnerSubtitle: { ...type.caption, color: colors.inkMuted, marginTop: 2 },
  preview: { ...type.bodySmall, color: colors.inkSoft, flex: 1 },
  previewRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  pressed: { opacity: 0.7 },
  searchBox: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  searchInput: { ...type.body, color: colors.ink, flex: 1, padding: 0 },
  subtitle: { ...type.bodySmall, color: colors.inkSoft, marginTop: 2 },
  title: { ...type.title1, color: colors.ink, fontWeight: '800' },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  unread: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 2 },
  unreadText: { ...type.caption2, color: '#FFFFFF', fontWeight: '700' },
});
