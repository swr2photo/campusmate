import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Text from './AppText';
import { useTheme } from '../theme';

// Keep status separate from cached rows: a failed refresh must not hide history.
export default function ConversationInboxStatus({ inbox, retry, empty = false, filtered = false, groupLoading = false, groupError = null }) {
  const { colors } = useTheme();
  const { isConversationsLoading: loading, conversationsError: error,
    conversationsOnline: online, conversationsNetworkReady: networkReady } = inbox;
  let title, detail;
  if (networkReady && !online) {
    title = 'ออฟไลน์';
    detail = empty ? 'ยังโหลดแชตไม่ได้ จะลองใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต' : 'แสดงแชตที่บันทึกไว้ จะอัปเดตเมื่อเชื่อมต่ออินเทอร์เน็ต';
  } else if (error) {
    title = 'โหลดแชตคู่ไม่สำเร็จ';
    detail = 'ประวัติแชตที่บันทึกไว้ยังอยู่ กรุณาลองอีกครั้ง';
  } else if (empty && (loading || groupLoading || !networkReady)) {
    return <View accessible accessibilityRole="progressbar" accessibilityLabel="กำลังโหลดแชต" style={{ padding: 24, alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.inkMuted }}>กำลังโหลดแชต…</Text>
    </View>;
  } else if (empty && groupError) {
    // The group's existing footer owns its error and retry action.
    return null;
  } else if (empty) {
    title = filtered ? 'ไม่พบข้อความ' : 'ยังไม่มีแชต';
    detail = filtered ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'เมื่อคุณรับคำขอถูกใจหรือเข้าร่วมตี้ ห้องสนทนาจะปรากฏที่นี่';
  } else return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 24, alignItems: 'center', gap: 8 }}>
    <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
    <Text style={{ color: colors.inkMuted, textAlign: 'center' }}>{detail}</Text>
    {error && online ? <Pressable accessibilityRole="button" accessibilityLabel="ลองโหลดแชตคู่อีกครั้ง" onPress={retry}
      style={{ minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 16 }}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>ลองใหม่</Text>
    </Pressable> : null}
  </View>;
}
