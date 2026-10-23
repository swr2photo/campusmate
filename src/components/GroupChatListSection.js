import { Pressable } from './NativePressable';
import Text from './AppText';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { IosLikeAvatar } from './iosLike';
import { spacing, type, useTheme } from '../theme';
import { formatInboxTimestamp } from '../utils/inboxPresentation';

export function GroupChatRow({ group, onPress }) {
  const { colors, isDark } = useTheme();
  const unread = Boolean(group.unread);
  const title = group.title || 'แชตกลุ่มของตี้';
  const memberCount = group.memberCount || group.memberIds?.length || 0;
  const preview = { image: 'รูปภาพ', gif: 'GIF', audio: 'ข้อความเสียง', track: 'เพลง' }[group.lastMessageType]
    || (group.lastMessageAt ? 'ข้อความใหม่' : 'เริ่มสนทนาได้แล้ว');
  const detail = `${memberCount} สมาชิก · ${preview}`;

  const handlePress = () => {
    if (onPress) {
      onPress(group);
      return;
    }
    router.push({ pathname: '/group-chat', params: { partyId: group.id } });
  };

  return (
    <Pressable
      accessibilityLabel={`แชตกลุ่ม ${title}${unread ? ' มีข้อความที่ยังไม่อ่าน' : ''}`}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)')
            : colors.canvas,
        },
      ]}
    >
      <IosLikeAvatar
        cacheScope={`group:${group.id}`}
        color={colors.primarySoft}
        icon="person.3.fill"
        size={62}
        uri={group.avatarUri || null}
      />
      <View style={styles.copy}>
        <View style={styles.heading}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.ink }, unread && styles.unreadName]}>
          {title}
        </Text>
        <Text style={[styles.time, { color: colors.inkMuted }]}>{formatInboxTimestamp(group.lastMessageAt)}</Text>
        </View>
        <View style={styles.previewRow}>
        <Text numberOfLines={1} style={[styles.detail, { color: unread ? colors.ink : colors.inkMuted }, unread && styles.unreadPreview]}>
          {detail}
        </Text>
        {unread ? <View accessibilityLabel="มีข้อความที่ยังไม่อ่าน" style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function GroupChatInboxStatus({ inbox }) {
  const { colors } = useTheme();
  if (inbox.loading || inbox.loadingMore) return <ActivityIndicator style={styles.status} color={colors.primary} />;
  if (inbox.error) return <View style={styles.status}><Text style={{ color: colors.danger }}>โหลดแชตกลุ่มไม่สำเร็จ</Text>
    <Pressable accessibilityRole="button" onPress={inbox.retry}><Text style={{ color: colors.primary }}>ลองใหม่</Text></Pressable></View>;
  if (inbox.hasMore) return <Pressable accessibilityRole="button" style={styles.status} onPress={inbox.loadMore}><Text style={{ color: colors.primary }}>โหลดแชตกลุ่มเพิ่มเติม</Text></Pressable>;
  return null;
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', gap: 14, marginVertical: 3, paddingHorizontal: 8, paddingVertical: 10 },
  copy: { flex: 1, minWidth: 0, paddingRight: spacing.xs, justifyContent: 'center' },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  time: { fontSize: 11, flexShrink: 0 },
  unreadDot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, minWidth: 0, fontSize: type.headline, fontWeight: '700' },
  unreadName: { fontWeight: '800' },
  detail: { flex: 1, minWidth: 0, fontSize: type.caption },
  unreadPreview: { fontWeight: '700' },
  status: { padding: 16, alignItems: 'center', gap: 8 },
});
