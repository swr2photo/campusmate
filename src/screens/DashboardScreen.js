import Text from '../components/AppText';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAppAppointments, useAppBadges, useAppProfile } from '../context/AppContext';
import { IosLikeAvatar, IosLikeCard, IosLikeScreen, IosLikeSectionTitle } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { radius, shadow, spacing, type, useTheme } from '../theme';

const SHORTCUTS = [
  { id: 'likes', title: 'ถูกใจ & จับคู่', hint: 'ดูคนที่ถูกใจคุณ คำขอที่ส่งไป และคู่ที่จับคู่แล้ว', icon: 'heart.fill', colorKey: 'coral' },
  { id: 'discover', title: 'ค้นหาเพื่อน', hint: 'ค้นหาคนที่ชอบกิจกรรมเหมือนกัน', icon: 'person.2.fill', colorKey: 'violet' },
  { id: 'chat', title: 'แชตของฉัน', hint: 'กลับไปคุยกับเพื่อนที่จับคู่แล้ว', icon: 'message.fill', colorKey: 'blue' },
  { id: 'meetup', title: 'จุดนัดหมาย', hint: 'เลือกสถานที่นัดพบที่สะดวกและปลอดภัย', icon: 'mappin.and.ellipse', colorKey: 'mint' },
  { id: 'appointments', title: 'ประวัติการนัด', hint: 'ดูวันเวลาและรายละเอียดนัดหมายกับแต่ละคน', icon: 'calendar.badge.clock', colorKey: 'coral' },
];

export default function DashboardScreen({ onNavigate, onOpenProfile }) {
  const { colors } = useTheme();
  const { appointments = [] } = useAppAppointments();
  const { conversationCount = 0, matchedCount: matchedProfileCount = 0, pendingLikeCount = 0, totalUnreadMessages = 0 } = useAppBadges();
  const { profile } = useAppProfile();
  const unreadCount = totalUnreadMessages;
  const matchedCount = Math.max(matchedProfileCount, conversationCount);
  const displayName = profile?.name || profile?.nickname || 'เพื่อน';
  const activeAppointmentCount = appointments.filter((appointment) => appointment.status === 'active').length;

  return (
    <IosLikeScreen>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <View style={styles.headerCopy}>
          <Text style={[styles.greeting, { color: colors.ink }]}>สวัสดี {displayName}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="เปิดโปรไฟล์" accessibilityRole="button" onPress={onOpenProfile} style={({ pressed }) => [pressed && styles.pressed]}>
            <IosLikeAvatar cacheScope={profile?.id} cacheVersion={profile?.avatarRevision} color={colors.primarySoft} emoji={profile?.avatar} size={44} uri={profile?.avatarUri} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <IosLikeSectionTitle
          subtitle="เลือกสิ่งที่คุณอยากทำต่อ"
          title="เมนูทางลัด"
        />

        <View style={styles.shortcutGrid}>
          {SHORTCUTS.map((shortcut) => (
            <ShortcutCard
              badge={shortcut.id === 'likes'
                ? pendingLikeCount
                : shortcut.id === 'chat'
                  ? unreadCount
                  : shortcut.id === 'appointments'
                    ? activeAppointmentCount
                    : 0}
              colors={colors}
              key={shortcut.id}
              onPress={() => onNavigate(shortcut.id)}
              shortcut={shortcut}
            />
          ))}
        </View>

        <MatchStatsCard
          conversationsCount={conversationCount}
          matchedCount={matchedCount}
          pendingCount={pendingLikeCount}
          unreadCount={unreadCount}
        />
      </ScrollView>
    </IosLikeScreen>
  );
}

function ShortcutCard({ badge, colors, onPress, shortcut }) {
  const accent = colors[shortcut.colorKey] || colors.primary;
  const soft = colors[`${shortcut.colorKey}Soft`] || colors.primarySoft;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.shortcutCardWrapper, pressed && styles.pressed]}>
      <IosLikeCard style={styles.shortcutCard}>
        <View style={styles.shortcutTopRow}>
          <View style={[styles.shortcutIcon, { backgroundColor: soft }]}>
            <FeatureIcon color={accent} name={shortcut.icon} size={23} />
          </View>
          {badge > 0 ? <Text style={[styles.badge, { backgroundColor: soft, color: accent }]}>{badge > 99 ? '99+' : badge}</Text> : null}
        </View>
        <Text numberOfLines={1} style={[styles.shortcutTitle, { color: colors.ink }]}>{shortcut.title}</Text>
        <Text numberOfLines={2} style={[styles.shortcutHint, { color: colors.inkMuted }]}>{shortcut.hint}</Text>
      </IosLikeCard>
    </Pressable>
  );
}

function MatchStatsCard({ conversationsCount, matchedCount, pendingCount, unreadCount }) {
  const { colors } = useTheme();
  const activeRate = matchedCount > 0 ? Math.min(100, Math.round((conversationsCount / matchedCount) * 100)) : 0;
  const waitingCount = Math.max(0, matchedCount - conversationsCount);
  const stats = [
    { label: 'แมตช์', value: matchedCount, color: colors.violet },
    { label: 'รอตอบรับ', value: pendingCount, color: colors.coral },
    { label: 'ห้องแชต', value: conversationsCount, color: colors.blue },
    { label: 'ยังไม่อ่าน', value: unreadCount, color: colors.mint },
  ];
  const insight = matchedCount === 0
    ? 'เริ่มค้นหาเพื่อนเพื่อสร้างแมตช์แรกของคุณ'
    : activeRate >= 75
      ? 'แมตช์ส่วนใหญ่เริ่มบทสนทนาแล้ว'
      : `ยังมี ${waitingCount} แมตช์ที่รอเริ่มบทสนทนา`;

  return (
    <IosLikeCard style={styles.statsCard}>
      <View style={styles.statsHeader}>
        <View style={styles.statsCopy}>
          <Text style={[styles.statsTitle, { color: colors.ink }]}>สถิติแมตช์</Text>
        </View>
        <View style={styles.totalWrap}>
          <Text style={[styles.totalValue, { color: colors.primary }]}>{matchedCount}</Text>
          <Text style={[styles.totalLabel, { color: colors.inkMuted }]}>แมตช์แล้ว</Text>
        </View>
      </View>

      <HalfDonutChart activeRate={activeRate} colors={colors} />

      <View style={styles.legendGrid}>
        {stats.map((stat) => <StatLegend key={stat.label} {...stat} />)}
      </View>

      <View style={[styles.insight, { backgroundColor: colors.surfaceRaised }]}>
        <FeatureIcon color={colors.primary} name="sparkles" size={16} />
        <Text style={[styles.insightText, { color: colors.inkMuted }]}>{insight} · อัตราเริ่มแชต {activeRate}%</Text>
      </View>
    </IosLikeCard>
  );
}

function HalfDonutChart({ activeRate, colors }) {
  const segmentCount = 25;
  const activeSegments = Math.round((activeRate / 100) * segmentCount);
  const centerX = 110;
  const centerY = 105;
  const radiusValue = 82;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const angle = 180 - (index * 180) / (segmentCount - 1);
    const radians = (angle * Math.PI) / 180;
    return {
      angle,
      index,
      left: centerX + radiusValue * Math.cos(radians) - 6,
      top: centerY - radiusValue * Math.sin(radians) - 11,
    };
  });

  return (
    <View accessibilityLabel={`อัตราเริ่มแชต ${activeRate}%`} style={styles.donutChart}>
      {segments.map((segment) => (
        <View
          key={segment.index}
          style={[
            styles.donutSegment,
            {
              backgroundColor: segment.index < activeSegments ? colors.primary : colors.surfaceRaised,
              left: segment.left,
              top: segment.top,
              transform: [{ rotate: `${90 - segment.angle}deg` }],
            },
          ]}
        />
      ))}
      <View style={styles.donutCenter}>
        <Text style={[styles.donutValue, { color: colors.ink }]}>{activeRate}%</Text>
        <Text style={[styles.donutLabel, { color: colors.inkMuted }]}>เริ่มแชตแล้ว</Text>
      </View>
    </View>
  );
}

function StatLegend({ color, label, value }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.legendItem, { backgroundColor: colors.surfaceRaised }]}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.legendLabel, { color: colors.inkMuted }]}>{label}</Text>
      <Text style={[styles.legendValue, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 106, paddingHorizontal: spacing.lg, paddingTop: 38, paddingBottom: spacing.md },
  headerCopy: { flex: 1, paddingRight: spacing.md },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  greeting: { fontSize: type.title1, fontWeight: '800', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: type.caption, lineHeight: 18, marginTop: 5 },
  content: { gap: spacing.xl, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'space-between' },
  shortcutCardWrapper: { width: '47.8%' },
  shortcutCard: { minHeight: 164, padding: spacing.lg, width: '100%' },
  shortcutTopRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', minHeight: 50 },
  shortcutIcon: { alignItems: 'center', borderRadius: radius.pill, height: 48, justifyContent: 'center', width: 48 },
  badge: { borderRadius: radius.pill, fontSize: type.caption2, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5 },
  shortcutTitle: { fontSize: type.headline, fontWeight: '800', marginTop: spacing.md },
  shortcutHint: { fontSize: type.caption, lineHeight: 17, marginTop: 4 },
  statsCard: { padding: spacing.lg },
  statsHeader: { alignItems: 'flex-start', flexDirection: 'row' },
  statsCopy: { flex: 1, paddingRight: spacing.sm },
  statsTitle: { fontSize: type.headline, fontWeight: '800' },
  statsSubtitle: { fontSize: type.caption, marginTop: 4 },
  totalWrap: { alignItems: 'flex-end' },
  totalValue: { fontSize: type.title, fontWeight: '800' },
  totalLabel: { fontSize: type.caption2, fontWeight: '600', marginTop: 1 },
  donutChart: { alignSelf: 'center', height: 124, marginTop: spacing.lg, position: 'relative', width: 220 },
  donutSegment: { borderRadius: 6, height: 22, position: 'absolute', width: 12 },
  donutCenter: { alignItems: 'center', bottom: 0, left: 45, position: 'absolute', right: 45 },
  donutValue: { fontSize: type.title, fontWeight: '800' },
  donutLabel: { fontSize: type.caption2, fontWeight: '600', marginTop: 1 },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  legendItem: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', minHeight: 36, paddingHorizontal: spacing.sm, width: '48%' },
  legendDot: { borderRadius: 4, height: 8, marginRight: 6, width: 8 },
  legendLabel: { flex: 1, fontSize: type.caption2, fontWeight: '600' },
  legendValue: { fontSize: type.caption, fontWeight: '800' },
  insight: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  insightText: { flex: 1, fontSize: type.caption, lineHeight: 17 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
