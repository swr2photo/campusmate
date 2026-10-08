import Text from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Image from '../components/CachedImage';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  MATCHING_ACTIVITY_OPTIONS,
  MATCHING_AGE_MIN,
  MATCHING_AVAILABILITY_OPTIONS,
  MATCHING_DEFAULT_AGE_MAX,
  MATCHING_GENDER_OPTIONS,
  MATCHING_PACE_OPTIONS,
  MATCHING_WEEKDAY_OPTIONS,
  MATCHING_YEAR_OPTIONS,
  createMatchingOptionState,
  getSelectedMatchingValues,
  matchesActivityDetailFilters,
  matchesAvailabilityPeriods,
  matchesAvailabilityWeekdays,
  normalizeMatchingAge,
  profileHasAvailability,
  profileHasPhoto,
  pruneActivityDetailFilters,
} from '../data/matchingFilters';
import { useAppActions, useAppBadges, useAppConversations, useAppFeed, useAppProfile } from '../context/AppContext';
import { IosLikeScreen } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import NativeAdCard from '../components/NativeAdCard';
import { isDiscoveryAdDue } from '../utils/adPolicy';
import { useEntitlement } from '../context/MembershipContext';
import { FEATURE_ADVANCED_FILTERS, FEATURE_UNLIMITED_REWIND } from '../data/plans';
import { allowedMatchingPreferences } from '../services/secureDiscoveryService';
import { TourTarget } from '../context/AppTourContext';
import { HomeCardSkeleton } from '../components/LikesSkeleton';
import { useDiscoveryDeckState } from '../hooks/useDiscoveryDeckState';
import { getImageRequestUri, useProfileImagePrefetch } from '../utils/useRemoteImage';
import { ACTIVITY_CATEGORY_BY_ID } from '../data/activityCategories';
import { ACTIVITY_LABELS, formatDistance, formatReadableDate, getActivityLabel } from '../utils/formatters';
import { dailyPick, getDailySeed, pickDailyProfile } from '../utils/dailyPick';
import { radius, spacing, type, useTheme } from '../theme';

function getTagDisplayLabel(tag) {
  if (!tag) return '';
  const cat = ACTIVITY_CATEGORY_BY_ID[tag];
  if (cat?.shortLabel) return cat.shortLabel;
  if (cat?.label) return cat.label;
  if (ACTIVITY_LABELS[tag]) return ACTIVITY_LABELS[tag];
  return getActivityLabel(tag);
}

// Quick activity categories with vector icons (100% Zero-Emoji)
const QUICK_ACTIVITIES = [
  { id: 'all', label: 'ทั้งหมด', symbol: 'sparkles' },
  { id: 'study', label: 'ติวสอบ', symbol: 'book.closed.fill' },
  { id: 'food', label: 'ทานอาหาร', symbol: 'fork.knife' },
  { id: 'gym', label: 'ฟิตเนส', symbol: 'dumbbell.fill' },
  { id: 'chill', label: 'คาเฟ่ & ชิล', symbol: 'cup.and.saucer.fill' },
  { id: 'gaming', label: 'บอร์ดเกม', symbol: 'gamecontroller.fill' },
  { id: 'running', label: 'วิ่ง', symbol: 'figure.run' },
  { id: 'sports', label: 'กีฬา', symbol: 'sportscourt.fill' },
];

function stripEmojis(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '')
    .trim();
}

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

export default function HomeScreen({ onOpenLikes }) {
  const { colors, isDark } = useTheme();
  const advancedFilters = useEntitlement(FEATURE_ADVANCED_FILTERS);
  const rewind = useEntitlement(FEATURE_UNLIMITED_REWIND);
  const {
    availableProfiles = [],
    hasMoreProfiles = false,
    isLoadingMoreProfiles = false,
    isResolvingDistances = false,
    isDiscoveryReady = false,
    discoveryError = null,
    matchedProfileIds = [],
    selectedMeetup,
    discoveryActionCount = 0,
  } = useAppFeed();
  const { conversationCount = 0, matchedCount = 0 } = useAppBadges();
  const {
    dismissProfile,
    getMeetupStats,
    loadMoreProfiles,
    matchProfile,
    recycleSkippedProfiles,
    retryDiscovery,
  } = useAppActions();
  const { profile } = useAppProfile();
  const { conversations = [] } = useAppConversations();

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [actionInProgress, setActionInProgress] = useState(false);

  const recycleLock = useRef(false);
  const pinnedDailyRef = useRef({ day: getDailySeed(), id: null });
  const openLikes = onOpenLikes || (() => router.push('/likes'));
  const preferences = allowedMatchingPreferences(profile?.matchingPreferences, advancedFilters.allowed);

  const faculty = preferences.sameFacultyOnly === true ? 'all' : (preferences.faculty || 'all');
  const sameFacultyOnly = preferences.sameFacultyOnly === true;
  const ageMin = normalizeMatchingAge(preferences.ageMin, MATCHING_AGE_MIN);
  const ageMax = Math.max(ageMin, normalizeMatchingAge(preferences.ageMax, MATCHING_DEFAULT_AGE_MAX));
  const years = createMatchingOptionState(MATCHING_YEAR_OPTIONS, preferences.years || []);
  const genders = createMatchingOptionState(MATCHING_GENDER_OPTIONS, preferences.genders || []);
  const activities = createMatchingOptionState(MATCHING_ACTIVITY_OPTIONS, preferences.activities || []);
  const paces = createMatchingOptionState(MATCHING_PACE_OPTIONS, preferences.paces || []);
  const activityDetailFilters = useMemo(
    () => pruneActivityDetailFilters(preferences.activityDetails, preferences.activities || []),
    [preferences.activityDetails, preferences.activities]
  );
  const availabilityPeriods = createMatchingOptionState(
    MATCHING_AVAILABILITY_OPTIONS,
    preferences.availabilityPeriods || []
  );
  const weekdays = createMatchingOptionState(MATCHING_WEEKDAY_OPTIONS, preferences.weekdays || []);
  const selectedAvailabilityPeriods = getSelectedMatchingValues(MATCHING_AVAILABILITY_OPTIONS, availabilityPeriods);
  const selectedWeekdays = getSelectedMatchingValues(MATCHING_WEEKDAY_OPTIONS, weekdays);
  const availabilityFilterActive = selectedAvailabilityPeriods.length > 0
    && selectedAvailabilityPeriods.length < MATCHING_AVAILABILITY_OPTIONS.length;
  const activeFacultyFilter = sameFacultyOnly ? (profile?.faculty || 'all') : faculty;
  const maxDistance = Number(preferences.maxDistance);
  const requirePhoto = preferences.requirePhoto === true;
  const requireAvailability = preferences.requireAvailability === true;
  const meetupStats = selectedMeetup && profile ? getMeetupStats(profile) : null;

  const filteredProfiles = useMemo(() => {
    const filtered = availableProfiles.filter((candidate) => {
      if (activeFacultyFilter !== 'all' && candidate.faculty !== activeFacultyFilter) return false;
      if (sameFacultyOnly && candidate.faculty !== profile?.faculty) return false;
      const candidateAge = Number(candidate.age);
      if (Number.isFinite(candidateAge) && (candidateAge < ageMin || candidateAge > ageMax)) return false;
      const selectedYears = getSelectedMatchingValues(MATCHING_YEAR_OPTIONS, years);
      if (selectedYears.length && candidate.year && !selectedYears.includes(candidate.year)) return false;
      const selectedGenders = getSelectedMatchingValues(MATCHING_GENDER_OPTIONS, genders);
      if (selectedGenders.length && candidate.gender && !selectedGenders.includes(candidate.gender)) return false;

      // Quick Category Filter from Top Carousel
      if (selectedCategory !== 'all') {
        const candidateActs = candidate.activities || [candidate.activity].filter(Boolean);
        if (!candidateActs.includes(selectedCategory) && candidate.activity !== selectedCategory) {
          return false;
        }
      }

      const selectedActivities = getSelectedMatchingValues(MATCHING_ACTIVITY_OPTIONS, activities);
      if (selectedActivities.length) {
        const candidateActivities = candidate.activities || [candidate.activity].filter(Boolean);
        if (!selectedActivities.some((item) => candidateActivities.includes(item) || candidate.activity === item)) {
          return false;
        }
      }
      const selectedPaces = getSelectedMatchingValues(MATCHING_PACE_OPTIONS, paces);
      if (selectedPaces.length && candidate.pace && !selectedPaces.includes(candidate.pace)) return false;
      if (!matchesActivityDetailFilters(candidate, activityDetailFilters)) return false;
      if (availabilityFilterActive && !matchesAvailabilityPeriods(candidate, selectedAvailabilityPeriods)) {
        return false;
      }
      if (selectedWeekdays.length && !matchesAvailabilityWeekdays(candidate, selectedWeekdays)) return false;
      if (requirePhoto && !profileHasPhoto(candidate)) return false;
      if (requireAvailability && !profileHasAvailability(candidate)) return false;
      if (
        Number.isFinite(maxDistance)
        && maxDistance > 0
        && typeof candidate.distance === 'number'
        && candidate.distance > maxDistance
      ) {
        return false;
      }
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
  }, [
    activeFacultyFilter,
    activityDetailFilters,
    ageMax,
    ageMin,
    availabilityFilterActive,
    activities,
    availableProfiles,
    genders,
    paces,
    maxDistance,
    profile?.faculty,
    profile?.id,
    requireAvailability,
    requirePhoto,
    sameFacultyOnly,
    selectedAvailabilityPeriods,
    selectedCategory,
    selectedWeekdays,
    years,
  ]);

  const currentProfile = filteredProfiles[0] || null;
  useProfileImagePrefetch(filteredProfiles.slice(1, 4));
  const deck = useDiscoveryDeckState({
    hasCandidate: isDiscoveryReady && Boolean(currentProfile),
    isDiscoveryReady,
    isLoadingMoreProfiles,
    isResolvingDistances,
    discoveryError,
    retryDiscovery,
  });

  useEffect(() => {
    if (currentProfile || isLoadingMoreProfiles || isResolvingDistances || !hasMoreProfiles) {
      recycleLock.current = false;
      return undefined;
    }
    if (recycleLock.current) return undefined;
    recycleLock.current = true;
    const timer = setTimeout(() => {
      void loadMoreProfiles()?.catch?.((error) => {
        console.warn('[HomeScreen] loadMoreProfiles error:', error?.message || error);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [currentProfile, hasMoreProfiles, isLoadingMoreProfiles, isResolvingDistances, loadMoreProfiles]);

  const restartDeck = useCallback(() => {
    // Bringing skipped people back is CampusMate Plus (unlimited rewind).
    if (!rewind.guard()) return;
    pinnedDailyRef.current.id = null;
    void recycleSkippedProfiles()?.catch?.((error) => {
      console.warn('[HomeScreen] restartDeck recycle error:', error?.message || error);
    });
    if (hasMoreProfiles && !isLoadingMoreProfiles) {
      void loadMoreProfiles()?.catch?.((error) => {
        console.warn('[HomeScreen] restartDeck loadMore error:', error?.message || error);
      });
    }
  }, [hasMoreProfiles, isLoadingMoreProfiles, loadMoreProfiles, recycleSkippedProfiles, rewind.guard]);

  const handlePass = useCallback(async () => {
    if (!currentProfile || actionInProgress) return;
    setActionInProgress(true);
    try {
      await dismissProfile(currentProfile.id);
    } catch (error) {
      console.warn('[HomeScreen] dismissProfile error:', error?.message || error);
    } finally {
      setActionInProgress(false);
    }
  }, [actionInProgress, currentProfile, dismissProfile]);

  const handleMatch = useCallback(async () => {
    if (!currentProfile || actionInProgress) return;
    setActionInProgress(true);
    try {
      const result = await matchProfile(currentProfile);
      if (result?.matched && result?.conversationId) {
        router.push({ pathname: '/chat-room', params: { chatId: result.conversationId } });
      }
    } catch (error) {
      console.warn('[HomeScreen] matchProfile error:', error?.message || error);
    } finally {
      setActionInProgress(false);
    }
  }, [actionInProgress, currentProfile, matchProfile]);

  const handleSuperLike = useCallback(async () => {
    if (!currentProfile || actionInProgress) return;
    setActionInProgress(true);
    try {
      const result = await matchProfile(currentProfile);
      if (result?.matched && result?.conversationId) {
        router.push({ pathname: '/chat-room', params: { chatId: result.conversationId } });
      }
    } catch (error) {
      console.warn('[HomeScreen] superLike error:', error?.message || error);
    } finally {
      setActionInProgress(false);
    }
  }, [actionInProgress, currentProfile, matchProfile]);

  const handleDirectChat = useCallback(async () => {
    if (!currentProfile || actionInProgress) return;
    if (isCurrentMatched) {
      const convo = conversations?.find((c) =>
        c?.participants?.includes?.(currentProfile.id) || c?.otherUser?.id === currentProfile.id
      );
      if (convo?.id) {
        router.push({ pathname: '/chat-room', params: { chatId: convo.id } });
        return;
      }
    }
    setActionInProgress(true);
    try {
      const result = await matchProfile(currentProfile);
      if (result?.conversationId) {
        router.push({ pathname: '/chat-room', params: { chatId: result.conversationId } });
      } else {
        router.push({ pathname: '/discover-profile', params: { profileId: currentProfile.id } });
      }
    } catch (error) {
      router.push({ pathname: '/discover-profile', params: { profileId: currentProfile.id } });
    } finally {
      setActionInProgress(false);
    }
  }, [actionInProgress, conversations, currentProfile, isCurrentMatched, matchProfile]);

  const tourScrollRef = useRef(null);

  const handleOpenProfile = useCallback(() => {
    if (!currentProfile) return;
    router.push({ pathname: '/discover-profile', params: { profileId: currentProfile.id } });
  }, [currentProfile]);

  const isCurrentMatched = Boolean(
    currentProfile?.isMatched || (currentProfile?.id && matchedProfileIds.includes(currentProfile.id))
  );

  return (
    <IosLikeScreen>
      <ScrollView
        ref={tourScrollRef}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >


        {/* 1. Collegiate Campus Context Header */}
        <CampusContextBar
          faculty={profile?.faculty}
          matchedCount={Math.max(matchedCount, conversationCount)}
          onOpenLikes={openLikes}
        />

        {/* Unverified users: their profile stays hidden until face verification. */}


        {/* 2. Activity Filter Carousel */}
        <TourTarget id="home.activities" scrollRef={tourScrollRef}>
          <ActivityFilterStrip
            categories={QUICK_ACTIVITIES}
            onSelect={setSelectedCategory}
            selected={selectedCategory}
          />
        </TourTarget>

        {/* 3. Daily Pick Spotlight Banner (Redesigned) */}
        <TourTarget id="home.dailyPick" scrollRef={tourScrollRef}>
          <DailyPickBanner
            candidate={deck.state === 'card' ? currentProfile : null}
            onOpenCandidate={handleOpenProfile}
          />
        </TourTarget>

        {/* 4. Main Profile Card or Empty State */}
        {isDiscoveryAdDue(discoveryActionCount) ? <NativeAdCard key={`discovery-ad-${discoveryActionCount}`} /> : null}
        {deck.state === 'card' ? (
          <>
            <TourTarget id="home.deck" scrollRef={tourScrollRef}>
              <DiscoverProfileCard
                key={currentProfile.id}
                candidate={currentProfile}
                isMatched={isCurrentMatched}
                onPress={handleOpenProfile}
              />
            </TourTarget>

            {/* 5. 5-Button Tactile Action Bar */}
            <TourTarget id="home.actions" scrollRef={tourScrollRef} scrollOffset={360}>
              <DiscoveryActionBar
                disabled={actionInProgress}
                isMatched={isCurrentMatched}
                onChat={handleDirectChat}
                onMatch={handleMatch}
                onPass={handlePass}
                onRestart={restartDeck}
                onSuperLike={handleSuperLike}
              />
            </TourTarget>
          </>
        ) : deck.state === 'loading' ? (
          <TourTarget id="home.deck" scrollRef={tourScrollRef}>
            <HomeCardSkeleton />
          </TourTarget>
        ) : deck.state === 'error' ? (
          <TourTarget id="home.deck" scrollRef={tourScrollRef}>
            <DiscoveryErrorState offline={deck.offline} onRetry={deck.retry} stalled={deck.stalled} />
          </TourTarget>
        ) : (
          <TourTarget id="home.deck" scrollRef={tourScrollRef}>
            <EmptyState loading={false} onReset={restartDeck} />
          </TourTarget>
        )}
      </ScrollView>
    </IosLikeScreen>
  );
}

function CampusContextBar({ faculty, matchedCount, onOpenLikes }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={[styles.campusBar, { backgroundColor: isDark ? colors.surfaceRaised : colors.surface, borderColor: colors.line }]}>
      <View style={styles.campusInfo}>
        <View style={[styles.campusBadgeIcon, { backgroundColor: colors.primarySoft }]}>
          <FeatureIcon color={colors.primary} name="building.columns.fill" size={16} />
        </View>
        <View style={styles.campusTexts}>
          <Text numberOfLines={1} style={[styles.campusTitle, { color: colors.ink }]}>
            มหาวิทยาลัยสงขลานครินทร์
          </Text>
          <Text numberOfLines={1} style={[styles.campusSubtitle, { color: colors.inkMuted }]}>
            {faculty ? `คณะ${faculty.replace(/^คณะ/, '')}` : 'วิทยาเขตหาดใหญ่'}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityLabel="ดูรายการถูกใจและการแมตช์"
        accessibilityRole="button"
        onPress={onOpenLikes}
        style={({ pressed }) => [
          styles.campusLikesChip,
          { backgroundColor: colors.primarySoft, borderColor: colors.line },
          pressed && styles.pressed,
        ]}
      >
        <FeatureIcon color={colors.primary} name="heart.fill" size={13} />
        <Text style={[styles.campusLikesText, { color: colors.primary }]}>{matchedCount}</Text>
      </Pressable>
    </View>
  );
}

function ActivityFilterStrip({ categories, selected, onSelect }) {
  const { colors, isDark } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterStripContainer}
    >
      {categories.map((cat) => {
        const active = selected === cat.id;
        return (
          <Pressable
            key={cat.id}
            accessibilityRole="button"
            onPress={() => onSelect(cat.id)}
            style={({ pressed }) => [
              styles.filterChip,
              {
                backgroundColor: active
                  ? colors.primary
                  : (isDark ? colors.surfaceRaised : colors.surface),
                borderColor: active ? colors.primary : colors.line,
              },
              pressed && styles.pressed,
            ]}
          >
            <FeatureIcon
              color={active ? colors.onPrimary : (isDark ? colors.inkSoft : colors.inkMuted)}
              name={cat.symbol}
              size={13}
            />
            <Text
              style={[
                styles.filterChipText,
                { color: active ? colors.onPrimary : colors.ink },
              ]}
            >
              {cat.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function DailyPickBanner({ candidate, onOpenCandidate }) {
  const { colors, isDark } = useTheme();
  const [timeLeft, setTimeLeft] = useState(() => formatRemainingTime(getRemainingTime()));
  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(formatRemainingTime(getRemainingTime())), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Pressable
      accessibilityLabel={candidate ? 'การ์ดแนะนำประจำวัน แตะเพื่อดูโปรไฟล์' : 'แนะนำประจำวัน ยังไม่มีคนที่ตรงกันวันนี้'}
      accessibilityRole={candidate ? 'button' : 'text'}
      disabled={!candidate}
      onPress={onOpenCandidate}
      style={({ pressed }) => [
        styles.dailyPickCard,
        {
          backgroundColor: isDark ? 'rgba(30,41,59,0.7)' : '#FFFFFF',
          borderColor: isDark ? 'rgba(59,130,246,0.25)' : 'rgba(37,99,235,0.16)',
        },
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={
          isDark
            ? ['rgba(37,99,235,0.18)', 'rgba(30,41,59,0.4)', 'rgba(99,102,241,0.15)']
            : ['rgba(238,244,255,0.95)', 'rgba(248,250,252,0.85)', 'rgba(240,245,255,0.95)']
        }
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.dailyPickBody}>
        {/* Star Icon Badge */}
        <View style={[styles.dailyPickStarBadge, { backgroundColor: isDark ? 'rgba(245,158,11,0.2)' : '#FEF3C7' }]}>
          <FeatureIcon color="#D97706" name="star.fill" size={17} />
        </View>

        {/* Center: Info */}
        <View style={styles.dailyPickCenter}>
          <View style={styles.dailyPickTitleRow}>
            <Text numberOfLines={1} style={[styles.dailyPickTitle, { color: colors.ink }]}>
              แนะนำประจำวัน
            </Text>
            {candidate ? (
              <View style={[styles.matchScoreBadge, { backgroundColor: isDark ? 'rgba(59,130,246,0.25)' : '#DBEAFE' }]}>
                <Text style={[styles.matchScoreText, { color: colors.primary }]}>ตรงกัน 98%</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={[styles.dailyPickDesc, { color: colors.inkMuted }]}>
            {candidate ? `ตรงกับตารางและเป้าหมายของ ${stripEmojis(candidate.name)}` : 'ยังไม่มีคนที่ตรงกันวันนี้ ลองปรับตัวกรองดูนะ'}
          </Text>
          <View style={styles.dailyPickTimerRow}>
            <FeatureIcon color={colors.inkMuted} name="clock" size={11} />
            <Text style={[styles.dailyPickTimeText, { color: colors.inkMuted }]}>
              รีเซ็ตใน {timeLeft}
            </Text>
          </View>
        </View>

        {/* Right: CTA Button (only when there is someone to open) */}
        {candidate ? (
          <View style={styles.dailyPickActionCol}>
            <View style={styles.dailyPickActionBtn}>
              <Text style={[styles.dailyPickActionText, { color: colors.primary }]}>ดูทันที</Text>
              <FeatureIcon color={colors.primary} name="chevron.right" size={14} />
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function DiscoverProfileCard({ candidate, isMatched, onPress }) {
  const { colors } = useTheme();
  const imageUri = getImageRequestUri(candidate.avatarUri, candidate.avatarRevision);

  const rawTags = candidate.activities || [candidate.activity].filter(Boolean);
  const displayTags = rawTags.map(stripEmojis).filter(Boolean);
  const bioText = stripEmojis(candidate.bio);
  const trackName = stripEmojis(candidate.favoriteTracks?.[0]?.name || candidate.favoriteTracks?.[0]?.title);
  const trackArtist = stripEmojis(candidate.favoriteTracks?.[0]?.artist);

  return (
    <Pressable
      accessibilityLabel={`เปิดโปรไฟล์ ${candidate.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.profileCardWrapper, pressed && styles.cardPressed]}
    >
      <View style={[styles.profileCard, { backgroundColor: candidate.avatarColor || colors.card, borderColor: colors.line }]}>
        {imageUri ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={candidate.id}
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            transition={0}
          />
        ) : (
          <View style={styles.profilePlaceholder}>
            <FeatureIcon color={colors.inkMuted} name="person.crop.square.fill" size={84} />
          </View>
        )}

        {/* Top Badges (Verified, Location, Match) */}
        <View style={styles.cardTopBadges}>
          <View style={styles.cardTopLeftBadges}>
            {candidate.isFaceVerified ? (
              <View style={[styles.glassBadge, { borderColor: 'rgba(35, 123, 231, 0.4)' }]}>
                <FeatureIcon color="#2869C7" name="checkmark.seal.fill" size={11} />
                <Text style={[styles.glassBadgeText, { color: '#2869C7', fontWeight: '700' }]}>ยืนยันใบหน้าแล้ว</Text>
              </View>
            ) : (
              <View style={styles.glassBadge}>
                <FeatureIcon color="#2869C7" name="lock.shield.fill" size={11} />
                <Text style={styles.glassBadgeText}>ยืนยันตัวตนแล้ว</Text>
              </View>
            )}
            <View style={styles.glassBadge}>
              <FeatureIcon color="#FFFFFF" name="mappin.and.ellipse" size={11} />
              <Text style={styles.glassBadgeText}>
                {typeof candidate.distance === 'number' && candidate.distance > 100
                  ? 'ในวิทยาเขต'
                  : (formatDistance(candidate.distance) || 'ในวิทยาเขต')}
              </Text>
            </View>
          </View>

          {isMatched ? (
            <View style={[styles.glassBadge, styles.matchedBadge]}>
              <FeatureIcon color="#10B981" name="checkmark.circle.fill" size={11} />
              <Text style={[styles.glassBadgeText, { color: '#10B981', fontWeight: '700' }]}>แมตช์แล้ว</Text>
            </View>
          ) : (
            <View style={styles.glassBadge}>
              <FeatureIcon color="#F59E0B" name="sparkles" size={11} />
              <Text style={styles.glassBadgeText}>ตรงกัน 96%</Text>
            </View>
          )}
        </View>

        {/* Bottom Gradient Overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(10,18,32,0.25)', 'rgba(10,18,32,0.85)', '#0B132B']}
          locations={[0, 0.38, 0.72, 1.0]}
          style={styles.cardBottomOverlay}
        >
          <View style={styles.nameRow}>
            <View style={styles.onlineDot} />
            <Text numberOfLines={1} style={styles.heroName}>
              {stripEmojis(candidate.name)}{candidate.age ? `, ${candidate.age}` : ''}
            </Text>
          </View>

          <Text numberOfLines={1} style={styles.heroFaculty}>
            {[
              candidate.faculty ? `คณะ${candidate.faculty.replace(/^คณะ/, '')}` : null,
              candidate.year || 'นักศึกษา',
            ].filter(Boolean).join(' · ')}
          </Text>

          {bioText ? (
            <Text numberOfLines={2} style={styles.heroBio}>
              {bioText}
            </Text>
          ) : null}

          {/* Tags */}
          {displayTags.length > 0 ? (
            <View style={styles.tagsContainer}>
              {displayTags.slice(0, 3).map((tag, idx) => (
                <View key={idx} style={styles.tagPill}>
                  <Text style={styles.tagText}>{getTagDisplayLabel(tag)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Favorite Track Mini Widget */}
          {trackName ? (
            <View style={styles.trackPill}>
              <FeatureIcon color="#10B981" name="music.note" size={11} />
              <Text numberOfLines={1} style={styles.trackText}>
                {trackName}{trackArtist ? ` - ${trackArtist}` : ''}
              </Text>
            </View>
          ) : null}
        </LinearGradient>
      </View>
    </Pressable>
  );
}

function DiscoveryActionBar({ disabled, isMatched, onRestart, onPass, onSuperLike, onMatch, onChat }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={styles.actionBar}>
      {/* 1. Undo / Rewind */}
      <Pressable
        accessibilityLabel="เริ่มใหม่ นำคนที่เคยข้ามกลับมา"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onRestart}
        style={({ pressed }) => [
          styles.actionBtnSmall,
          {
            backgroundColor: isDark ? 'rgba(30,41,59,0.7)' : colors.surface,
            borderColor: isDark ? 'rgba(100,116,139,0.3)' : colors.line,
          },
          pressed && styles.pressed,
        ]}
      >
        <FeatureIcon color={colors.inkMuted || '#64748B'} name="arrow.counterclockwise" size={19} />
      </Pressable>

      {/* 2. Pass / Skip */}
      <Pressable
        accessibilityLabel="ข้ามคนนี้"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPass}
        style={({ pressed }) => [
          styles.actionBtnMedium,
          {
            backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : '#FFF1F2',
            borderColor: isDark ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.25)',
          },
          pressed && styles.pressed,
        ]}
      >
        <FeatureIcon color="#EF4444" name="xmark" size={24} />
      </Pressable>

      {/* 3. Super Like */}
      <Pressable
        accessibilityLabel="ถูกใจเป็นพิเศษ"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onSuperLike}
        style={({ pressed }) => [
          styles.actionBtnSmall,
          {
            backgroundColor: isDark ? 'rgba(14,165,233,0.15)' : '#F0F9FF',
            borderColor: isDark ? 'rgba(14,165,233,0.35)' : 'rgba(14,165,233,0.3)',
          },
          pressed && styles.pressed,
        ]}
      >
        <FeatureIcon color="#0EA5E9" name="star.fill" size={20} />
      </Pressable>

      {/* 4. Connect / Match (Hero Button) */}
      <Pressable
        accessibilityLabel="ถูกใจและขอเชื่อมต่อเป็นเพื่อน"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onMatch}
        style={({ pressed }) => [
          styles.actionBtnLarge,
          { backgroundColor: colors.primary },
          pressed && styles.pressed,
        ]}
      >
        <FeatureIcon color={colors.onPrimary || '#FFFFFF'} name="heart.fill" size={28} />
      </Pressable>

      {/* 5. Direct Message / Send */}
      <Pressable
        accessibilityLabel="ส่งข้อความทักทาย"
        accessibilityRole="button"
        disabled={disabled}
        onPress={onChat}
        style={({ pressed }) => [
          styles.actionBtnSmall,
          {
            backgroundColor: isDark ? 'rgba(37,99,235,0.15)' : '#EFF6FF',
            borderColor: isDark ? 'rgba(37,99,235,0.35)' : 'rgba(37,99,235,0.25)',
          },
          pressed && styles.pressed,
        ]}
      >
        <FeatureIcon color={colors.primary || '#2563EB'} name="paperplane.fill" size={19} />
      </Pressable>
    </View>
  );
}

function MeetupBanner({ meetup, stats }) {
  const { colors, isDark } = useTheme();
  const meetupColor = colors.primaryDark;
  const meetupSoft = colors.primarySoft;
  const meetupBorder = isDark ? 'rgba(112,178,255,0.28)' : 'rgba(35,123,231,0.16)';
  return (
    <View style={[styles.meetupBanner, { backgroundColor: meetupSoft, borderColor: meetupBorder }]}>
      <Pressable accessibilityRole="button" onPress={() => router.navigate('/meetup')} style={({ pressed }) => [styles.meetupBannerMain, pressed && styles.pressed]}>
        <View style={[styles.meetupIcon, { backgroundColor: meetupColor }]}>
          <FeatureIcon color={colors.onPrimary} name="mappin.and.ellipse" size={13} />
        </View>
        <View style={styles.meetupCopy}>
          <View style={styles.meetupTitleRow}>
            <Text numberOfLines={1} style={[styles.meetupEyebrow, { color: colors.ink }]}>จุดนัดพบ</Text>
            <Text style={[styles.meetupStatus, { color: stats?.isFull ? colors.danger : meetupColor }]}>
              {stats ? (stats.isFull ? 'เต็มแล้ว' : `ร่วม ${stats.acceptedCount}/${stats.maxPeople}`) : 'พร้อม'}
            </Text>
          </View>
          <Text numberOfLines={1} style={[styles.meetupName, { color: colors.ink }]}>{meetup.name}</Text>
          <Text numberOfLines={1} style={[styles.meetupMeta, { color: colors.inkMuted }]}>
            {meetup.schedule?.date ? formatReadableDate(meetup.schedule.date) : 'แตะเพื่อจัดการจุดนัดพบ'}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="จัดการจุดนัดพบ"
        onPress={() => router.navigate('/meetup')}
        style={({ pressed }) => [styles.meetupManage, { backgroundColor: meetupColor }, pressed && styles.pressed]}
      >
        <Text style={[styles.meetupManageText, { color: colors.onPrimary }]}>จัดการ</Text>
      </Pressable>
    </View>
  );
}

function DiscoveryErrorState({ offline = false, stalled = false, onRetry }) {
  const { colors } = useTheme();
  const title = offline ? 'ไม่ได้เชื่อมต่ออินเทอร์เน็ต' : stalled ? 'โหลดโปรไฟล์นานกว่าปกติ' : 'โหลดโปรไฟล์ไม่สำเร็จ';
  const body = offline
    ? 'ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง โปรไฟล์จะโหลดเองเมื่อกลับมาออนไลน์'
    : 'อาจเป็นเพราะสัญญาณไม่เสถียร ลองอีกครั้งหรือปรับตัวกรองการจับคู่';
  return (
    <View accessibilityRole="alert" style={[styles.emptyState, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <FeatureIcon color={colors.primary} name={offline ? 'wifi.slash' : 'exclamationmark.triangle'} size={28} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: colors.inkMuted }]}>{body}</Text>
      <View style={styles.emptyActionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.resetButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          <FeatureIcon color={colors.onPrimary} name="arrow.triangle.2.circlepath" size={16} />
          <Text style={[styles.resetButtonText, { color: colors.onPrimary }]}>ลองอีกครั้ง</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/matching-filters')}
          style={({ pressed }) => [styles.filterConfigButton, { borderColor: colors.line, backgroundColor: colors.surface }, pressed && styles.pressed]}
        >
          <FeatureIcon color={colors.ink} name="slider.horizontal.3" size={16} />
          <Text style={[styles.filterConfigButtonText, { color: colors.ink }]}>ปรับตัวกรอง</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EmptyState({ loading = false, onReset }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.emptyState, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <FeatureIcon color={colors.primary} name="person.2.slash" size={28} />
        )}
      </View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>
        {loading ? 'กำลังค้นหาเพื่อนที่ตรงกัน…' : 'ยังไม่มีโปรไฟล์ที่ตรงกันในหมวดนี้'}
      </Text>
      <Text style={[styles.emptyText, { color: colors.inkMuted }]}>
        {loading
          ? 'กำลังโหลดโปรไฟล์และตรวจสอบระยะทาง โปรไฟล์จะแสดงเองเมื่อพร้อม'
          : 'ลองเปลี่ยนหมวดหมู่กิจกรรม หรือกด "เริ่มใหม่" เพื่อดูคนที่เคยข้ามอีกครั้ง'}
      </Text>
      {!loading ? (
        <View style={styles.emptyActionRow}>
          <Pressable
            accessibilityRole="button"
            onPress={onReset}
            style={({ pressed }) => [styles.resetButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
          >
            <FeatureIcon color={colors.onPrimary} name="arrow.triangle.2.circlepath" size={16} />
            <Text style={[styles.resetButtonText, { color: colors.onPrimary }]}>เริ่มใหม่</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/matching-filters')}
            style={({ pressed }) => [styles.filterConfigButton, { borderColor: colors.line, backgroundColor: colors.surface }, pressed && styles.pressed]}
          >
            <FeatureIcon color={colors.ink} name="slider.horizontal.3" size={16} />
            <Text style={[styles.filterConfigButtonText, { color: colors.ink }]}>ปรับตัวกรอง</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  pressed: {
    opacity: 0.76,
  },
  cardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.995 }],
  },

  // 1. Campus Bar
  campusBar: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  campusInfo: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  campusBadgeIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  campusTexts: {
    flex: 1,
  },
  campusTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  campusSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  campusLikesChip: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  campusLikesText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // 2. Activity Filter Strip
  filterStripContainer: {
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // 3. Daily Pick Card (Collegiate Spotlight Banner)
  dailyPickCard: {
    borderCurve: 'continuous',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  dailyPickBody: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dailyPickStarBadge: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  dailyPickCenter: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  dailyPickTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dailyPickTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  matchScoreBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  matchScoreText: {
    fontSize: 10,
    fontWeight: '700',
  },
  dailyPickDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  dailyPickTimerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 1,
  },
  dailyPickTimeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '500',
  },
  dailyPickActionCol: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  dailyPickActionBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  dailyPickActionText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // 4. Hero Profile Card
  profileCardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  profileCard: {
    borderCurve: 'continuous',
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    height: 460,
    overflow: 'hidden',
    position: 'relative',
  },
  profilePlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  cardTopBadges: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 12,
    position: 'absolute',
    right: 12,
    top: 12,
    zIndex: 10,
  },
  cardTopLeftBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  glassBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,32,58,0.7)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  glassBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  matchedBadge: {
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderColor: 'rgba(16,185,129,0.4)',
  },
  cardBottomOverlay: {
    bottom: 0,
    gap: 6,
    justifyContent: 'flex-end',
    left: 0,
    paddingBottom: 16,
    paddingHorizontal: 16,
    paddingTop: 48,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  onlineDot: {
    backgroundColor: '#10B981',
    borderRadius: radius.pill,
    height: 9,
    width: 9,
  },
  heroName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heroFaculty: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '500',
  },
  heroBio: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  tagPill: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  trackPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.18)',
    borderColor: 'rgba(16,185,129,0.3)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  trackText: {
    color: '#E8F8F1',
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
  },

  // 5. Tactile Action Bar
  actionBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  actionBtnSmall: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  actionBtnMedium: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnLarge: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 66,
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
    width: 66,
  },

  // Meetup Banner
  meetupBanner: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  meetupBannerMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  meetupIcon: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  meetupCopy: { flex: 1 },
  meetupTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  meetupEyebrow: { fontSize: type.caption2, fontWeight: '600' },
  meetupStatus: { fontSize: 12, fontWeight: '600' },
  meetupName: { fontSize: type.bodySmall, fontWeight: '600', marginTop: 1 },
  meetupMeta: { fontSize: type.caption2, marginTop: 1 },
  meetupManage: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 10,
  },
  meetupManageText: { fontSize: type.caption2, fontWeight: '600' },

  // Empty State
  emptyState: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingVertical: 36,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  emptyTitle: {
    fontSize: type.headline,
    fontWeight: '700',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: type.caption,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.lg,
    width: '100%',
  },
  resetButton: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.md,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  resetButtonText: {
    fontSize: type.bodySmall,
    fontWeight: '600',
  },
  filterConfigButton: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  filterConfigButtonText: {
    fontSize: type.bodySmall,
    fontWeight: '600',
  },
});
