import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ACTIVITY_CATEGORIES } from '../data/activityCategories';
import { FACULTIES } from '../data/faculties';
import { useApp } from '../context/AppContext';
import {
  IosLikeAvatar,
  IosLikeCard,
  IosLikeHeader,
  IosLikePill,
  IosLikeScreen,
  IosLikeSectionTitle,
  IconButton,
} from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate, getActivityLabel } from '../utils/formatters';
import { radius, spacing, type, useTheme } from '../theme';

const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FILTER_ACTIVITY_IDS = ['running', 'gym', 'sports', 'study', 'chill'];
const FILTER_YEAR_KEYS = [1, 2, 3, 4];

function getRemainingTime() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, tomorrow.getTime() - now.getTime());
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function getDailySeed() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function dailyShuffle(items, seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) | 0;
  }
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const swapIndex = Math.floor((Math.abs(hash) % 10000) / 10000 * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function allEnabled(values) {
  return Object.values(values).every(Boolean);
}

export default function HomeScreen({ onOpenLikes }) {
  const { colors, isDark } = useTheme();
  const {
    availableProfiles = [],
    conversations = [],
    getMeetupStats,
    matchedProfileIds = [],
    pendingIncomingLikes = [],
    profile,
    recycleSkippedProfiles,
    saveMatchingPreferences,
    selectedMeetup,
  } = useApp();
  const [showSettings, setShowSettings] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [faculty, setFaculty] = useState('all');
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [eveningOnly, setEveningOnly] = useState(false);
  const [distance, setDistance] = useState(25);
  const [years, setYears] = useState({ 1: true, 2: true, 3: true, 4: true });
  const [genders, setGenders] = useState({ male: true, female: true, other: true });
  const [activities, setActivities] = useState({ running: true, gym: true, sports: true, study: true, chill: true });
  const [facultySaving, setFacultySaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [timeLeft, setTimeLeft] = useState(getRemainingTime());
  const recycleLock = useRef(false);
  const openLikes = onOpenLikes || (() => router.push('/likes'));

  useEffect(() => {
    const preferences = profile?.matchingPreferences || {};
    const selectedActivities = preferences.activities || [];
    const selectedYears = preferences.years || [];
    const selectedGenders = preferences.genders || [];
    setFaculty(preferences.faculty || 'all');
    setSameFacultyOnly(preferences.sameFacultyOnly === true);
    setDistance(Number(preferences.maxDistance) || 25);
    setActivities(Object.fromEntries(FILTER_ACTIVITY_IDS.map((id) => [
      id,
      selectedActivities.length === 0 || selectedActivities.includes(id),
    ])));
    setYears(Object.fromEntries(FILTER_YEAR_KEYS.map((key) => [
      key,
      selectedYears.length === 0 || selectedYears.includes(`ชั้นปีที่ ${key}`),
    ])));
    setGenders({
      male: selectedGenders.length === 0 || selectedGenders.includes('male'),
      female: selectedGenders.length === 0 || selectedGenders.includes('female'),
      other: selectedGenders.length === 0 || selectedGenders.includes('nonbinary'),
    });
  }, [
    profile?.id,
    profile?.matchingPreferences?.activities,
    profile?.matchingPreferences?.faculty,
    profile?.matchingPreferences?.genders,
    profile?.matchingPreferences?.maxDistance,
    profile?.matchingPreferences?.sameFacultyOnly,
    profile?.matchingPreferences?.years,
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((current) => (current <= 1000 ? RESET_INTERVAL_MS : current - 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const persistFacultyMatching = async (nextFaculty, nextSameFaculty) => {
    if (facultySaving) return;
    const previousFaculty = faculty;
    const previousSameFaculty = sameFacultyOnly;
    const normalizedSameFaculty = nextSameFaculty === true && Boolean(profile?.faculty);
    const normalizedFaculty = normalizedSameFaculty ? 'all' : (nextFaculty || 'all');
    setFaculty(normalizedFaculty);
    setSameFacultyOnly(normalizedSameFaculty);
    setFacultySaving(true);
    try {
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        faculty: normalizedFaculty,
        sameFacultyOnly: normalizedSameFaculty,
      });
    } catch (error) {
      setFaculty(previousFaculty);
      setSameFacultyOnly(previousSameFaculty);
      console.error('[HomeScreen] Failed to save faculty matching:', error);
    } finally {
      setFacultySaving(false);
    }
  };

  const saveSearchSettings = async () => {
    setSettingsSaving(true);
    try {
      const selectedActivities = FILTER_ACTIVITY_IDS.filter((key) => activities[key]);
      const selectedYears = FILTER_YEAR_KEYS
        .filter((key) => years[key])
        .map((key) => `ชั้นปีที่ ${key}`);
      const selectedGenders = [
        genders.male && 'male',
        genders.female && 'female',
        genders.other && 'nonbinary',
      ].filter(Boolean);
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        activities: selectedActivities.length === FILTER_ACTIVITY_IDS.length ? [] : selectedActivities,
        faculty: sameFacultyOnly ? 'all' : faculty,
        genders: selectedGenders.length === 3 ? [] : selectedGenders,
        maxDistance: Math.round(distance),
        sameFacultyOnly,
        years: selectedYears.length === FILTER_YEAR_KEYS.length ? [] : selectedYears,
      });
      setShowSettings(false);
    } catch (error) {
      console.error('[HomeScreen] Failed to save search settings:', error);
    } finally {
      setSettingsSaving(false);
    }
  };

  const activeFacultyFilter = sameFacultyOnly
    ? (profile?.faculty || 'all')
    : (faculty || 'all');

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (selectedCategory !== 'all' && candidate.activity !== selectedCategory && !candidate.activities?.includes(selectedCategory)) return false;
      if (activeFacultyFilter !== 'all' && candidate.faculty !== activeFacultyFilter) return false;
      if (sameFacultyOnly && candidate.faculty !== profile?.faculty) return false;
      if (eveningOnly && !candidate.availability?.includes('17:') && !candidate.availability?.includes('18:')) return false;
      return true;
    });
    return dailyShuffle(filtered, getDailySeed() + (profile?.id || ''));
  }, [activeFacultyFilter, availableProfiles, eveningOnly, profile?.faculty, profile?.id, sameFacultyOnly, selectedCategory]);

  const currentProfile = filteredProfiles[0] || null;
  const meetupStats = profile && getMeetupStats ? getMeetupStats(profile) : null;

  useEffect(() => {
    if (currentProfile || !availableProfiles.length || filteredProfiles.length) {
      recycleLock.current = false;
      return undefined;
    }
    if (recycleLock.current) return undefined;
    recycleLock.current = true;
    const timer = setTimeout(() => recycleSkippedProfiles(), 900);
    return () => clearTimeout(timer);
  }, [availableProfiles.length, currentProfile, filteredProfiles.length, recycleSkippedProfiles]);

  const resetFilters = () => {
    recycleSkippedProfiles();
    setSelectedCategory('all');
    setEveningOnly(false);
    setDistance(25);
    setYears({ 1: true, 2: true, 3: true, 4: true });
    setGenders({ male: true, female: true, other: true });
    setActivities({ running: true, gym: true, sports: true, study: true, chill: true });
    void persistFacultyMatching('all', false);
  };

  return (
    <IosLikeScreen>
      <IosLikeHeader
        onRightPress={() => setShowSettings(true)}
        rightIcon="gearshape.fill"
        subtitle="ค้นหาเพื่อนที่ชอบกิจกรรมเหมือนกัน"
        title="หาเพื่อน"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {selectedMeetup ? <MeetupBanner meetup={selectedMeetup} stats={meetupStats} /> : null}

        <IosLikeSectionTitle
          subtitle="ปรับรายการให้เหมาะกับคุณ"
          title="ค้นหาเพื่อนที่ใช่"
        />

        <View style={styles.quickFilterRow}>
          <QuickFilterButton
            badge={pendingIncomingLikes.length}
            icon="heart.fill"
            label="ถูกใจคุณ"
            onPress={openLikes}
          />
          <QuickFilterButton
            icon="clock.arrow.2.circlepath"
            label="เริ่มใหม่"
            onPress={resetFilters}
          />
          <QuickFilterButton
            active={showFilters}
            icon="tune"
            label="ตัวกรอง"
            onPress={() => setShowFilters((current) => !current)}
          />
        </View>

        {showFilters ? (
          <View style={[styles.smartFilterBar, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <FilterButton active={sameFacultyOnly} icon="building.columns.fill" label="คณะเดียวกัน" onPress={() => void persistFacultyMatching('all', !sameFacultyOnly)} />
            <FilterButton active={eveningOnly} icon="sunset.fill" label="ว่างช่วงเย็น" onPress={() => setEveningOnly((current) => !current)} />
            <IconButton accessibilityLabel="เปิดตัวกรองเพิ่มเติม" icon="slider.horizontal.3" onPress={() => setShowSettings(true)} size={18} style={styles.filterIconButton} tintColor={colors.primary} />
          </View>
        ) : null}

        <View style={styles.categoryHeader}>
          <IosLikeSectionTitle subtitle="เลือกหมวดกิจกรรมที่อยากเจอ" title="กิจกรรมที่สนใจ" />
        </View>
        <ScrollView contentContainerStyle={styles.pillRow} horizontal showsHorizontalScrollIndicator={false}>
          {ACTIVITY_CATEGORIES.map((category) => (
            <IosLikePill
              active={selectedCategory === category.id}
              color={category.id === 'all' ? colors.primary : category.color}
              icon={category.id === 'all' ? 'person.2.fill' : category.icon}
              key={category.id}
              onPress={() => setSelectedCategory(category.id)}
            >
              {category.label}
            </IosLikePill>
          ))}
        </ScrollView>

        {currentProfile ? (
          <>
            <IosLikeSectionTitle
              action="รีเซ็ต"
              onAction={resetFilters}
              subtitle={`รีเซ็ตใน ${formatRemainingTime(timeLeft)}`}
              title="แนะนำสำหรับคุณ"
            />
            <DiscoverProfileCard
              candidate={currentProfile}
              onPress={() => router.push({ pathname: '/discover-profile', params: { profileId: currentProfile.id } })}
            />
            <View style={styles.shortcutRow}>
              <ShortcutPill icon="clock.arrow.2.circlepath" label="รีเซ็ตโปรไฟล์" value={formatRemainingTime(timeLeft)} />
              <ShortcutPill icon="flame.fill" label="แมตช์" value={String(Math.max(matchedProfileIds.length, conversations.length))} />
            </View>
          </>
        ) : (
          <EmptyState onReset={resetFilters} />
        )}
      </ScrollView>

      <SettingsModal
        activities={activities}
        distance={distance}
        eveningOnly={eveningOnly}
        faculty={faculty}
        facultySaving={facultySaving}
        genders={genders}
        onActivities={(id) => setActivities((current) => ({ ...current, [id]: !current[id] }))}
        onClose={() => setShowSettings(false)}
        onDistance={setDistance}
        onEvening={() => setEveningOnly((current) => !current)}
        onFaculty={(nextFaculty) => {
          setFaculty(nextFaculty);
          setSameFacultyOnly(false);
        }}
        onSave={saveSearchSettings}
        onGenders={(key) => setGenders((current) => ({ ...current, [key]: !current[key] }))}
        onSameFaculty={() => {
          setSameFacultyOnly((current) => !current);
          setFaculty('all');
        }}
        onYears={(key) => setYears((current) => ({ ...current, [key]: !current[key] }))}
        saving={settingsSaving}
        sameFacultyOnly={sameFacultyOnly}
        visible={showSettings}
        years={years}
      />
    </IosLikeScreen>
  );
}

function QuickFilterButton({ active = false, badge = 0, icon, label, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.quickFilter, { backgroundColor: active ? colors.primarySoft : colors.surfaceRaised, borderColor: active ? colors.primary : colors.line }, pressed && styles.pressed]}>
      <FeatureIcon color={active ? colors.primary : colors.inkMuted} name={icon} size={15} />
      <Text style={[styles.quickFilterText, { color: active ? colors.primary : colors.ink }]}>{label}</Text>
      {badge > 0 ? <View style={[styles.quickBadge, { backgroundColor: colors.coral }]}><Text style={styles.quickBadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
    </Pressable>
  );
}

function MeetupBanner({ meetup, stats }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/meetup')} style={({ pressed }) => [styles.meetupBanner, { backgroundColor: colors.mintSoft, borderColor: colors.mintSoft }, pressed && styles.pressed]}>
      <View style={[styles.meetupIcon, { backgroundColor: colors.mint }]}><FeatureIcon color="#FFFFFF" name="mappin.and.ellipse" size={17} /></View>
      <View style={styles.meetupCopy}>
        <View style={styles.meetupTitleRow}>
          <Text style={[styles.meetupEyebrow, { color: colors.mint }]}>จุดนัดพบ</Text>
          <Text style={[styles.meetupStatus, { color: stats?.isFull ? colors.coral : colors.mint }]}>{stats ? (stats.isFull ? 'เต็มแล้ว' : `ร่วม ${stats.acceptedCount}/${stats.maxPeople}`) : 'พร้อม'}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.meetupName, { color: colors.ink }]}>{meetup.name}</Text>
        <Text numberOfLines={1} style={[styles.meetupMeta, { color: colors.inkMuted }]}>{meetup.schedule?.date ? formatReadableDate(meetup.schedule.date) : 'แตะเพื่อจัดการจุดนัดพบ'}</Text>
      </View>
      <FeatureIcon color={colors.mint} name="chevron.right" size={18} />
    </Pressable>
  );
}

function FilterButton({ active, icon, label, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.filterButton, { backgroundColor: active ? colors.primarySoft : colors.surfaceRaised, borderColor: active ? colors.primary : colors.line }, pressed && styles.pressed]}>
      <FeatureIcon color={active ? colors.primary : colors.inkMuted} name={icon} size={15} />
      <Text style={[styles.filterButtonText, { color: active ? colors.primary : colors.inkMuted }]}>{label}</Text>
    </Pressable>
  );
}

function DiscoverProfileCard({ candidate, onPress }) {
  const { colors, isDark } = useTheme();
  const imageUri = useRemoteImage(candidate.avatarUri);
  const gradientColors = isDark ? ['transparent', 'rgba(20,23,27,0.92)'] : ['transparent', 'rgba(16,32,58,0.88)'];
  return (
    <Pressable accessibilityLabel={`เปิดโปรไฟล์ ${candidate.name}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <IosLikeCard style={styles.profileCard}>
        <View style={[styles.profileHero, { backgroundColor: candidate.avatarColor || colors.primarySoft }]}>
          {imageUri ? <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} /> : <IosLikeAvatar color={candidate.avatarColor || colors.primarySoft} emoji={candidate.avatar} size={112} />}
          <LinearGradient colors={gradientColors} style={styles.profileGradient} />
          <View style={styles.profileHeroCopy}>
            {candidate.isMatched ? <View style={styles.matchedBadge}><FeatureIcon color="#FFFFFF" name="person.2.fill" size={12} /><Text style={styles.matchedBadgeText}>เพื่อนที่คุณแมตช์แล้ว 💬</Text></View> : null}
            <Text numberOfLines={1} style={styles.profileHeroName}>{candidate.name}{candidate.age ? `, ${candidate.age}` : ''}</Text>
            <Text numberOfLines={1} style={styles.profileHeroMeta}>{[getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities), candidate.faculty].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}</Text>
          </View>
          <View style={[styles.compatibility, { backgroundColor: colors.card }]}><Text style={[styles.compatibilityValue, { color: colors.primary }]}>{candidate.compatibility || 0}%</Text><Text style={[styles.compatibilityLabel, { color: colors.inkMuted }]}>เข้ากันได้</Text></View>
        </View>
      </IosLikeCard>
    </Pressable>
  );
}

function ShortcutPill({ icon, label, value }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.shortcutPill, { backgroundColor: colors.surfaceRaised }]}>
      <FeatureIcon color={colors.primary} name={icon} size={15} />
      <Text style={[styles.shortcutLabel, { color: colors.inkMuted }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.shortcutValue, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

function EmptyState({ onReset }) {
  const { colors } = useTheme();
  return (
    <IosLikeCard style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}><FeatureIcon color={colors.primary} name="person.fill.xmark" size={28} /></View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>ยังไม่มีโปรไฟล์ที่ตรงกัน</Text>
      <Text style={[styles.emptyText, { color: colors.inkMuted }]}>ระบบจะค้นหาโปรไฟล์ใหม่โดยอัตโนมัติ หากตัวกรองไม่มีคนที่ตรงกัน</Text>
      <Pressable accessibilityRole="button" onPress={onReset} style={({ pressed }) => [styles.resetButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}><Text style={styles.resetButtonText}>รีเซ็ตตัวกรอง</Text></Pressable>
    </IosLikeCard>
  );
}

function SettingsModal({ activities, distance, eveningOnly, faculty, facultySaving, genders, onActivities, onClose, onDistance, onEvening, onFaculty, onGenders, onSave, onSameFaculty, onYears, saving, sameFacultyOnly, visible, years }) {
  const { colors } = useTheme();
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityLabel="ปิดการตั้งค่าตัวกรอง" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.settingsSheet, { backgroundColor: colors.card }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.inkSoft }]} />
          <View style={styles.sheetHeader}><View><Text style={[styles.sheetTitle, { color: colors.ink }]}>ตั้งค่าการจับคู่</Text><Text style={[styles.sheetSubtitle, { color: colors.inkMuted }]}>ตัวกรองจะใช้กับการค้นหาเพื่อนของคุณ</Text></View><IconButton accessibilityLabel="ปิดตัวกรอง" icon="xmark" onPress={onClose} size={18} tintColor={colors.ink} /></View>
          <ScrollView contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
            <FilterSectionLabel label="ระยะห่างจากคุณ" />
            <View style={[styles.distanceCard, { backgroundColor: colors.surfaceRaised }]}>
              <View style={styles.distanceHeader}><Text style={[styles.distanceValue, { color: colors.primary }]}>{Math.round(distance)} กม.</Text><Text style={[styles.distanceHint, { color: colors.inkMuted }]}>ค้นหาเพื่อนในรัศมี</Text></View>
              <View style={styles.distanceControls}>
                {[5, 15, 25, 50].map((value) => <IosLikePill active={Math.round(distance) === value} key={value} onPress={() => onDistance(value)}>{`${value} กม.`}</IosLikePill>)}
              </View>
            </View>

            <FilterSectionLabel label="กิจกรรมที่สนใจ" />
            <View style={styles.optionGrid}>
              {ACTIVITY_CATEGORIES.filter((category) => FILTER_ACTIVITY_IDS.includes(category.id)).map((category) => (
                <OptionToggle active={activities[category.id]} icon={category.icon} key={category.id} label={category.label} onPress={() => onActivities(category.id)} />
              ))}
            </View>

            <FilterSectionLabel label="ช่วงชั้นปี" />
            <View style={styles.optionGrid}>
              {FILTER_YEAR_KEYS.map((key) => <OptionToggle active={years[key]} icon="graduationcap.fill" key={key} label={key === 4 ? 'ปี 4 ขึ้นไป' : `ปี ${key}`} onPress={() => onYears(key)} />)}
            </View>

            <FilterSectionLabel label="คณะ" />
            <ScrollView contentContainerStyle={styles.settingPills} horizontal showsHorizontalScrollIndicator={false}>
              {['all', ...FACULTIES].map((item) => <IosLikePill active={!sameFacultyOnly && faculty === item} key={item} onPress={() => onFaculty(item)}>{item === 'all' ? 'ทุกคณะ' : item}</IosLikePill>)}
            </ScrollView>
            <SettingRow icon="building.columns.fill" label="เฉพาะคณะเดียวกับฉัน" onPress={onSameFaculty} value={sameFacultyOnly} />
            <SettingRow icon="sunset.fill" label="ว่างช่วงเย็น" onPress={onEvening} value={eveningOnly} />

            <FilterSectionLabel label="เพศ" />
            <View style={styles.optionGrid}>
              <OptionToggle active={genders.male} icon="person.fill" label="ชาย" onPress={() => onGenders('male')} />
              <OptionToggle active={genders.female} icon="person.fill" label="หญิง" onPress={() => onGenders('female')} />
              <OptionToggle active={genders.other} icon="person.2.fill" label="อื่น ๆ" onPress={() => onGenders('other')} />
            </View>
            <Text style={[styles.genderHelper, { color: colors.inkMuted }]}>เลือกเพศที่อยากพบได้มากกว่าหนึ่งข้อ</Text>

            {facultySaving || saving ? <Text style={[styles.savingText, { color: colors.primary }]}>กำลังบันทึกการตั้งค่า…</Text> : null}
            <Pressable accessibilityRole="button" disabled={saving} onPress={onSave} style={({ pressed }) => [styles.doneButton, { backgroundColor: colors.primary }, pressed && styles.pressed, saving && styles.disabled]}><Text style={styles.doneButtonText}>{saving ? 'กำลังบันทึก…' : 'บันทึกตัวกรอง'}</Text></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FilterSectionLabel({ label }) {
  const { colors } = useTheme();
  return <Text style={[styles.settingLabel, { color: colors.inkMuted }]}>{label}</Text>;
}

function OptionToggle({ active, icon, label, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={onPress} style={({ pressed }) => [styles.optionToggle, { backgroundColor: active ? colors.primarySoft : colors.surfaceRaised, borderColor: active ? colors.primary : colors.line }, pressed && styles.pressed]}>
      <FeatureIcon color={active ? colors.primary : colors.inkMuted} name={icon} size={15} />
      <Text numberOfLines={1} style={[styles.optionText, { color: active ? colors.primary : colors.inkMuted }]}>{label}</Text>
      {active ? <FeatureIcon color={colors.primary} name="checkmark" size={14} /> : null}
    </Pressable>
  );
}

function SettingRow({ icon, label, onPress, value }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={onPress} style={({ pressed }) => [styles.settingRow, { borderBottomColor: colors.line }, pressed && styles.pressed]}>
      <View style={[styles.settingIcon, { backgroundColor: colors.primarySoft }]}><FeatureIcon color={colors.primary} name={icon} size={17} /></View>
      <Text style={[styles.settingText, { color: colors.ink }]}>{label}</Text>
      <View style={[styles.check, { borderColor: value ? colors.primary : colors.line, backgroundColor: value ? colors.primary : 'transparent' }]}>{value ? <FeatureIcon color="#FFFFFF" name="checkmark" size={14} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingBottom: 40, paddingHorizontal: spacing.lg, paddingTop: 110 },
  quickFilterRow: { flexDirection: 'row', gap: spacing.sm },
  quickFilter: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 40, paddingHorizontal: spacing.sm },
  quickFilterText: { fontSize: type.caption2, fontWeight: '800' },
  quickBadge: { alignItems: 'center', borderRadius: radius.pill, minWidth: 19, paddingHorizontal: 5, paddingVertical: 2 },
  quickBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  categoryHeader: { marginBottom: -spacing.sm },
  pillRow: { gap: spacing.sm, paddingRight: spacing.lg },
  smartFilterBar: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  filterButton: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 38, paddingHorizontal: spacing.sm },
  filterButtonText: { fontSize: type.caption2, fontWeight: '700' },
  filterIconButton: { height: 38, width: 38 },
  meetupBanner: { alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  meetupIcon: { alignItems: 'center', borderRadius: radius.pill, height: 34, justifyContent: 'center', width: 34 },
  meetupCopy: { flex: 1 },
  meetupTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  meetupEyebrow: { fontSize: type.caption2, fontWeight: '800' },
  meetupStatus: { fontSize: type.caption2, fontWeight: '800' },
  meetupName: { fontSize: type.body, fontWeight: '800', marginTop: 2 },
  meetupMeta: { fontSize: type.caption2, marginTop: 2 },
  profileCard: { padding: 0 },
  profileHero: { height: 360, justifyContent: 'flex-end', overflow: 'hidden', position: 'relative' },
  profileGradient: { bottom: 0, height: 190, left: 0, position: 'absolute', right: 0 },
  profileHeroCopy: { bottom: spacing.lg, left: spacing.lg, position: 'absolute', right: 80 },
  profileHeroName: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  profileHeroMeta: { color: 'rgba(255,255,255,0.86)', fontSize: type.caption, fontWeight: '600', marginTop: 5 },
  matchedBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.pill, flexDirection: 'row', gap: 5, marginBottom: spacing.sm, paddingHorizontal: 9, paddingVertical: 5 },
  matchedBadgeText: { color: '#FFFFFF', fontSize: type.caption2, fontWeight: '700' },
  compatibility: { alignItems: 'center', borderRadius: radius.pill, bottom: spacing.lg, elevation: 4, paddingHorizontal: 10, paddingVertical: 7, position: 'absolute', right: spacing.lg, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 8 },
  compatibilityValue: { fontSize: type.headline, fontWeight: '800' },
  compatibilityLabel: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  shortcutRow: { flexDirection: 'row', gap: spacing.sm },
  shortcutPill: { alignItems: 'center', borderRadius: radius.pill, flex: 1, flexDirection: 'row', gap: 5, minHeight: 38, paddingHorizontal: spacing.md },
  shortcutLabel: { fontSize: type.caption2, fontWeight: '600' },
  shortcutValue: { flex: 1, fontSize: type.caption2, fontWeight: '800', textAlign: 'right' },
  emptyState: { alignItems: 'center', padding: spacing.xxl },
  emptyIcon: { alignItems: 'center', borderRadius: radius.pill, height: 58, justifyContent: 'center', width: 58 },
  emptyTitle: { fontSize: type.headline, fontWeight: '800', marginTop: spacing.md },
  emptyText: { fontSize: type.caption, lineHeight: 18, marginTop: spacing.sm, textAlign: 'center' },
  resetButton: { borderRadius: radius.pill, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  resetButtonText: { color: '#FFFFFF', fontSize: type.caption, fontWeight: '800' },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.38)', flex: 1, justifyContent: 'flex-end' },
  settingsSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sheetHandle: { alignSelf: 'center', borderRadius: radius.pill, height: 5, marginBottom: spacing.md, opacity: 0.4, width: 38 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.md },
  sheetTitle: { fontSize: type.headline, fontWeight: '800' },
  sheetSubtitle: { fontSize: type.caption2, marginTop: 3 },
  settingsContent: { gap: spacing.md, paddingBottom: spacing.xl },
  settingLabel: { fontSize: type.caption, fontWeight: '800', marginTop: spacing.sm },
  distanceCard: { borderRadius: radius.lg, padding: spacing.md },
  distanceHeader: { alignItems: 'baseline', flexDirection: 'row', gap: spacing.sm },
  distanceValue: { fontSize: type.title, fontWeight: '900' },
  distanceHint: { fontSize: type.caption2 },
  distanceControls: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  settingPills: { gap: spacing.sm, paddingBottom: spacing.xs },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionToggle: { alignItems: 'center', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 42, paddingHorizontal: spacing.sm, width: '48%' },
  optionText: { flex: 1, fontSize: type.caption2, fontWeight: '700' },
  genderHelper: { fontSize: type.caption2, marginTop: -spacing.sm },
  settingRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 58, paddingVertical: spacing.sm },
  settingIcon: { alignItems: 'center', borderRadius: radius.sm, height: 34, justifyContent: 'center', marginRight: spacing.md, width: 34 },
  settingText: { flex: 1, fontSize: type.body, fontWeight: '700' },
  check: { alignItems: 'center', borderRadius: 7, borderWidth: 1.5, height: 24, justifyContent: 'center', width: 24 },
  savingText: { fontSize: type.caption, fontWeight: '600' },
  doneButton: { alignItems: 'center', borderRadius: radius.pill, minHeight: 48, justifyContent: 'center', marginTop: spacing.sm },
  doneButtonText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
