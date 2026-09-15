import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Picker as NativePicker } from '@react-native-picker/picker';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { router } from 'expo-router';
import { FACULTIES } from '../data/faculties';
import {
  MATCHING_ACTIVITY_OPTIONS,
  MATCHING_AGE_MAX,
  MATCHING_AGE_MIN,
  MATCHING_AGE_VALUES,
  MATCHING_AVAILABILITY_OPTIONS,
  MATCHING_DEFAULT_AGE_MAX,
  MATCHING_GENDER_OPTIONS,
  MATCHING_PACE_OPTIONS,
  MATCHING_YEAR_OPTIONS,
  createMatchingOptionState,
  getSelectedMatchingValues,
  matchesAvailabilityPeriods,
  normalizeMatchingAge,
} from '../data/matchingFilters';
import { useApp } from '../context/AppContext';
import {
  IosLikeCard,
  IosLikePill,
  IosLikeScreen,
  IconButton,
} from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate, getActivityLabel } from '../utils/formatters';
import { radius, spacing, type, useTheme } from '../theme';

const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

function dailyPick(items, seed) {
  if (items.length <= 1) return items;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) | 0;
  }
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return [items[(hash >>> 0) % items.length]];
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
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [faculty, setFaculty] = useState('all');
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [distance, setDistance] = useState(25);
  const [ageMin, setAgeMin] = useState(MATCHING_AGE_MIN);
  const [ageMax, setAgeMax] = useState(MATCHING_DEFAULT_AGE_MAX);
  const [years, setYears] = useState(() => createMatchingOptionState(MATCHING_YEAR_OPTIONS));
  const [genders, setGenders] = useState(() => createMatchingOptionState(MATCHING_GENDER_OPTIONS));
  const [activities, setActivities] = useState(() => createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
  const [paces, setPaces] = useState(() => createMatchingOptionState(MATCHING_PACE_OPTIONS));
  const [availabilityPeriods, setAvailabilityPeriods] = useState(() => createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
  const [availabilityFilterActive, setAvailabilityFilterActive] = useState(false);
  const [facultySaving, setFacultySaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const recycleLock = useRef(false);
  const openLikes = onOpenLikes || (() => router.push('/likes'));

  useEffect(() => {
    const preferences = profile?.matchingPreferences || {};
    const selectedActivities = preferences.activities || [];
    const selectedYears = preferences.years || [];
    const selectedGenders = preferences.genders || [];
    const selectedPaces = preferences.paces || [];
    const selectedAvailabilityPeriods = preferences.availabilityPeriods || [];
    const normalizedAgeMin = normalizeMatchingAge(preferences.ageMin, MATCHING_AGE_MIN);
    const normalizedAgeMax = Math.max(
      normalizedAgeMin,
      normalizeMatchingAge(preferences.ageMax, MATCHING_DEFAULT_AGE_MAX)
    );
    setFaculty(preferences.faculty || 'all');
    setSameFacultyOnly(preferences.sameFacultyOnly === true);
    setDistance(Number(preferences.maxDistance) || 25);
    setAgeMin(normalizedAgeMin);
    setAgeMax(normalizedAgeMax);
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS, selectedActivities));
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS, selectedYears));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS, selectedGenders));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS, selectedPaces));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS, selectedAvailabilityPeriods));
    setAvailabilityFilterActive(
      selectedAvailabilityPeriods.length > 0
      && selectedAvailabilityPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length
    );
  }, [
    profile?.id,
    profile?.matchingPreferences?.activities,
    profile?.matchingPreferences?.ageMax,
    profile?.matchingPreferences?.ageMin,
    profile?.matchingPreferences?.availabilityPeriods,
    profile?.matchingPreferences?.faculty,
    profile?.matchingPreferences?.genders,
    profile?.matchingPreferences?.maxDistance,
    profile?.matchingPreferences?.paces,
    profile?.matchingPreferences?.sameFacultyOnly,
    profile?.matchingPreferences?.years,
  ]);

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

  const toggleAvailabilityPeriod = (value) => {
    const nextAvailabilityPeriods = {
      ...availabilityPeriods,
      [value]: !availabilityPeriods[value],
    };
    const selectedPeriods = MATCHING_AVAILABILITY_OPTIONS
      .filter(({ value: optionValue }) => nextAvailabilityPeriods[optionValue])
      .map(({ value: optionValue }) => optionValue);
    setAvailabilityPeriods(
      selectedPeriods.length === 0
      || selectedPeriods.length === MATCHING_AVAILABILITY_OPTIONS.length
        ? createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS)
        : nextAvailabilityPeriods
    );
    setAvailabilityFilterActive(
      selectedPeriods.length > 0
      && selectedPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length
    );
  };

  const saveSearchSettings = async () => {
    setSettingsSaving(true);
    try {
      const selectedActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
      const selectedYears = getSelectedMatchingValues(MATCHING_YEAR_OPTIONS, years);
      const selectedGenders = getSelectedMatchingValues(MATCHING_GENDER_OPTIONS, genders);
      const selectedPaces = getSelectedMatchingValues(MATCHING_PACE_OPTIONS, paces);
      const selectedAvailabilityPeriods = getSelectedMatchingValues(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods);
      const normalizedAgeMin = Math.min(
        MATCHING_AGE_MAX,
        Math.max(MATCHING_AGE_MIN, Math.round(ageMin))
      );
      const normalizedAgeMax = Math.max(
        normalizedAgeMin,
        Math.min(MATCHING_AGE_MAX, Math.max(MATCHING_AGE_MIN, Math.round(ageMax)))
      );
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        activities: selectedActivities,
        ageMin: normalizedAgeMin,
        ageMax: normalizedAgeMax,
        availabilityPeriods: selectedAvailabilityPeriods,
        faculty: sameFacultyOnly ? 'all' : faculty,
        genders: selectedGenders,
        maxDistance: Math.round(distance),
        paces: selectedPaces,
        sameFacultyOnly,
        years: selectedYears,
      });
      setAgeMin(normalizedAgeMin);
      setAgeMax(normalizedAgeMax);
      setAvailabilityFilterActive(
        selectedAvailabilityPeriods.length > 0
        && selectedAvailabilityPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length
      );
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

  const selectedAvailabilityPeriods = useMemo(
    () => (availabilityFilterActive
      ? getSelectedMatchingValues(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods)
      : []),
    [availabilityFilterActive, availabilityPeriods]
  );

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (selectedCategory !== 'all' && candidate.activity !== selectedCategory && !candidate.activities?.includes(selectedCategory)) return false;
      if (activeFacultyFilter !== 'all' && candidate.faculty !== activeFacultyFilter) return false;
      if (sameFacultyOnly && candidate.faculty !== profile?.faculty) return false;
      if (availabilityFilterActive) {
        if (
          selectedAvailabilityPeriods.length > 0
          && !matchesAvailabilityPeriods(candidate, selectedAvailabilityPeriods)
        ) {
          return false;
        }
      }
      return true;
    });
    return dailyPick(filtered, getDailySeed() + (profile?.id || ''));
  }, [activeFacultyFilter, availabilityFilterActive, availableProfiles, profile?.faculty, profile?.id, sameFacultyOnly, selectedAvailabilityPeriods, selectedCategory]);

  const currentProfile = filteredProfiles[0] || null;
  const meetupStats = profile && getMeetupStats ? getMeetupStats(profile) : null;

  useEffect(() => {
    if (!availableProfiles || !availableProfiles.length) return;
    const upcoming = availableProfiles.slice(0, 6);
    upcoming.forEach((item) => {
      const uri = item?.avatarUri || item?.photoURL;
      if (uri && typeof uri === 'string' && uri.startsWith('http')) {
        Image.prefetch(uri).catch(() => {});
      }
    });
  }, [availableProfiles]);

  useEffect(() => {
    if (currentProfile || !availableProfiles.length || filteredProfiles.length) {
      recycleLock.current = false;
      return undefined;
    }
    if (recycleLock.current) return undefined;
    recycleLock.current = true;
    const timer = setTimeout(() => {
      void recycleSkippedProfiles()?.catch?.((error) => {
        console.warn('[HomeScreen] recycleSkippedProfiles error:', error?.message || error);
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [availableProfiles.length, currentProfile, filteredProfiles.length, recycleSkippedProfiles]);

  const resetFilters = () => {
    void recycleSkippedProfiles()?.catch?.((error) => {
      console.warn('[HomeScreen] resetFilters recycle error:', error?.message || error);
    });
    setSelectedCategory('all');
    setDistance(25);
    setAgeMin(MATCHING_AGE_MIN);
    setAgeMax(MATCHING_DEFAULT_AGE_MAX);
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS));
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
    setAvailabilityFilterActive(false);
    void saveMatchingPreferences({
      ...(profile?.matchingPreferences || {}),
      activities: [],
      ageMin: MATCHING_AGE_MIN,
      ageMax: MATCHING_DEFAULT_AGE_MAX,
      availabilityPeriods: [],
      faculty: 'all',
      genders: [],
      maxDistance: 25,
      paces: [],
      sameFacultyOnly: false,
      years: [],
    }).catch((error) => console.error('[HomeScreen] Failed to reset filters:', error));
    setFaculty('all');
    setSameFacultyOnly(false);
  };

  return (
    <IosLikeScreen>
      <MatchingHeader onSettings={() => setShowSettings(true)} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {selectedMeetup ? <MeetupBanner meetup={selectedMeetup} stats={meetupStats} /> : null}

        <View style={styles.quickFilterRow}>
          <QuickFilterButton
            badge={pendingIncomingLikes.length}
            label="ถูกใจ & จับคู่"
            onPress={openLikes}
          />
          <QuickFilterButton
            label="เริ่มใหม่"
            onPress={resetFilters}
          />
        </View>

        {currentProfile ? (
          <>
            <DiscoverProfileCard
              candidate={currentProfile}
              onPress={() => router.push({ pathname: '/discover-profile', params: { profileId: currentProfile.id } })}
            />
            <View style={styles.shortcutRow}>
              <ResetCountdownPill />
              <ShortcutPill accent icon="flame.fill" label="สถิติแมตช์" value={String(Math.max(matchedProfileIds.length, conversations.length))} />
            </View>
          </>
        ) : (
          <EmptyState onReset={resetFilters} />
        )}
      </ScrollView>

      <SettingsModal
        activities={activities}
        ageMax={ageMax}
        ageMin={ageMin}
        availabilityPeriods={availabilityPeriods}
        distance={distance}
        faculty={faculty}
        facultySaving={facultySaving}
        genders={genders}
        onAgeMax={(value) => {
          const nextMax = normalizeMatchingAge(value, ageMax);
          setAgeMax(nextMax);
          if (nextMax < ageMin) {
            setAgeMin(nextMax);
          }
        }}
        onAgeMin={(value) => {
          const nextMin = normalizeMatchingAge(value, ageMin);
          setAgeMin(nextMin);
          if (nextMin > ageMax) {
            setAgeMax(nextMin);
          }
        }}
        onActivities={(id) => setActivities((current) => ({ ...current, [id]: !current[id] }))}
        onAvailability={toggleAvailabilityPeriod}
        onClose={() => setShowSettings(false)}
        onDistance={setDistance}
        onFaculty={(nextFaculty) => {
          setFaculty(nextFaculty);
          setSameFacultyOnly(false);
        }}
        onSave={saveSearchSettings}
         onGenders={(key) => setGenders((current) => ({ ...current, [key]: !current[key] }))}
         onPaces={(value) => setPaces((current) => ({ ...current, [value]: !current[value] }))}
         onSameFaculty={() => {
           setSameFacultyOnly((current) => !current);
           setFaculty('all');
         }}
         onYears={(key) => setYears((current) => ({ ...current, [key]: !current[key] }))}
         paces={paces}
         saving={settingsSaving}
        sameFacultyOnly={sameFacultyOnly}
        visible={showSettings}
        years={years}
      />
    </IosLikeScreen>
  );
}

function MatchingHeader({ onSettings }) {
  const { colors, isDark } = useTheme();
  return (
    <View pointerEvents="box-none" style={[styles.matchingHeader, { backgroundColor: colors.canvas }]}>
      <BlurView intensity={isDark ? 30 : 40} pointerEvents="none" tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={[styles.matchingHeaderSurface, { backgroundColor: isDark ? 'rgba(20,23,27,0.96)' : 'rgba(246,248,252,0.98)' }]}
      />
      <View style={styles.matchingHeaderContent}>
        <Text style={[styles.matchingHeaderTitle, { color: colors.ink }]}>หาเพื่อน</Text>
        <View style={styles.matchingHeaderActions}>
          <IconButton accessibilityLabel="เปิดการตั้งค่าการจับคู่" icon="gearshape.fill" onPress={onSettings} size={20} style={[styles.matchingHeaderButton, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]} tintColor={colors.ink} />
        </View>
      </View>
    </View>
  );
}

function QuickFilterButton({ badge = 0, label, onPress }) {
  const { colors, isDark } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.quickFilter, { backgroundColor: isDark ? colors.surfaceRaised : colors.primarySoft, borderColor: 'transparent' }, pressed && styles.pressed]}>
      <Text style={[styles.quickFilterText, { color: colors.ink }]}>{label}</Text>
      {badge > 0 ? <View style={[styles.quickBadgeDot, { backgroundColor: colors.primary }]} /> : null}
    </Pressable>
  );
}

function MeetupBanner({ meetup, stats }) {
  const { colors, isDark } = useTheme();
  const meetupColor = colors.primaryDark;
  const fullColor = colors.danger;
  const meetupSoft = colors.primarySoft;
  const meetupBorder = isDark ? 'rgba(154,140,255,0.28)' : 'rgba(91,92,226,0.16)';
  return (
    <View style={[styles.meetupBanner, { backgroundColor: meetupSoft, borderColor: meetupBorder, shadowColor: meetupColor }]}>
      <Pressable accessibilityRole="button" onPress={() => router.push('/meetup')} style={({ pressed }) => [styles.meetupBannerMain, pressed && styles.pressed]}>
        <View style={[styles.meetupIcon, { backgroundColor: meetupColor }]}><FeatureIcon color="#FFFFFF" name="mappin.and.ellipse" size={13} /></View>
        <View style={styles.meetupCopy}>
          <View style={styles.meetupTitleRow}>
            <Text numberOfLines={1} style={[styles.meetupEyebrow, { color: colors.ink }]}>{'จุดนัดพบ'}</Text>
            <Text style={[styles.meetupStatus, { color: stats?.isFull ? fullColor : meetupColor }]}>{stats ? (stats.isFull ? 'เต็มแล้ว' : `ร่วม ${stats.acceptedCount}/${stats.maxPeople}`) : 'พร้อม'}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.meetupName, { color: colors.ink }]}>{meetup.name}</Text>
          <Text numberOfLines={1} style={[styles.meetupMeta, { color: colors.inkMuted }]}>{meetup.schedule?.date ? formatReadableDate(meetup.schedule.date) : 'แตะเพื่อจัดการจุดนัดพบ'}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="จัดการจุดนัดพบ" onPress={() => router.push('/meetup')} style={({ pressed }) => [styles.meetupManage, { backgroundColor: meetupColor }, pressed && styles.pressed]}>
        <Text style={styles.meetupManageText}>จัดการ</Text>
      </Pressable>
    </View>
  );
}

function DiscoverProfileCard({ candidate, onPress }) {
  const { colors, isDark } = useTheme();
  const imageUri = useRemoteImage(candidate.avatarUri, candidate.updatedAt, candidate.id);
  const gradientColors = isDark
    ? ['rgba(20,23,27,0)', 'rgba(20,23,27,0.42)', 'rgba(20,23,27,0.9)']
    : ['rgba(16,32,58,0)', 'rgba(16,32,58,0.28)', 'rgba(16,32,58,0.82)'];
  return (
    <Pressable accessibilityLabel={`เปิดโปรไฟล์ ${candidate.name}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <IosLikeCard style={styles.profileCard}>
        <View style={[styles.profileHero, { backgroundColor: candidate.avatarColor || colors.primarySoft }]}>
          {imageUri ? <Image resizeMode="cover" source={{ uri: imageUri }} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} /> : <View style={styles.profilePlaceholder}><FeatureIcon color={colors.inkMuted} name="person.crop.square.fill" size={84} /></View>}
          <MaskedView
            pointerEvents="none"
            style={styles.profileBlur}
            maskElement={<LinearGradient colors={['transparent', '#FFFFFF', '#FFFFFF']} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />}
          >
            <BlurView intensity={isDark ? 38 : 48} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={gradientColors} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
          </MaskedView>
          <View style={styles.profileHeroCopy}>
            {candidate.isMatched ? <View style={styles.matchedBadge}><FeatureIcon color="#FFFFFF" name="person.2.fill" size={12} /><Text style={styles.matchedBadgeText}>เพื่อนที่คุณแมตช์แล้ว 💬</Text></View> : null}
            <Text numberOfLines={1} style={styles.profileHeroName}>{candidate.name}{candidate.age ? `, ${candidate.age}` : ''}</Text>
            <Text numberOfLines={1} style={styles.profileHeroMeta}>{[getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities), candidate.faculty].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}</Text>
          </View>

        </View>
      </IosLikeCard>
    </Pressable>
  );
}

function ShortcutPill({ accent = false, icon, label, value }) {
  const { colors, isDark } = useTheme();
  const backgroundColor = accent && !isDark ? '#E7EBF2' : colors.surfaceRaised;
  return (
    <View style={[styles.shortcutPill, { backgroundColor }]}>
      <FeatureIcon color={accent ? colors.coral : colors.primary} name={icon} size={12} />
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={[styles.shortcutLabel, { color: colors.ink }]}>{label}</Text>
      {value ? <Text numberOfLines={1} style={[styles.shortcutValue, { color: colors.ink }]}>{value}</Text> : null}
    </View>
  );
}

function ResetCountdownPill() {
  const [timeLeft, setTimeLeft] = useState(getRemainingTime());

  useEffect(() => {
    const updateCountdown = () => setTimeLeft(getRemainingTime());
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, []);

  return <ShortcutPill icon="clock.arrow.2.circlepath" label={`รีเซ็ตใน ${formatRemainingTime(timeLeft)}`} />;
}

function EmptyState({ onReset }) {
  const { colors } = useTheme();
  return (
    <IosLikeCard style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}><FeatureIcon color={colors.primary} name="person.2.slash" size={28} /></View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>ยังไม่มีโปรไฟล์ที่ตรงกัน</Text>
      <Text style={[styles.emptyText, { color: colors.inkMuted }]}>ระบบจะค้นหาโปรไฟล์ใหม่โดยอัตโนมัติ หากตัวกรองไม่มีคนที่ตรงกัน</Text>
      <Pressable accessibilityRole="button" onPress={onReset} style={({ pressed }) => [styles.resetButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
        <FeatureIcon color="#FFFFFF" name="arrow.triangle.2.circlepath" size={17} />
        <Text style={styles.resetButtonText}>เริ่มใหม่</Text>
      </Pressable>
    </IosLikeCard>
  );
}

function SettingsModal({ activities, ageMax, ageMin, availabilityPeriods, distance, faculty, facultySaving, genders, onActivities, onAgeMax, onAgeMin, onAvailability, onClose, onDistance, onFaculty, onGenders, onPaces, onSave, onSameFaculty, onYears, paces, saving, sameFacultyOnly, visible, years }) {
  const { colors } = useTheme();
  const sheetOffset = useRef(new Animated.Value(600)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(sheetOffset, {
        toValue: 700,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      closeRef.current?.();
      isClosingRef.current = false;
    });
  }, [sheetOffset, fadeAnim]);

  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      sheetOffset.setValue(600);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(sheetOffset, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, sheetOffset, fadeAnim]);

  const sheetPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => {
      // Immediate response when pressing anywhere on the top handle / header area (top 85px)
      return evt.nativeEvent.locationY <= 85;
    },
    onStartShouldSetPanResponderCapture: (evt) => {
      return evt.nativeEvent.locationY <= 85;
    },
    onMoveShouldSetPanResponder: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      // Intercept downward drag from anywhere on the header area so children don't block dragging
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderGrant: () => {
      sheetOffset.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        sheetOffset.setValue(gestureState.dy);
      } else {
        sheetOffset.setValue(gestureState.dy * 0.15);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 70 || gestureState.vy > 0.5) {
        closeWithAnimation();
      } else {
        Animated.spring(sheetOffset, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      Animated.spring(sheetOffset, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 280,
        useNativeDriver: true,
      }).start();
    },
  }), [closeWithAnimation, sheetOffset]);

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={closeWithAnimation}>
      <View style={styles.modalBackdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]}>
          <Pressable accessibilityLabel="ปิดการตั้งค่าตัวกรอง" onPress={closeWithAnimation} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          style={[
            styles.settingsSheet,
            {
              backgroundColor: colors.card,
              zIndex: 10,
              elevation: 20,
              transform: [{ translateY: sheetOffset }],
            },
          ]}
        >
          {/* Header Draggable Area */}
          <View
            {...sheetPan.panHandlers}
            accessibilityHint="ลากลงเพื่อปิดตัวกรอง"
            onAccessibilityEscape={closeWithAnimation}
            style={{ width: '100%', paddingTop: 4, paddingBottom: 6 }}
          >
            <View style={{ alignItems: 'center', justifyContent: 'center', width: '100%', paddingTop: 4, paddingBottom: 12 }}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.inkSoft, opacity: 0.45 }]} />
            </View>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetTitle, { color: colors.ink }]}>ตั้งค่าการจับคู่</Text>
                <Text style={[styles.sheetSubtitle, { color: colors.inkMuted }]}>ตัวกรองจะใช้กับการค้นหาเพื่อนของคุณ</Text>
              </View>
            </View>
          </View>
           <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
             <FilterSectionLabel label="ช่วงอายุ" />
             <View style={styles.agePickerRow}>
               <AgePicker label="อายุต่ำสุด" onValueChange={onAgeMin} value={ageMin} />
               <AgePicker label="อายุสูงสุด" onValueChange={onAgeMax} value={ageMax} />
             </View>
             <Text style={[styles.filterHelper, { color: colors.inkMuted }]}>ระบบจะแสดงคนอายุ {ageMin}–{ageMax} ปี</Text>

             <FilterSectionLabel label="ระยะห่างจากคุณ" />
             <View style={[styles.distanceCard, { backgroundColor: colors.surfaceRaised }]}>
               <View style={styles.distanceHeader}><Text style={[styles.distanceValue, { color: colors.primary }]}>{Math.round(distance)} กม.</Text><Text style={[styles.distanceHint, { color: colors.inkMuted }]}>ค้นหาเพื่อนในรัศมี</Text></View>
               <View style={styles.distanceControls}>
                 {[5, 15, 25, 50].map((value) => <IosLikePill active={Math.round(distance) === value} key={value} onPress={() => onDistance(value)}>{`${value} กม.`}</IosLikePill>)}
               </View>
             </View>

             <FilterSectionLabel label="กิจกรรมที่สนใจ" />
             <View style={styles.optionGrid}>
               {MATCHING_ACTIVITY_OPTIONS.map(({ icon, label, value }) => (
                 <OptionToggle active={activities[value]} icon={icon} key={value} label={label} onPress={() => onActivities(value)} />
               ))}
             </View>
             <Text style={[styles.filterHelper, { color: colors.inkMuted }]}>เลือกได้หลายกิจกรรม ระบบจะแสดงคนที่ตรงกับอย่างน้อยหนึ่งข้อ</Text>

             <FilterSectionLabel label="ช่วงชั้นปี" />
             <View style={styles.optionGrid}>
              {MATCHING_YEAR_OPTIONS.map(({ icon, label, value }) => (
                <OptionToggle active={years[value]} icon={icon} key={value} label={label} onPress={() => onYears(value)} />
              ))}
             </View>

            <FilterSectionLabel label="คณะ" />
            <ScrollView contentContainerStyle={styles.settingPills} horizontal showsHorizontalScrollIndicator={false}>
              {['all', ...FACULTIES].map((item) => <IosLikePill active={!sameFacultyOnly && faculty === item} key={item} onPress={() => onFaculty(item)}>{item === 'all' ? 'ทุกคณะ' : item}</IosLikePill>)}
             </ScrollView>
             <SettingRow icon="building.columns.fill" label="เฉพาะคณะเดียวกับฉัน" onPress={onSameFaculty} value={sameFacultyOnly} />

             <FilterSectionLabel label="เพซ / ระดับกิจกรรม" />
             <View style={styles.optionGrid}>
               {MATCHING_PACE_OPTIONS.map(({ icon, label, value }) => (
                 <OptionToggle active={paces[value]} icon={icon} key={value} label={label} onPress={() => onPaces(value)} />
               ))}
             </View>

             <FilterSectionLabel label="ช่วงเวลาที่สะดวก" />
             <View style={styles.optionGrid}>
               {MATCHING_AVAILABILITY_OPTIONS.map(({ icon, label, value }) => (
                 <OptionToggle active={availabilityPeriods[value]} icon={icon} key={value} label={label} onPress={() => onAvailability(value)} />
               ))}
             </View>
             <Text style={[styles.filterHelper, { color: colors.inkMuted }]}>จับคู่จากช่วงเวลาที่โปรไฟล์อีกฝ่ายระบุไว้</Text>

             <FilterSectionLabel label="เพศ" />
             <View style={styles.optionGrid}>
              {MATCHING_GENDER_OPTIONS.map(({ icon, label, value }) => (
                <OptionToggle active={genders[value]} icon={icon} key={value} label={label} onPress={() => onGenders(value)} />
              ))}
             </View>
            <Text style={[styles.genderHelper, { color: colors.inkMuted }]}>เลือกเพศที่อยากพบได้มากกว่าหนึ่งข้อ</Text>

          </ScrollView>
          <View style={[styles.settingsFooter, { borderTopColor: colors.line }]}>
            {facultySaving || saving ? <Text style={[styles.savingText, { color: colors.primary }]}>กำลังบันทึกการตั้งค่า…</Text> : null}
            <Pressable accessibilityRole="button" disabled={saving} onPress={onSave} style={({ pressed }) => [styles.doneButton, { backgroundColor: colors.primary }, pressed && styles.pressed, saving && styles.disabled]}><Text style={styles.doneButtonText}>{saving ? 'กำลังบันทึก…' : 'บันทึกตัวกรอง'}</Text></Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AgePicker({ label, onValueChange, value }) {
  const { colors } = useTheme();
  return (
    <View style={styles.agePickerColumn}>
      <Text style={[styles.agePickerLabel, { color: colors.inkMuted }]}>{label}</Text>
      <View style={[styles.agePicker, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
        <NativePicker
          dropdownIconColor={colors.inkMuted}
          mode="dropdown"
          onValueChange={onValueChange}
          selectedValue={value}
          style={[styles.agePickerInput, { color: colors.ink }]}
        >
          {MATCHING_AGE_VALUES.map((age) => (
            <NativePicker.Item key={age} label={`${age} ปี`} value={age} />
          ))}
        </NativePicker>
      </View>
    </View>
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
  content: { gap: 22, paddingBottom: spacing.xxxl, paddingHorizontal: spacing.xl, paddingTop: 92 },
  matchingHeader: { height: 85, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 20 },
  matchingHeaderSurface: { ...StyleSheet.absoluteFillObject },
  matchingHeaderContent: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 15, paddingHorizontal: spacing.xl, paddingTop: 35 },
  matchingHeaderTitle: { fontSize: type.title1, fontWeight: '800', letterSpacing: -0.4 },
  matchingHeaderActions: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  matchingHeaderButton: { height: 36, width: 36 },
  quickFilterRow: { flexDirection: 'row', gap: spacing.sm },
  quickFilter: { alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 7 },
  quickFilterText: { fontSize: type.body, fontWeight: '700' },
  quickBadgeDot: { borderRadius: radius.pill, height: 6, marginLeft: 1, width: 6 },
  meetupBanner: { alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 9, shadowColor: '#17805A', shadowOffset: { height: 2, width: 0 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  meetupBannerMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, minWidth: 0 },
  meetupIcon: { alignItems: 'center', borderRadius: radius.pill, height: 32, justifyContent: 'center', width: 32 },
  meetupCopy: { flex: 1 },
  meetupTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  meetupEyebrow: { fontSize: type.caption2, fontWeight: '700' },
  meetupStatus: { fontSize: 10, fontWeight: '700' },
  meetupName: { fontSize: 13.5, fontWeight: '800', marginTop: 1 },
  meetupMeta: { fontSize: 10.5, marginTop: 1 },
  meetupManage: { alignItems: 'center', borderRadius: radius.pill, justifyContent: 'center', minHeight: 32, paddingHorizontal: 10 },
  meetupManageText: { color: '#FFFFFF', fontSize: type.caption2, fontWeight: '800' },
  profileCard: { borderColor: 'transparent', borderRadius: 24, borderWidth: 0, elevation: 6, overflow: 'hidden', padding: 0, shadowColor: '#000000', shadowOffset: { height: 10, width: 0 }, shadowOpacity: 0.28, shadowRadius: 22 },
  profileHero: { borderRadius: 24, height: 340, justifyContent: 'flex-end', overflow: 'hidden', position: 'relative' },
  profileBlur: { bottom: 0, height: 158, left: 0, position: 'absolute', right: 0 },
  profilePlaceholder: { alignItems: 'center', flex: 1, justifyContent: 'center', width: '100%' },
  profileHeroCopy: { bottom: 22, left: 18, position: 'absolute', right: 18 },
  profileHeroName: { color: '#FFFFFF', fontSize: type.title, fontWeight: '800', letterSpacing: -0.4 },
  profileHeroMeta: { color: 'rgba(255,255,255,0.88)', fontSize: type.subheadline, fontWeight: '600', marginTop: 5 },
  matchedBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.pill, flexDirection: 'row', gap: 4, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4 },
  matchedBadgeText: { color: '#FFFFFF', fontSize: type.caption2, fontWeight: '700' },
  compatibility: { alignItems: 'center', borderRadius: radius.pill, bottom: spacing.lg, elevation: 4, paddingHorizontal: 10, paddingVertical: 7, position: 'absolute', right: spacing.lg, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 8 },
  compatibilityValue: { fontSize: type.headline, fontWeight: '800' },
  compatibilityLabel: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  shortcutRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  shortcutPill: { alignItems: 'center', borderRadius: radius.pill, flex: 1, flexDirection: 'row', gap: 6, minHeight: 0, minWidth: 0, paddingHorizontal: 11, paddingVertical: 7 },
  shortcutLabel: { flexShrink: 1, fontSize: type.caption2, fontWeight: '700' },
  shortcutValue: { fontSize: type.caption2, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingHorizontal: 22, paddingVertical: 36 },
  emptyIcon: { alignItems: 'center', borderRadius: radius.pill, height: 58, justifyContent: 'center', width: 58 },
  emptyTitle: { fontSize: type.headline, fontWeight: '800', marginTop: spacing.md },
  emptyText: { fontSize: type.caption, lineHeight: 18, marginTop: spacing.sm, textAlign: 'center' },
  resetButton: { alignItems: 'center', borderRadius: radius.pill, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: spacing.lg, minHeight: 48, paddingHorizontal: spacing.xl, width: '100%' },
  resetButtonText: { color: '#FFFFFF', fontSize: type.caption, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  settingsSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, height: '90%', overflow: 'hidden', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  settingsScroll: { flex: 1, minHeight: 0 },
  settingsFooter: { flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  sheetHandle: { alignSelf: 'center', borderRadius: radius.pill, height: 5, opacity: 0.45, width: 44 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.md },
  sheetTitle: { fontSize: type.headline, fontWeight: '800' },
  sheetSubtitle: { fontSize: type.caption2, marginTop: 3 },
  settingsContent: { gap: spacing.md, paddingBottom: spacing.xl },
  settingLabel: { fontSize: type.caption, fontWeight: '800', marginTop: spacing.sm },
  filterHelper: { fontSize: type.caption2, lineHeight: 16, marginTop: -spacing.sm },
  agePickerRow: { flexDirection: 'row', gap: spacing.sm },
  agePickerColumn: { flex: 1, gap: spacing.xs },
  agePickerLabel: { fontSize: type.caption2, fontWeight: '700' },
  agePicker: { borderRadius: radius.md, borderWidth: 1, minHeight: 52, justifyContent: 'center' },
  agePickerInput: { height: 52, width: '100%' },
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
