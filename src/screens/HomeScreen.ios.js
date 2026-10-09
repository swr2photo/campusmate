import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import RNText from '../components/AppText';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getImageRequestUri, useProfileImagePrefetch } from '../utils/useRemoteImage';
import ExpoImage from '../components/CachedImage';
import { formatDistance, formatReadableDate, getActivityLabel } from '../utils/formatters';
import { dailyPick, getDailySeed, pickDailyProfile } from '../utils/dailyPick';
import { FACULTIES } from '../data/faculties';
import {
  MATCHING_ACTIVITY_OPTIONS,
  MATCHING_AGE_MAX,
  MATCHING_AGE_MIN,
  MATCHING_AVAILABILITY_OPTIONS,
  MATCHING_DEFAULT_AGE_MAX,
  MATCHING_GENDER_OPTIONS,
  MATCHING_MORE_ACTIVITY_OPTIONS,
  MATCHING_MORE_GENDER_OPTIONS,
  MATCHING_PACE_OPTIONS,
  MATCHING_PRIMARY_ACTIVITY_OPTIONS,
  MATCHING_PRIMARY_GENDER_OPTIONS,
  MATCHING_UNLIMITED_DISTANCE,
  MATCHING_WEEKDAY_OPTIONS,
  MATCHING_YEAR_OPTIONS,
  clearActivityDetailFilter,
  createMatchingOptionState,
  getActivityDetailFilterOptions,
  getSelectedMatchingValues,
  matchesActivityDetailFilters,
  matchesAvailabilityPeriods,
  pruneActivityDetailFilters,
  toggleActivityDetailFilter,
  matchesAvailabilityWeekdays,
  normalizeMatchingAge,
  profileHasAvailability,
  profileHasPhoto,
  toggleMatchingOption,
} from '../data/matchingFilters';
import { router, useFocusEffect } from 'expo-router';
import { useEntitlement } from '../context/MembershipContext';
import NativeTourTarget from '../components/NativeTourTarget.ios';
import { useDiscoveryDeckState } from '../hooks/useDiscoveryDeckState';
import { FEATURE_ADVANCED_FILTERS, FEATURE_UNLIMITED_REWIND, stripPaidMatchingPreferences } from '../data/plans';
import { ContentUnavailableView, Host, HStack, Image, BottomSheet, Form, Section, Slider, Picker, Menu, Toggle, ScrollView, Spacer, VStack, ZStack, RNHostView, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityHint, accessibilityLabel, aspectRatio, background, buttonBorderShape, buttonStyle, clipShape, clipped, contentShape, controlSize, disabled, foregroundStyle, frame, labelStyle, lineLimit, onTapGesture, padding, presentationDetents, presentationDragIndicator, pickerStyle, resizable, scrollIndicators, scrollPosition, scrollTargetLayout, shadow, shapes, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppBadges, useAppFeed, useAppProfile } from '../context/AppContext';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { View, Pressable, useColorScheme } from 'react-native';

const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

const usePalette = useNativePalette;

const cardShape = shapes.roundedRectangle({
  cornerRadius: 24,
  roundedCornerStyle: 'continuous',
});
const panelShape = shapes.roundedRectangle({
  cornerRadius: 18,
  roundedCornerStyle: 'continuous',
});

function getRemainingTimeUntilMidnight() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const diff = Math.max(0, tomorrow.getTime() - now.getTime());
  const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
  const minutes = Math.floor((diff / (1000 * 60)) % 60).toString().padStart(2, '0');
  const seconds = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}


export default function HomeScreen() {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const {
    availableProfiles,
    hasMoreProfiles = false,
    isLoadingMoreProfiles = false,
    isResolvingDistances = false,
    isDiscoveryReady = false,
    discoveryError = null,
    selectedMeetup,
  } = useAppFeed();
  const { conversationCount = 0, matchedCount: matchedProfileCount = 0 } = useAppBadges();
  const { getMeetupStats, loadMoreProfiles, recycleSkippedProfiles, retryDiscovery, saveMatchingPreferences } = useAppActions();
  const { profile } = useAppProfile();
  // CampusMate Plus gates (src/data/plans.js).
  const advancedFilters = useEntitlement(FEATURE_ADVANCED_FILTERS);
  const rewind = useEntitlement(FEATURE_UNLIMITED_REWIND);
  const tourScrollPosition = useNativeState(null);
  const myMeetupStats = useMemo(() => (profile ? getMeetupStats(profile) : null), [profile, getMeetupStats]);
  const matchedCount = Math.max(matchedProfileCount, conversationCount);

  // Settings BottomSheet State
  const [showSettings, setShowSettings] = useState(false);
  const [distance, setDistance] = useState(25);
  const [ageMin, setAgeMin] = useState(MATCHING_AGE_MIN);
  const [ageMax, setAgeMax] = useState(MATCHING_DEFAULT_AGE_MAX);
  const [years, setYears] = useState(() => createMatchingOptionState(MATCHING_YEAR_OPTIONS));
  const [genders, setGenders] = useState(() => createMatchingOptionState(MATCHING_GENDER_OPTIONS));
  const [activities, setActivities] = useState(() => createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
  const [paces, setPaces] = useState(() => createMatchingOptionState(MATCHING_PACE_OPTIONS));
  const [detailFilters, setDetailFilters] = useState({});
  const [availabilityPeriods, setAvailabilityPeriods] = useState(() => createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
  const [weekdays, setWeekdays] = useState(() => createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS));
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [requireAvailability, setRequireAvailability] = useState(false);
  const [availabilityFilterActive, setAvailabilityFilterActive] = useState(false);
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [faculty, setFaculty] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const pinnedDailyRef = useRef({ day: getDailySeed(), id: null });
  
  const [showFilters, setShowFilters] = useState(false);
  
  React.useEffect(() => {
    if (!profile) return;
    const preferences = stripPaidMatchingPreferences(profile.matchingPreferences || {}, advancedFilters.allowed);
    const selectedActivities = preferences.activities || [];
    const selectedYears = preferences.years || [];
    const selectedGenders = preferences.genders || [];
    const selectedPaces = preferences.paces || [];
    const selectedAvailabilityPeriods = preferences.availabilityPeriods || [];
    const selectedWeekdays = preferences.weekdays || [];
    const normalizedAgeMin = normalizeMatchingAge(preferences.ageMin, MATCHING_AGE_MIN);
    const normalizedAgeMax = Math.max(
      normalizedAgeMin,
      normalizeMatchingAge(preferences.ageMax, MATCHING_DEFAULT_AGE_MAX)
    );
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS, selectedActivities));
    setFaculty(preferences.faculty || 'all');
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS, selectedYears));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS, selectedGenders));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS, selectedPaces));
    setDetailFilters(pruneActivityDetailFilters(preferences.activityDetails, selectedActivities));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS, selectedAvailabilityPeriods));
    setWeekdays(createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS, selectedWeekdays));
    setDistance(Number.isFinite(Number(preferences.maxDistance)) ? Number(preferences.maxDistance) : 25);
    setAgeMin(normalizedAgeMin);
    setAgeMax(normalizedAgeMax);
    setSameFacultyOnly(preferences.sameFacultyOnly ?? false);
    setRequirePhoto(preferences.requirePhoto === true);
    setRequireAvailability(preferences.requireAvailability === true);
    setAvailabilityFilterActive(
      selectedAvailabilityPeriods.length > 0
      && selectedAvailabilityPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length
    );
  }, [
    profile?.id,
    profile?.matchingPreferences?.activities,
    profile?.matchingPreferences?.activityDetails,
    profile?.matchingPreferences?.ageMax,
    profile?.matchingPreferences?.ageMin,
    profile?.matchingPreferences?.availabilityPeriods,
    profile?.matchingPreferences?.faculty,
    profile?.matchingPreferences?.genders,
    profile?.matchingPreferences?.maxDistance,
    profile?.matchingPreferences?.paces,
    profile?.matchingPreferences?.requireAvailability,
    profile?.matchingPreferences?.requirePhoto,
    profile?.matchingPreferences?.sameFacultyOnly,
    profile?.matchingPreferences?.weekdays,
    profile?.matchingPreferences?.years,
    advancedFilters.allowed,
  ]);

  const handleFacultySelection = (nextFaculty) => {
    if (!advancedFilters.guard()) return;
    setFaculty(nextFaculty);
    if (nextFaculty !== 'all') setSameFacultyOnly(false);
  };

  const handleSameFacultySelection = (enabled) => {
    if (!advancedFilters.guard()) return;
    setSameFacultyOnly(enabled);
    if (enabled) setFaculty('all');
  };

  const saveSearchSettings = async () => {
    const selectedActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
    const selectedYears = getSelectedMatchingValues(MATCHING_YEAR_OPTIONS, years);
    const selectedGenders = getSelectedMatchingValues(MATCHING_GENDER_OPTIONS, genders);
    const selectedPaces = getSelectedMatchingValues(MATCHING_PACE_OPTIONS, paces);
    const selectedAvailabilityPeriods = getSelectedMatchingValues(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods);
    const selectedWeekdays = getSelectedMatchingValues(MATCHING_WEEKDAY_OPTIONS, weekdays);
    const normalizedAgeMin = Math.min(
      MATCHING_AGE_MAX,
      Math.max(MATCHING_AGE_MIN, Math.round(ageMin))
    );
    const normalizedAgeMax = Math.max(
      normalizedAgeMin,
      Math.min(MATCHING_AGE_MAX, Math.max(MATCHING_AGE_MIN, Math.round(ageMax)))
    );
    await saveMatchingPreferences({
      ...(profile.matchingPreferences || {}),
      activities: selectedActivities,
      activityDetails: pruneActivityDetailFilters(detailFilters, selectedActivities),
      ageMin: normalizedAgeMin,
      ageMax: normalizedAgeMax,
      availabilityPeriods: selectedAvailabilityPeriods,
      faculty: sameFacultyOnly ? 'all' : faculty,
      genders: selectedGenders,
      maxDistance: Math.round(distance),
      paces: selectedPaces,
      requireAvailability,
      requirePhoto,
      sameFacultyOnly,
      weekdays: selectedWeekdays,
      years: selectedYears,
    });
    setAgeMin(normalizedAgeMin);
    setAgeMax(normalizedAgeMax);
    setAvailabilityFilterActive(
      selectedAvailabilityPeriods.length > 0
      && selectedAvailabilityPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length
    );
    setShowSettings(false);
  };

  const activeFacultyFilter = sameFacultyOnly
    ? (profile?.faculty || 'all')
    : (faculty || 'all');
  const selectedFilterActivities = useMemo(
    () => getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities),
    [activities]
  );
  const detailFilterSections = useMemo(
    () => selectedFilterActivities.map(getActivityDetailFilterOptions).filter(Boolean),
    [selectedFilterActivities]
  );
  const savedDetailFilters = useMemo(
    () => pruneActivityDetailFilters(
      profile?.matchingPreferences?.activityDetails,
      profile?.matchingPreferences?.activities || []
    ),
    [profile?.matchingPreferences?.activityDetails, profile?.matchingPreferences?.activities]
  );

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (selectedCategory !== 'all' && candidate.activity !== selectedCategory && !candidate.activities?.includes(selectedCategory)) return false;
      if (!matchesActivityDetailFilters(candidate, savedDetailFilters)) return false;
      if (activeFacultyFilter !== 'all' && candidate.faculty !== activeFacultyFilter) return false;
      if (sameFacultyOnly && candidate.faculty !== profile?.faculty) return false;
      if (availabilityFilterActive) {
        const selectedAvailabilityPeriods = getSelectedMatchingValues(
          MATCHING_AVAILABILITY_OPTIONS,
          availabilityPeriods
        );
        if (
          selectedAvailabilityPeriods.length > 0
          && !matchesAvailabilityPeriods(candidate, selectedAvailabilityPeriods)
        ) {
          return false;
        }
      }
      const selectedWeekdays = getSelectedMatchingValues(MATCHING_WEEKDAY_OPTIONS, weekdays);
      if (selectedWeekdays.length && !matchesAvailabilityWeekdays(candidate, selectedWeekdays)) return false;
      if (requirePhoto && !profileHasPhoto(candidate)) return false;
      if (requireAvailability && !profileHasAvailability(candidate)) return false;
      return true;
    });
    const today = getDailySeed();
    if (pinnedDailyRef.current.day !== today) {
      pinnedDailyRef.current = { day: today, id: null };
    }
    const seed = `${today}:${profile?.id || ''}`;
    const picked = pinnedDailyRef.current.id
      ? pickDailyProfile(filtered, seed, pinnedDailyRef.current.id)
      : dailyPick(filtered, seed);
    pinnedDailyRef.current.id = picked[0]?.id || null;
    return picked;
  }, [activeFacultyFilter, availabilityFilterActive, availabilityPeriods, availableProfiles, profile?.faculty, profile?.id, requireAvailability, requirePhoto, sameFacultyOnly, savedDetailFilters, selectedCategory, weekdays]);

  const currentProfile = filteredProfiles[0] || null;
  const imageUri = getImageRequestUri(currentProfile?.avatarUri, currentProfile?.avatarRevision);
  useProfileImagePrefetch(filteredProfiles.slice(1, 4));

  const deck = useDiscoveryDeckState({
    hasCandidate: Boolean(currentProfile),
    isDiscoveryReady,
    isLoadingMoreProfiles,
    isResolvingDistances,
    discoveryError,
    retryDiscovery,
  });
  const isWaitingForProfiles = deck.state === 'loading';
  const deckFailed = deck.state === 'error';
  const hasRequestedMoreForThisEmptyState = useRef(false);

  // When the deck runs dry, pull the next discovery page so new profiles show
  // up on their own. Skipped profiles stay skipped until the user explicitly
  // taps "เริ่มใหม่".
  useEffect(() => {
    if (filteredProfiles.length > 0 || isLoadingMoreProfiles || isResolvingDistances) {
      hasRequestedMoreForThisEmptyState.current = false;
      return;
    }
    if (!hasMoreProfiles || hasRequestedMoreForThisEmptyState.current) return;
    hasRequestedMoreForThisEmptyState.current = true;
    void loadMoreProfiles()?.catch?.((error) => {
      console.warn('[HomeScreen.ios] loadMoreProfiles error:', error?.message || error);
    });
  }, [filteredProfiles.length, hasMoreProfiles, isLoadingMoreProfiles, isResolvingDistances, loadMoreProfiles]);

  useFocusEffect(
    React.useCallback(() => {
      hasRequestedMoreForThisEmptyState.current = false;
      setRefreshTick((t) => t + 1);
    }, [])
  );

  const persistFacultyMatching = async (nextFaculty, nextSameFacultyOnly) => {
    if (!advancedFilters.guard()) return;
    const previousFaculty = faculty;
    const previousSameFacultyOnly = sameFacultyOnly;
    const normalizedSameFacultyOnly = nextSameFacultyOnly === true && Boolean(profile?.faculty);
    const normalizedFaculty = normalizedSameFacultyOnly ? 'all' : (nextFaculty || 'all');

    setFaculty(normalizedFaculty);
    setSameFacultyOnly(normalizedSameFacultyOnly);
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
    }
  };

  const persistAvailabilityPeriods = async (nextAvailabilityPeriods, nextActive) => {
    if (!advancedFilters.guard()) return;
    const previousAvailabilityPeriods = availabilityPeriods;
    const previousActive = availabilityFilterActive;
    setAvailabilityPeriods(nextAvailabilityPeriods);
    setAvailabilityFilterActive(nextActive);
    try {
      await saveMatchingPreferences({
        ...(profile?.matchingPreferences || {}),
        availabilityPeriods: getSelectedMatchingValues(MATCHING_AVAILABILITY_OPTIONS, nextAvailabilityPeriods),
      });
    } catch (error) {
      setAvailabilityPeriods(previousAvailabilityPeriods);
      setAvailabilityFilterActive(previousActive);
      console.error('[HomeScreen] Failed to save availability filter:', error);
    }
  };

  const toggleEveningFilter = () => {
    const nextAvailabilityPeriods = availabilityFilterActive
      ? { ...availabilityPeriods, evening: !availabilityPeriods.evening }
      : Object.fromEntries(MATCHING_AVAILABILITY_OPTIONS.map(({ value }) => [value, value === 'evening']));
    const selectedPeriods = MATCHING_AVAILABILITY_OPTIONS
      .filter(({ value }) => nextAvailabilityPeriods[value])
      .map(({ value }) => value);
    const normalizedAvailabilityPeriods = selectedPeriods.length === 0
      || selectedPeriods.length === MATCHING_AVAILABILITY_OPTIONS.length
      ? createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS)
      : nextAvailabilityPeriods;
    const nextActive = selectedPeriods.length > 0 && selectedPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length;
    void persistAvailabilityPeriods(normalizedAvailabilityPeriods, nextActive);
  };

  const toggleAvailabilityPeriod = (value) => {
    if (!advancedFilters.guard()) return;
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

  // "เริ่มใหม่" brings skipped profiles back and refreshes the deck while
  // keeping every saved filter untouched.
  const handleReset = () => {
    // "เริ่มใหม่" brings skipped people back: CampusMate Plus (unlimited rewind).
    if (!rewind.guard()) return;
    pinnedDailyRef.current.id = null;
    setSelectedCategory('all');
    void recycleSkippedProfiles()?.catch?.((error) => {
      console.warn('[HomeScreen.ios] handleReset recycle error:', error?.message || error);
    });
    if (hasMoreProfiles && !isLoadingMoreProfiles) {
      void loadMoreProfiles()?.catch?.((error) => {
        console.warn('[HomeScreen.ios] handleReset loadMore error:', error?.message || error);
      });
    }
  };



  const blurIntensity = colorScheme === 'dark' ? 30 : 40;
  const meetupAccent = colorScheme === 'dark' ? '#7966FF' : '#4546B8';
  const meetupSoft = colorScheme === 'dark' ? 'rgba(112,178,255,0.16)' : '#EEF2F7';

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Host
        colorScheme={colorScheme}
        seedColor={palette.purple}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsIndicators={false}
          modifiers={[scrollIndicators('never', 'vertical'), scrollPosition(tourScrollPosition, { anchor: 'top' })]}
        >
          <VStack
            alignment="leading"
            spacing={22}
            modifiers={[
              scrollTargetLayout(),
              padding({ top: 12, bottom: 36, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >
            <NativeTourTarget id="home.activities" ensureVisible={() => tourScrollPosition.set('home.activities')}>
              <FilterChips onAll={handleReset} />
            </NativeTourTarget>

            {showFilters && (
              <SmartFilters
                eveningOnly={availabilityFilterActive && availabilityPeriods.evening}
                onEvening={toggleEveningFilter}
                onSameFaculty={() => persistFacultyMatching('all', !sameFacultyOnly)}
                sameFacultyOnly={sameFacultyOnly}
              />
            )}

            {currentProfile ? (
              <>
                <NativeTourTarget id="home.deck" ensureVisible={() => tourScrollPosition.set('home.deck')}>
                <ProfileCard
                  candidate={currentProfile}
                  imageUri={imageUri}
                  onPress={() => router.push({
                    pathname: '/discover-profile',
                    params: { profileId: currentProfile.id },
                  })}
                />
                </NativeTourTarget>
                <DiscoveryShortcuts
                  matchedCount={matchedCount}
                  resetKey={currentProfile.id}
                />
              </>
            ) : (
              <VStack
                spacing={18}
                modifiers={[
                  padding({ vertical: 36, horizontal: 22 }),
                  frame({ maxWidth: Infinity }),
                  background(palette.card, cardShape),
                ]}
              >
                <ContentUnavailableView
                  description={deckFailed
                    ? (deck.offline
                      ? 'ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง โปรไฟล์จะโหลดเองเมื่อกลับมาออนไลน์'
                      : 'อาจเป็นเพราะสัญญาณไม่เสถียร ลองอีกครั้งหรือปรับตัวกรองการจับคู่')
                    : isWaitingForProfiles
                      ? 'กำลังโหลดโปรไฟล์และตรวจสอบระยะทาง โปรไฟล์จะแสดงเองเมื่อพร้อม'
                      : 'ตัวกรองของคุณยังคงอยู่ กด "เริ่มใหม่" เพื่อดูคนที่เคยข้ามอีกครั้ง หรือปรับตัวกรองจากมุมขวาบน'}
                  systemImage={deckFailed
                    ? (deck.offline ? 'wifi.slash' : 'exclamationmark.triangle')
                    : isWaitingForProfiles ? 'arrow.triangle.2.circlepath' : 'person.2.slash'}
                  title={deckFailed
                    ? (deck.offline ? 'ไม่ได้เชื่อมต่ออินเทอร์เน็ต' : deck.stalled ? 'โหลดโปรไฟล์นานกว่าปกติ' : 'โหลดโปรไฟล์ไม่สำเร็จ')
                    : isWaitingForProfiles ? 'กำลังค้นหาเพื่อนที่ตรงกัน…' : 'ยังไม่มีโปรไฟล์ที่ตรงกัน'}
                />
                {deckFailed ? (
                  <Button
                    label="ลองอีกครั้ง"
                    onPress={deck.retry}
                    systemImage="arrow.clockwise"
                    modifiers={[
                      buttonStyle('glassProminent'),
                      buttonBorderShape('capsule'),
                      controlSize('large'),
                      tint(palette.purple),
                      frame({ maxWidth: Infinity }),
                    ]}
                  />
                ) : null}
                {!isWaitingForProfiles && !deckFailed ? (
                  <Button
                    label="เริ่มใหม่"
                    onPress={handleReset}
                    systemImage="arrow.triangle.2.circlepath"
                    modifiers={[
                      buttonStyle('glassProminent'),
                      buttonBorderShape('capsule'),
                      controlSize('large'),
                      tint(palette.purple),
                      frame({ maxWidth: Infinity }),
                    ]}
                  />
                ) : null}
                {!isWaitingForProfiles ? (
                  <Button
                    label="ปรับตัวกรอง"
                    onPress={() => router.push('/matching-filters')}
                    systemImage="slider.horizontal.3"
                    modifiers={[
                      buttonStyle('glass'),
                      buttonBorderShape('capsule'),
                      controlSize('large'),
                      frame({ maxWidth: Infinity }),
                    ]}
                  />
                ) : null}
              </VStack>
            )}
          </VStack>
        </ScrollView>

        <BottomSheet
          isPresented={showSettings}
          onIsPresentedChange={setShowSettings}
          modifiers={[
            presentationDetents(['large']),
            presentationDragIndicator('visible')
          ]}
        >
          <Host colorScheme={colorScheme === 'dark' ? 'dark' : 'light'} seedColor={palette.purple} style={{ flex: 1 }}>
          <VStack style={{ flex: 1 }}>
            <Text
              modifiers={[
                font({ textStyle: 'headline', weight: 'bold' }),
                padding({ top: 20, bottom: 5 }),
                frame({ maxWidth: Infinity, alignment: 'center' })
              ]}
            >
              ตั้งค่าการจับคู่
            </Text>
            <Form>
              <Section header={<Text>ช่วงอายุ</Text>} footer={<Text>แสดงคนอายุ {Math.round(ageMin)}–{Math.round(ageMax)} ปี</Text>}>
                <Text>อายุต่ำสุด: {Math.round(ageMin)} ปี</Text>
                <Slider
                  value={ageMin}
                  onValueChange={(value) => setAgeMin(Math.min(Math.round(value), ageMax))}
                  min={MATCHING_AGE_MIN}
                  max={MATCHING_AGE_MAX}
                  step={1}
                />
                <Text>อายุสูงสุด: {Math.round(ageMax)} ปี</Text>
                <Slider
                  value={ageMax}
                  onValueChange={(value) => setAgeMax(Math.max(Math.round(value), ageMin))}
                  min={MATCHING_AGE_MIN}
                  max={MATCHING_AGE_MAX}
                  step={1}
                />
              </Section>
              <Section
                header={<Text>ระยะห่างจากคุณ</Text>}
                footer={<Text>{distance === MATCHING_UNLIMITED_DISTANCE ? 'ไม่จำกัดระยะ' : `ค้นหาในรัศมี ${Math.round(distance)} กม.`} ระยะใกล้กว่า 700 ม. แสดงเป็น 700 ม. และไม่เปิดเผยพิกัด</Text>}
              >
                <Toggle
                  isOn={distance === MATCHING_UNLIMITED_DISTANCE}
                  label="ไม่จำกัดระยะ"
                  onIsOnChange={(enabled) => setDistance(enabled ? MATCHING_UNLIMITED_DISTANCE : 25)}
                  systemImage="location.fill"
                />
                <Slider
                  max={50}
                  min={1}
                  onValueChange={setDistance}
                  step={1}
                  value={distance === MATCHING_UNLIMITED_DISTANCE ? 25 : Math.max(1, distance)}
                />
              </Section>
              <Section footer={<Text>เว้นว่างไว้ถ้าไม่ต้องการจำกัด</Text>} header={<Text>กิจกรรม</Text>}>
                {MATCHING_PRIMARY_ACTIVITY_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!activities[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => setActivities((current) => toggleMatchingOption(MATCHING_ACTIVITY_OPTIONS, current, value))}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>กิจกรรมเพิ่มเติม</Text>}>
                {MATCHING_MORE_ACTIVITY_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!activities[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => setActivities((current) => toggleMatchingOption(MATCHING_ACTIVITY_OPTIONS, current, value))}
                    systemImage={icon}
                  />
                ))}
              </Section>
              {detailFilterSections.map((section) => (
                <Section
                  footer={<Text>เว้นว่างไว้ = ไม่จำกัด</Text>}
                  header={<Text>รายละเอียด{section.label}</Text>}
                  key={section.id}
                >
                  {section.fields.map((field) => {
                    const selected = detailFilters[section.id]?.[field.key] || [];
                    return (
                      <Picker
                        key={field.key}
                        label={field.label}
                        modifiers={[pickerStyle('navigationLink')]}
                        onSelectionChange={(next) => {
                          // Native pickers are single-choice; a filter saved
                          // with several values from Android collapses to
                          // whichever option is picked here.
                          setDetailFilters((current) => {
                            const cleared = clearActivityDetailFilter(current, section.id, field.key);
                            return next === '__any__'
                              ? cleared
                              : toggleActivityDetailFilter(cleared, section.id, field.key, next);
                          });
                        }}
                        selection={selected.length === 1 ? selected[0] : '__any__'}
                      >
                        <Text modifiers={[tag('__any__')]}>{selected.length > 1 ? `เลือกไว้ ${selected.length}` : 'ทั้งหมด'}</Text>
                        {field.options.map(({ label, value }) => (
                          <Text key={value} modifiers={[tag(value)]}>{label}</Text>
                        ))}
                      </Picker>
                    );
                  })}
                </Section>
              ))}
              <Section header={<Text>ชั้นปี</Text>}>
                {MATCHING_YEAR_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!years[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => advancedFilters.guard() && setYears((current) => toggleMatchingOption(MATCHING_YEAR_OPTIONS, current, value))}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>คณะ</Text>}>
                <Picker label="เลือกคณะ" onSelectionChange={handleFacultySelection} selection={faculty} modifiers={[pickerStyle('menu')]}>
                  <Text modifiers={[tag('all')]}>ทุกคณะ</Text>
                  {FACULTIES.map((fac) => (
                    <Text key={fac} modifiers={[tag(fac)]}>{fac}</Text>
                  ))}
                </Picker>
                <Toggle isOn={sameFacultyOnly} label="เฉพาะคณะเดียวกับฉัน" onIsOnChange={handleSameFacultySelection} systemImage="building.columns.fill" />
              </Section>
              <Section footer={<Text>ใช้เมื่อสนใจเพื่อนที่วิ่ง</Text>} header={<Text>เพซวิ่ง</Text>}>
                {MATCHING_PACE_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!paces[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => advancedFilters.guard() && setPaces((current) => toggleMatchingOption(MATCHING_PACE_OPTIONS, current, value))}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>วันที่สะดวก</Text>}>
                {MATCHING_WEEKDAY_OPTIONS.map(({ longLabel, value }) => (
                  <Toggle
                    isOn={!!weekdays[value]}
                    key={value}
                    label={longLabel}
                    onIsOnChange={() => advancedFilters.guard() && setWeekdays((current) => toggleMatchingOption(MATCHING_WEEKDAY_OPTIONS, current, value))}
                  />
                ))}
              </Section>
              <Section footer={<Text>จับคู่จากช่วงเวลาในโปรไฟล์</Text>} header={<Text>ช่วงเวลา</Text>}>
                {MATCHING_AVAILABILITY_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!availabilityPeriods[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => toggleAvailabilityPeriod(value)}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>เพศ</Text>}>
                {MATCHING_PRIMARY_GENDER_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!genders[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => setGenders((current) => toggleMatchingOption(MATCHING_GENDER_OPTIONS, current, value))}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>เพศเพิ่มเติม</Text>}>
                {MATCHING_MORE_GENDER_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={!!genders[value]}
                    key={value}
                    label={label}
                    onIsOnChange={() => setGenders((current) => toggleMatchingOption(MATCHING_GENDER_OPTIONS, current, value))}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>เงื่อนไขเพิ่มเติม</Text>}>
                <Toggle isOn={requirePhoto} label="ต้องมีรูปโปรไฟล์" onIsOnChange={setRequirePhoto} systemImage="person.crop.circle" />
                <Toggle isOn={requireAvailability} label="ต้องระบุเวลาว่าง" onIsOnChange={(value) => { if (advancedFilters.guard()) setRequireAvailability(value); }} systemImage="clock.fill" />
              </Section>
            </Form>
            <Button
              label="บันทึกตัวกรอง"
              onPress={saveSearchSettings}
              systemImage="checkmark.circle.fill"
              modifiers={[
                buttonStyle('glassProminent'),
                buttonBorderShape('capsule'),
                controlSize('large'),
                tint(palette.purple),
                padding({ horizontal: 20, bottom: 24 }),
                frame({ maxWidth: Infinity }),
              ]}
            />
          </VStack>
          </Host>
        </BottomSheet>
      </Host>
    </View>
  );
}

function FilterChips({ onAll }) {
  return (
    <ScrollView
      axes="horizontal"
      showsIndicators={false}
      modifiers={[scrollIndicators('never', 'horizontal')]}
    >
      <HStack spacing={8}>
        <FilterChip label="ถูกใจ" onPress={() => router.push('/likes')} />
        <FilterChip label="เริ่มใหม่" onPress={onAll} />
      </HStack>
    </ScrollView>
  );
}

function FilterChip({ dot = false, label, onPress }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(label),
      ]}
    >
      <HStack
        alignment="center"
        spacing={5}
        modifiers={[
          padding({ horizontal: 12, vertical: 7 }),
          background(palette.chip, shapes.capsule()),
        ]}
      >
        <Text
          modifiers={[
            font({ textStyle: 'subheadline', weight: 'semibold', design: 'rounded' }),
            foregroundStyle(palette.text),
          ]}
        >
          {label}
        </Text>
        {dot && <Image color={palette.purple} size={6} systemName="circle.fill" />}
      </HStack>
    </Button>
  );
}

function SmartFilters({ eveningOnly, onEvening, onSameFaculty, sameFacultyOnly }) {
  const palette = usePalette();
  return (
    <HStack
      spacing={9}
      modifiers={[
        padding({ all: 12 }),
        frame({ maxWidth: Infinity }),
        background(palette.card, panelShape),
      ]}
    >
      <CompactFilter
        active={sameFacultyOnly}
        label="คณะเดียวกัน"
        onPress={onSameFaculty}
        systemImage="building.columns.fill"
      />
      <CompactFilter
        active={eveningOnly}
        label="ว่างช่วงเย็น"
        onPress={onEvening}
        systemImage="sunset.fill"
      />
    </HStack>
  );
}

function CompactFilter({ active, label, onPress, systemImage }) {
  const palette = usePalette();
  return (
    <Button
      label={label}
      onPress={onPress}
      systemImage={systemImage}
      modifiers={[
        buttonStyle(active ? 'glassProminent' : 'glass'),
        buttonBorderShape('capsule'),
        controlSize('regular'),
        tint(active ? palette.purple : palette.chip),
        frame({ maxWidth: Infinity }),
      ]}
    />
  );
}

function ProfileCard({ candidate, imageUri, onPress }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const glassGradient = colorScheme === 'dark'
    ? ['rgba(20,23,27,0)', 'rgba(20,23,27,0.42)', 'rgba(20,23,27,0.9)']
    : ['rgba(16,32,58,0)', 'rgba(16,32,58,0.28)', 'rgba(16,32,58,0.82)'];

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        frame({ maxWidth: Infinity }),
        background(palette.card, cardShape),
        clipShape('roundedRectangle', 24),
        shadow({ radius: 22, y: 10, color: 'rgba(0,0,0,0.28)' }),
        contentShape(shapes.rectangle()),
        onTapGesture(onPress),
        accessibilityLabel(`${candidate.name}${candidate.age ? `, ${candidate.age}` : ''}`),
        accessibilityHint('แตะเพื่อดูรายละเอียดโปรไฟล์'),
      ]}
    >
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
        <ZStack modifiers={[frame({ height: 340, maxWidth: Infinity })]}>
          {imageUri ? (
            <RNHostView matchContents={false} modifiers={[frame({ height: 340, maxWidth: Infinity })]}>
              <ExpoImage source={{ uri: imageUri }} contentFit="cover" priority="high" style={{ width: '100%', height: 340 }} />
            </RNHostView>
          ) : (
            <Image
              color={palette.secondary}
              size={84}
              systemName="person.crop.square.fill"
              modifiers={[
                frame({ height: 340, maxWidth: Infinity }),
                background(candidate.avatarColor || palette.chip),
              ]}
            />
          )}

          <RNHostView matchContents={false}>
            <View style={{ height: 340, width: '100%' }} pointerEvents="none">
              <MaskedView
                style={{ bottom: 0, height: 158, left: 0, position: 'absolute', right: 0 }}
                maskElement={
                  <LinearGradient
                    colors={['transparent', '#FFFFFF', '#FFFFFF']}
                    locations={[0, 0.48, 1]}
                    style={{ flex: 1 }}
                  />
                }
              >
                <BlurView intensity={colorScheme === 'dark' ? 38 : 48} tint={colorScheme} style={{ flex: 1 }} />
                <LinearGradient colors={glassGradient} locations={[0, 0.45, 1]} style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }} />
              </MaskedView>
            </View>
          </RNHostView>

          <VStack
            alignment="leading"
            spacing={6}
            modifiers={[
              padding({ top: 44, bottom: 22, horizontal: 18 }),
              frame({ height: 340, maxWidth: Infinity, alignment: 'bottomLeading' }),
            ]}
          >
            <Spacer />
            {candidate.isMatched && (
              <HStack
                alignment="center"
                spacing={4}
                modifiers={[
                  padding({ horizontal: 8, vertical: 4 }),
                  background('rgba(255,255,255,0.2)', shapes.capsule()),
                ]}
              >
                <Image color={palette.white} size={11} systemName="person.2.fill" />
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(palette.white)]}>
                  เพื่อนที่คุณแมตช์แล้ว 💬
                </Text>
              </HStack>
            )}
            <Text
              modifiers={[
                font({ textStyle: 'title', weight: 'bold', design: 'rounded' }),
                foregroundStyle(palette.white),
                lineLimit(1),
              ]}
            >
              {candidate.name}{candidate.age ? `, ${candidate.age}` : ''}
            </Text>
            <Text
              modifiers={[
                font({ textStyle: 'subheadline', weight: 'medium' }),
                foregroundStyle('rgba(255,255,255,0.88)'),
                lineLimit(1),
              ]}
            >
              {[getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities), candidate.faculty, formatDistance(candidate.distance)].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}
            </Text>
          </VStack>
        </ZStack>
      </VStack>

    </ZStack>
  );
}

function DiscoveryShortcuts({ matchedCount = 0, resetKey }) {
  const palette = usePalette();
  const [timeLeft, setTimeLeft] = useState(getRemainingTimeUntilMidnight());
  const resetDeadlineRef = useRef(Date.now() + RESET_INTERVAL_MS);

  useEffect(() => {
    resetDeadlineRef.current = Date.now() + RESET_INTERVAL_MS;
    setTimeLeft(formatRemainingTime(RESET_INTERVAL_MS));
  }, [resetKey]);

  useEffect(() => {
    const updateCountdown = () => {
      const remaining = resetDeadlineRef.current - Date.now();
      if (remaining <= 0) {
        resetDeadlineRef.current = Date.now() + RESET_INTERVAL_MS;
        setTimeLeft(formatRemainingTime(RESET_INTERVAL_MS));
        return;
      }
      setTimeLeft(formatRemainingTime(remaining));
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <HStack spacing={10} alignment="center" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <HStack
        spacing={6}
        alignment="center"
        modifiers={[
          padding({ horizontal: 11, vertical: 7 }),
          background(palette.surfaceRaised, shapes.capsule()),
          shadow({ color: 'black', opacity: 0.03, radius: 4, x: 0, y: 1 }),
        ]}
      >
        <Image color={palette.purple} size={12} systemName="clock.arrow.2.circlepath" />
        <Text
          modifiers={[
            font({ textStyle: 'caption2', weight: 'bold' }),
            foregroundStyle(palette.text),
          ]}
        >
          รีเซ็ตใน {timeLeft}
        </Text>
      </HStack>

      <ShortcutCircle
        label="สถิติแมตช์"
        onPress={() => router.navigate('/home')}
        systemImage="flame.fill"
        value={`${matchedCount}`}
      />
    </HStack>
  );
}

function ShortcutCircle({ label, onPress, systemImage, value = '' }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(label),
      ]}
    >
      <HStack
        alignment="center"
        spacing={6}
        modifiers={[
          padding({ horizontal: 11, vertical: 7 }),
          background(palette.circle, shapes.capsule()),
        ]}
      >
        <Image color={palette.coral} size={12} systemName={systemImage} />
        <Text
          modifiers={[
            font({ textStyle: 'caption2', weight: 'semibold' }),
            foregroundStyle(palette.text),
          ]}
        >
          {label}
        </Text>
        {value ? (
          <Text
            modifiers={[
              font({ textStyle: 'caption2', weight: 'bold', design: 'rounded' }),
              foregroundStyle(palette.coral),
            ]}
          >
            {value}
          </Text>
        ) : null}
      </HStack>
    </Button>
  );
}
