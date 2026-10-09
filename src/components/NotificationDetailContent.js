import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AppText from './AppText';
import { PrimaryButton } from './ui';
import { useTheme } from '../theme';
import { timestampMillis } from '../services/notificationInboxService';

export default function NotificationDetailContent({ notification, onClose, actionLabel, onAction }) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const timestamp = timestampMillis(notification?.createdAt);
  return <View style={{ padding: 24, gap: 18, backgroundColor: colors.card }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Feather name="bell" size={22} color={colors.primary} /></View>
      <View style={{ flex: 1, gap: 3 }}><AppText style={{ color: colors.inkMuted, fontSize: 12 }}>รายละเอียดแจ้งเตือน</AppText><AppText style={{ color: colors.inkMuted, fontSize: 12 }}>{timestamp ? new Date(timestamp).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'แจ้งเตือนใหม่'}</AppText></View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="ปิดรายละเอียดแจ้งเตือน" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}><Feather name="x" size={20} color={colors.ink} /></Pressable>
    </View>
    <ScrollView style={{ flexGrow: 0, maxHeight: height * 0.45 }} contentContainerStyle={{ gap: 12, paddingBottom: 4 }} showsVerticalScrollIndicator>
      <AppText selectable style={{ fontSize: 22, lineHeight: 32, fontWeight: '700', color: colors.ink }}>{notification?.title}</AppText>
      <AppText selectable style={{ fontSize: 15, lineHeight: 26, color: colors.inkMuted }}>{notification?.body}</AppText>
    </ScrollView>
    {actionLabel ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
    <Pressable onPress={onClose} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.surfaceRaised }}><AppText style={{ color: colors.ink, fontWeight: '600' }}>อ่านแล้ว · ปิด</AppText></Pressable>
  </View>;
}
