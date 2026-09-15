import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate, getActivityLabel } from '../utils/formatters';
import { FACULTIES } from '../data/faculties';
import {
  MATCHING_ACTIVITY_OPTIONS,
  MATCHING_AGE_MAX,
  MATCHING_AGE_MIN,
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
import { router, useFocusEffect } from 'expo-router';
import {
  Button,
  ContentUnavailableView,
  Host,
  HStack,
  Image,
  BottomSheet,
  Form,
  Section,
  Slider,
  Picker,
  Menu,
  Toggle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  RNHostView,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  aspectRatio,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  contentShape,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  onTapGesture,
  padding,
  presentationDetents,
  presentationDragIndicator,
  pickerStyle,
  resizable,
  scrollIndicators,
  shadow,
  shapes,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useApp } from '../context/AppContext';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { View, Pressable, useColorScheme, Animated, Text as RNText } from 'react-native';

const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

const darkPalette = { background: '#14171B', surface: '#20242A', surfaceRaised: '#292E35', text: '#F7F8FA', secondary: '#B6BDC8', tertiary: '#7F8896', coral: '#FF7A6B', coralSoft: 'rgba(255,122,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#62A8FF', blueSoft: 'rgba(98,168,255,0.16)', mint: '#45D1A1', mintSoft: 'rgba(69,209,161,0.16)' , purple: '#9A8CFF', card: '#20242A', white: '#FFFFFF', chip: '#292E35', circle: '#292E35'};
const lightPalette = { background: '#F6F8FC', surface: '#FFFFFF', surfaceRaised: '#F6F8FC', text: '#10203A', secondary: '#60708A', tertiary: '#8B98AC', coral: '#F47C6B', coralSoft: 'rgba(244,124,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#3986E8', blueSoft: 'rgba(57,134,232,0.16)', mint: '#18A878', mintSoft: 'rgba(24,168,120,0.16)' , purple: '#5B5CE2', card: '#FFFFFF', white: '#FFFFFF', chip: '#EEF0FF', circle: '#E7EBF2'};
function usePalette() { const scheme = useColorScheme(); return scheme === 'dark' ? darkPalette : lightPalette; }

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

function dailyPick(array, seedStr) {
  if (array.length <= 1) return array;
  const rng = pseudoRandom(seedStr);
  return [array[Math.floor(rng() * array.length)]];
}

export default function HomeScreen({ onOpenLikes }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
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
  const scrollY = useRef(new Animated.Value(0)).current;
  const myMeetupStats = useMemo(() => (profile ? getMeetupStats(profile) : null), [profile, getMeetupStats]);
  const matchedCount = Math.max(matchedProfileIds?.length || 0, conversations?.length || 0);

  // Settings BottomSheet State
  const [showSettings, setShowSettings] = useState(false);
  const [distance, setDistance] = useState(25);
  const [ageMin, setAgeMin] = useState(MATCHING_AGE_MIN);
  const [ageMax, setAgeMax] = useState(MATCHING_DEFAULT_AGE_MAX);
  const [years, setYears] = useState(() => createMatchingOptionState(MATCHING_YEAR_OPTIONS));
  const [genders, setGenders] = useState(() => createMatchingOptionState(MATCHING_GENDER_OPTIONS));
  const [activities, setActivities] = useState(() => createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS));
  const [paces, setPaces] = useState(() => createMatchingOptionState(MATCHING_PACE_OPTIONS));
  const [availabilityPeriods, setAvailabilityPeriods] = useState(() => createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS));
  const [availabilityFilterActive, setAvailabilityFilterActive] = useState(false);
  const [sameFacultyOnly, setSameFacultyOnly] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [faculty, setFaculty] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const [showFilters, setShowFilters] = useState(false);
  
  React.useEffect(() => {
    if (!profile) return;
    const preferences = profile.matchingPreferences || {};
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
    setActivities(createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS, selectedActivities));
    setFaculty(preferences.faculty || 'all');
    setYears(createMatchingOptionState(MATCHING_YEAR_OPTIONS, selectedYears));
    setGenders(createMatchingOptionState(MATCHING_GENDER_OPTIONS, selectedGenders));
    setPaces(createMatchingOptionState(MATCHING_PACE_OPTIONS, selectedPaces));
    setAvailabilityPeriods(createMatchingOptionState(MATCHING_AVAILABILITY_OPTIONS, selectedAvailabilityPeriods));
    setDistance(preferences.maxDistance ?? 25);
    setAgeMin(normalizedAgeMin);
    setAgeMax(normalizedAgeMax);
    setSameFacultyOnly(preferences.sameFacultyOnly ?? false);
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

  const handleFacultySelection = (nextFaculty) => {
    setFaculty(nextFaculty);
    if (nextFaculty !== 'all') setSameFacultyOnly(false);
  };

  const handleSameFacultySelection = (enabled) => {
    setSameFacultyOnly(enabled);
    if (enabled) setFaculty('all');
  };

  const saveSearchSettings = async () => {
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
      ...(profile.matchingPreferences || {}),
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
  };

  const activeFacultyFilter = sameFacultyOnly
    ? (profile?.faculty || 'all')
    : (faculty || 'all');

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (selectedCategory !== 'all' && candidate.activity !== selectedCategory && !candidate.activities?.includes(selectedCategory)) return false;
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
      return true;
    });
    return dailyPick(filtered, getDailySeed() + (profile?.id || ''));
  }, [activeFacultyFilter, availabilityFilterActive, availabilityPeriods, availableProfiles, profile?.faculty, profile?.id, sameFacultyOnly, selectedCategory]);

  const currentProfile = filteredProfiles[0] || null;
  const remoteAvatar = useRemoteImage(currentProfile?.avatarUri, currentProfile?.updatedAt, currentProfile?.id);
  const imageUri = remoteAvatar;

  const hasRecycledForThisEmptyState = useRef(false);

  useEffect(() => {
    if (filteredProfiles.length > 0) {
      hasRecycledForThisEmptyState.current = false;
      return;
    }

    if (!hasRecycledForThisEmptyState.current) {
      hasRecycledForThisEmptyState.current = true;
      void recycleSkippedProfiles()?.catch?.((error) => {
        console.warn('[HomeScreen.ios] recycleSkippedProfiles error:', error?.message || error);
      });
    }
  }, [filteredProfiles.length, recycleSkippedProfiles]);

  useFocusEffect(
    React.useCallback(() => {
      hasRecycledForThisEmptyState.current = false;
      setRefreshTick((t) => t + 1);
    }, [])
  );

  const persistFacultyMatching = async (nextFaculty, nextSameFacultyOnly) => {
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

  const handleReset = () => {
    void recycleSkippedProfiles()?.catch?.((error) => {
      console.warn('[HomeScreen.ios] handleReset recycle error:', error?.message || error);
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
    setFaculty('all');
    setSameFacultyOnly(false);
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
  };



  const blurIntensity = colorScheme === 'dark' ? 30 : 40;
  const meetupAccent = colorScheme === 'dark' ? '#7966FF' : '#4546B8';
  const meetupSoft = colorScheme === 'dark' ? 'rgba(154,140,255,0.16)' : '#EEF0FF';

  const smallHeaderOpacity = scrollY.interpolate({
    inputRange: [30, 60],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const largeHeaderOpacity = scrollY.interpolate({
    inputRange: [0, 30],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const largeHeaderTranslateY = scrollY.interpolate({
    inputRange: [0, 40],
    outputRange: [0, -20],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <MaskedView
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 104, zIndex: 10 }}
        maskElement={
          <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
        }
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }} pointerEvents="box-none">
        <Host colorScheme={colorScheme} seedColor={palette.purple} style={{ width: '100%', height: 85 }}>
          <VStack modifiers={[padding({ top: 35, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
            <Header onSettings={() => setShowSettings(true)} />
          </VStack>
        </Host>
      </View>
      <Host
        colorScheme={colorScheme}
        seedColor={palette.purple}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsIndicators={false}
          modifiers={[scrollIndicators('never', 'vertical')]}
        >
          <VStack
            alignment="leading"
            spacing={22}
            modifiers={[
              padding({ top: 60, bottom: 36, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >
            {selectedMeetup && (
              <HStack
                alignment="center"
                spacing={10}
                modifiers={[
                  padding({ horizontal: 12, vertical: 9 }),
                  frame({ maxWidth: Infinity }),
                  background(meetupSoft, shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' })),
                  shadow({ color: meetupAccent, opacity: 0.12, radius: 8, x: 0, y: 2 }),
                ]}
              >
                <Button
                  onPress={() => router.push('/meetup')}
                  modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
                >
                  <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                    <VStack
                      alignment="center"
                      modifiers={[
                        frame({ width: 32, height: 32 }),
                        background(meetupAccent, shapes.circle()),
                        shadow({ color: meetupAccent, opacity: 0.24, radius: 6, x: 0, y: 2 }),
                      ]}
                    >
                      <Image color="#FFFFFF" size={13} systemName="mappin.and.ellipse" />
                    </VStack>
                    <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                      <HStack spacing={6} alignment="center">
                        <Text modifiers={[font({ weight: 'bold', size: 11 }), foregroundStyle(palette.text), lineLimit(1)]}>
                          จุดนัดพบ
                        </Text>
                        <Text modifiers={[font({ weight: 'bold', size: 10 }), foregroundStyle(myMeetupStats?.isFull ? '#FF453A' : meetupAccent)]}>
                          {myMeetupStats ? `${myMeetupStats.isFull ? 'เต็มแล้ว' : `ร่วม ${myMeetupStats.acceptedCount}/${myMeetupStats.maxPeople}`}` : 'พร้อม'}
                        </Text>
                      </HStack>
                      <Text modifiers={[font({ size: 13.5, weight: 'bold' }), foregroundStyle(palette.text), lineLimit(1)]}>
                        {selectedMeetup.name}
                      </Text>
                      {selectedMeetup.schedule?.date ? (
                        <Text modifiers={[font({ size: 10.5, weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(1)]}>
                          {formatReadableDate(selectedMeetup.schedule.date)}
                          {selectedMeetup.schedule?.startTime && selectedMeetup.schedule?.endTime ? ` · ${selectedMeetup.schedule.startTime}–${selectedMeetup.schedule.endTime}` : ''}
                        </Text>
                      ) : (
                        <Text modifiers={[font({ size: 10.5, weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                          แตะเพื่อจัดการจุดนัดพบ
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                </Button>
                <Button
                  label="จัดการ"
                  onPress={() => router.push('/meetup')}
                  modifiers={[
                    buttonStyle('glassProminent'),
                    buttonBorderShape('capsule'),
                    controlSize('small'),
                    tint(meetupAccent),
                  ]}
                />
              </HStack>
            )}
            <FilterChips
              likesCount={pendingIncomingLikes.length}
              onAll={handleReset}
              onLikes={onOpenLikes}
            />

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
                <ProfileCard
                  candidate={currentProfile}
                  imageUri={imageUri}
                  onPress={() => router.push({
                    pathname: '/discover-profile',
                    params: { profileId: currentProfile.id },
                  })}
                />
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
                  description="ระบบจะค้นหาโปรไฟล์ใหม่โดยอัตโนมัติ หากตัวกรองไม่มีคนที่ตรงกัน"
                  systemImage="person.2.slash"
                  title="ยังไม่มีโปรไฟล์ที่ตรงกัน"
                />
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
              <Section header={<Text>ระยะห่างจากคุณ</Text>} footer={<Text>ค้นหาเพื่อนในรัศมี {Math.round(distance)} กิโลเมตร</Text>}>
                <Slider
                  value={distance}
                  onValueChange={setDistance}
                  min={1}
                  max={50}
                  step={1}
                />
              </Section>
              <Section header={<Text>กิจกรรมที่สนใจ</Text>}>
                {MATCHING_ACTIVITY_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={activities[value]}
                    key={value}
                    onIsOnChange={(enabled) => setActivities((current) => ({ ...current, [value]: enabled }))}
                    label={label}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>ช่วงชั้นปี (เลือกได้หลายข้อ)</Text>}>
                {MATCHING_YEAR_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={years[value]}
                    key={value}
                    onIsOnChange={(enabled) => setYears((current) => ({ ...current, [value]: enabled }))}
                    label={label}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>คณะ</Text>}>
                <Picker label="เลือกคณะ" selection={faculty} onSelectionChange={handleFacultySelection} modifiers={[pickerStyle('menu')]}>
                  <Text modifiers={[tag('all')]}>ทุกคณะ</Text>
                  {FACULTIES.map((fac) => (
                    <Text key={fac} modifiers={[tag(fac)]}>{fac}</Text>
                  ))}
                </Picker>
                <Toggle isOn={sameFacultyOnly} onIsOnChange={handleSameFacultySelection} label="เฉพาะคณะเดียวกับฉัน" systemImage="building.columns.fill" />
              </Section>
              <Section header={<Text>เพซ / ระดับกิจกรรม</Text>} footer={<Text>เลือกได้หลายข้อ ระบบจะจับคู่คนที่มีระดับตรงกัน</Text>}>
                {MATCHING_PACE_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={paces[value]}
                    key={value}
                    onIsOnChange={(enabled) => setPaces((current) => ({ ...current, [value]: enabled }))}
                    label={label}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>ช่วงเวลาที่สะดวก</Text>} footer={<Text>จับคู่จากช่วงเวลาที่อีกฝ่ายระบุไว้ในโปรไฟล์</Text>}>
                {MATCHING_AVAILABILITY_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={availabilityPeriods[value]}
                    key={value}
                    onIsOnChange={() => toggleAvailabilityPeriod(value)}
                    label={label}
                    systemImage={icon}
                  />
                ))}
              </Section>
              <Section header={<Text>เพศ (เลือกได้หลายข้อ)</Text>}>
                {MATCHING_GENDER_OPTIONS.map(({ icon, label, value }) => (
                  <Toggle
                    isOn={genders[value]}
                    key={value}
                    onIsOnChange={(enabled) => setGenders((current) => ({ ...current, [value]: enabled }))}
                    label={label}
                    systemImage={icon}
                  />
                ))}
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
        </BottomSheet>
      </Host>
    </View>
  );
}

function Header({ onSettings }) {
  const palette = usePalette();
  return (
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <Text
        modifiers={[
          font({ textStyle: 'title1', weight: 'bold', design: 'rounded' }),
          foregroundStyle(palette.text),
        ]}
      >
        หาเพื่อน
      </Text>
      <Spacer />
      <Button
        label="ตั้งค่า"
        onPress={onSettings}
        systemImage="gearshape.fill"
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('regular'),
          labelStyle('iconOnly'),
          tint(palette.text),
        ]}
      />
    </HStack>
  );
}

function FilterChips({ likesCount, onAll, onLikes }) {
  const palette = usePalette();
  return (
    <ScrollView
      axes="horizontal"
      showsIndicators={false}
      modifiers={[scrollIndicators('never', 'horizontal')]}
    >
      <HStack spacing={8}>
        <FilterChip dot={likesCount > 0} label="ถูกใจ & จับคู่" onPress={onLikes} />
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
            <Image
              uiImage={imageUri}
              modifiers={[
                resizable(),
                aspectRatio({ ratio: 0.82, contentMode: 'fill' }),
                frame({ height: 340, maxWidth: Infinity }),
                clipped(),
              ]}
            />
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
              {[getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities), candidate.faculty].filter(Boolean).join(' · ') || 'แตะเพื่อดูโปรไฟล์'}
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
