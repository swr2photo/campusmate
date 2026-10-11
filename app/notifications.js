import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppText from '../src/components/AppText';
import FeatureIcon from '../src/components/FeatureIcon';
import { OutlineButton, PrimaryButton } from '../src/components/ui';
import { useNotificationInbox } from '../src/context/NotificationInboxContext';
import { useFaceVerificationFlow } from '../src/components/FaceVerificationPrompt';
import { inboxTargetAvailable, timestampMillis } from '../src/services/notificationInboxService';
import { radius, spacing, useTheme } from '../src/theme';

const DAY_MS = 86400000;
const TODO_SECTION = 'สิ่งที่ต้องทำ';
const ANNOUNCEMENT_ROUTES = ['/home', '/discover', '/meetup', '/me', '/chat'];

// Icon, theme tint and short label for each inbox type.
function kindFor(type) {
  const value = String(type || '');
  if (value === 'face_verification') return { icon: 'person.crop.circle.badge.checkmark', tint: 'primary', label: 'ยืนยันตัวตน' };
  if (value === 'like') return { icon: 'heart.fill', tint: 'coral', label: 'ถูกใจ' };
  if (value === 'match') return { icon: 'heart.circle.fill', tint: 'coral', label: 'จับคู่สำเร็จ' };
  if (value === 'incoming_call') return { icon: 'phone.fill', tint: 'green', label: 'สายเรียกเข้า' };
  if (value === 'group_message') return { icon: 'bubble.left.and.bubble.right.fill', tint: 'blue', label: 'แชตกลุ่ม' };
  if (value.includes('message')) return { icon: 'bubble.left.fill', tint: 'blue', label: 'ข้อความ' };
  if (value.includes('party')) return { icon: 'person.3.fill', tint: 'amber', label: 'ตี้' };
  if (value === 'appointment') return { icon: 'calendar.badge.clock', tint: 'mint', label: 'นัดหมาย' };
  if (value === 'admin_announcement') return { icon: 'bell.badge.fill', tint: 'primary', label: 'ประกาศจาก CampusMate' };
  return { icon: 'bell.fill', tint: 'inkMuted', label: 'CampusMate' };
}
// Theme tints are 6-digit hex, so a 12% alpha suffix gives a soft fill in both modes.
const softFill = color => `${color}1F`;
const startOfDay = millis => { const day = new Date(millis); day.setHours(0, 0, 0, 0); return day.getTime(); };
const isTodo = row => row.type === 'face_verification' && row.status === 'required';

function sectionTitle(row, today) {
  if (isTodo(row)) return TODO_SECTION;
  const millis = timestampMillis(row.createdAt);
  const days = millis ? Math.round((today - startOfDay(millis)) / DAY_MS) : 0;
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (days < 7) return new Date(millis).toLocaleDateString('th-TH', { weekday: 'long' });
  return new Date(millis).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}
function timeLabel(millis, now) {
  const minutes = Math.floor((now - millis) / 60000);
  if (!millis || minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 360 && startOfDay(millis) === startOfDay(now)) return `${Math.floor(minutes / 60)} ชม.`;
  return `${new Date(millis).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
}

export default function NotificationsRoute() {
  const { colors, isDark } = useTheme(), inbox = useNotificationInbox(), face = useFaceVerificationFlow(), insets = useSafeAreaInsets();
  const [unreadOnly, setUnreadOnly] = useState(false), [detail, setDetail] = useState(null), [busy, setBusy] = useState(false);
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const now = Date.now();
  // Rows arrive newest first, so consecutive grouping yields one section per day.
  const sections = useMemo(() => {
    const today = startOfDay(Date.now()), out = [];
    for (const row of inbox.rows) {
      if (unreadOnly && row.readAt) continue;
      const title = sectionTitle(row, today), last = out.at(-1);
      if (last?.title === title) last.data.push(row); else out.push({ key: `${out.length}:${title}`, title, data: [row] });
    }
    return out;
  }, [inbox.rows, unreadOnly]);

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
  const startFace = row => {
    if (!row.readAt) void inbox.markRead(row.id).catch(report);
    setDetail(null); face.start();
  };
  const allRead = async () => { setBusy(true); try { await inbox.markAll(); } catch { report(); } finally { setBusy(false); } };
  const loadMore = () => { if (inbox.hasMore && !inbox.loadingMore) inbox.loadMore().catch(report); };
  const detailLive = detail ? inbox.rows.find(row => row.id === detail.id) || detail : null;
  const canStartFace = row => row?.type === 'face_verification' && face.required && row.status !== 'completed';

  const renderItem = ({ item, index, section }) => {
    const kind = kindFor(item.type), tint = colors[kind.tint], unread = !item.readAt;
    if (section.title === TODO_SECTION) {
      return <View style={styles.todo}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} ${item.body || ''}`} onPress={() => open(item)} style={({ pressed }) => [styles.todoHeader, pressed && styles.pressed]}>
          <View style={[styles.todoIcon, { backgroundColor: tint }]}><FeatureIcon name={kind.icon} size={22} color={colors.onPrimary} /></View>
          <View style={styles.copy}>
            <AppText style={styles.todoTitle} numberOfLines={2}>{item.title}</AppText>
            <AppText style={styles.body} numberOfLines={3}>{item.body}</AppText>
          </View>
        </Pressable>
        {canStartFace(item) ? <PrimaryButton compact iconName="person.crop.circle.badge.checkmark" label="เริ่มยืนยันใบหน้า" onPress={() => startFace(item)} /> : null}
      </View>;
    }
    const first = index === 0, last = index === section.data.length - 1;
    return <View style={[styles.slice, first && styles.sliceFirst, last && styles.sliceLast]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${unread ? 'ยังไม่อ่าน ' : ''}${kind.label} ${item.title} ${item.body || ''}`}
        onPress={() => open(item)} style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.rowPressed]}>
        <View style={[styles.icon, { backgroundColor: softFill(tint) }]}><FeatureIcon name={kind.icon} size={20} color={tint} /></View>
        <View style={styles.copy}>
          <View style={styles.meta}>
            <AppText style={[styles.kind, { color: tint }]} numberOfLines={1}>{kind.label}</AppText>
            <AppText style={styles.time}>{timeLabel(timestampMillis(item.createdAt), now)}</AppText>
            {unread ? <View style={styles.dot} /> : null}
          </View>
          <AppText style={[styles.title, unread && styles.titleUnread]} numberOfLines={2}>{item.title}</AppText>
          {item.body ? <AppText style={styles.body} numberOfLines={2}>{item.body}</AppText> : null}
          {item.status === 'completed' ? <View style={styles.doneChip}><FeatureIcon name="checkmark.circle.fill" size={12} color={colors.green} /><AppText style={styles.doneText}>สำเร็จแล้ว</AppText></View> : null}
        </View>
      </Pressable>
      {last ? null : <View style={styles.separator} />}
    </View>;
  };

  const detailKind = kindFor(detailLive?.type), detailTint = colors[detailKind.tint], detailMillis = timestampMillis(detailLive?.createdAt);
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: 'แจ้งเตือน', headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว" disabled={busy || !inbox.count} onPress={allRead} hitSlop={8} style={styles.headerAction}>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <AppText style={[styles.headerActionText, { color: inbox.count ? colors.primary : colors.inkSoft }]}>อ่านทั้งหมด</AppText>}
    </Pressable> }} />
    <View accessibilityRole="tablist" style={styles.segment}>
      {[{ label: 'ทั้งหมด', value: false }, { label: 'ยังไม่อ่าน', value: true, count: inbox.count }].map(tab => {
        const active = unreadOnly === tab.value;
        return <Pressable key={tab.label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setUnreadOnly(tab.value)} style={[styles.segmentItem, active && styles.segmentItemActive]}>
          <AppText style={[styles.segmentText, active && styles.segmentTextActive]}>{tab.label}</AppText>
          {tab.count ? <View style={styles.badge}><AppText style={styles.badgeText}>{tab.count > 99 ? '99+' : tab.count}</AppText></View> : null}
        </Pressable>;
      })}
    </View>
    {inbox.offline ? <View style={[styles.banner, { backgroundColor: colors.amberSoft }]}>
      <FeatureIcon name="wifi.slash" size={16} color={colors.amber} />
      <AppText style={styles.bannerText}>กำลังแสดงข้อมูลที่บันทึกไว้ เชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดต</AppText>
    </View> : null}
    {inbox.error ? <Pressable accessibilityRole="button" onPress={inbox.retry} style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
      <FeatureIcon name="exclamationmark.triangle.fill" size={16} color={colors.danger} />
      <AppText style={styles.bannerText}>อัปเดตไม่สำเร็จ</AppText>
      <AppText style={[styles.bannerAction, { color: colors.danger }]}>ลองอีกครั้ง</AppText>
    </Pressable> : null}
    <SectionList sections={sections} keyExtractor={row => row.id} renderItem={renderItem} stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.list} onEndReached={loadMore} onEndReachedThreshold={0.4}
      renderSectionHeader={({ section }) => <AppText style={[styles.sectionTitle, section.title === TODO_SECTION && { color: colors.primary }]}>{section.title}</AppText>}
      ListEmptyComponent={<View style={styles.empty}>{inbox.loading ? <><ActivityIndicator color={colors.primary} /><AppText style={styles.emptyText}>กำลังโหลดแจ้งเตือน…</AppText></> : <>
        <View style={[styles.emptyIcon, { backgroundColor: softFill(unreadOnly ? colors.green : colors.primary) }]}>
          <FeatureIcon name={unreadOnly ? 'checkmark.circle.fill' : 'bell.fill'} size={34} color={unreadOnly ? colors.green : colors.primary} />
        </View>
        <AppText style={styles.emptyTitle}>{unreadOnly ? 'อ่านครบแล้ว' : 'ยังไม่มีแจ้งเตือน'}</AppText>
        <AppText style={styles.emptyText}>{unreadOnly ? 'ไม่มีแจ้งเตือนที่ยังไม่ได้อ่าน' : 'เมื่อมีคนถูกใจ ส่งข้อความ หรือมีความเคลื่อนไหวของตี้และนัดหมาย จะแสดงที่นี่'}</AppText>
        {unreadOnly ? <Pressable accessibilityRole="button" onPress={() => setUnreadOnly(false)} style={styles.headerAction}><AppText style={styles.link}>ดูแจ้งเตือนทั้งหมด</AppText></Pressable> : null}
      </>}</View>}
      ListFooterComponent={sections.length ? <View style={styles.footer}>{inbox.loadingMore ? <ActivityIndicator color={colors.primary} /> : inbox.hasMore
        ? <Pressable accessibilityRole="button" onPress={loadMore} style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}><AppText style={styles.link}>โหลดเพิ่มเติม</AppText></Pressable>
        : <View style={styles.footerNote}><FeatureIcon name="clock.fill" size={13} color={colors.inkSoft} /><AppText style={styles.footerText}>เก็บประวัติย้อนหลัง 90 วัน</AppText></View>}</View> : null} />
    <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
      <View style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel="ปิด" onPress={() => setDetail(null)} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetIcon, { backgroundColor: softFill(detailTint) }]}><FeatureIcon name={detailKind.icon} size={26} color={detailTint} /></View>
              <View style={styles.copy}>
                <AppText style={[styles.sheetKind, { color: detailTint }]}>{detailKind.label}</AppText>
                {detailMillis ? <AppText style={styles.time}>{new Date(detailMillis).toLocaleString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</AppText> : null}
              </View>
            </View>
            <AppText style={styles.sheetTitle}>{detailLive?.title}</AppText>
            <AppText style={styles.sheetBody}>{detailLive?.body}</AppText>
          </ScrollView>
          <View style={styles.sheetActions}>
            {canStartFace(detailLive) ? <PrimaryButton iconName="person.crop.circle.badge.checkmark" label="เริ่มยืนยันใบหน้า" onPress={() => startFace(detailLive)} /> : null}
            {detailLive?.type === 'admin_announcement' && ANNOUNCEMENT_ROUTES.includes(detailLive?.target?.route) ? <PrimaryButton label="เปิดหน้าที่เกี่ยวข้อง" onPress={() => { setDetail(null); router.push(detailLive.target.route); }} /> : null}
            <OutlineButton label="ปิด" onPress={() => setDetail(null)} />
          </View>
        </View>
      </View>
    </Modal>{face.modal}
  </View>;
}

function createStyles(c, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.canvas },
    headerAction: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
    headerActionText: { fontSize: 14, fontWeight: '600' },
    segment: { flexDirection: 'row', marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm, padding: 3, borderRadius: radius.md, backgroundColor: c.surfaceRaised },
    segmentItem: { flex: 1, minHeight: 38, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm + 2 },
    segmentItemActive: { backgroundColor: isDark ? c.line : c.card, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 1 },
    segmentText: { fontSize: 14, fontWeight: '600', color: c.inkMuted },
    segmentTextActive: { color: c.ink },
    badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.coral },
    badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700', color: '#FFFFFF' },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginTop: spacing.xs, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md },
    bannerText: { flex: 1, fontSize: 13, color: c.ink },
    bannerAction: { fontSize: 13, fontWeight: '700' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: c.inkMuted, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
    todo: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: softFill(c.primary), backgroundColor: c.primarySoft },
    todoHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    todoIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    todoTitle: { fontSize: 16, fontWeight: '700', color: c.ink },
    slice: { backgroundColor: c.card, overflow: 'hidden' },
    sliceFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
    sliceLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: 14, paddingVertical: 13 },
    rowUnread: { backgroundColor: `${c.primary}${isDark ? '24' : '0F'}` },
    rowPressed: { backgroundColor: c.surfaceRaised },
    separator: { position: 'absolute', left: 70, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: c.line },
    icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minWidth: 0, gap: 3 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    kind: { flex: 1, fontSize: 12, fontWeight: '700' },
    time: { fontSize: 12, color: c.inkSoft },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary },
    title: { fontSize: 15, fontWeight: '500', color: c.ink },
    titleUnread: { fontWeight: '700' },
    body: { fontSize: 14, lineHeight: 21, color: c.inkMuted },
    doneChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: softFill(c.green) },
    doneText: { fontSize: 12, fontWeight: '600', color: c.green },
    pressed: { opacity: 0.7 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 72, paddingHorizontal: spacing.xl, gap: spacing.md },
    emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: c.ink },
    emptyText: { fontSize: 14, lineHeight: 21, color: c.inkMuted, textAlign: 'center', maxWidth: 300 },
    link: { fontSize: 14, fontWeight: '600', color: c.primary },
    footer: { paddingTop: spacing.xl, alignItems: 'center' },
    loadMore: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.line },
    footerNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    footerText: { fontSize: 12, color: c.inkSoft },
    scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,20,22,0.45)' },
    sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '85%', backgroundColor: c.card, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, borderCurve: 'continuous' },
    handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: c.line },
    sheetContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    sheetIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    sheetKind: { fontSize: 13, fontWeight: '700' },
    sheetTitle: { fontSize: 20, fontWeight: '700', color: c.ink },
    sheetBody: { fontSize: 15, lineHeight: 24, color: c.inkMuted },
    sheetActions: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  });
}
