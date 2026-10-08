import Text from './AppText';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import FeatureIcon from './FeatureIcon';
import { radius, spacing, useTheme } from '../theme';

export function GroupChatRow({ group }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`แชตกลุ่ม ${group.title || ''}${group.unread ? ' มีข้อความที่ยังไม่อ่าน' : ''}`}
    onPress={() => router.push({ pathname: '/group-chat', params: { partyId: group.id } })}
    style={[styles.row, { backgroundColor: colors.card, borderColor: colors.line }]}>
    <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}><FeatureIcon name="person.3.fill" size={22} color={colors.primary} /></View>
    <View style={styles.copy}><Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>{group.title || 'แชตกลุ่มของตี้'}</Text>
      <Text style={[styles.detail, { color: colors.inkMuted }]}>{group.memberCount || group.memberIds?.length || 0} สมาชิก · {group.lastMessageType === 'image' ? 'รูปภาพ' : group.lastMessageAt ? 'ข้อความเข้ารหัส' : 'เริ่มสนทนาได้แล้ว'}</Text></View>
    {group.unread ? <View accessibilityLabel="ยังไม่อ่าน" style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
    <FeatureIcon name="chevron.right" size={16} color={colors.inkSoft} />
  </Pressable>;
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
  row: { marginVertical: 5, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', gap: 11, alignItems: 'center' },
  iconWrap: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 }, name: { fontSize: 14, fontWeight: '800' }, detail: { fontSize: 12, marginTop: 3 },
  dot: { width: 9, height: 9, borderRadius: 5 }, status: { padding: 16, alignItems: 'center', gap: 8 },
});
