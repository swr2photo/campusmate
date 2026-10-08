import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AppText from './AppText';
import { useNotificationInbox } from '../context/NotificationInboxContext';
import { useTheme } from '../theme';

export default function NotificationBell() {
  const { count } = useNotificationInbox(), { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`แจ้งเตือน${count ? ` ยังไม่อ่าน ${count} รายการ` : ''}`} onPress={() => router.push('/notifications')} style={styles.button}>
    <Feather name="bell" size={22} color={colors.ink} />
    {count > 0 && <View style={[styles.badge, { backgroundColor: colors.primary }]}><AppText style={styles.text}>{count > 99 ? '99+' : count}</AppText></View>}
  </Pressable>;
}
const styles = StyleSheet.create({ button: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, badge: { position: 'absolute', right: 0, top: 0, borderRadius: 12, minWidth: 18, paddingHorizontal: 4, alignItems: 'center' }, text: { color: '#FFFFFF', fontSize: 10, lineHeight: 18, fontWeight: '600' } });
