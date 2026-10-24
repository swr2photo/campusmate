import { Pressable } from './NativePressable';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

// Keep status separate from cached rows: a failed refresh must not hide history.
function SyncNotice({ colors, empty, retry }) {
  return <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', backgroundColor: colors.surfaceContainerLow || colors.card,
    borderRadius: 18, flexDirection: 'row', gap: 12, marginHorizontal: 12, marginVertical: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
    <View style={{ alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }}>
      <FeatureIcon color={colors.accentText || colors.primary} name="arrow.triangle.2.circlepath" size={17} />
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>กำลังเชื่อมต่อแชตใหม่</Text>
      <Text style={{ color: colors.inkMuted, fontSize: 13, lineHeight: 18 }}>
        {empty ? 'ระบบจะลองโหลดให้อัตโนมัติ ไม่ต้องทำอะไรเพิ่ม' : 'แชตที่บันทึกไว้ยังอยู่ครบ ข้อความใหม่จะขึ้นเองเมื่อเชื่อมต่อได้'}
      </Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="ลองเชื่อมต่อแชตตอนนี้" hitSlop={6} onPress={retry}
      style={{ justifyContent: 'center', minHeight: 44, paddingHorizontal: 6 }}>
      <Text style={{ color: colors.accentText || colors.primary, fontWeight: '700' }}>ลองตอนนี้</Text>
    </Pressable>
  </View>;
}

export default function ConversationInboxStatus({ inbox, retry, groupRetry, empty = false, filtered = false, groupLoading = false, groupError = null }) {
  const { colors } = useTheme();
  const { isConversationsLoading: loading, conversationsError: error,
    conversationsOnline: online, conversationsNetworkReady: networkReady } = inbox;
  let title, detail;
  if (networkReady && !online) {
    title = 'ออฟไลน์';
    detail = empty ? 'ยังโหลดแชตไม่ได้ จะลองใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต' : 'แสดงแชตที่บันทึกไว้ จะอัปเดตเมื่อเชื่อมต่ออินเทอร์เน็ต';
  } else if (error || groupError) {
    // One calm notice for both lists: the inbox keeps retrying by itself and
    // cached rows stay visible above it.
    return <SyncNotice colors={colors} empty={empty} retry={() => { retry?.(); groupRetry?.(); }} />;
  } else if (empty && (loading || groupLoading || !networkReady)) {
    return <View accessible accessibilityRole="progressbar" accessibilityLabel="กำลังโหลดแชต" style={{ padding: 24, alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.inkMuted }}>กำลังโหลดแชต…</Text>
    </View>;
  } else if (empty) {
    title = filtered ? 'ไม่พบข้อความ' : 'ยังไม่มีแชต';
    detail = filtered ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'เมื่อคุณรับคำขอถูกใจหรือเข้าร่วมตี้ ห้องสนทนาจะปรากฏที่นี่';
  } else return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 24, alignItems: 'center', gap: 8 }}>
    <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
    <Text style={{ color: colors.inkMuted, textAlign: 'center' }}>{detail}</Text>
  </View>;
}
