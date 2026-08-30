import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ACTIVITY_CATEGORIES } from '../data/activityCategories';
import { FACULTIES } from '../data/faculties';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, SectionTitle } from '../components/ui';
import FeatureIcon from '../components/FeatureIcon';
import { formatReadableDate, getActivityLabel } from '../utils/formatters';
import { radius, shadow, spacing, type, useTheme } from '../theme';

function getRemainingTimeUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const diff = Math.max(0, tomorrow.getTime() - now.getTime());
  const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
  const minutes = Math.floor((diff / (1000 * 60)) % 60).toString().padStart(2, '0');
  const seconds = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function getDailySeed() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function pseudoRandom(seedStr) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = Math.imul(31, hash) + seedStr.charCodeAt(i) | 0;
  }
  return function() {
    hash = (hash ^ (hash << 13)) | 0;
    hash = (hash ^ (hash >>> 17)) | 0;
    hash = (hash ^ (hash << 5)) | 0;
    return (Math.abs(hash) % 10000) / 10000;
  };
}

function dailyShuffle(array, seedStr) {
  const rng = pseudoRandom(seedStr);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function HomeScreen({ onOpenLikes }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const {
    availableProfiles,
    conversations,
    getMeetupStats,
    matchedProfileIds,
    pendingIncomingLikes,
    profile,
    recycleSkippedProfiles,
    saveMatchingPreferences,
    selectedMeetup,
  } = useApp();
  const myMeetupStats = useMemo(() => (profile ? getMeetupStats(profile) : null), [profile, getMeetupStats]);
  const matchedCount = matchedProfileIds?.length || conversations?.length || 0;
  const [timeLeft, setTimeLeft] = useState(getRemainingTimeUntilMidnight());
  const autoRefreshLock = React.useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(getRemainingTimeUntilMidnight());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSmartFilters, setShowSmartFilters] = useState(false);
  const [faculty, setFaculty] = useState('all');
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [facultySaving, setFacultySaving] = useState(false);
  const [eveningOnly, setEveningOnly] = useState(false);

  useEffect(() => {
    const preferences = profile?.matchingPreferences || {};
    setFaculty(preferences.sameFacultyOnly ? 'all' : (preferences.faculty || 'all'));
    setSameFacultyOnly(preferences.sameFacultyOnly === true);
  }, [
    profile?.id,
    profile?.matchingPreferences?.faculty,
    profile?.matchingPreferences?.sameFacultyOnly,
  ]);

  const updateFacultyMatching = async (nextFaculty, nextSameFacultyOnly) => {
    if (facultySaving) return;
    const previousFaculty = faculty;
    const previousSameFacultyOnly = sameFacultyOnly;
    const normalizedSameFacultyOnly = nextSameFacultyOnly === true && Boolean(profile?.faculty);
    const normalizedFaculty = normalizedSameFacultyOnly ? 'all' : (nextFaculty || 'all');

    setFaculty(normalizedFaculty);
    setSameFacultyOnly(normalizedSameFacultyOnly);
    setFacultySaving(true);
    try {
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        faculty: normalizedFaculty,
        sameFacultyOnly: normalizedSameFacultyOnly,
      });
    } catch (error) {
      setFaculty(previousFaculty);
      setSameFacultyOnly(previousSameFacultyOnly);
      console.error('[HomeScreen] Failed to save faculty matching:', error);
    } finally {
      setFacultySaving(false);
    }
  };

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (selectedCategory !== 'all' && candidate.activity !== selectedCategory) return false;
      if (!sameFacultyOnly && faculty !== 'all' && candidate.faculty !== faculty) return false;
      if (sameFacultyOnly && candidate.faculty !== profile?.faculty) return false;
      if (eveningOnly && !candidate.availability?.includes('17:') && !candidate.availability?.includes('18:')) return false;
      return true;
    });
    return dailyShuffle(filtered, getDailySeed() + (profile?.id || ''));
  }, [availableProfiles, eveningOnly, faculty, profile?.faculty, profile?.id, sameFacultyOnly, selectedCategory]);

  useEffect(() => setCurrentIndex(0), [eveningOnly, faculty, sameFacultyOnly, selectedCategory]);

  const currentProfile = filteredProfiles[currentIndex] || null;

  useEffect(() => {
    if (currentProfile) {
      autoRefreshLock.current = false;
      return;
    }
    if (!availableProfiles?.length || filteredProfiles.length > 0) return;
    if (autoRefreshLock.current) return;

    autoRefreshLock.current = true;
    const timer = setTimeout(() => {
      recycleSkippedProfiles();
      setEveningOnly(false);
      setSelectedCategory('all');
    }, 1200);

    return () => clearTimeout(timer);
  }, [availableProfiles, currentProfile, filteredProfiles, recycleSkippedProfiles]);

  const handleReset = () => {
    recycleSkippedProfiles();
    setSelectedCategory('all');
    setEveningOnly(false);
    void updateFacultyMatching('all', false);
  };

  const selectCategory = (category) => {
    setSelectedCategory(category);
    setCurrentIndex(0);
  };

  const header = (
    <View style={{ marginTop: spacing.xl }}>
      {selectedMeetup && (
        <View style={styles.meetupBannerCompact}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/meetup')}
            style={({ pressed }) => [styles.meetupMainContent, pressed && styles.pressed]}
          >
            <View style={styles.meetupIconSmall}>
              <FeatureIcon color={colors.green} name="mappin.and.ellipse" size={16} />
            </View>
            <View style={styles.meetupCopy}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text numberOfLines={1} style={styles.meetupSubtitle}>{selectedMeetup.name}</Text>
                <Text style={[styles.meetupTag, myMeetupStats?.isFull && { color: '#FF453A' }]}>
                  {myMeetupStats ? `(${myMeetupStats.isFull ? 'เต็มแล้ว' : `ร่วม ${myMeetupStats.acceptedCount}/${myMeetupStats.maxPeople}`})` : '(นัดหมาย)'}
                </Text>
              </View>
              {selectedMeetup.schedule?.date ? (
                <Text numberOfLines={1} style={styles.meetupDetail}>
                  {formatReadableDate(selectedMeetup.schedule.date)}
                  {selectedMeetup.schedule?.startTime && selectedMeetup.schedule?.endTime ? ` · ${selectedMeetup.schedule.startTime}–${selectedMeetup.schedule.endTime}` : ''}
                </Text>
              ) : (
                <Text style={styles.meetupDetail}>แตะเพื่อจัดการจุดนัดพบ</Text>
              )}
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/meetup')}
            style={({ pressed }) => [styles.meetupSettingsBtn, pressed && styles.pressed]}
          >
            <FeatureIcon color={colors.green} name="slider.horizontal.3" size={16} />
          </Pressable>
        </View>
      )}

      <Pressable
        accessibilityLabel="ดูคนที่กดถูกใจคุณ"
        accessibilityRole="button"
        onPress={onOpenLikes}
        style={({ pressed }) => [styles.likesBanner, pressed && styles.pressed]}
      >
        <View style={styles.likesIcon}><FeatureIcon color={colors.coral} name="heart.fill" size={15} /></View>
        <View style={styles.likesCopy}>
          <Text style={styles.likesEyebrow}>{pendingIncomingLikes.length ? 'มีคนสนใจคุณ' : 'กำลังรอคนใหม่'}</Text>
          <Text style={styles.likesTitle}>
            {pendingIncomingLikes.length ? `${pendingIncomingLikes.length} คนกดถูกใจคุณ` : 'ดูคนที่สนใจคุณ'}
          </Text>
          <Text style={styles.likesSubtitle}>
            {pendingIncomingLikes.length ? 'เลือกได้ว่าจะรับเป็นเพื่อนหรือไม่' : 'เมื่อมีคนกดใจ รายการจะแสดงที่นี่'}
          </Text>
        </View>
        <View style={styles.likesArrow}><FeatureIcon color={colors.coral} name="chevron.right" size={14} /></View>
      </Pressable>

      <View style={styles.sectionRow}>
        <SectionTitle title="กิจกรรมที่สนใจ" />
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowSmartFilters((current) => !current)}
          style={[styles.filterButton, showSmartFilters && styles.filterButtonActive]}
        >
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
          <Pressable
            disabled={facultySaving || !profile?.faculty}
            onPress={() => updateFacultyMatching('all', !sameFacultyOnly)}
            style={[styles.optionRow, (facultySaving || !profile?.faculty) && styles.optionRowDisabled]}
          >
            <View style={[styles.checkbox, sameFacultyOnly && styles.checkboxActive]}>
              {sameFacultyOnly && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>คณะเดียวกัน</Text>
              <Text style={styles.optionSubtitle}>แสดงเพื่อนจาก {profile?.faculty || 'คณะของคุณ'}</Text>
            </View>
          </Pressable>
          <Text style={styles.facultyFilterLabel}>หรือเลือกคณะที่ต้องการค้นหา</Text>
          <ScrollView
            contentContainerStyle={styles.facultyFilterRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {['all', ...FACULTIES].map((item) => {
              const active = !sameFacultyOnly && faculty === item;
              return (
                <Pressable
                  accessibilityRole="button"
                  disabled={facultySaving}
                  key={item}
                  onPress={() => updateFacultyMatching(item, false)}
                  style={[styles.facultyChip, active && styles.facultyChipActive]}
                >
                  <Text style={[styles.facultyChipText, active && styles.facultyChipTextActive]}>
                    {item === 'all' ? 'ทุกคณะ' : item}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {facultySaving ? <Text style={styles.facultySavingText}>กำลังบันทึกการจับคู่...</Text> : null}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <FeatureIcon color={colors.primary} name="clock.arrow.2.circlepath" size={14} />
          <Text style={styles.resultLabel}>สุ่มชุดใหม่ใน {timeLeft}</Text>
        </View>
        <Text style={styles.resultHint}>แมตช์แล้ว {matchedCount} คน</Text>
      </View>
    </View>
  );

  const colorScheme = useColorScheme();
  const blurTint = colorScheme === 'dark' ? 'dark' : 'light';
  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={styles.container}>

            <LinearGradient colors={[colors.canvas, colors.canvas + '00']} style={[styles.topRow, { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }]} pointerEvents="none">
        <View>
          <Text style={styles.title}>สวัสดี {profile.nickname} 👋</Text>
          <Text style={styles.subtitle}>ค้นหาเพื่อนที่อยากทำกิจกรรมแบบเดียวกับคุณ</Text>
        </View>
        <View style={styles.psuBadge}><Text style={styles.psuBadgeText}>PSU</Text></View>
      </LinearGradient>
      <FlatList
        ListHeaderComponent={<View style={{ height: 100 }} />}
        data={currentProfile ? [currentProfile] : []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={(
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>🧭</Text>
            <Text style={styles.emptyTitle}>ยังไม่มีโปรไฟล์ที่ตรงกับตัวกรอง</Text>
            <Text style={styles.emptyText}>ลองเปลี่ยนหมวดหมู่ หรือล้างรายการที่ข้ามไว้เพื่อเริ่มค้นหาใหม่</Text>
          </Card>
        )}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View>
            <Pressable
              accessibilityLabel={`เปิดโปรไฟล์ ${item.name}`}
              accessibilityRole="button"
              onPress={() => router.push({
                pathname: '/discover-profile',
                params: { profileId: item.id },
              })}
              style={({ pressed }) => [styles.profileCardPressable, pressed && styles.pressed]}
            >
            <Card style={styles.profileCard}>
              <View style={[styles.profileHero, { backgroundColor: item.avatarColor }]}>
                <View style={styles.heroTopRow}>
                  {item.isMatched ? (
                    <View style={[styles.matchPill, { backgroundColor: '#9A8CFF' }]}>
                      <Text style={styles.matchPillText}>เพื่อนที่คุณแมตช์แล้ว 💬</Text>
                    </View>
                  ) : (
                    <View style={styles.matchPill}>
                      <Text style={styles.matchPillText}>เหมาะกับคุณ {item.compatibility}%</Text>
                    </View>
                  )}
                  <Text style={styles.heroLabel}>CAMPUSMATE</Text>
                </View>
                <Avatar color={colors.glass} emoji={item.avatar} size={112} online />
                <View style={styles.activityPill}>
                  <Text style={styles.activityPillIcon}>{ACTIVITY_CATEGORIES.find((category) => category.id === item.activity)?.icon}</Text>
                  <Text style={styles.activityPillText}>{getActivityLabel(item.activity, item.activityLabel, item.activities)}</Text>
                </View>
              </View>

              <View style={styles.profileBody}>
                <View style={styles.profileTitleRow}>
                  <View style={styles.profileNameWrap}>
                    <Text style={styles.profileName}>{item.name} <Text style={styles.nickname}>({item.nickname})</Text></Text>
                    <Text style={styles.profileMeta}>{[
                      item.age ? `${item.age} ปี` : null,
                      item.faculty,
                      item.year,
                    ].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}</Text>
                  </View>
                  <View style={styles.scoreCircle}><Text style={styles.scoreValue}>{item.compatibility}</Text><Text style={styles.scoreUnit}>%</Text></View>
                </View>

                <View style={styles.detailList}>
                  <DetailRow icon="◷" label="ทักษะ / ความสนใจ" value={item.skill} />
                  <DetailRow icon="⌁" label="ช่วงเวลาว่าง" value={item.availability} />
                </View>

                <View style={styles.tagRow}>
                  {(item.tags || item.interests || []).map((tag) => <Chip key={tag} label={tag} style={styles.smallChip} />)}
                </View>



                <View style={styles.bioBox}>
                  <Text style={styles.bioQuote}>“</Text>
                  <Text style={styles.bioText}>{item.bio}</Text>
                </View>
              </View>

            </Card>
            </Pressable>
            <Text style={styles.safetyNote}>แตะการ์ดเพื่อดูรายละเอียด แล้วเลือกถูกใจหรือไม่เลือก</Text>
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

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  topRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xxl },
  meetupBannerCompact: {
    alignItems: 'center',
    backgroundColor: colors.greenSoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  meetupMainContent: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  meetupIconSmall: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 32,
  },
  meetupTag: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '800',
  },
  meetupSettingsBtn: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 30,
  },
  meetupBanner: { alignItems: 'flex-start', backgroundColor: colors.greenSoft, borderColor: colors.greenSoft, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.xl, padding: spacing.md },
  meetupIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 24, height: 48, justifyContent: 'center', marginRight: spacing.md, width: 48 },
  meetupEmoji: { fontSize: 24 },
  meetupCopy: { flex: 1 },
  meetupTitle: { color: colors.green, fontSize: type.micro, fontWeight: '900', marginBottom: 2 },
  meetupSubtitle: { color: colors.ink, fontSize: type.subheadline || 14, fontWeight: '800' },
  meetupDetailRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 2 },
  meetupDetail: { color: colors.inkMuted, fontSize: type.micro, fontWeight: '700' },
  meetupDetailMsg: { color: colors.green, fontSize: type.caption },
  candidateMeetupCard: { alignItems: 'flex-start', backgroundColor: colors.greenSoft, borderRadius: radius.md, flexDirection: 'row', marginTop: spacing.md, padding: spacing.md },
  candidateMeetupEmoji: { fontSize: 20, marginRight: spacing.sm },
  candidateMeetupCopy: { flex: 1 },
  candidateMeetupTitle: { color: colors.green, fontSize: type.body, fontWeight: '800', marginBottom: 2 },
  candidateMeetupTime: { color: colors.inkMuted, fontSize: type.micro, fontWeight: '700', marginTop: 2 },
  candidateMeetupMsg: { color: colors.green, fontSize: type.caption, marginTop: 4 },
  likesBanner: { alignItems: 'center', backgroundColor: colors.coralSoft, borderColor: colors.coralSoft, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  likesIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, height: 32, justifyContent: 'center', marginRight: spacing.sm, width: 32 },
  likesCopy: { flex: 1 },
  likesEyebrow: { color: colors.coral, fontSize: 10, fontWeight: '800' },
  likesTitle: { color: colors.ink, fontSize: 13.5, fontWeight: '800', marginTop: 1 },
  likesSubtitle: { color: colors.inkMuted, fontSize: 11, marginTop: 1 },
  likesArrow: { alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.4, marginBottom: 5 },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 5 },
  psuBadge: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  psuBadgeText: { color: colors.card, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  sectionRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  filterButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 13, borderWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8 },
  filterButtonActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  filterButtonIcon: { color: colors.inkMuted, fontSize: 18, marginRight: 5 },
  filterButtonIconActive: { color: colors.primary },
  filterButtonText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800' },
  filterButtonTextActive: { color: colors.primary },
  categoryRow: { paddingBottom: spacing.lg, paddingRight: spacing.lg },
  categoryChip: { marginRight: spacing.sm },
  filterPanel: { borderRadius: radius.md, marginBottom: spacing.lg, padding: spacing.lg },
  filterPanelTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900', marginBottom: spacing.sm },
  optionRow: { alignItems: 'center', flexDirection: 'row', paddingVertical: spacing.sm },
  optionRowDisabled: { opacity: 0.5 },
  checkbox: { alignItems: 'center', borderColor: colors.line, borderRadius: 7, borderWidth: 1.5, height: 24, justifyContent: 'center', marginRight: spacing.md, width: 24 },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.card, fontSize: 14, fontWeight: '900' },
  optionCopy: { flex: 1 },
  optionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  optionSubtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 2 },
  facultyFilterLabel: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '700', marginTop: spacing.sm },
  facultyFilterRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  facultyChip: { borderColor: colors.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 8 },
  facultyChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  facultyChipText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '700' },
  facultyChipTextActive: { color: colors.card },
  facultySavingText: { color: colors.primary, fontSize: type.caption, marginBottom: spacing.xs },
  resultHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  resultLabel: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  resultHint: { color: colors.inkSoft, fontSize: type.micro },
  profileCard: { overflow: 'hidden' },
  profileCardPressable: { width: '100%' },
  profileHero: { alignItems: 'center', height: 210, justifyContent: 'center', padding: spacing.lg, position: 'relative' },
  heroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', left: spacing.lg, position: 'absolute', right: spacing.lg, top: spacing.lg },
  matchPill: { backgroundColor: colors.glass, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  matchPillText: { color: colors.ink, fontSize: type.micro, fontWeight: '900' },
  heroLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
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
  safetyNote: { color: colors.inkSoft, fontSize: type.micro, marginTop: spacing.md, textAlign: 'center' },
  emptyCard: { alignItems: 'center', marginTop: spacing.lg, padding: spacing.xxl },
  emptyEmoji: { fontSize: 42, marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  emptyButton: { marginTop: spacing.lg, minWidth: 170 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
