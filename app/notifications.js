import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppText from '../src/components/AppText';
import FeatureIcon from '../src/components/FeatureIcon';
import { OutlineButton, PrimaryButton } from '../src/components/ui';
import useNotificationsPage from '../src/hooks/useNotificationsPage';
import { timestampMillis } from '../src/services/notificationInboxService';
import { ANNOUNCEMENT_ROUTES, fullDateLabel, kindFor, timeLabel, TODO_SECTION, withAlpha } from '../src/utils/notificationDisplay';
import { radius, spacing, useTheme } from '../src/theme';

const softFill = color => withAlpha(color, 0.12);

// iOS renders notifications.ios.js (SwiftUI); this page serves Android.
export default function NotificationsRoute() {
  const { colors, isDark } = useTheme(), insets = useSafeAreaInsets();
  const { inbox, face, sections, unreadOnly, setUnreadOnly, detail, detailOpen, busy, open, closeDetail, startFace, openRoute, canStartFace, allRead, loadMore } = useNotificationsPage();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const now = Date.now();

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

  const detailKind = kindFor(detail?.type), detailTint = colors[detailKind.tint], detailMillis = timestampMillis(detail?.createdAt);
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
    <Modal visible={detailOpen} transparent animationType="fade" onRequestClose={closeDetail}>
      <View style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel="ปิด" onPress={closeDetail} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetIcon, { backgroundColor: softFill(detailTint) }]}><FeatureIcon name={detailKind.icon} size={26} color={detailTint} /></View>
              <View style={styles.copy}>
                <AppText style={[styles.sheetKind, { color: detailTint }]}>{detailKind.label}</AppText>
                {detailMillis ? <AppText style={styles.time}>{fullDateLabel(detailMillis)}</AppText> : null}
              </View>
            </View>
            <AppText style={styles.sheetTitle}>{detail?.title}</AppText>
            <AppText style={styles.sheetBody}>{detail?.body}</AppText>
          </ScrollView>
          <View style={styles.sheetActions}>
            {canStartFace(detail) ? <PrimaryButton iconName="person.crop.circle.badge.checkmark" label="เริ่มยืนยันใบหน้า" onPress={() => startFace(detail)} /> : null}
            {detail?.type === 'admin_announcement' && ANNOUNCEMENT_ROUTES.includes(detail?.target?.route) ? <PrimaryButton label="เปิดหน้าที่เกี่ยวข้อง" onPress={() => openRoute(detail.target.route)} /> : null}
            <OutlineButton label="ปิด" onPress={closeDetail} />
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
    rowUnread: { backgroundColor: withAlpha(c.primary, isDark ? 0.14 : 0.06) },
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
