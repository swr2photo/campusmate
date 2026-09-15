import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import {
  getPublicProfile,
  isProfileReadyForDiscovery,
  mergeProfileRecords,
  normalizeProfileRecord,
  toSafePublicProfile,
} from '../services/firestoreService';
import { useApp } from '../context/AppContext';
import FeatureIcon from '../components/FeatureIcon';
import { useRemoteImage } from '../utils/useRemoteImage';
import { formatAvailabilitySlots, formatDistance, formatReadableDate, genderLabel, getActivityLabel } from '../utils/formatters';
import { radius, spacing, type, useTheme } from '../theme';

const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const actionButtonWidth = 96;
const actionSideInset = 32;

function mergeCandidateProfiles(...lists) {
  const byId = new Map();
  lists.forEach((list) => {
    const items = Array.isArray(list) ? list : [list];
    items.forEach((item) => {
      if (!item?.id) return;
      byId.set(item.id, mergeProfileRecords(byId.get(item.id), item));
    });
  });
  return Array.from(byId.values());
}

function displayText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return '';
}

function safeStringList(value) {
  return Array.isArray(value) ? value.map(displayText).filter(Boolean) : [];
}

function hasCorruptMarker(value) {
  return typeof value === 'string' && value.includes('???');
}

function InfoRow({ icon, label, value, colors, styles }) {
  const isMulti = typeof value === 'string' && value.includes('\n');
  return (
    <View style={[styles.infoRow, isMulti && { alignItems: 'flex-start' }]}>
      <View style={[styles.infoIcon, isMulti && { marginTop: 2 }]}>
        <FeatureIcon color={colors.primary} name={icon} size={18} />
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, isMulti && { lineHeight: 22 }]}>{value || 'ไม่ระบุ'}</Text>
      </View>
    </View>
  );
}

function ProfileCardView({
  candidate,
  colors,
  insets,
  isDark,
  isUnderCard = false,
  isViewOnly = false,
  styles,
  getMeetupStats,
  likeBorderOpacity = null,
  skipBorderOpacity = null,
  swipeCoral = null,
  underCardBlurOpacity = null,
}) {
  const allTags = useMemo(() => {
    if (!candidate) return [];
    return Array.from(new Set([
      ...safeStringList(candidate.tags),
      ...safeStringList(candidate.interests),
    ]));
  }, [candidate]);

  const activityDisplay = useMemo(() => {
    if (!candidate) return '';
    const activity = Array.isArray(candidate.activity)
      ? safeStringList(candidate.activity)
      : displayText(candidate.activity);
    const activityLabel = displayText(candidate.activityLabel);
    const activities = safeStringList(candidate.activities);
    return displayText(getActivityLabel(activity, activityLabel, activities));
  }, [candidate]);

  const displayName = candidate?.nickname || candidate?.name || 'ผู้ใช้ CampusMate';
  const safeDisplayName = displayText(displayName) || 'ผู้ใช้ CampusMate';
  const ageDisplay = displayText(candidate?.age);
  const genderDisplay = displayText(candidate?.gender);
  const facultyDisplay = displayText(candidate?.faculty);
  const yearDisplay = displayText(candidate?.year);
  const skillDisplay = displayText(candidate?.skill);
  const paceDisplay = displayText(candidate?.pace);
  const formattedSlots = formatAvailabilitySlots(candidate?.availabilitySlots);
  const availabilityDisplay = formattedSlots
    || (!hasCorruptMarker(candidate?.availability) ? displayText(candidate?.availability) : '');
  const distanceValue = candidate?.distance == null
    ? null
    : (typeof candidate.distance === 'number' ? candidate.distance : Number(candidate.distance));
  const safeDistance = Number.isFinite(distanceValue) ? distanceValue : null;
  const meetup = candidate?.meetup && typeof candidate.meetup === 'object' && !Array.isArray(candidate.meetup)
    ? candidate.meetup
    : null;
  const meetupSchedule = meetup?.schedule && typeof meetup.schedule === 'object' && !Array.isArray(meetup.schedule)
    ? meetup.schedule
    : null;
  const meetupName = displayText(meetup?.name) || 'จุดนัดหมาย';
  const meetupDate = displayText(meetupSchedule?.date);
  const meetupStartTime = displayText(meetupSchedule?.startTime);
  const meetupEndTime = displayText(meetupSchedule?.endTime);
  const meetupMaxPeople = displayText(meetupSchedule?.maxPeople);
  const meetupMessage = displayText(meetupSchedule?.message);
  const bioDisplay = displayText(candidate?.bio) || 'ยังไม่ได้เขียนคำแนะนำตัว';
  const compatibilityDisplay = candidate?.compatibility == null
    ? ''
    : displayText(candidate.compatibility);
  const avatarColor = typeof candidate?.avatarColor === 'string' && candidate.avatarColor.trim()
    ? candidate.avatarColor
    : (isDark ? colors.surfaceRaised : '#E9EDF4');
  const hasVisibleDetails = Boolean(
    ageDisplay
    || genderDisplay
    || facultyDisplay
    || yearDisplay
    || activityDisplay
    || skillDisplay
    || paceDisplay
    || availabilityDisplay
    || safeDistance != null
    || meetup
  );
  const remoteHeroImage = useRemoteImage(candidate?.avatarUri, candidate?.updatedAt, candidate?.id);
  const meetupStats = candidate && getMeetupStats ? getMeetupStats(candidate) : null;

  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [candidate?.id]);

  const Container = isUnderCard ? View : ScrollView;
  const containerProps = isUnderCard
    ? {
        pointerEvents: 'none',
        style: [
          styles.scrollContent,
          { paddingTop: 68 + insets.top, width: '100%', height: '100%' },
        ],
      }
    : {
        ref: scrollRef,
        contentContainerStyle: [
          styles.scrollContent,
          { paddingTop: 68 + insets.top },
          isViewOnly && { paddingBottom: spacing.xl },
        ],
        nestedScrollEnabled: true,
        showsVerticalScrollIndicator: false,
        style: { width: '100%', height: '100%' },
      };

  return (
    <Container {...containerProps}>
      <View style={styles.swipeCard}>
        <View style={styles.hero}>
          {remoteHeroImage ? (
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              recyclingKey={candidate?.id}
              source={{ uri: remoteHeroImage }}
              style={styles.heroImage}
            />
          ) : (
            <View
              accessibilityLabel="ยังไม่มีรูปโปรไฟล์"
              style={[styles.heroImage, styles.heroPlaceholder, { backgroundColor: avatarColor }]}
            >
              <FeatureIcon color={colors.inkMuted} name="person.crop.square.fill" size={86} />
              <Text style={styles.heroPlaceholderText}>ยังไม่มีรูปโปรไฟล์</Text>
            </View>
          )}
          <View style={styles.heroOverlay} />
          {isUnderCard ? (
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.14)', 'rgba(0,0,0,0.14)']}
              locations={[0, 0.42, 1]}
              pointerEvents="none"
              style={styles.heroBlur}
            />
          ) : (
            <MaskedView
              pointerEvents="none"
              style={styles.heroBlur}
              maskElement={(
                <LinearGradient
                  colors={['transparent', '#FFFFFF', '#FFFFFF']}
                  locations={[0, 0.42, 1]}
                  style={StyleSheet.absoluteFill}
                />
              )}
            >
              <BlurView intensity={isDark ? 28 : 34} tint="dark" style={StyleSheet.absoluteFill} />
              <View pointerEvents="none" style={styles.heroBlurScrim} />
            </MaskedView>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.16)', 'rgba(0,0,0,0.48)']}
            locations={[0, 0.46, 1]}
            pointerEvents="none"
            style={styles.heroGradient}
          />
          <View style={styles.heroCopy}>
            <Text style={styles.heroName}>{safeDisplayName}{ageDisplay ? `, ${ageDisplay}` : ''}</Text>
            {activityDisplay ? <Text style={styles.heroActivity}>{activityDisplay}</Text> : null}
          </View>
        </View>

        {isUnderCard ? null : <View style={styles.body}>
          <View style={styles.identityRow}>
            <View style={styles.identityCopy}>
              <Text style={styles.title}>เกี่ยวกับ {safeDisplayName}</Text>
              <Text style={styles.subtitle}>ข้อมูลที่เจ้าของโปรไฟล์เลือกแสดง</Text>
            </View>
            {compatibilityDisplay ? (
              <View style={styles.compatibility}>
                <Text style={styles.compatibilityValue}>{compatibilityDisplay}%</Text>
                <Text style={styles.compatibilityLabel}>เข้ากันได้</Text>
              </View>
            ) : null}
          </View>

          {ageDisplay ? <InfoRow icon="calendar" label="อายุ" value={`${ageDisplay} ปี`} colors={colors} styles={styles} /> : null}
          {genderDisplay ? <InfoRow icon="person.2.fill" label="เพศ" value={genderLabel(genderDisplay)} colors={colors} styles={styles} /> : null}
          {(facultyDisplay && !hasCorruptMarker(facultyDisplay)) ? <InfoRow icon="building.columns.fill" label="คณะ" value={facultyDisplay} colors={colors} styles={styles} /> : null}
          {(yearDisplay && !hasCorruptMarker(yearDisplay)) ? <InfoRow icon="graduationcap.fill" label="ชั้นปี" value={yearDisplay} colors={colors} styles={styles} /> : null}
          {activityDisplay ? <InfoRow icon="figure.run" label="กิจกรรมที่ชอบ" value={activityDisplay} colors={colors} styles={styles} /> : null}
          {skillDisplay ? <InfoRow icon="star.fill" label="ระดับ / ทักษะ" value={skillDisplay} colors={colors} styles={styles} /> : null}
          {paceDisplay ? <InfoRow icon="speedometer" label="สไตล์ / เพซ" value={paceDisplay} colors={colors} styles={styles} /> : null}
          {availabilityDisplay ? (
            <InfoRow
              icon="clock.fill"
              label="เวลาที่สะดวก"
              value={availabilityDisplay}
              colors={colors}
              styles={styles}
            />
          ) : null}
          {safeDistance != null ? <InfoRow icon="location.circle.fill" label="ระยะห่างจากคุณ" value={formatDistance(safeDistance)} colors={colors} styles={styles} /> : null}

          {!hasVisibleDetails ? (
            <View style={styles.privacyNotice}>
              <FeatureIcon color={colors.primary} name="eye.slash.fill" size={18} />
              <Text style={styles.privacyNoticeText}>ข้อมูลรายละเอียดอื่นถูกซ่อนไว้ตามการตั้งค่าความเป็นส่วนตัว</Text>
            </View>
          ) : null}

          {meetup && (
            <View style={styles.meetupCard}>
              <View style={styles.meetupHeader}>
                <View style={styles.meetupTitleRow}>
                  <FeatureIcon color={colors.primary} name="mappin.and.ellipse" size={19} />
                  <Text style={styles.meetupSectionTitle}>จุดนัดหมาย</Text>
                </View>
                {meetupStats?.isFull ? (
                  <View style={[styles.meetupTag, { backgroundColor: 'rgba(255,100,100,0.18)' }]}>
                    <Text style={[styles.meetupTagText, { color: '#FF453A' }]}>นัดหมายเต็มแล้ว ({meetupStats.maxPeople}/{meetupStats.maxPeople})</Text>
                  </View>
                ) : (
                  <View style={styles.meetupTag}>
                    <Text style={styles.meetupTagText}>{meetupStats ? `รับสมัคร (ว่างอีก ${meetupStats.remaining} ที่)` : 'นัดพบกันที่นี่'}</Text>
                  </View>
                )}
              </View>

              <View style={styles.meetupItemRow}>
                <FeatureIcon color={colors.inkSoft} name="location.fill" size={16} />
                <Text style={styles.meetupName}>{meetupName}</Text>
              </View>

              {meetupDate && (
                <View style={styles.meetupItemRow}>
                  <FeatureIcon color={colors.inkSoft} name="calendar" size={16} />
                  <Text style={styles.meetupTime}>
                    {formatReadableDate(meetupDate)}
                    {meetupStartTime && meetupEndTime ? ` · ${meetupStartTime}–${meetupEndTime}` : ''}
                  </Text>
                </View>
              )}

              {meetupMaxPeople ? (
                <View style={styles.meetupItemRow}>
                  <FeatureIcon color={colors.inkSoft} name="person.2.fill" size={16} />
                  <Text style={styles.meetupPeople}>
                    {meetupStats
                      ? `ผู้เข้าร่วม ${meetupStats.acceptedCount}/${meetupStats.maxPeople} คน (รวมเจ้าของโพสต์)`
                      : `จำนวน ${meetupMaxPeople} คน`}
                  </Text>
                </View>
              ) : null}

              {meetupMessage ? (
                <View style={[styles.meetupItemRow, styles.meetupMsgRow]}>
                  <FeatureIcon color={colors.primary} name="text.bubble.fill" size={16} />
                  <Text style={styles.meetupMsg}>{meetupMessage}</Text>
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.bioSection}>
            <View style={styles.bioTitleRow}>
              <FeatureIcon color={colors.primary} name="text.quote" size={17} />
              <Text style={styles.sectionTitle}>แนะนำตัว</Text>
            </View>
            <Text numberOfLines={5} style={styles.bio}>{bioDisplay}</Text>
          </View>

          {allTags.length ? (
            <View>
              <Text style={styles.tagsTitle}>ความสนใจ</Text>
              <View style={styles.tagRow}>
                {allTags.map((tag) => (
                  <View key={tag} style={styles.tagChip}>
                    <Text style={styles.tagChipText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>}

        {!isUnderCard && !isViewOnly && likeBorderOpacity && skipBorderOpacity ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.cardSwipeGlow,
                {
                  borderColor: colors.primary,
                  opacity: likeBorderOpacity,
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.cardSwipeGlow,
                {
                  borderColor: swipeCoral || colors.danger,
                  opacity: skipBorderOpacity,
                },
              ]}
            />
          </>
        ) : null}

        {isUnderCard && underCardBlurOpacity ? (
          <Animated.View
            pointerEvents="none"
            style={[
              { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
              {
                borderRadius: 24,
                opacity: underCardBlurOpacity,
                overflow: 'hidden',
                zIndex: 20,
              },
            ]}
          >
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark ? 'rgba(12,16,24,0.22)' : 'rgba(255,255,255,0.24)',
                },
              ]}
            />
          </Animated.View>
        ) : null}
      </View>
    </Container>
  );
}

export default function DiscoverProfileScreen({ isViewOnlyParam, profileId, onClose, onToast }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors, isDark);
  const swipeCoral = isDark ? colors.coral : colors.danger;
  const { availableProfiles, conversations, dismissProfile, getMeetupStats, matchProfile, pendingIncomingLikes, acceptedIncomingLikes, sendActivityInvite, hasMoreProfiles, isLoadingMoreProfiles, loadMoreProfiles } = useApp();
  const [processing, setProcessing] = useState(false);
  const [sessionExcludedIds, setSessionExcludedIds] = useState([]);
  const [directProfile, setDirectProfile] = useState(null);
  const [profileLookupState, setProfileLookupState] = useState(() => (profileId ? 'loading' : 'idle'));
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const decisionStarted = useRef(false);
  const candidateCache = useRef(new Map());
  const [exitingCard, setExitingCard] = useState(null);
  const currentDxRef = useRef(0);

  useEffect(() => {
    if (!profileId) {
      setDirectProfile(null);
      setProfileLookupState('idle');
      return;
    }
    let active = true;
    let serverReadComplete = false;
    setProfileLookupState('loading');
    try {
      const { db } = requireFirebase();
      const profileRef = doc(db, 'profiles', profileId);
      void getPublicProfile(profileId).then((freshProfile) => {
        if (!active) return;
        serverReadComplete = true;
        if (freshProfile) {
          setDirectProfile(freshProfile);
          setProfileLookupState('ready');
        } else {
          setProfileLookupState('not-found');
        }
      }).catch((error) => {
        if (active) {
          setProfileLookupState('error');
          console.warn('Fresh profile lookup error:', error);
        }
      });
      const unsub = onSnapshot(profileRef, (snap) => {
        if (!active || (serverReadComplete && snap.metadata?.fromCache)) return;
        if (snap.exists()) {
          setDirectProfile(toSafePublicProfile(snap.id, snap.data()));
          setProfileLookupState('ready');
        } else {
          setDirectProfile(null);
          setProfileLookupState('not-found');
        }
      }, (error) => {
        if (active) {
          setProfileLookupState('error');
          console.warn('Realtime profile lookup error:', error?.message || error);
        }
      });
      return () => {
        active = false;
        unsub();
      };
    } catch (e) {
      setProfileLookupState('error');
      console.warn('Realtime profile lookup error:', e);
    }
  }, [profileId]);

  const isViewOnly = Boolean(isViewOnlyParam);

  const candidatePool = useMemo(() => {
    const seenIds = new Set();
    const excludedIds = new Set(sessionExcludedIds);
    const availableList = Array.isArray(availableProfiles) ? availableProfiles : [];
    const pendingLikes = Array.isArray(pendingIncomingLikes) ? pendingIncomingLikes : [];
    return mergeCandidateProfiles(availableList, pendingLikes).filter((item) => {
      const id = item?.id;
      if (!id || excludedIds.has(id) || seenIds.has(id) || !isProfileReadyForDiscovery(item)) return false;
      seenIds.add(id);
      return true;
    });
  }, [availableProfiles, pendingIncomingLikes, sessionExcludedIds]);

  // Keep the last known pool so a short Firestore refresh cannot leave the
  // card blank while the decision request is still being completed.
  useEffect(() => {
    candidatePool.forEach((item) => candidateCache.current.set(item.id, item));
  }, [candidatePool]);

  const candidate = useMemo(() => {
    if (isViewOnly) {
      const matchedConvo = conversations?.find((c) => c.profileId === profileId || c.participants?.includes(profileId));
      const fromAvailable = candidatePool.find((item) => item.id === profileId);
      const fromConversation = matchedConvo?.participantProfiles?.[profileId]
        ? normalizeProfileRecord(profileId, matchedConvo.participantProfiles[profileId])
        : null;
      return mergeCandidateProfiles(fromAvailable, fromConversation, directProfile?.id === profileId ? directProfile : null)[0] || null;
    }

    const isDecisionExcluded = (id) => sessionExcludedIds.includes(id);
    const requestedProfile = profileId && candidatePool.find((item) => (
      item.id === profileId && !isDecisionExcluded(item.id)
    ));
    if (requestedProfile || (directProfile?.id === profileId && !isDecisionExcluded(profileId))) {
      return mergeCandidateProfiles(requestedProfile, directProfile?.id === profileId ? directProfile : null)[0] || null;
    }

    const nextProfile = candidatePool.find((item) => !isDecisionExcluded(item.id));
    if (nextProfile) return nextProfile;

    // The profile subscription can briefly be ahead of the paged discovery
    // list. Use the direct snapshot for the initial card in that window.
    if (!candidatePool.length && directProfile?.id === profileId && !isDecisionExcluded(profileId)) {
      return directProfile;
    }

    if (processing && !isViewOnly) {
      const cachedNext = Array.from(candidateCache.current.values())
        .find((item) => !isDecisionExcluded(item.id));
      if (cachedNext) return cachedNext;
    }

    return null;
  }, [candidatePool, conversations, directProfile, isViewOnly, processing, profileId, sessionExcludedIds]);

  const nextCandidate = useMemo(() => {
    if (isViewOnly || !candidate) return null;
    const isDecisionExcluded = (id) => sessionExcludedIds.includes(id) || id === candidate.id;
    return candidatePool.find((item) => !isDecisionExcluded(item.id)) || null;
  }, [candidate, candidatePool, isViewOnly, sessionExcludedIds]);

  useEffect(() => {
    if (!candidatePool || !candidatePool.length) return;
    const upcoming = candidatePool.slice(0, 6);
    upcoming.forEach((item) => {
      const uri = item?.avatarUri || item?.photoURL;
      if (uri && typeof uri === 'string' && uri.startsWith('http')) {
        Image.prefetch(uri, 'memory-disk').catch(() => {});
      }
    });
  }, [candidatePool]);

  useEffect(() => {
    if (isViewOnly || candidate || !hasMoreProfiles || isLoadingMoreProfiles) return undefined;
    void loadMoreProfiles();
    return undefined;
  }, [candidate, hasMoreProfiles, isLoadingMoreProfiles, isViewOnly, loadMoreProfiles]);

  const isCandidateMatched = useMemo(() => {
    if (!candidate) return false;
    const isMutualAccepted = acceptedIncomingLikes?.some((like) => like.id === candidate.id);
    const isOutgoingAccepted = Boolean(candidate.isMatched);
    const hasLiveConvo = conversations?.some(
      (c) => (c.profileId === candidate.id || c.participants?.includes(candidate.id)) && !c.isHidden
    );
    return Boolean((isMutualAccepted || isOutgoingAccepted) && hasLiveConvo);
  }, [candidate, conversations, acceptedIncomingLikes]);

  const meetupStats = useMemo(
    () => (candidate ? getMeetupStats(candidate) : null),
    [candidate, getMeetupStats]
  );

  const allTags = useMemo(() => {
    if (!candidate) return [];
    return Array.from(new Set([
      ...safeStringList(candidate.tags),
      ...safeStringList(candidate.interests),
    ]));
  }, [candidate]);

  const activityDisplay = useMemo(() => {
    if (!candidate) return '';
    const activity = Array.isArray(candidate.activity)
      ? safeStringList(candidate.activity)
      : displayText(candidate.activity);
    const activityLabel = displayText(candidate.activityLabel);
    const activities = safeStringList(candidate.activities);
    return displayText(getActivityLabel(activity, activityLabel, activities));
  }, [candidate]);
  const displayName = candidate?.nickname || candidate?.name || 'ผู้ใช้ CampusMate';
  const safeDisplayName = displayText(displayName) || 'ผู้ใช้ CampusMate';
  const ageDisplay = displayText(candidate?.age);
  const genderDisplay = displayText(candidate?.gender);
  const facultyDisplay = displayText(candidate?.faculty);
  const yearDisplay = displayText(candidate?.year);
  const skillDisplay = displayText(candidate?.skill);
  const paceDisplay = displayText(candidate?.pace);
  const formattedSlots = formatAvailabilitySlots(candidate?.availabilitySlots);
  const availabilityDisplay = formattedSlots
    || (!hasCorruptMarker(candidate?.availability) ? displayText(candidate?.availability) : '');
  const distanceValue = candidate?.distance == null
    ? null
    : (typeof candidate.distance === 'number' ? candidate.distance : Number(candidate.distance));
  const safeDistance = Number.isFinite(distanceValue) ? distanceValue : null;
  const meetup = candidate?.meetup && typeof candidate.meetup === 'object' && !Array.isArray(candidate.meetup)
    ? candidate.meetup
    : null;
  const meetupSchedule = meetup?.schedule && typeof meetup.schedule === 'object' && !Array.isArray(meetup.schedule)
    ? meetup.schedule
    : null;
  const meetupName = displayText(meetup?.name) || 'จุดนัดหมาย';
  const meetupDate = displayText(meetupSchedule?.date);
  const meetupStartTime = displayText(meetupSchedule?.startTime);
  const meetupEndTime = displayText(meetupSchedule?.endTime);
  const meetupMaxPeople = displayText(meetupSchedule?.maxPeople);
  const meetupMessage = displayText(meetupSchedule?.message);
  const bioDisplay = displayText(candidate?.bio) || 'ยังไม่ได้เขียนคำแนะนำตัว';
  const compatibilityDisplay = candidate?.compatibility == null
    ? ''
    : displayText(candidate.compatibility);
  const avatarColor = typeof candidate?.avatarColor === 'string' && candidate.avatarColor.trim()
    ? candidate.avatarColor
    : (isDark ? colors.surfaceRaised : '#E9EDF4');
  const hasVisibleDetails = Boolean(
    ageDisplay
    || genderDisplay
    || facultyDisplay
    || yearDisplay
    || activityDisplay
    || skillDisplay
    || paceDisplay
    || availabilityDisplay
    || safeDistance != null
    || meetup
  );
  const remoteHeroImage = useRemoteImage(candidate?.avatarUri, candidate?.updatedAt, candidate?.id);

  const previousCandidateId = useRef(null);
  useEffect(() => {
    if (candidate?.id === previousCandidateId.current) return;
    previousCandidateId.current = candidate?.id || null;
    decisionStarted.current = false;
    translateX.stopAnimation();
    translateY.stopAnimation();
    cardScale.stopAnimation();
    cardOpacity.stopAnimation();
    translateX.setValue(0);
    translateY.setValue(0);
    cardScale.setValue(1);
    cardOpacity.setValue(1);
  }, [candidate?.id, cardOpacity, cardScale, translateX, translateY]);

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [onClose]);

  const handleDecision = useCallback(async (decision) => {
    if (!candidate || processing) return;

    const candidateId = candidate.id;
    const candidateName = candidate.name || 'เพื่อน';
    const isMatched = isCandidateMatched;

    setProcessing(true);
    setSessionExcludedIds((current) => [...current, candidateId]);
    decisionStarted.current = false;

    // Immediate optimistic notification so user never experiences lag
    if (decision === 'like') {
      if (isMatched) {
        onToast?.(`ส่งคำขอร่วมกิจกรรมถึง ${candidateName} แล้ว...`, 'info');
      } else {
        onToast?.(`ส่งถูกใจให้ ${candidateName} แล้ว`, 'info');
      }
    } else {
      onToast?.('ไม่เลือกโปรไฟล์นี้แล้ว', 'info');
    }

    try {
      if (decision === 'like') {
        if (isMatched) {
          const inviteResult = await sendActivityInvite(candidate);
          if (inviteResult?.matched && inviteResult?.conversationId) {
            onToast?.(`คุณและ ${candidateName} แมตช์กันแล้ว! 🎉 กำลังเปิดห้องแชต...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: inviteResult.conversationId } });
          }
        } else {
          const result = await matchProfile(candidate);
          if (result?.matched && result?.conversationId) {
            onToast?.(`คุณและ ${candidateName} แมตช์กันแล้ว! 🎉 กำลังเปิดห้องแชต...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: result.conversationId } });
          }
        }
      } else {
        await dismissProfile(candidate.id);
      }
    } catch (error) {
      setSessionExcludedIds((current) => current.filter((id) => id !== candidateId));
      onToast?.(`Error: ${error.message}`, 'info');
    } finally {
      setProcessing(false);
    }
  }, [candidate, dismissProfile, isCandidateMatched, matchProfile, onToast, processing, sendActivityInvite]);

  const finishSwipe = useCallback((decision) => {
    if (processing || decisionStarted.current || !candidate) return;
    decisionStarted.current = true;
    const isLike = decision === 'like';
    const flyOutX = isLike ? screenWidth * 1.35 : -screenWidth * 1.35;
    const startX = currentDxRef.current || (isLike ? 80 : -80);
    currentDxRef.current = 0;

    const flyX = new Animated.Value(startX);
    const flyOpacity = new Animated.Value(1);
    const outgoing = candidate;

    setExitingCard({
      candidate: outgoing,
      decision,
      flyX,
      flyOpacity,
      rotate: flyX.interpolate({
        inputRange: [-screenWidth, 0, screenWidth],
        outputRange: ['-10deg', '0deg', '10deg'],
        extrapolate: 'clamp',
      }),
    });

    // Reset top card animation values immediately for incoming candidate
    translateX.setValue(0);
    translateY.setValue(0);
    cardScale.setValue(1);
    cardOpacity.setValue(1);

    // Call decision immediately to advance candidate pool
    void handleDecision(decision);

    // Animate outgoing card smoothly offscreen
    Animated.parallel([
      Animated.timing(flyX, {
        duration: 250,
        toValue: flyOutX,
        useNativeDriver: true,
      }),
      Animated.timing(flyOpacity, {
        delay: 50,
        duration: 200,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setExitingCard(null);
    });
  }, [candidate, cardOpacity, cardScale, handleDecision, processing, translateX, translateY]);

  const resetSwipe = useCallback(() => {
    decisionStarted.current = false;
    currentDxRef.current = 0;
    Animated.parallel([
      Animated.spring(translateX, {
        friction: 7,
        tension: 70,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        friction: 7,
        tension: 70,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        friction: 7,
        tension: 70,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        duration: 120,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardOpacity, cardScale, translateX, translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      !decisionStarted.current
      && Math.abs(gestureState.dx) > 18
      && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) + 8
    ),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      !decisionStarted.current
      && Math.abs(gestureState.dx) > 18
      && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) + 8
    ),
    onPanResponderGrant: () => {
      decisionStarted.current = false;
      currentDxRef.current = 0;
      translateX.stopAnimation();
      translateY.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (!decisionStarted.current) {
        currentDxRef.current = gestureState.dx;
        translateX.setValue(gestureState.dx);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx > 100 || (gestureState.dx > 25 && gestureState.vx > 0.6)) {
        finishSwipe('like');
      } else if (gestureState.dx < -100 || (gestureState.dx < -25 && gestureState.vx < -0.6)) {
        finishSwipe('skip');
      } else {
        resetSwipe();
      }
    },
    onPanResponderTerminate: resetSwipe,
    onPanResponderTerminationRequest: () => false,
  }), [finishSwipe, resetSwipe, translateX, translateY]);

  const rotate = translateX.interpolate({
    inputRange: [-screenWidth, 0, screenWidth],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp',
  });
  const skipActionScale = translateX.interpolate({
    inputRange: [-120, 0, 120],
    outputRange: [1.3, 1, 0.9],
    extrapolate: 'clamp',
  });
  const skipActionBgOpacity = translateX.interpolate({
    inputRange: [-120, -20, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });
  const likeActionBgOpacity = translateX.interpolate({
    inputRange: [0, 20, 120],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const likeActionScale = translateX.interpolate({
    inputRange: [-120, 0, 120],
    outputRange: [0.94, 1, 1.12],
    extrapolate: 'clamp',
  });
  const skipBadgeOpacity = translateX.interpolate({
    inputRange: [-120, -20, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });
  const likeBadgeOpacity = translateX.interpolate({
    inputRange: [0, 20, 120],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const skipBorderOpacity = translateX.interpolate({
    inputRange: [-120, -30, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  });
  const likeBorderOpacity = translateX.interpolate({
    inputRange: [0, 30, 120],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });
  const nextCardScale = translateX.interpolate({
    inputRange: [-180, 0, 180],
    outputRange: [1, 0.94, 1],
    extrapolate: 'clamp',
  });
  const nextCardTranslateY = translateX.interpolate({
    inputRange: [-180, 0, 180],
    outputRange: [0, 14, 0],
    extrapolate: 'clamp',
  });
  const nextCardOpacity = translateX.interpolate({
    inputRange: [-160, -25, 0, 25, 160],
    outputRange: [1, 0.7, 0, 0.7, 1],
    extrapolate: 'clamp',
  });
  const nextCardRotate = translateX.interpolate({
    inputRange: [-180, -60, 0, 60, 180],
    outputRange: ['0deg', '4.5deg', '0deg', '-4.5deg', '0deg'],
    extrapolate: 'clamp',
  });
  const underCardBlurOpacity = translateX.interpolate({
    inputRange: [-160, -40, 0, 40, 160],
    outputRange: [0, 0.45, 1, 0.45, 0],
    extrapolate: 'clamp',
  });

  if (!candidate) {
    const waitingForProfile = profileLookupState === 'loading';
    const lookupFailed = profileLookupState === 'error';
    return (
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.container}>
        <View style={styles.emptyState}>
          <FeatureIcon
            color={waitingForProfile ? colors.primary : colors.inkMuted}
            name={waitingForProfile ? 'clock.arrow.2.circlepath' : 'person.crop.circle.badge.questionmark'}
            size={54}
          />
          <Text style={styles.emptyTitle}>
            {waitingForProfile ? 'กำลังโหลดโปรไฟล์…' : lookupFailed ? 'โหลดโปรไฟล์ไม่สำเร็จ' : 'ไม่พบโปรไฟล์นี้แล้ว'}
          </Text>
          <Text style={styles.emptyText}>
            {waitingForProfile ? 'กำลังดึงข้อมูลจากระบบ กรุณารอสักครู่' : lookupFailed ? 'ตรวจสอบการเชื่อมต่อแล้วลองเปิดโปรไฟล์อีกครั้ง' : 'โปรไฟล์อาจถูกซ่อนหรือลบไปแล้ว'}
          </Text>
          {!waitingForProfile ? (
            <Pressable onPress={close} style={styles.backButton}>
              <FeatureIcon color={colors.primary} name="chevron.left" size={18} />
              <Text style={styles.backButtonText}>กลับไปค้นหาเพื่อน</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['right', 'bottom', 'left']} style={styles.container}>
      <View style={[styles.fixedHeader, { height: 68 + insets.top, paddingTop: insets.top }]}>
        <BlurView intensity={isDark ? 34 : 48} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View
          pointerEvents="none"
          style={[styles.fixedHeaderSurface, { backgroundColor: isDark ? 'rgba(20,23,27,0.96)' : 'rgba(246,248,252,0.98)' }]}
        />
        <Pressable accessibilityLabel="ย้อนกลับ" onPress={close} style={styles.headerBackButton}>
          <FeatureIcon color={colors.ink} name="chevron.left" size={22} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>
            {isViewOnly ? `โปรไฟล์ ${safeDisplayName}` : 'ค้นหาเพื่อน'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {isViewOnly ? ((!hasCorruptMarker(facultyDisplay) && facultyDisplay) || activityDisplay || 'เพื่อนใน CampusMate') : 'ปัดเพื่อดูคนถัดไป'}
          </Text>
        </View>
      </View>

      <View collapsable={false} style={styles.cardDeckContainer}>
        {/* Next Card in the deck (pre-rendered and pre-loaded underneath) */}
        {!isViewOnly && nextCandidate ? (
          <Animated.View
            key={`next-${nextCandidate.id}`}
            collapsable={false}
            pointerEvents="none"
            style={[
              styles.stackedUnderCard,
              {
                opacity: nextCardOpacity,
                transform: [
                  { scale: nextCardScale },
                  { translateY: nextCardTranslateY },
                  { rotate: nextCardRotate },
                ],
              },
            ]}
          >
            <ProfileCardView
              candidate={nextCandidate}
              colors={colors}
              insets={insets}
              isDark={isDark}
              isUnderCard={true}
              isViewOnly={false}
              styles={styles}
              getMeetupStats={getMeetupStats}
              underCardBlurOpacity={underCardBlurOpacity}
            />
          </Animated.View>
        ) : null}

        {/* Top Active Card */}
        <Animated.View
          key={candidate.id}
          collapsable={false}
          {...(isViewOnly ? {} : panResponder.panHandlers)}
          style={[
            styles.animatedContent,
            {
              opacity: isViewOnly ? 1 : cardOpacity,
              transform: isViewOnly ? [] : [{ translateX }, { translateY }, { rotate }, { scale: cardScale }],
            },
          ]}
        >
          {!isViewOnly ? (
            <>
              <Animated.View pointerEvents="none" style={[styles.decisionBadge, styles.skipBadge, { opacity: skipBadgeOpacity }]}>
                <Text style={styles.skipBadgeText}>ไม่เลือก</Text>
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.decisionBadge, styles.likeBadge, { opacity: likeBadgeOpacity }]}>
                <Text style={styles.likeBadgeText}>{isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}</Text>
              </Animated.View>
            </>
          ) : null}
          <ProfileCardView
            candidate={candidate}
            colors={colors}
            insets={insets}
            isDark={isDark}
            isUnderCard={false}
            isViewOnly={isViewOnly}
            styles={styles}
            getMeetupStats={getMeetupStats}
            likeBorderOpacity={likeBorderOpacity}
            skipBorderOpacity={skipBorderOpacity}
            swipeCoral={swipeCoral}
          />
        </Animated.View>

        {/* Smooth Exiting Card Overlay (Guarantees zero flicker or jump during transition) */}
        {exitingCard ? (
          <Animated.View
            pointerEvents="none"
            collapsable={false}
            style={[
              styles.animatedContent,
              {
                opacity: exitingCard.flyOpacity,
                transform: [
                  { translateX: exitingCard.flyX },
                  { rotate: exitingCard.rotate },
                ],
                zIndex: 35,
              },
            ]}
          >
            <ProfileCardView
              candidate={exitingCard.candidate}
              colors={colors}
              insets={insets}
              isDark={isDark}
              isUnderCard={false}
              isViewOnly={true}
              styles={styles}
              getMeetupStats={getMeetupStats}
            />
          </Animated.View>
        ) : null}
      </View>

      {!isViewOnly ? (
        <>
          <View pointerEvents="box-none" style={styles.floatingActions}>
            <Animated.View style={[styles.actionGroup, { transform: [{ scale: skipActionScale }] }]}>
              <Pressable
                accessibilityLabel="ไม่เลือก"
                disabled={processing}
                onPress={() => finishSwipe('skip')}
                style={({ pressed }) => [styles.actionButton, styles.skipButton, pressed && styles.pressed, processing && styles.disabled]}
              >
                <Animated.View pointerEvents="none" style={[styles.actionButtonHighlight, { backgroundColor: swipeCoral, opacity: skipActionBgOpacity }]} />
                <View style={[styles.actionIcon, styles.skipIcon]}>
                  <FeatureIcon color={colors.inkMuted} name="xmark" size={25} />
                  <Animated.View pointerEvents="none" style={[styles.actionIconLayer, { opacity: skipActionBgOpacity }]}>
                    <FeatureIcon color="#FFFFFF" name="xmark" size={25} />
                  </Animated.View>
                </View>
              </Pressable>
              <Text style={styles.skipButtonText}>ไม่เลือก</Text>
            </Animated.View>
            <Animated.View style={[styles.actionGroup, { transform: [{ scale: likeActionScale }] }]}>
              <Pressable
                accessibilityLabel={isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}
                disabled={processing}
                onPress={() => finishSwipe('like')}
                style={({ pressed }) => [styles.actionButton, styles.likeButton, pressed && styles.pressed, processing && styles.disabled]}
              >
                <Animated.View pointerEvents="none" style={[styles.actionButtonHighlight, { backgroundColor: colors.primary, opacity: likeActionBgOpacity }]} />
                <View style={[styles.actionIcon, styles.likeIcon]}>
                  <FeatureIcon color={colors.primary} name={isCandidateMatched ? 'message.fill' : 'heart.fill'} size={23} />
                  <Animated.View pointerEvents="none" style={[styles.actionIconLayer, { opacity: likeActionBgOpacity }]}>
                    <FeatureIcon color="#FFFFFF" name={isCandidateMatched ? 'message.fill' : 'heart.fill'} size={23} />
                  </Animated.View>
                </View>
              </Pressable>
              <Text style={styles.likeButtonText}>{isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}</Text>
            </Animated.View>
          </View>
          <Text pointerEvents="none" style={styles.swipeHint}>
            {isCandidateMatched ? 'ปัดซ้ายเพื่อข้าม · ปัดขวาเพื่อไปห้องแชต' : 'ปัดซ้ายเพื่อไม่เลือก · ปัดขวาเพื่อถูกใจ'}
          </Text>
        </>
      ) : null}
    </SafeAreaView>
  );
}



const getStyles = (colors, isDark) => {
  const surfaceRaised = isDark ? colors.surfaceRaised : '#E9EDF4';
  const swipeCoral = isDark ? colors.coral : colors.danger;
  return StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  cardDeckContainer: { flex: 1, height: '100%', position: 'relative', width: '100%' },
  stackedUnderCard: { bottom: 0, height: '100%', left: 0, position: 'absolute', right: 0, top: 0, width: '100%' },
  animatedContent: { bottom: 0, height: '100%', left: 0, position: 'absolute', right: 0, top: 0, width: '100%' },
  decisionBadge: { borderRadius: radius.pill, borderWidth: 2, elevation: 6, paddingHorizontal: 16, paddingVertical: 9, position: 'absolute', top: 78, zIndex: 25 },
  swipeCard: { alignSelf: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 24, borderWidth: 1, elevation: 3, overflow: 'hidden', position: 'relative', shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, width: '100%' },
  cardSwipeGlow: { bottom: 0, borderRadius: 24, borderWidth: 3.5, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 15 },
  skipBadge: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: swipeCoral, left: 20, transform: [{ rotate: '-8deg' }] },
  likeBadge: { backgroundColor: colors.primary, borderColor: '#FFFFFF', right: 20, transform: [{ rotate: '8deg' }] },
  skipBadgeText: { color: swipeCoral, fontSize: type.body, fontWeight: '900' },
  likeBadgeText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '900' },
  fixedHeader: { alignItems: 'center', backgroundColor: colors.glass, borderBottomWidth: 0, flexDirection: 'row', height: 68, left: 0, paddingHorizontal: spacing.lg, position: 'absolute', right: 0, top: 0, zIndex: 20 },
  fixedHeaderSurface: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  headerBackButton: { alignItems: 'center', backgroundColor: colors.glass, borderColor: colors.glassBorder, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { marginLeft: spacing.md },
  headerTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  headerSubtitle: { color: colors.inkMuted, fontSize: type.micro, fontWeight: '600', marginTop: 2 },
  scrollContent: { paddingBottom: 132, paddingHorizontal: 10, paddingTop: 68 },
  hero: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: 420, overflow: 'hidden', position: 'relative', width: '100%' },
  heroImage: { borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '100%', width: '100%' },
  heroPlaceholder: { alignItems: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, justifyContent: 'center' },
  heroPlaceholderText: { color: colors.inkMuted, fontSize: type.body, fontWeight: '800', marginTop: spacing.sm },
  heroOverlay: { backgroundColor: 'rgba(0,0,0,0.12)', borderTopLeftRadius: 24, borderTopRightRadius: 24, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroBlur: { bottom: 0, height: 200, left: 0, position: 'absolute', right: 0 },
  heroBlurScrim: { backgroundColor: 'rgba(0,0,0,0.14)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroGradient: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  heroCopy: { bottom: 48, left: spacing.xl, position: 'absolute', right: spacing.xl },
  heroName: { color: colors.card, fontSize: 34, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.44)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 5 },
  heroActivity: { color: colors.card, fontSize: type.body, fontWeight: '700', marginTop: 5, textShadowColor: 'rgba(0,0,0,0.44)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  body: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -20, paddingBottom: 40, paddingHorizontal: 28, paddingTop: 28, width: '100%' },
  identityRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.md },
  identityCopy: { flex: 1, paddingRight: spacing.md },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 4 },
  compatibility: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.pill, minWidth: 72, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  compatibilityValue: { color: colors.primary, fontSize: 17, fontWeight: '900' },
  compatibilityLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '700', marginTop: 1 },
  infoRow: { alignItems: 'center', backgroundColor: surfaceRaised, borderRadius: 16, flexDirection: 'row', marginBottom: 9, padding: 12 },
  infoIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  infoCopy: { flex: 1, marginLeft: spacing.md },
  infoLabel: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '700' },
  infoValue: { color: colors.ink, fontSize: type.body, fontWeight: '800', marginTop: 2 },
  privacyNotice: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md },
  privacyNoticeText: { color: colors.inkMuted, flex: 1, fontSize: type.caption, lineHeight: 18 },
  meetupCard: { backgroundColor: surfaceRaised, borderRadius: 20, marginTop: spacing.md, padding: spacing.lg },
  meetupHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  meetupTitleRow: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.xs, minWidth: 0 },
  meetupSectionTitle: { color: colors.ink, flexShrink: 1, fontSize: type.body, fontWeight: '900' },
  meetupTag: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  meetupTagText: { color: colors.primary, fontSize: type.micro, fontWeight: '800' },
  meetupItems: { gap: spacing.sm },
  meetupItemRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  meetupMsgRow: { alignItems: 'flex-start', paddingTop: 2 },
  meetupName: { color: colors.ink, flex: 1, fontSize: type.body, fontWeight: '800', minWidth: 0 },
  meetupTime: { color: colors.inkMuted, flex: 1, fontSize: type.caption, fontWeight: '600', minWidth: 0 },
  meetupPeople: { color: colors.inkMuted, flex: 1, fontSize: type.caption, fontWeight: '600', minWidth: 0 },
  meetupMsg: { color: colors.ink, flex: 1, fontSize: type.body, lineHeight: 20 },
  bioSection: { backgroundColor: colors.primarySoft, borderRadius: 18, marginTop: spacing.md, padding: 15 },
  bioTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  bio: { color: colors.inkMuted, fontSize: type.body, lineHeight: 21, marginTop: spacing.sm },
  tagsTitle: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '800', marginTop: spacing.lg },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, paddingRight: spacing.md },
  tagChip: { backgroundColor: surfaceRaised, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tagChipText: { color: colors.ink, fontSize: type.caption, fontWeight: '700' },
  floatingActions: { alignItems: 'flex-start', bottom: 24, flexDirection: 'row', justifyContent: 'space-between', left: actionSideInset, position: 'absolute', right: actionSideInset, zIndex: 30 },
  swipeHint: { bottom: 6, color: colors.inkSoft, fontSize: type.micro, left: 0, position: 'absolute', right: 0, textAlign: 'center', zIndex: 29 },
  actionGroup: { alignItems: 'center', justifyContent: 'center', width: actionButtonWidth },
  actionButton: { alignItems: 'center', borderRadius: 32, flexDirection: 'column', height: 64, justifyContent: 'center', overflow: 'hidden', position: 'relative', shadowColor: '#000000', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.18, shadowRadius: 12, width: 64 },
  actionButtonHighlight: { borderRadius: 32, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  actionIcon: { alignItems: 'center', height: 42, justifyContent: 'center', position: 'relative', width: 42 },
  actionIconLayer: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  skipButton: { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 },
  skipIcon: { backgroundColor: 'transparent' },
  skipIconText: { color: colors.primary, fontSize: 31, fontWeight: '500', lineHeight: 34, marginTop: -2 },
  skipButtonText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '900', marginTop: 5, textAlign: 'center', width: actionButtonWidth },
  likeButton: { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 },
  likeIcon: { backgroundColor: 'transparent' },
  likeButtonText: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '900', marginTop: 5, textAlign: 'center', width: actionButtonWidth },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', marginTop: spacing.lg },
  emptyText: { color: colors.inkMuted, fontSize: type.body, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.lg, padding: spacing.md },
  backButtonText: { color: colors.primary, fontSize: type.body, fontWeight: '800', marginLeft: spacing.xs },
  });
};
