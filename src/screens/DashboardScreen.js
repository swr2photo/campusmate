import React from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useApp } from '../context/AppContext';
import { Avatar, SectionTitle } from '../components/ui';
import FeatureIcon from '../components/FeatureIcon';
import { radius, shadow, spacing, type, useTheme } from '../theme';

const QUICK_ACTIONS = [
  { id: 'discover', icon: '✦', label: 'จับคู่เพื่อน', hint: 'ค้นหาคนที่ใช่' },
  { id: 'chat', icon: '◌', label: 'แชตของฉัน', hint: 'คุยต่อได้เลย' },
  { id: 'meetup', icon: '⌖', label: 'สถานที่ใกล้ตัว', hint: 'วางแผนนัดพบ' },
];

export default function DashboardScreen({ onNavigate, onOpenProfile }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const {
    availableProfiles,
    campusSpots,
    conversations,
    matchedProfileIds,
    pendingIncomingLikes,
    profile,
    selectedMeetup,
  } = useApp();

  const nextCandidate = availableProfiles[0];
  const visibleSpots = campusSpots.slice(0, 3);
  const unreadCount = conversations.reduce((sum, item) => sum + (item.unread || 0), 0);
  const displayName = profile.nickname || profile.name || 'เพื่อน';

  const colorScheme = useColorScheme();
  const blurTint = colorScheme === 'dark' ? 'dark' : 'light';
  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.canvas, colors.canvas + '00']} style={[styles.topBar, { zIndex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }]}>
        <View style={styles.topCopy}>
          <Text style={styles.title}>สวัสดี {displayName}</Text>
          <Text style={styles.subtitle}>พื้นที่เล็ก ๆ สำหรับหาเพื่อนที่ชอบทำกิจกรรมเหมือนกัน</Text>
        </View>
        <Pressable 
          accessibilityLabel="เปิดโปรไฟล์และการตั้งค่า"
          accessibilityRole="button"
          onPress={onOpenProfile}
          style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
        >
          {profile.avatarUri ? (
            <Image source={{ uri: profile.avatarUri }} style={{ width: 48, height: 48, borderRadius: 24 }} />
          ) : (
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.line, justifyContent: 'center', alignItems: 'center' }}>
              <SymbolView name="person.fill" size={28} tintColor={colors.inkSoft} />
            </View>
          )}
        </Pressable>
      </LinearGradient>
      <FlatList
        data={visibleSpots}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingTop: spacing.md }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <View style={{ paddingTop: 80 }}>
            <View style={styles.heroCard}>
              <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>แนะนำสำหรับวันนี้</Text></View>
              <Text style={styles.heroTitle}>เริ่มจากกิจกรรมที่คุณอยากทำ</Text>
              <Text style={styles.heroText}>เลือกความสนใจ แล้วให้ CampusMate ช่วยหาเพื่อนที่เข้ากันได้</Text>
              <Pressable
                accessibilityLabel="เริ่มค้นหาเพื่อน"
                accessibilityRole="button"
                onPress={() => onNavigate('discover')}
                style={({ pressed }) => [styles.heroAction, pressed && styles.pressed]}
              >
                <Text style={styles.heroActionText}>เริ่มค้นหาเพื่อน</Text>
                <Text style={styles.heroActionArrow}>→</Text>
              </Pressable>
            </View>

            {pendingIncomingLikes.length > 0 && (
              <Pressable
                accessibilityLabel="ดูคนที่กดถูกใจคุณ"
                accessibilityRole="button"
                onPress={() => onNavigate('likes')}
                style={({ pressed }) => [styles.likesNotice, pressed && styles.pressed]}
              >
                <View style={styles.likesNoticeIcon}><FeatureIcon color={colors.coral} name="heart.fill" size={23} /></View>
                <View style={styles.likesNoticeCopy}>
                  <Text style={styles.likesNoticeTitle}>{pendingIncomingLikes.length} คนกดถูกใจคุณ</Text>
                  <Text style={styles.likesNoticeText}>ลองเข้าไปดูโปรไฟล์ แล้วเลือกว่าจะรับเป็นเพื่อนหรือไม่</Text>
                </View>
                <FeatureIcon color={colors.coral} name="chevron.right" size={18} />
              </Pressable>
            )}

            <SectionTitle
              title="ทางลัดของคุณ"
              subtitle="กลับไปทำสิ่งที่ใช้บ่อยได้ในแตะเดียว"
              />
            <View style={styles.quickRow}>
              {QUICK_ACTIONS.map((action) => (
                <Pressable
                  accessibilityLabel={action.label}
                  accessibilityRole="button"
                  key={action.id}
                  onPress={() => onNavigate(action.id)}
                  style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
                >
                  <View style={styles.quickIcon}><Text style={styles.quickIconText}>{action.icon}</Text></View>
                  <Text style={styles.quickLabel}>{action.label}</Text>
                  <Text style={styles.quickHint}>{action.hint}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              accessibilityLabel="เปิดรายละเอียดนัดหมาย"
              accessibilityRole="button"
              onPress={() => onNavigate('meetup')}
              style={({ pressed }) => [styles.nextCard, pressed && styles.pressed]}
            >
              <View style={styles.nextIcon}><Text style={styles.nextIconText}>⌖</Text></View>
              <View style={styles.nextCopy}>
                <Text style={styles.nextEyebrow}>{selectedMeetup ? 'นัดหมายที่เลือกไว้' : 'สิ่งที่ทำต่อได้'}</Text>
                <Text numberOfLines={1} style={styles.nextTitle}>
                  {selectedMeetup?.name || 'เลือกสถานที่สำหรับนัดพบเพื่อน'}
                </Text>
                <Text numberOfLines={1} style={styles.nextMeta}>
                  {selectedMeetup?.scheduledAt || 'ดูสถานที่ปลอดภัยใกล้มหาวิทยาลัย'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>

            <View style={styles.statsRow}>
              <Stat label="เพื่อนที่จับคู่แล้ว" styles={styles} value={Math.max(matchedProfileIds.length || 0, conversations.length || 0)} />
              <Stat label="บทสนทนา" styles={styles} value={conversations.length} />
              <Stat label="ข้อความใหม่" styles={styles} value={unreadCount} />
            </View>

            <SectionTitle
              title="เพื่อนที่น่าจะเข้ากับคุณ"
              subtitle="ดูโปรไฟล์แนะนำล่าสุด"
              action="ดูทั้งหมด"
              onAction={() => onNavigate('discover')}
            />
            <Pressable
              accessibilityLabel="เปิดหน้าค้นหาเพื่อน"
              accessibilityRole="button"
              onPress={() => onNavigate('discover')}
              style={({ pressed }) => [styles.candidateCard, pressed && styles.pressed]}
            >
              {nextCandidate ? (
                <>
                  <Avatar color={nextCandidate.avatarColor} emoji={nextCandidate.avatar} online size={54} />
                  <View style={styles.candidateCopy}>
                    <Text numberOfLines={1} style={styles.candidateName}>{nextCandidate.name}</Text>
                    <Text numberOfLines={1} style={styles.candidateMeta}>{nextCandidate.activityLabel}</Text>
                    <View style={styles.compatibilityPill}><Text style={styles.compatibilityText}>เข้ากันได้ {nextCandidate.compatibility}%</Text></View>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </>
              ) : (
                <Text style={styles.emptyCandidate}>โปรไฟล์ใหม่จะแสดงที่นี่เมื่อมีคนเข้าร่วม</Text>
              )}
            </Pressable>

            <SectionTitle
              title="สถานที่น่าไปใกล้คุณ"
              subtitle="เลือกสถานที่เพื่อดูรายละเอียดและนัดหมาย"
              action="ดูทั้งหมด"
              onAction={() => onNavigate('meetup')}
            />
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`เปิดรายละเอียด ${item.name}`}
            accessibilityRole="button"
            onPress={() => onNavigate('meetup')}
            style={({ pressed }) => [styles.spotCard, pressed && styles.pressed]}
          >
            <View style={[styles.spotIcon, { backgroundColor: item.category === 'running' ? colors.coralSoft : item.category === 'study' ? colors.blueSoft : colors.greenSoft }]}>
              <Text style={styles.spotEmoji}>{item.emoji}</Text>
            </View>
            <View style={styles.spotCopy}>
              <Text numberOfLines={1} style={styles.spotName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.spotMeta}>{item.distance} · {item.rating} ★</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.emptyCandidate}>ยังไม่มีสถานที่แนะนำ</Text>}
      />
    </View>
  );
}

function Stat({ value, label, styles }) {
  const { colors } = useTheme();
  const activeStyles = styles || getStyles(colors);
  return (
    <View style={activeStyles.stat}>
      <Text style={activeStyles.statValue}>{value}</Text>
      <Text numberOfLines={2} style={activeStyles.statLabel}>{label}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  topBar: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xl },
  topCopy: { flex: 1, paddingRight: spacing.md },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.3, marginBottom: spacing.sm },
  title: { color: colors.ink, fontSize: type.title, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 18, marginTop: 5 },
  profileButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.pill, borderWidth: 1, height: 56, justifyContent: 'center', width: 56, ...shadow.card },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, marginBottom: spacing.xl, overflow: 'hidden', padding: spacing.xl },
  heroBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.pill, marginBottom: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  heroBadgeText: { color: colors.card, fontSize: type.micro, fontWeight: '900' },
  heroTitle: { color: colors.card, fontSize: 22, fontWeight: '900', lineHeight: 28 },
  heroText: { color: 'rgba(255,255,255,0.84)', fontSize: type.body, lineHeight: 20, marginTop: spacing.sm, maxWidth: 300 },
  heroAction: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.card, borderRadius: radius.pill, flexDirection: 'row', marginTop: spacing.lg, minHeight: 44, paddingHorizontal: spacing.lg },
  heroActionText: { color: colors.primaryDark, fontSize: type.caption, fontWeight: '900' },
  heroActionArrow: { color: colors.primaryDark, fontSize: 20, fontWeight: '900', marginLeft: spacing.sm },
  likesNotice: { alignItems: 'center', backgroundColor: colors.coralSoft, borderColor: colors.coralSoft, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.xl, padding: spacing.md },
  likesNoticeIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 21, height: 42, justifyContent: 'center', marginRight: spacing.md, width: 42 },
  likesNoticeCopy: { flex: 1 },
  likesNoticeTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  likesNoticeText: { color: colors.inkMuted, fontSize: type.micro, lineHeight: 16, marginTop: 3 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
  quickAction: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, minHeight: 112, padding: spacing.md, width: '31.5%', ...shadow.card },
  quickIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 14, height: 34, justifyContent: 'center', marginBottom: spacing.sm, width: 34 },
  quickIconText: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  quickLabel: { color: colors.ink, fontSize: type.caption, fontWeight: '900' },
  quickHint: { color: colors.inkSoft, fontSize: 10, lineHeight: 14, marginTop: 3 },
  nextCard: { alignItems: 'center', backgroundColor: colors.greenSoft, borderColor: colors.greenSoft, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.xl, padding: spacing.md },
  nextIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 18, height: 44, justifyContent: 'center', marginRight: spacing.md, width: 44 },
  nextIconText: { color: colors.green, fontSize: 24, fontWeight: '900' },
  nextCopy: { flex: 1 },
  nextEyebrow: { color: colors.green, fontSize: type.micro, fontWeight: '900' },
  nextTitle: { color: colors.ink, fontSize: type.caption, fontWeight: '900', marginTop: 3 },
  nextMeta: { color: colors.inkMuted, fontSize: type.micro, marginTop: 3 },
  chevron: { color: colors.primary, fontSize: 28, fontWeight: '300', marginLeft: spacing.sm },
  statsRow: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.xl, paddingVertical: spacing.md, ...shadow.card },
  stat: { alignItems: 'center', flex: 1, paddingHorizontal: spacing.sm },
  statValue: { color: colors.primary, fontSize: type.section, fontWeight: '900' },
  statLabel: { color: colors.inkMuted, fontSize: 10, lineHeight: 13, marginTop: 3, textAlign: 'center' },
  candidateCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.xl, padding: spacing.md, ...shadow.card },
  candidateCopy: { flex: 1, marginLeft: spacing.md },
  candidateName: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  candidateMeta: { color: colors.inkMuted, fontSize: type.caption, marginTop: 3 },
  compatibilityPill: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.pill, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4 },
  compatibilityText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  emptyCandidate: { color: colors.inkMuted, flex: 1, fontSize: type.caption, lineHeight: 18 },
  spotCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.md, ...shadow.card },
  spotIcon: { alignItems: 'center', borderRadius: 14, height: 46, justifyContent: 'center', marginRight: spacing.md, width: 46 },
  spotEmoji: { fontSize: 24 },
  spotCopy: { flex: 1 },
  spotName: { color: colors.ink, fontSize: type.caption, fontWeight: '900' },
  spotMeta: { color: colors.inkMuted, fontSize: type.micro, marginTop: 4 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
