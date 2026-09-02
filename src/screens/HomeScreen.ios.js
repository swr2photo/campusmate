import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatReadableDate, getActivityLabel } from '../utils/formatters';
import { ACTIVITY_CATEGORIES } from '../data/activityCategories';
import { FACULTIES } from '../data/faculties';
import { useAssets } from 'expo-asset';
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
  DisclosureGroup,
  Label,
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

const profilePhoto = require('../../assets/friend-profile-card.png');
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
  const { getPendingIncomingLikes } = useApp();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [assets] = useAssets([profilePhoto]);
  const myMeetupStats = useMemo(() => (profile ? getMeetupStats(profile) : null), [profile, getMeetupStats]);
  const matchedCount = Math.max(matchedProfileIds?.length || 0, conversations?.length || 0);
  const [timeLeft, setTimeLeft] = useState(getRemainingTimeUntilMidnight());
  const resetDeadlineRef = useRef(Date.now() + RESET_INTERVAL_MS);
  const resetCountdown = React.useCallback(() => {
    resetDeadlineRef.current = Date.now() + RESET_INTERVAL_MS;
    setTimeLeft(formatRemainingTime(RESET_INTERVAL_MS));
  }, []);

  useEffect(() => {
    const updateCountdown = () => {
      const remaining = resetDeadlineRef.current - Date.now();
      if (remaining <= 0) {
        resetCountdown();
        return;
      }
      setTimeLeft(formatRemainingTime(remaining));
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [resetCountdown]);

  // Settings BottomSheet State
  const [showSettings, setShowSettings] = useState(false);
  const [distance, setDistance] = useState(15);
  const [years, setYears] = useState({ 1: true, 2: true, 3: true, 4: true });
  const [genders, setGenders] = useState({ male: true, female: true, other: true });
  const [activities, setActivities] = useState({ exerciseExpanded: false, running: true, gym: true, sports: true, study: true, chill: true });
  const [eveningOnly, setEveningOnly] = useState(false);
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
    setActivities({
      exerciseExpanded: false,
      running: selectedActivities.length === 0 || selectedActivities.includes('running'),
      gym: selectedActivities.length === 0 || selectedActivities.includes('gym'),
      sports: selectedActivities.length === 0 || selectedActivities.includes('sports'),
      study: selectedActivities.length === 0 || selectedActivities.includes('study'),
      chill: selectedActivities.length === 0 || selectedActivities.includes('chill'),
    });
    setFaculty(preferences.faculty || 'all');
    setYears({
      1: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 1'),
      2: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 2'),
      3: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 3'),
      4: selectedYears.length === 0 || selectedYears.includes('ชั้นปีที่ 4'),
    });
    setGenders({
      male: selectedGenders.length === 0 || selectedGenders.includes('male'),
      female: selectedGenders.length === 0 || selectedGenders.includes('female'),
      other: selectedGenders.length === 0 || selectedGenders.includes('nonbinary'),
    });
    setDistance(preferences.maxDistance ?? 25);
    setSameFacultyOnly(preferences.sameFacultyOnly ?? false);
  }, [
    profile?.id,
    profile?.matchingPreferences?.activities,
    profile?.matchingPreferences?.faculty,
    profile?.matchingPreferences?.genders,
    profile?.matchingPreferences?.maxDistance,
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
    const selectedActivities = ['running', 'gym', 'sports', 'study', 'chill'].filter((key) => activities[key]);
    const selectedYears = [1, 2, 3, 4].filter((key) => years[key]).map((key) => `ชั้นปีที่ ${key}`);
    const selectedGenders = [
      genders.male && 'male',
      genders.female && 'female',
      genders.other && 'nonbinary',
    ].filter(Boolean);
    await saveMatchingPreferences({
      ...(profile.matchingPreferences || {}),
      activities: selectedActivities.length === 5 ? [] : selectedActivities,
      faculty: sameFacultyOnly ? 'all' : faculty,
      genders: selectedGenders.length === 3 ? [] : selectedGenders,
      maxDistance: Math.round(distance),
      sameFacultyOnly,
      years: selectedYears.length === 4 ? [] : selectedYears,
    });
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
      if (eveningOnly && !candidate.availability?.includes('17:') && !candidate.availability?.includes('18:')) return false;
      return true;
    });
    return dailyShuffle(filtered, getDailySeed() + (profile?.id || ''));
  }, [activeFacultyFilter, availableProfiles, eveningOnly, profile?.faculty, profile?.id, sameFacultyOnly, selectedCategory]);

  const currentProfile = filteredProfiles[0] || null;
  const remoteAvatar = useRemoteImage(currentProfile?.avatarUri);
  const imageUri = remoteAvatar || assets?.[0]?.localUri || assets?.[0]?.uri;

  useEffect(() => {
    if (currentProfile?.id) resetCountdown();
  }, [currentProfile?.id, resetCountdown]);

  const hasRecycledForThisEmptyState = useRef(false);

  useEffect(() => {
    if (filteredProfiles.length > 0) {
      hasRecycledForThisEmptyState.current = false;
      return;
    }

    if (!hasRecycledForThisEmptyState.current) {
      hasRecycledForThisEmptyState.current = true;
      recycleSkippedProfiles();
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

  const handleReset = () => {
    recycleSkippedProfiles();
    setSelectedCategory('all');
    setEveningOnly(false);
    void persistFacultyMatching('all', false);
  };



  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

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

function DiscoveryShortcuts({ matchedCount = 0, timeLeft = '24:00:00' }) {
  const palette = usePalette();
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
