import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AppText from '../src/components/AppText';
import NotificationDetail from '../src/components/NotificationDetail';
import LiquidGlassView from '../src/components/LiquidGlassView';
import { useNotificationInbox } from '../src/context/NotificationInboxContext';
import { useFaceVerificationFlow } from '../src/components/FaceVerificationPrompt';
import { inboxTargetAvailable, timestampMillis } from '../src/services/notificationInboxService';
import { showAlert } from '../src/utils/appAlert';
import { useTheme } from '../src/theme';

const iconFor = type => type === 'face_verification' ? 'shield' : type === 'like' || type === 'match' ? 'heart' : type.includes('message') ? 'message-circle' : type.includes('party') ? 'users' : type === 'appointment' ? 'calendar' : 'bell';

export default function NotificationsRoute() {
  const { colors, isDark } = useTheme(), inbox = useNotificationInbox(), face = useFaceVerificationFlow();
  const [unread, setUnread] = useState(false), [detail, setDetail] = useState(null), [busy, setBusy] = useState(false);
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const rows = inbox.rows.filter(row => !unread || !row.readAt);
  const report = () => showAlert('ยังเปิดรายการไม่ได้', 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', { tone: 'danger' });
  const open = async row => {
    try {
      if (!row.readAt) void inbox.markRead(row.id).catch(report);
      if (row.type === 'face_verification' || row.type === 'admin_announcement' || row.type === 'system') { setDetail(row); return; }
      if (!await inboxTargetAvailable(row, inbox.uid)) { showAlert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'ข้อมูลอาจถูกลบ หรือคุณไม่มีสิทธิ์เปิดรายการนี้', { tone: 'warning' }); return; }
      const target = row.target || {};
      if (target.conversationId) router.push({ pathname: '/chat-room', params: { chatId: target.conversationId } });
      else if (row.type === 'group_message' && target.partyId) router.push({ pathname: '/group-chat', params: { partyId: target.partyId } });
      else if (target.partyId) router.push({ pathname: '/party-finder', params: { partyId: target.partyId } });
      else if (target.appointmentId) router.push('/appointments');
      else if (row.type === 'like') router.push('/likes');
      else setDetail(row);
    } catch (error) {
      if (String(error.code).includes('permission-denied') || String(error.code).includes('not-found')) showAlert('รายการนี้ไม่พร้อมใช้งานแล้ว', 'คุณไม่มีสิทธิ์เปิดรายการนี้ หรือข้อมูลถูกลบแล้ว', { tone: 'warning' });
      else report();
    }
  };
  const allRead = async () => { setBusy(true); try { await inbox.markAll(); } catch { report(); } finally { setBusy(false); } };
  const dayLabel = row => { if (row.type === 'face_verification' && row.status === 'required') return 'สิ่งที่ต้องทำ'; const millis = timestampMillis(row.createdAt); return millis ? new Date(millis).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : 'กำลังบันทึก'; };
  const detailLive = detail ? inbox.rows.find(row => row.id === detail.id) || detail : null;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'แจ้งเตือน',
          headerRight: () => (
            <Pressable disabled={busy || !inbox.count} onPress={allRead} style={styles.headerAction}>
              <AppText style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
                {busy ? 'กำลังบันทึก…' : 'อ่านทั้งหมด'}
              </AppText>
            </Pressable>
          ),
        }}
      />
      <View style={styles.tabsContainer}>
        <LiquidGlassView glassEffectStyle="clear" style={styles.tabsGlass}>
          {[{ label: 'ทั้งหมด', value: false }, { label: 'ยังไม่อ่าน', value: true }].map(tab => (
            <Pressable
              key={tab.label}
              onPress={() => setUnread(tab.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: unread === tab.value }}
              style={[styles.tab, unread === tab.value && styles.tabActive]}
            >
              <AppText
                style={{
                  color: unread === tab.value ? (isDark ? '#FFFFFF' : '#0B1424') : colors.inkMuted,
                  fontWeight: unread === tab.value ? '700' : '500',
                  fontSize: 14,
                }}
              >
                {tab.label}
              </AppText>
            </Pressable>
          ))}
        </LiquidGlassView>
      </View>
      {inbox.offline && <AppText style={styles.note}>กำลังแสดงข้อมูลที่บันทึกไว้ เชื่อมต่ออินเทอร์เน็ตเพื่ออัปเดต</AppText>}
      {inbox.error && <Pressable onPress={inbox.retry} style={styles.headerAction}><AppText style={styles.note}>อัปเดตไม่สำเร็จ · แตะเพื่อลองอีกครั้ง</AppText></Pressable>}
      <FlatList
        data={rows}
        keyExtractor={row => row.id}
        contentContainerStyle={styles.list}
        onEndReached={() => { if (inbox.hasMore && !inbox.loadingMore) inbox.loadMore().catch(report); }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <View style={styles.empty}>
            {inbox.loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Feather name="bell" size={32} color={colors.inkMuted} />
                <AppText style={styles.emptyTitle}>{unread ? (inbox.hasMore ? 'ยังไม่มีรายการที่ยังไม่อ่านในประวัติที่โหลดไว้' : 'อ่านครบแล้ว') : 'ยังไม่มีแจ้งเตือน'}</AppText>
                <AppText style={styles.note}>{unread && inbox.hasMore ? 'โหลดเพิ่มเติมเพื่อตรวจรายการก่อนหน้า' : 'แจ้งเตือนใหม่และประวัติย้อนหลังจะอยู่ที่นี่'}</AppText>
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {inbox.loadingMore ? <ActivityIndicator color={colors.primary} /> : inbox.hasMore ? <Pressable onPress={() => inbox.loadMore().catch(report)} style={styles.headerAction}><AppText style={{ color: colors.primary }}>โหลดเพิ่มเติม</AppText></Pressable> : <AppText style={styles.note}>เก็บประวัติย้อนหลัง 90 วัน</AppText>}
          </View>
        }
        renderItem={({ item, index }) => (
          <View>
            {index === 0 || dayLabel(item) !== dayLabel(rows[index - 1]) ? (
              <AppText style={styles.day}>{dayLabel(item)}</AppText>
            ) : null}
            <LiquidGlassView
              glassEffectStyle="regular"
              style={[
                styles.rowGlass,
                !item.readAt && {
                  borderColor: isDark ? 'rgba(40, 105, 199, 0.45)' : 'rgba(40, 105, 199, 0.35)',
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => open(item)}
                style={styles.rowPressable}
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: !item.readAt
                        ? isDark ? 'rgba(40, 105, 199, 0.22)' : 'rgba(40, 105, 199, 0.12)'
                        : isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                    },
                  ]}
                >
                  <Feather
                    name={iconFor(item.type)}
                    size={20}
                    color={!item.readAt ? colors.primary : colors.ink}
                  />
                </View>
                <View style={styles.copy}>
                  <AppText style={[styles.title, !item.readAt && { fontWeight: '700' }]}>
                    {item.title}
                  </AppText>
                  <AppText style={styles.body} numberOfLines={2}>
                    {item.body}
                  </AppText>
                  <AppText style={styles.time}>
                    {timestampMillis(item.createdAt)
                      ? new Date(timestampMillis(item.createdAt)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                    {item.status === 'completed' ? ' · สำเร็จแล้ว' : ''}
                  </AppText>
                </View>
                {!item.readAt && (
                  <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                )}
              </Pressable>
            </LiquidGlassView>
          </View>
        )}
      />
      <NotificationDetail
        notification={detailLive}
        onClose={() => setDetail(null)}
        actionLabel={
          detailLive?.type === 'face_verification' && face.required && detailLive?.status !== 'completed'
            ? 'เริ่มยืนยันใบหน้า'
            : detailLive?.type === 'admin_announcement' && ['/home', '/discover', '/meetup', '/me', '/chat'].includes(detailLive?.target?.route)
            ? 'เปิดหน้าที่เกี่ยวข้อง'
            : null
        }
        onAction={() => {
          setDetail(null);
          if (detailLive?.type === 'face_verification') face.start();
          else router.push(detailLive.target.route);
        }}
      />
      {face.modal}
    </View>
  );
}

function createStyles(c, isDark) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.canvas },
    tabsContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    tabsGlass: {
      flexDirection: 'row',
      borderRadius: 16,
      borderCurve: 'continuous',
      padding: 4,
    },
    tab: {
      flex: 1,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderCurve: 'continuous',
    },
    tabActive: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.85)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    list: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
    rowGlass: {
      borderRadius: 20,
      borderCurve: 'continuous',
      marginBottom: 10,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
    rowPressable: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      padding: 16,
    },
    icon: {
      width: 42,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)',
    },
    copy: { flex: 1, minWidth: 0, gap: 4 },
    title: { fontSize: 15, fontWeight: '600', color: c.ink },
    body: { fontSize: 14, lineHeight: 22, color: c.inkMuted },
    time: { fontSize: 12, color: c.inkMuted },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
    day: { fontSize: 13, fontWeight: '700', color: c.inkMuted, marginTop: 14, marginBottom: 8, marginLeft: 4 },
    note: { color: c.inkMuted, fontSize: 12, textAlign: 'center', padding: 12 },
    empty: { alignItems: 'center', paddingVertical: 72, gap: 16 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: c.ink },
    footer: { padding: 20, alignItems: 'center' },
    headerAction: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  });
}
