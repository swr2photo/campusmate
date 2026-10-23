import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import Text from './AppText';
import React, { useMemo } from 'react';
import { Image, Modal, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { radius, shadow, spacing, type, useTheme } from '../theme';
import { useRemoteImage } from '../utils/useRemoteImage';
import { getMessageReactionEntries } from '../utils/messageReactions';
import { GlassBackground, GlassIconButton, useLiquidGlass, useSheetGlassTint } from './LiquidGlassSurface';

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const milliseconds = value < 1e11 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  if (typeof value.seconds === 'number') {
    const date = new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value._seconds === 'number') {
    const date = new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatReactionTime(value) {
  const date = toDate(value);
  if (!date) return 'ยังไม่ทราบเวลา';
  return date.toLocaleString('th-TH', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
    hour12: false,
  });
}

function getReactionEntries(item, profiles, currentUserId) {
  const reactionTimes = item?.reactionTimes || {};
  const fallbackTime = item?.updatedAt || item?.createdAt || item?.time;

  return getMessageReactionEntries(item?.reactions)
    .map(({ userId, emoji }) => {
      const profile = profiles?.[userId] || {};
      return {
        emoji,
        profile,
        reactedAt: reactionTimes[userId] || fallbackTime,
        userId,
        name: profile.name || profile.nickname || (userId === currentUserId ? 'คุณ' : 'ผู้ใช้ CampusMate'),
      };
    })
    .sort((first, second) => {
      const firstDate = toDate(first.reactedAt)?.getTime() || 0;
      const secondDate = toDate(second.reactedAt)?.getTime() || 0;
      return secondDate - firstDate;
    });
}

function ReactionAvatar({ profile, userId, colors }) {
  const avatar = profile?.avatarUri || profile?.avatar;
  const isImage = typeof avatar === 'string'
    && (avatar.startsWith('http') || avatar.startsWith('file://') || avatar.startsWith('data:'));
  const remoteUri = useRemoteImage(isImage ? avatar : null, profile?.avatarRevision, userId);
  const avatarEmoji = !isImage && typeof avatar === 'string' && avatar.length <= 8 ? avatar : null;

  return (
    <View style={[styles.avatar, { backgroundColor: profile?.avatarColor || colors.primarySoft }]}>
      {remoteUri ? (
        <Image source={{ uri: remoteUri }} style={styles.avatarImage} />
      ) : avatarEmoji ? (
        <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
      ) : (
        <FeatureIcon color={colors.inkSoft} name="person.fill" size={22} />
      )}
    </View>
  );
}

export default function ReactionDetailsModal({
  currentUserId,
  item,
  onClose,
  onOpenProfile,
  profiles,
  visible,
}) {
  const { colors } = useTheme();
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();
  const entries = useMemo(
    () => getReactionEntries(item, profiles, currentUserId),
    [currentUserId, item, profiles]
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="ปิดรายละเอียดรีแอค" onPress={onClose} style={StyleSheet.absoluteFill} />
        <NativeCard style={[styles.sheet, glass
          ? { backgroundColor: 'transparent', borderColor: 'transparent' }
          : { backgroundColor: colors.card, borderColor: colors.line }]}>
          <GlassBackground style={{ borderRadius: radius.xl }} tintColor={glassTint} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.ink }]}>รีแอคของข้อความ</Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>{entries.length} คน</Text>
            </View>
            <GlassIconButton
              accessibilityLabel="ปิดรายละเอียดรีแอค"
              hitSlop={8}
              icon="xmark"
              iconColor={colors.inkMuted}
              iconSize={16}
              onPress={onClose}
              size={40}
            />
          </View>

          {entries.length ? entries.map((entry) => {
            const profile = entry.profile || {};
            return (
              <Pressable
                accessibilityLabel={`ดูโปรไฟล์ ${entry.name}`}
                accessibilityRole="button"
                key={entry.userId}
                onPress={() => onOpenProfile?.(entry.userId)}
                style={({ pressed }) => [styles.profileRow, { backgroundColor: colors.surfaceRaised }, pressed && styles.pressed]}
              >
                <ReactionAvatar colors={colors} profile={profile} userId={entry.userId} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.profileName, { color: colors.ink }]}>{entry.name}</Text>
                  <Text numberOfLines={1} style={[styles.reactionMeta, { color: colors.inkMuted }]}>{entry.emoji} · {formatReactionTime(entry.reactedAt)}</Text>
                </View>
                <FeatureIcon color={colors.inkSoft} name="chevron.right" size={16} />
              </Pressable>
            );
          }) : (
            <Text style={[styles.emptyText, { color: colors.inkMuted }]}>ยังไม่มีข้อมูลรีแอค</Text>
          )}

          {entries.length ? (
            <Text style={[styles.hint, { color: colors.inkSoft }]}>แตะแถวเพื่อดูโปรไฟล์</Text>
          ) : null}
        </NativeCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  sheet: {
    borderRadius: radius.xl,
    borderWidth: 1,
    maxHeight: '66%',
    padding: spacing.md,
    width: '100%',
    ...shadow.card,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  headerCopy: { flex: 1 },
  title: { fontSize: type.h3, fontWeight: '800' },
  subtitle: { fontSize: type.caption, marginTop: 2 },
  profileRow: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', marginTop: spacing.xs, minHeight: 54, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  avatar: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', overflow: 'hidden', width: 40 },
  avatarImage: { height: 40, width: 40 },
  avatarEmoji: { fontSize: 20 },
  rowCopy: { flex: 1, marginLeft: spacing.sm, minWidth: 0 },
  profileName: { fontSize: type.bodySmall, fontWeight: '800' },
  reactionMeta: { fontSize: type.caption2, marginTop: 2 },
  hint: { fontSize: type.caption2, marginTop: spacing.sm, textAlign: 'center' },
  emptyText: { fontSize: type.bodySmall, paddingVertical: spacing.lg, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
