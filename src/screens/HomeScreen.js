import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ACTIVITY_CATEGORIES } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, PrimaryButton, SectionTitle } from '../components/ui';
import { colors, radius, shadow, spacing, type } from '../theme';

export default function HomeScreen({ onToast }) {
  const {
    availableProfiles,
    dismissProfile,
    matchProfile,
    profile,
    resetMatching,
  } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSmartFilters, setShowSmartFilters] = useState(false);
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [eveningOnly, setEveningOnly] = useState(false);

  const filteredProfiles = useMemo(() => availableProfiles.filter((candidate) => {
    if (selectedCategory !== 'all' && candidate.activity !== selectedCategory) return false;
    if (sameFacultyOnly && candidate.faculty !== profile.faculty) return false;
    if (eveningOnly && !candidate.availability.includes('17:') && !candidate.availability.includes('18:')) return false;
    return true;
  }), [availableProfiles, eveningOnly, profile.faculty, sameFacultyOnly, selectedCategory]);

  useEffect(() => setCurrentIndex(0), [eveningOnly, sameFacultyOnly, selectedCategory]);

  const currentProfile = filteredProfiles[currentIndex] || null;

  const selectCategory = (category) => {
    setSelectedCategory(category);
    setCurrentIndex(0);
  };

  const handleSkip = () => {
    if (!currentProfile) return;
    dismissProfile(currentProfile.id);
    setCurrentIndex(0);
    onToast?.('ข้ามโปรไฟล์แล้ว กำลังหาเพื่อนคนถัดไป', 'info');
  };

  const handleLike = () => {
    if (!currentProfile) return;
    matchProfile(currentProfile);
    setCurrentIndex(0);
    onToast?.(`จับคู่กับ ${currentProfile.name} แล้ว เริ่มแชทได้เลย`);
  };

  const header = (
    <View>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.eyebrow}>CampusMate / MATCH</Text>
          <Text style={styles.title}>สวัสดี {profile.nickname} 👋</Text>
          <Text style={styles.subtitle}>ค้นหาเพื่อนที่อยากทำกิจกรรมแบบเดียวกับคุณ</Text>
        </View>
        <View style={styles.psuBadge}><Text style={styles.psuBadgeText}>PSU</Text></View>
      </View>

      <View style={styles.sectionRow}>
        <SectionTitle title="กิจกรรมที่สนใจ" subtitle="เลือกหมวดหมู่เพื่อค้นหาให้ตรงใจ" />
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowSmartFilters((current) => !current)}
          style={[styles.filterButton, showSmartFilters && styles.filterButtonActive]}
        >
          <Text style={[styles.filterButtonIcon, showSmartFilters && styles.filterButtonIconActive]}>☷</Text>
          <Text style={[styles.filterButtonText, showSmartFilters && styles.filterButtonTextActive]}>ตัวกรอง</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        {ACTIVITY_CATEGORIES.map((category) => (
          <Chip
            key={category.id}
            active={selectedCategory === category.id}
            color={category.color}
            icon={category.icon}
            label={category.label}
            onPress={() => selectCategory(category.id)}
            style={styles.categoryChip}
          />
        ))}
      </ScrollView>

      {showSmartFilters && (
        <Card style={styles.filterPanel}>
          <Text style={styles.filterPanelTitle}>ปรับการจับคู่ให้เหมาะกับคุณ</Text>
          <Pressable onPress={() => setSameFacultyOnly((current) => !current)} style={styles.optionRow}>
            <View style={[styles.checkbox, sameFacultyOnly && styles.checkboxActive]}>
              {sameFacultyOnly && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>คณะเดียวกัน</Text>
              <Text style={styles.optionSubtitle}>แสดงเพื่อนจาก {profile.faculty}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setEveningOnly((current) => !current)} style={styles.optionRow}>
            <View style={[styles.checkbox, eveningOnly && styles.checkboxActive]}>
              {eveningOnly && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>ว่างช่วงเย็น</Text>
              <Text style={styles.optionSubtitle}>เหมาะกับกิจกรรมหลังเลิกเรียน</Text>
            </View>
          </Pressable>
        </Card>
      )}

      <View style={styles.resultHeader}>
        <Text style={styles.resultLabel}>{filteredProfiles.length} คนที่อาจเข้ากับคุณ</Text>
        <Text style={styles.resultHint}>เลื่อนดูทีละโปรไฟล์</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={currentProfile ? [currentProfile] : []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={(
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>🧭</Text>
            <Text style={styles.emptyTitle}>ยังไม่มีโปรไฟล์ที่ตรงกับตัวกรอง</Text>
            <Text style={styles.emptyText}>ลองเปลี่ยนหมวดหมู่ หรือล้างรายการที่ข้ามไว้เพื่อเริ่มค้นหาใหม่</Text>
            <OutlineButton
              label="เริ่มค้นหาใหม่"
              onPress={() => {
                resetMatching();
                setSelectedCategory('all');
                setSameFacultyOnly(false);
                setEveningOnly(false);
                setCurrentIndex(0);
              }}
              style={styles.emptyButton}
            />
          </Card>
        )}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View>
            <Card style={styles.profileCard}>
              <View style={[styles.profileHero, { backgroundColor: item.avatarColor }]}>
                <View style={styles.heroTopRow}>
                  <View style={styles.matchPill}><Text style={styles.matchPillText}>เหมาะกับคุณ {item.compatibility}%</Text></View>
                  <Text style={styles.heroLabel}>CAMPUSMATE</Text>
                </View>
                <Avatar color="rgba(255,255,255,0.72)" emoji={item.avatar} size={112} online />
                <View style={styles.activityPill}>
                  <Text style={styles.activityPillIcon}>{ACTIVITY_CATEGORIES.find((category) => category.id === item.activity)?.icon}</Text>
                  <Text style={styles.activityPillText}>{item.activityLabel}</Text>
                </View>
              </View>

              <View style={styles.profileBody}>
                <View style={styles.profileTitleRow}>
                  <View style={styles.profileNameWrap}>
                    <Text style={styles.profileName}>{item.name} <Text style={styles.nickname}>({item.nickname})</Text></Text>
                    <Text style={styles.profileMeta}>{item.age} ปี · {item.faculty} · {item.year}</Text>
                  </View>
                  <View style={styles.scoreCircle}><Text style={styles.scoreValue}>{item.compatibility}</Text><Text style={styles.scoreUnit}>%</Text></View>
                </View>

                <View style={styles.detailList}>
                  <DetailRow icon="◷" label="ทักษะ / ความสนใจ" value={item.skill} />
                  <DetailRow icon="⌁" label="ช่วงเวลาว่าง" value={item.availability} />
                  <DetailRow icon="⌖" label="จุดนัดพบที่สะดวก" value={item.location} />
                </View>

                <View style={styles.tagRow}>
                  {item.tags.map((tag) => <Chip key={tag} label={tag} style={styles.smallChip} />)}
                </View>

                <View style={styles.bioBox}>
                  <Text style={styles.bioQuote}>“</Text>
                  <Text style={styles.bioText}>{item.bio}</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
                  <Text style={styles.skipIcon}>×</Text>
                  <Text style={styles.skipText}>ข้าม</Text>
                </Pressable>
                <PrimaryButton label="สนใจและจับคู่" icon="✦" onPress={handleLike} style={styles.likeButton} />
              </View>
            </Card>
            <Text style={styles.safetyNote}>🔒 ข้อมูลจะแสดงเฉพาะเมื่อจับคู่กันสำเร็จ</Text>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailIcon}>{icon}</Text>
      <View style={styles.detailCopy}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  topRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xxl },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.4, marginBottom: 5 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 5 },
  psuBadge: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  psuBadgeText: { color: colors.card, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  sectionRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  filterButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 13, borderWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8 },
  filterButtonActive: { backgroundColor: colors.primarySoft, borderColor: '#D6D8FF' },
  filterButtonIcon: { color: colors.inkMuted, fontSize: 18, marginRight: 5 },
  filterButtonIconActive: { color: colors.primary },
  filterButtonText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800' },
  filterButtonTextActive: { color: colors.primary },
  categoryRow: { paddingBottom: spacing.lg, paddingRight: spacing.lg },
  categoryChip: { marginRight: spacing.sm },
  filterPanel: { borderRadius: radius.md, marginBottom: spacing.lg, padding: spacing.lg },
  filterPanelTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900', marginBottom: spacing.sm },
  optionRow: { alignItems: 'center', flexDirection: 'row', paddingVertical: spacing.sm },
  checkbox: { alignItems: 'center', borderColor: colors.line, borderRadius: 7, borderWidth: 1.5, height: 24, justifyContent: 'center', marginRight: spacing.md, width: 24 },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.card, fontSize: 14, fontWeight: '900' },
  optionCopy: { flex: 1 },
  optionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  optionSubtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 2 },
  resultHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  resultLabel: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  resultHint: { color: colors.inkSoft, fontSize: type.micro },
  profileCard: { overflow: 'hidden' },
  profileHero: { alignItems: 'center', height: 210, justifyContent: 'center', padding: spacing.lg, position: 'relative' },
  heroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', left: spacing.lg, position: 'absolute', right: spacing.lg, top: spacing.lg },
  matchPill: { backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  matchPillText: { color: colors.ink, fontSize: type.micro, fontWeight: '900' },
  heroLabel: { color: 'rgba(16,32,58,0.42)', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  activityPill: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.pill, bottom: spacing.lg, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8, position: 'absolute' },
  activityPillIcon: { fontSize: 14, marginRight: 5 },
  activityPillText: { color: colors.card, fontSize: type.caption, fontWeight: '800' },
  profileBody: { padding: spacing.xl },
  profileTitleRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
  profileNameWrap: { flex: 1, paddingRight: spacing.sm },
  profileName: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  nickname: { color: colors.inkMuted, fontSize: 15, fontWeight: '600' },
  profileMeta: { color: colors.primary, fontSize: type.caption, fontWeight: '800', lineHeight: 18, marginTop: 5 },
  scoreCircle: { alignItems: 'center', backgroundColor: colors.greenSoft, borderRadius: 27, height: 54, justifyContent: 'center', width: 54 },
  scoreValue: { color: colors.green, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  scoreUnit: { color: colors.green, fontSize: 10, fontWeight: '800' },
  detailList: { borderTopColor: colors.line, borderTopWidth: 1, paddingTop: spacing.md },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', marginBottom: spacing.md },
  detailIcon: { color: colors.primary, fontSize: 19, fontWeight: '900', marginRight: spacing.md, textAlign: 'center', width: 22 },
  detailCopy: { flex: 1 },
  detailLabel: { color: colors.inkSoft, fontSize: type.micro, marginBottom: 2 },
  detailValue: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  smallChip: { marginBottom: spacing.xs, marginRight: spacing.xs, minHeight: 29, paddingHorizontal: 9 },
  bioBox: { backgroundColor: colors.canvas, borderRadius: radius.sm, flexDirection: 'row', padding: spacing.md },
  bioQuote: { color: colors.primary, fontSize: 27, fontWeight: '900', lineHeight: 22, marginRight: 5 },
  bioText: { color: colors.inkMuted, flex: 1, fontSize: type.caption, lineHeight: 18 },
  actionRow: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  skipButton: { alignItems: 'center', backgroundColor: colors.coralSoft, borderRadius: radius.md, flexDirection: 'row', justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.lg },
  skipIcon: { color: colors.coral, fontSize: 25, fontWeight: '400', lineHeight: 24, marginRight: 5 },
  skipText: { color: colors.coral, fontSize: type.body, fontWeight: '900' },
  likeButton: { flex: 1, marginLeft: spacing.sm, minHeight: 50 },
  safetyNote: { color: colors.inkSoft, fontSize: type.micro, marginTop: spacing.md, textAlign: 'center' },
  emptyCard: { alignItems: 'center', marginTop: spacing.lg, padding: spacing.xxl },
  emptyEmoji: { fontSize: 42, marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  emptyButton: { marginTop: spacing.lg, minWidth: 170 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
