import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AppText from '../src/components/AppText';
import { PrimaryButton } from '../src/components/ui';
import { useNotificationInbox } from '../src/context/NotificationInboxContext';
import { useFaceVerificationFlow } from '../src/components/FaceVerificationPrompt';
import { inboxTargetAvailable, timestampMillis } from '../src/services/notificationInboxService';
import { useTheme } from '../src/theme';

const iconFor = type => type === 'face_verification' ? 'shield' : type === 'like' || type === 'match' ? 'heart' : type.includes('message') ? 'message-circle' : type.includes('party') ? 'users' : type === 'appointment' ? 'calendar' : 'bell';
export default function NotificationsRoute() {
  const { colors } = useTheme(), inbox = useNotificationInbox(), face = useFaceVerificationFlow();
  const [unread, setUnread] = useState(false), [detail, setDetail] = useState(null), [busy, setBusy] = useState(false);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rows = inbox.rows.filter(row => !unread || !row.readAt);
  const report = () => Alert.alert('ยังเปิดรายการไม่ได้', 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง');
  const open = async row => {
    try {
      if (!row.readAt) void inbox.markRead(row.id).catch(report);
      if (row.type === 'face_verification' || row.type === 'admin_announcement' || row.type === 'system') { setDetail(row); return; }
      if (!await inboxTargetAvailable(row, inbox.uid)) { Alert.alert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'ข้อมูลอาจถูกลบ หรือคุณไม่มีสิทธิ์เปิดรายการนี้'); return; }
      const target = row.target || {};
      if (target.conversationId) router.push({ pathname: '/chat-room', params: { chatId: target.conversationId } });
      else if (row.type === 'group_message' && target.partyId) router.push({ pathname: '/group-chat', params: { partyId: target.partyId } });
      else if (target.partyId) router.push({ pathname: '/party-finder', params: { partyId: target.partyId } });
      else if (target.appointmentId) router.push('/appointments');
      else if (row.type === 'like') router.push('/likes');
      else setDetail(row);
    } catch (error) {
      if (String(error.code).includes('permission-denied') || String(error.code).includes('not-found')) Alert.alert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'คุณไม่มีสิทธิ์เปิดรายการนี้ หรือข้อมูลถูกลบแล้ว');
      else report();
    }
  };
  const allRead = async () => { setBusy(true); try { await inbox.markAll(); } catch { report(); } finally { setBusy(false); } };
  const dayLabel = row => { if (row.type === 'face_verification' && row.status === 'required') return 'สิ่งที่ต้องทำ'; const millis = timestampMillis(row.createdAt); return millis ? new Date(millis).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : 'กำลังบันทึก'; };
  const detailLive = detail ? inbox.rows.find(row => row.id === detail.id) || detail : null;
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: 'แจ้งเตือน', headerRight: () => <Pressable disabled={busy || !inbox.count} onPress={allRead} style={styles.headerAction}><AppText style={{ color: colors.primary, fontSize: 13 }}>{busy ? 'กำลังบันทึก…' : 'อ่านทั้งหมด'}</AppText></Pressable> }} />
    <View style={styles.tabs}>{[{ label: 'ทั้งหมด', value: false }, { label: 'ยังไม่อ่าน', value: true }].map(tab => <Pressable key={tab.label} onPress={() => setUnread(tab.value)} accessibilityRole="tab" accessibilityState={{ selected: unread === tab.value }} style={[styles.tab, unread === tab.value && { backgroundColor: colors.ink }]}><AppText style={{ color: unread === tab.value ? colors.card : colors.inkMuted }}>{tab.label}</AppText></Pressable>)}</View>
    {inbox.offline && <AppText style={styles.note}>กำลังแสดงข้อมูลที่บันทึกไว้ เชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดต</AppText>}
    {inbox.error && <Pressable onPress={inbox.retry} style={styles.headerAction}><AppText style={styles.note}>อัปเดตไม่สำเร็จ · แตะเพื่อลองอีกครั้ง</AppText></Pressable>}
    <FlatList data={rows} keyExtractor={row => row.id} contentContainerStyle={styles.list} onEndReached={() => { if (inbox.hasMore && !inbox.loadingMore) inbox.loadMore().catch(report); }} onEndReachedThreshold={0.4}
      ListEmptyComponent={<View style={styles.empty}>{inbox.loading ? <ActivityIndicator color={colors.primary} /> : <><Feather name="bell" size={32} color={colors.inkMuted} /><AppText style={styles.title}>{unread ? 'อ่านครบแล้ว' : 'ยังไม่มีแจ้งเตือน'}</AppText><AppText style={styles.note}>แจ้งเตือนใหม่และประวัติย้อนหลังจะอยู่ที่นี่</AppText></>}</View>}
      ListFooterComponent={<View style={styles.footer}>{inbox.loadingMore ? <ActivityIndicator color={colors.primary} /> : inbox.hasMore ? <Pressable onPress={() => inbox.loadMore().catch(report)} style={styles.headerAction}><AppText style={{ color: colors.primary }}>โหลดเพิ่มเติม</AppText></Pressable> : <AppText style={styles.note}>เก็บประวัติย้อนหลัง 90 วัน</AppText>}</View>}
      renderItem={({ item, index }) => <View>{index === 0 || dayLabel(item) !== dayLabel(rows[index - 1]) ? <AppText style={styles.day}>{dayLabel(item)}</AppText> : null}<Pressable accessibilityRole="button" onPress={() => open(item)} style={[styles.row, !item.readAt && { backgroundColor: colors.surfaceRaised }]}>
        <View style={styles.icon}><Feather name={iconFor(item.type)} size={21} color={colors.ink} /></View><View style={styles.copy}><AppText style={styles.title}>{item.title}</AppText><AppText style={styles.body} numberOfLines={2}>{item.body}</AppText><AppText style={styles.time}>{timestampMillis(item.createdAt) ? new Date(timestampMillis(item.createdAt)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''}{item.status === 'completed' ? ' · สำเร็จแล้ว' : ''}</AppText></View>{!item.readAt && <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
      </Pressable></View>} />
    <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}><View style={styles.scrim}><ScrollView style={styles.detail} contentContainerStyle={{ padding: 24, gap: 20 }}><AppText style={styles.detailTitle}>{detailLive?.title}</AppText><AppText style={styles.body}>{detailLive?.body}</AppText>
      {detailLive?.type === 'face_verification' && face.required && detailLive?.status !== 'completed' && <PrimaryButton label="เริ่มยืนยันใบหน้า" onPress={() => { setDetail(null); face.start(); }} />}
      {detailLive?.type === 'admin_announcement' && ['/home', '/discover', '/meetup', '/me', '/chat'].includes(detailLive?.target?.route) && <PrimaryButton label="เปิดหน้าที่เกี่ยวข้อง" onPress={() => { setDetail(null); router.push(detailLive.target.route); }} />}
      <Pressable onPress={() => setDetail(null)} style={styles.headerAction}><AppText style={{ color: colors.ink }}>ปิด</AppText></Pressable></ScrollView></View></Modal>{face.modal}
  </View>;
}
function createStyles(c) { return StyleSheet.create({ screen: { flex: 1, backgroundColor: c.canvas }, tabs: { flexDirection: 'row', gap: 8, padding: 16 }, tab: { minHeight: 44, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 }, list: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 }, row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line, borderRadius: 12 }, icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderRadius: 12 }, copy: { flex: 1, minWidth: 0, gap: 5 }, title: { fontSize: 15, fontWeight: '600', color: c.ink }, body: { fontSize: 14, lineHeight: 23, color: c.inkMuted }, time: { fontSize: 12, color: c.inkMuted }, dot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 }, day: { fontSize: 12, fontWeight: '600', color: c.inkMuted, marginTop: 16, marginBottom: 8 }, note: { color: c.inkMuted, fontSize: 12, textAlign: 'center', padding: 12 }, empty: { alignItems: 'center', paddingVertical: 72, gap: 16 }, footer: { padding: 20, alignItems: 'center' }, headerAction: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' }, scrim: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(20,20,22,0.45)' }, detail: { width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: c.card, maxHeight: '85%', borderRadius: 20 }, detailTitle: { color: c.ink, fontSize: 20, fontWeight: '600' } }); }
