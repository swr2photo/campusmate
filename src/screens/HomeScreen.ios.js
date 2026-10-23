import { Pressable } from '../components/NativePressable';
import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { showInAppNotification } from '../components/InAppNotificationBanner';
import { useProfileImagePrefetch } from '../utils/useRemoteImage';
import ExpoImage from '../components/CachedImage';
import { formatDistance, formatReadableDate, getActivityLabel } from '../utils/formatters';
import { dailyPick, getDailySeed, pickDailyProfile } from '../utils/dailyPick';
import { noteProfileOpened, rewindEligibleProfileId, subscribeRewindEligibility } from '../utils/rewindEligibility';
import { useToast } from '../context/ToastContext';
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
import { useNotificationInbox } from '../context/NotificationInboxContext';
import { StatusBarScrim } from '../components/TabPageHeader';
import { useDiscoveryDeckState } from '../hooks/useDiscoveryDeckState';
import ProfilePhotoCarousel from '../components/ProfilePhotoCarousel';
import RNText from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import { FEATURE_ADVANCED_FILTERS, stripPaidMatchingPreferences } from '../data/plans';
import { ContentUnavailableView, Host, HStack, Image, BottomSheet, Form, Section, Slider, Picker, Menu, Toggle, ScrollView, Spacer, VStack, ZStack, RNHostView, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, accessibilityHidden, accessibilityHint, accessibilityLabel, aspectRatio, background, buttonBorderShape, buttonStyle, clipShape, clipped, contentShape, controlSize, disabled, foregroundStyle, frame, labelStyle, lineLimit, multilineTextAlignment, onTapGesture, padding, presentationDetents, presentationDragIndicator, pickerStyle, resizable, scrollClipDisabled, scrollIndicators, scrollPosition, scrollTargetLayout, shadow, shapes, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppBadges, useAppFeed, useAppProfile } from '../context/AppContext';
import { StyleSheet, View, useColorScheme, Platform, useWindowDimensions } from 'react-native';
import CampusVibeBanner from '../components/discovery/CampusVibeBanner';
import SpotifyMiniPlayer from '../components/discovery/SpotifyMiniPlayer';
import AnimatedStatusBadge from '../components/status/AnimatedStatusBadge';
import { useResponsiveSize } from '../hooks/useResponsiveSize';
import { getDiscoverySummary } from '../utils/discoveryPresentation';
import { statusBadgeFor } from '../utils/userStatus';

const usePalette = useNativePalette;

const cardShape = shapes.roundedRectangle({
  cornerRadius: 24,
  roundedCornerStyle: 'continuous',
});
const panelShape = shapes.roundedRectangle({
  cornerRadius: 18,
  roundedCornerStyle: 'continuous',
});

const QUICK_ACTIVITIES = [
  { id: 'all', label: 'ทั้งหมด', systemImage: 'sparkles' },
  { id: 'study', label: 'ติวสอบ', systemImage: 'book.closed.fill' },
  { id: 'food', label: 'ทานอาหาร', systemImage: 'fork.knife' },
  { id: 'gym', label: 'ฟิตเนส', systemImage: 'dumbbell.fill' },
  { id: 'chill', label: 'คาเฟ่ & ชิล', systemImage: 'cup.and.saucer.fill' },
  { id: 'gaming', label: 'บอร์ดเกม', systemImage: 'gamecontroller.fill' },
  { id: 'running', label: 'วิ่ง', systemImage: 'figure.run' },
  { id: 'sports', label: 'กีฬา', systemImage: 'sportscourt.fill' },
];

function useRewindEligibleId() {
  const [id, setId] = useState(rewindEligibleProfileId);
  useEffect(() => subscribeRewindEligibility(setId), []);
  return id;
}

export default function HomeScreen() {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isTablet = (Platform.OS === 'ios' && Boolean(Platform.isPad)) || windowWidth >= 700;
  const contentHorizPadding = isTablet ? 32 : 20;
  const { bannerHeight } = useResponsiveSize();
  const bannerWidth = Math.max(0, Math.min(windowWidth, 980) - contentHorizPadding * 2);
  const deckHorizPadding = isTablet ? Math.max(0, Math.round((windowWidth - 620) / 2) - contentHorizPadding) : 0;
  const {
    availableProfiles,
    hasMoreProfiles = false,
    isLoadingMoreProfiles = false,
    isResolvingDistances = false,
    isDiscoveryReady = false,
    discoveryError = null,
    selectedMeetup,
    canRewindSkippedProfiles,
  } = useAppFeed();
  const { conversationCount = 0, matchedCount: matchedProfileCount = 0 } = useAppBadges();
  const { getMeetupStats, loadMoreProfiles, recycleSkippedProfiles, retryDiscovery, saveMatchingPreferences } = useAppActions();
  const { profile } = useAppProfile();
  // CampusMate Plus gates (src/data/plans.js).
  const advancedFilters = useEntitlement(FEATURE_ADVANCED_FILTERS);
  const { showToast } = useToast();
  const rewindingRef = useRef(false);
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
  const [photoMountEpoch, setPhotoMountEpoch] = useState(0);
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
      availabilityPeriods: [],
      weekdays: [],
      requireAvailability: false,
      faculty: sameFacultyOnly ? 'all' : faculty,
      genders: selectedGenders,
      maxDistance: Math.round(distance),
      paces: selectedPaces,
      requirePhoto,
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
      if (requirePhoto && !profileHasPhoto(candidate)) return false;
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
  const hasRequestedMoreForThisEmptyState = useRef(false);

  useEffect(() => {
    if (!discoveryError) return;
    const rawMsg = discoveryError?.message || 'โหลดโปรไฟล์ไม่สำเร็จ';
    const cleanMsg = typeof rawMsg === 'string' ? rawMsg.replace(/\s*\[\d{3}\]/g, '').trim() : rawMsg;
    showInAppNotification({
      title: 'ค้นหาเพื่อน',
      message: cleanMsg,
      tone: 'warning',
      icon: 'exclamationmark.triangle.fill',
    });
  }, [discoveryError]);

  // When the deck runs dry, pull the next discovery page so new profiles show
  // up on their own.
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
      // Navigation can detach the hosted RN image while this screen stays
      // mounted. Recreate only that native subtree when the screen returns;
      // keep the profile/deck and the persistent image cache intact.
      setPhotoMountEpoch((epoch) => epoch + 1);
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

  const rewindEligibleId = useRewindEligibleId();
  const handleRewind = async () => {
    if (rewindingRef.current) return;
    rewindingRef.current = true;
    try {
      const result = await recycleSkippedProfiles();
      if (result?.profile?.id) pinnedDailyRef.current.id = result.profile.id;
      if (!result?.profile && !result?.busy && !result?.plusRequired) {
        showToast('ไม่มีรายการที่ย้อนกลับได้ในขณะนี้', 'info');
      } else if (result?.profile) {
        showToast(`ย้อนกลับไปยังโปรไฟล์ของ ${result.profile.name || 'เพื่อน'} แล้ว`, 'success');
      }
    } catch (error) {
      if (error?.details?.reason === 'PLUS_REQUIRED') router.push('/membership');
      else showToast(error?.message || 'ย้อนกลับไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
    } finally {
      rewindingRef.current = false;
    }
  };

  const blurIntensity = colorScheme === 'dark' ? 30 : 40;
  const meetupAccent = colorScheme === 'dark' ? '#7966FF' : '#4546B8';
  const meetupSoft = colorScheme === 'dark' ? 'rgba(112,178,255,0.16)' : '#EEF2F7';

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <StatusBarScrim />
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
              padding({ top: 12, bottom: 36, horizontal: contentHorizPadding }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >
            <HomeTitleBar />

            {/* Live campus vibe (React Native view hosted in SwiftUI at a fixed size). */}
            <RNHostView matchContents modifiers={[frame({ width: bannerWidth, height: bannerHeight })]} style={{ width: bannerWidth, height: bannerHeight }}>
              <View collapsable={false} style={{ width: bannerWidth, height: bannerHeight }}>
                <CampusVibeBanner count={availableProfiles?.length || 0} hasMore={hasMoreProfiles} style={{ height: bannerHeight }} />
              </View>
            </RNHostView>

            <NativeTourTarget id="home.activities" ensureVisible={() => tourScrollPosition.set('home.activities')}>
              <FilterChips
                onOpenLikes={() => router.push('/likes')}
                onSelectCategory={setSelectedCategory}
                selectedCategory={selectedCategory}
              />
            </NativeTourTarget>

            {showFilters && (
              <SmartFilters
                onSameFaculty={() => persistFacultyMatching('all', !sameFacultyOnly)}
                sameFacultyOnly={sameFacultyOnly}
              />
            )}

            {currentProfile ? (
              <VStack
                alignment="center"
                spacing={22}
                modifiers={[
                  padding({ horizontal: deckHorizPadding }),
                  frame({ maxWidth: Infinity, alignment: 'center' }),
                ]}
              >
                <NativeTourTarget id="home.deck" ensureVisible={() => tourScrollPosition.set('home.deck')}>
                <ProfileCard
                  candidate={currentProfile}
                  photoMountEpoch={photoMountEpoch}
                  onPress={() => {
                    noteProfileOpened(currentProfile.id);
                    router.push({
                      pathname: '/discover-profile',
                      params: { profileId: currentProfile.id },
                    });
                  }}
                  onRewind={canRewindSkippedProfiles ? handleRewind : null}
                />
                </NativeTourTarget>
                <DiscoveryShortcuts matchedCount={matchedCount} />
              </VStack>
            ) : (
              <VStack
                  alignment="center"
                  spacing={14}
                  modifiers={[
                    padding({ vertical: isTablet ? 48 : 36, horizontal: isTablet ? 32 : 22 }),
                    padding({ horizontal: deckHorizPadding }),
                    frame({ maxWidth: Infinity }),
                    background(palette.card, cardShape),
                  ]}
                >
                  <Image
                    color={palette.secondary}
                    size={48}
                    systemName={isWaitingForProfiles ? 'arrow.triangle.2.circlepath' : 'person.2.slash'}
                  />
                  <Text
                    modifiers={[
                      font({ size: 18, weight: 'bold' }),
                      foregroundStyle(palette.text),
                      multilineTextAlignment('center'),
                    ]}
                  >
                    {deck.state === 'error' ? 'โหลดโปรไฟล์ไม่สำเร็จ' : isWaitingForProfiles ? 'กำลังค้นหาเพื่อนที่ตรงกัน…' : 'ยังไม่มีโปรไฟล์ที่ตรงกัน'}
                  </Text>
                  <Text
                    modifiers={[
                      font({ size: 14, weight: 'regular' }),
                      foregroundStyle(palette.secondary),
                      multilineTextAlignment('center'),
                    ]}
                  >
                    {deck.state === 'error' ? 'ตรวจสอบการเชื่อมต่อ แล้วลองโหลดโปรไฟล์อีกครั้ง' : isWaitingForProfiles
                      ? 'กำลังโหลดโปรไฟล์และตรวจสอบระยะทาง โปรไฟล์จะแสดงเองเมื่อพร้อม'
                      : 'ไม่พบโปรไฟล์ที่ตรงกับตัวกรองในขณะนี้ สามารถปรับตัวกรองการค้นหาได้จากปุ่มด้านล่างหรือมุมขวาบน'}
                  </Text>
                {!isWaitingForProfiles ? (
                  <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                    {deck.state === 'error' ? <Button label="ลองอีกครั้ง" onPress={deck.retry} modifiers={[buttonStyle('glassProminent'), tint(palette.purple)]} /> : null}
                    {canRewindSkippedProfiles ? (
                      <Button
                        onPress={handleRewind}
                        modifiers={[
                          buttonStyle('glass'),
                          buttonBorderShape('capsule'),
                          controlSize('large'),
                          tint(palette.purple),
                          frame({ maxWidth: Infinity }),
                        ]}
                      >
                        <HStack spacing={8} alignment="center">
                          <Image systemName="arrow.counterclockwise" size={16} color={palette.purple} />
                          <Text
                            modifiers={[
                              font({ size: 16, weight: 'semibold' }),
                              foregroundStyle(palette.accentText),
                            ]}
                          >
                            ย้อนกลับ
                          </Text>
                        </HStack>
                      </Button>
                    ) : null}
                    <Button
                      onPress={() => router.push('/matching-filters')}
                      modifiers={[
                        buttonStyle('glassProminent'),
                        buttonBorderShape('capsule'),
                        controlSize('large'),
                        tint(palette.purple),
                        frame({ maxWidth: Infinity }),
                      ]}
                    >
                      <HStack spacing={8} alignment="center">
                        <Image systemName="slider.horizontal.3" size={16} color={palette.white} />
                        <Text
                          modifiers={[
                            font({ size: 16, weight: 'semibold' }),
                            foregroundStyle(palette.white),
                          ]}
                        >
                          ปรับตัวกรอง
                        </Text>
                      </HStack>
                    </Button>
                  </HStack>
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

// Replaces the native navigation bar so the title and its buttons scroll with
// the page and move with it during the tab swipe.
function HomeTitleBar() {
  const palette = usePalette();
  const { count = 0 } = useNotificationInbox();
  const circleButton = [
    buttonStyle('glass'),
    buttonBorderShape('circle'),
    controlSize('large'),
    labelStyle('iconOnly'),
    tint(palette.text),
  ];
  return (
    <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 52 })]}>
      <Text
        modifiers={[
          font({ size: 28, weight: 'bold' }),
          foregroundStyle(palette.text),
          lineLimit(1),
          accessibilityAddTraits(['isHeader']),
        ]}
      >
        หาเพื่อน
      </Text>
      <Spacer />
      <ZStack alignment="topTrailing">
        <Button
          label="แจ้งเตือน"
          onPress={() => router.push('/notifications')}
          systemImage="bell"
          modifiers={[
            ...circleButton,
            accessibilityLabel(`แจ้งเตือน${count ? ` ยังไม่อ่าน ${count} รายการ` : ''}`),
          ]}
        />
        {count > 0 ? (
          <Text
            modifiers={[
              font({ size: 10, weight: 'bold' }),
              foregroundStyle('#FFFFFF'),
              padding({ horizontal: 5, vertical: 1 }),
              background(palette.accent, shapes.capsule()),
              accessibilityHidden(true),
            ]}
          >
            {count > 99 ? '99+' : String(count)}
          </Text>
        ) : null}
      </ZStack>
      <NativeTourTarget id="home.filters">
        <Button
          label="ตั้งค่าการจับคู่"
          onPress={() => router.push('/matching-filters')}
          systemImage="slider.horizontal.3"
          modifiers={circleButton}
        />
      </NativeTourTarget>
    </HStack>
  );
}

function FilterChips({ onOpenLikes, onSelectCategory, selectedCategory = 'all' }) {
  return (
    <ScrollView
      axes="horizontal"
      showsIndicators={false}
      // Let chips scroll out to the screen edge instead of being cut at the
      // page's content padding (iOS 17+; older iOS keeps the clipped look).
      modifiers={[scrollIndicators('never', 'horizontal'), scrollClipDisabled()]}
    >
      <HStack spacing={8}>
        <FilterChip label="ถูกใจ" onPress={onOpenLikes} systemImage="heart.fill" />
        {QUICK_ACTIVITIES.map((cat) => (
          <FilterChip
            active={selectedCategory === cat.id}
            key={cat.id}
            label={cat.label}
            onPress={() => onSelectCategory?.(cat.id)}
            systemImage={cat.systemImage}
          />
        ))}
      </HStack>
    </ScrollView>
  );
}

function FilterChip({ active = false, label, onPress, systemImage }) {
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
          background(active ? palette.purple : palette.chip, shapes.capsule()),
        ]}
      >
        {systemImage && (
          <Image
            color={active ? palette.white : (palette.accentText || palette.purple)}
            size={12}
            systemName={systemImage}
          />
        )}
        <Text
          modifiers={[
            font({ size: 14, weight: 'semibold' }),
            foregroundStyle(active ? palette.white : palette.text),
          ]}
        >
          {label}
        </Text>
      </HStack>
    </Button>
  );
}

function SmartFilters({ onSameFaculty, sameFacultyOnly }) {
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

function ProfileCard({ candidate, photoMountEpoch, onPress, onRewind }) {
  const palette = usePalette();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.min(windowWidth - 40, 620);
  const cardHeight = Math.round(cardWidth * 4 / 3);
  const footerHeight = Math.min(300, Math.max(200, Math.round(cardHeight * 0.5)));
  const status = statusBadgeFor(candidate);
  const summary = getDiscoverySummary(candidate);
  const track = candidate.favoriteTracks?.[0];

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        // ScrollView proposes an unbounded height. This card must own its
        // size rather than asking a fill-mode RNHostView to determine it.
        frame({ width: cardWidth, height: cardHeight }),
        background(palette.card, cardShape),
        clipShape('roundedRectangle', 24),
        shadow({ radius: 22, y: 10, color: 'rgba(0,0,0,0.28)' }),
      ]}
    >
      <RNHostView
        key={`${candidate.id}:${photoMountEpoch}`}
        matchContents
        modifiers={[frame({ width: cardWidth, height: cardHeight })]}
        style={{ width: cardWidth, height: cardHeight }}
      >
        <View collapsable={false} style={{ width: cardWidth, height: cardHeight }}>
          <ProfilePhotoCarousel
            profile={candidate}
            width={cardWidth}
            height={cardHeight}
            footerBlurHeight={footerHeight}
            interactive
            onPress={onPress}
            swipePhotos
            tapToChangePhotos={false}
          >
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {/* Top: what they're up to and the server's match score, when known. */}
              <View pointerEvents="none" style={{ position: 'absolute', left: 14, right: onRewind ? 72 : 14, top: 14, gap: 6, alignItems: 'flex-start' }}>
                {status ? <AnimatedStatusBadge kind={status.kind} text={status.text} /> : null}
                {summary.score !== null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'rgba(12,16,28,0.55)' }}>
                    <FeatureIcon name="sparkles" size={11} color="#FFC23D" />
                    <RNText style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>เข้ากัน {summary.score}%</RNText>
                  </View>
                ) : null}
              </View>
              {track?.name ? (
                <View pointerEvents="box-none" style={{ position: 'absolute', left: 14, right: 82, bottom: 18 }}>
                  <SpotifyMiniPlayer track={track} />
                </View>
              ) : null}
              <View pointerEvents="none" style={{ position: 'absolute', left: 18, right: 82, bottom: track?.name ? 86 : 24, gap: 6 }}>
                {candidate.isMatched ? (
                  <View style={{ alignSelf: 'flex-start', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.18)', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <FeatureIcon name="person.2.fill" size={12} color="#FFFFFF" />
                    <RNText style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>เพื่อนที่คุณแมตช์แล้ว</RNText>
                  </View>
                ) : null}
                <RNText numberOfLines={2} style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '800' }}>
                  {candidate.name}{candidate.age ? ` ${candidate.age}` : ''}
                </RNText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {candidate.faculty ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: 'rgba(91,141,239,0.9)' }}>
                      <FeatureIcon name="building.columns.fill" size={10} color="#FFFFFF" />
                      <RNText numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>คณะ{candidate.faculty.replace(/^คณะ/, '')}</RNText>
                    </View>
                  ) : null}
                  {candidate.year ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: 'rgba(232,115,74,0.9)' }}>
                      <FeatureIcon name="graduationcap.fill" size={10} color="#FFFFFF" />
                      <RNText numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>{candidate.year}</RNText>
                    </View>
                  ) : null}
                </View>
                <RNText numberOfLines={1} style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '500' }}>
                  {[getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities), formatDistance(candidate.distance)].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}
                </RNText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`ดูรายละเอียดโปรไฟล์เต็มของ ${candidate.name}`}
                onPress={onPress}
                style={({ pressed }) => ({ position: 'absolute', right: 18, bottom: 24, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' })}
              >
                <FeatureIcon color="#FFFFFF" name="arrow.up" size={23} />
              </Pressable>
              {onRewind ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ย้อนกลับไปยังคนที่กดไม่เลือกไว้"
                  onPress={(event) => { event?.stopPropagation?.(); onRewind(); }}
                  style={({ pressed }) => ({ position: 'absolute', right: 14, top: 14, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(10,18,32,0.86)' : 'rgba(10,18,32,0.62)' })}
                >
                  <FeatureIcon color="#FFFFFF" name="arrow.counterclockwise" size={22} />
                </Pressable>
              ) : null}
            </View>
          </ProfilePhotoCarousel>
          </View>
      </RNHostView>
    </ZStack>
  );
}


function DiscoveryShortcuts({ matchedCount = 0 }) {
  return (
    <HStack spacing={10} alignment="center" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <ShortcutCircle
        label="สถิติแมตช์"
        onPress={() => router.navigate('/home')}
        systemImage="flame.fill"
        value={`${matchedCount}`}
      />
    </HStack>
  );
}

function ShortcutCircle({ iconColor, label, onPress, systemImage, value = '' }) {
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
        <Image color={iconColor || palette.coral} size={12} systemName={systemImage} />
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
