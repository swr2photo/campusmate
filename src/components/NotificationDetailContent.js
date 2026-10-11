import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AppText from './AppText';
import { PrimaryButton } from './ui';
import { useTheme } from '../theme';
import { timestampMillis } from '../services/notificationInboxService';

export default function NotificationDetailContent({ notification, onClose, actionLabel, onAction }) {
  const { colors, isDark } = useTheme();
  const { height } = useWindowDimensions();
  const timestamp = timestampMillis(notification?.createdAt);
  return (
    <View style={{ padding: 24, gap: 18, backgroundColor: 'transparent' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: isDark ? 'rgba(40, 105, 199, 0.22)' : 'rgba(40, 105, 199, 0.12)',
            borderWidth: 1,
            borderColor: isDark ? 'rgba(40, 105, 199, 0.35)' : 'rgba(40, 105, 199, 0.2)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="bell" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <AppText style={{ color: colors.inkMuted, fontSize: 12 }}>รายละเอียดแจ้งเตือน</AppText>
          <AppText style={{ color: colors.inkMuted, fontSize: 12 }}>
            {timestamp
              ? new Date(timestamp).toLocaleString('th-TH', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'แจ้งเตือนใหม่'}
          </AppText>
        </View>
        <Pressable
          accessibilityLabel="ปิดรายละเอียดแจ้งเตือน"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            {
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.08)',
              alignItems: 'center',
              justifyContent: 'center',
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather color={colors.ink} name="x" size={18} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
        showsVerticalScrollIndicator
        style={{ flexGrow: 0, maxHeight: height * 0.45 }}
      >
        <AppText selectable style={{ fontSize: 22, lineHeight: 32, fontWeight: '700', color: colors.ink }}>
          {notification?.title}
        </AppText>
        <AppText selectable style={{ fontSize: 15, lineHeight: 26, color: colors.inkMuted }}>
          {notification?.body}
        </AppText>
      </ScrollView>
      {actionLabel ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [
          {
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
          },
          pressed && { opacity: 0.75, transform: [{ scale: 0.985 }] },
        ]}
      >
        <AppText style={{ color: colors.ink, fontWeight: '600', fontSize: 15 }}>อ่านแล้ว · ปิด</AppText>
      </Pressable>
    </View>
  );
}
