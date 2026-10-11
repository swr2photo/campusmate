import Text from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Image from '../components/CachedImage';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import { secureDiscoveryConfigured, subscribeSecureProfile } from '../services/secureDiscoveryService';
import {
  getPublicProfile,
  isProfileReadyForDiscovery,
  mergeProfileRecords,
  normalizeProfileRecord,
  toSafePublicProfile,
} from '../services/firestoreService';
import { useAppActions, useAppConversations, useAppFeed, useAppProfile } from '../context/AppContext';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FeatureIcon from '../components/FeatureIcon';
import TrackPreviewButton from '../components/TrackPreviewButton';
import SpotifyTasteMatchCard from '../components/SpotifyTasteMatchCard';
import SpotifyTopArtistsView from '../components/SpotifyTopArtistsView';
import { calculateMusicTasteMatch, openInSpotify } from '../services/spotifyAuthService';
import { getImageRequestUri, useProfileImagePrefetch } from '../utils/useRemoteImage';
import { formatAvailabilitySlots, formatDistance, formatReadableDate, genderLabel, getActivityLabel } from '../utils/formatters';
import { describeActivityDetails } from '../data/activityCategories';
import { radius, spacing, type, useTheme } from '../theme';
import { project } from '../utils/motion';

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

function InfoList({ children, styles }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.infoList}>
      {items.map((child, index) => (
        <React.Fragment key={child.key || `info-${index}`}>
          {React.cloneElement(child, { isLast: index === items.length - 1 })}
        </React.Fragment>
      ))}
    </View>
  );
}

function InfoRow({ icon, label, value, colors, styles, isLast = false }) {
  const isMulti = typeof value === 'string' && value.includes('\n');
  return (
    <View style={[styles.infoRow, isLast && styles.infoRowLast, isMulti && { alignItems: 'flex-start' }]}>
      <View style={[styles.infoIcon, isMulti && { marginTop: 0 }]}>
        <FeatureIcon color={colors.primary} name={icon} size={18} />
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, isMulti && { lineHeight: 22 }]}>{value || 'ไม่ระบุ'}</Text>
      </View>
    </View>
  );
}

function openSpotifyUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return;
  Linking.openURL(url.trim()).catch(() => {});
}

export function ProfileCardView({
  candidate,
  colors,
  insets,
  isDark,
  isUnderCard = false,
  isViewOnly = false,
  myFavoriteTracks = [],
  myProfile = null,
  styles,
  swipeCoral = null,
  swipeX = null,
}) {
  const allTags = useMemo(() => {
    if (!candidate) return [];
    return Array.from(new Set([
      ...safeStringList(candidate.tags),
      ...safeStringList(candidate.interests),
    ]));
  }, [candidate]);

  const candidateTracks = useMemo(() => (
    Array.isArray(candidate?.favoriteTracks)
      ? candidate.favoriteTracks.filter((track) => track && typeof track === 'object' && track.id && track.name)
      : []
  ), [candidate]);

  const tasteMatch = useMemo(() => {
    if (!candidate || !myProfile) return null;
    return calculateMusicTasteMatch(myProfile, candidate);
  }, [candidate, myProfile]);

  const sharedTracks = useMemo(() => {
    if (!candidateTracks.length || !Array.isArray(myFavoriteTracks) || !myFavoriteTracks.length) return [];
    const myIds = new Set(myFavoriteTracks.map((track) => track?.id).filter(Boolean));
    return candidateTracks.filter((track) => myIds.has(track.id));
  }, [candidateTracks, myFavoriteTracks]);

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
  const activityDetailRows = useMemo(
    () => describeActivityDetails(candidate?.activityDetails, safeStringList(candidate?.activities)),
    [candidate]
  );
  // The running row already spells out the pace; only fall back to the
  // legacy column when there is no structured detail for it.
  const paceDisplay = activityDetailRows.some((row) => row.id === 'running') ? '' : displayText(candidate?.pace);
  const activityTags = useMemo(() => {
    const candidateToUse = typeof candidate !== 'undefined' ? candidate : null;
    if (!candidateToUse) return [];
    const tags = [];
    const act = Array.isArray(candidateToUse.activity)
      ? safeStringList(candidateToUse.activity)
      : displayText(candidateToUse.activity);
    const actLabel = displayText(candidateToUse.activityLabel);
    const acts = safeStringList(candidateToUse.activities);
    const mainLabels = getActivityLabel(act, actLabel, acts);

    if (mainLabels) {
      tags.push(...mainLabels.split(',').map(s => s.trim()).filter(Boolean));
    }

    if (typeof activityDetailRows !== 'undefined' && Array.isArray(activityDetailRows)) {
      activityDetailRows.forEach(row => {
        if (!tags.includes(row.label)) {
           tags.push(row.label);
        }
        if (Array.isArray(row.lines)) {
          row.lines.forEach(line => {
             if (!tags.includes(line)) tags.push(line);
          });
        }
      });
    }

    if (typeof skillDisplay !== 'undefined' && skillDisplay && !tags.includes(skillDisplay)) tags.push(`ระดับ: ${skillDisplay}`);
    if (typeof paceDisplay !== 'undefined' && paceDisplay && !tags.includes(paceDisplay)) tags.push(`เพซ: ${paceDisplay}`);

    return Array.from(new Set(tags));
  }, [candidate, typeof activityDetailRows !== 'undefined' ? activityDetailRows : [], typeof skillDisplay !== 'undefined' ? skillDisplay : '', typeof paceDisplay !== 'undefined' ? paceDisplay : '']);

  const formattedSlots = formatAvailabilitySlots(candidate?.availabilitySlots);
  const availabilityDisplay = formattedSlots
    || (!hasCorruptMarker(candidate?.availability) ? displayText(candidate?.availability) : '');
  const distanceValue = candidate?.distance == null
    ? null
    : (typeof candidate.distance === 'number' ? candidate.distance : Number(candidate.distance));
  const safeDistance = Number.isFinite(distanceValue) ? distanceValue : null;
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
    || activityTags.length
    || availabilityDisplay
    || safeDistance != null
  );
  const remoteHeroImage = getImageRequestUri(candidate?.avatarUri, candidate?.avatarRevision);
    const galleryImages = useMemo(() => {
      const candidateToUse = typeof candidate !== 'undefined' ? candidate : null;
      if (!candidateToUse || !Array.isArray(candidateToUse.gallery)) return [];
      return candidateToUse.gallery;
    }, [candidate]);

  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [candidate?.id]);

  // Animated.ScrollView keeps the card + white shell on the same native transform tree
  // (plain ScrollView + elevation can leave the white card upright while content tilts).
  const Container = isUnderCard ? View : Animated.ScrollView;
  const containerProps = isUnderCard
    ? {
        pointerEvents: 'none',
        style: [
          styles.scrollContent,
          { paddingTop: 68 + insets.top, width: '100%' },
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

  const likeGlowStyle = useAnimatedStyle(() => {
    if (!swipeX || isUnderCard || isViewOnly) return { opacity: 0 };
    return {
      opacity: interpolate(swipeX.get(), [0, 16, 110], [0, 0.18, 0.5], Extrapolation.CLAMP),
    };
  });
  const skipGlowStyle = useAnimatedStyle(() => {
    if (!swipeX || isUnderCard || isViewOnly) return { opacity: 0 };
    return {
      opacity: interpolate(swipeX.get(), [-110, -16, 0], [0.5, 0.18, 0], Extrapolation.CLAMP),
    };
  });
  const heroBlurStyle = useAnimatedStyle(() => {
    if (!swipeX || isUnderCard) return { opacity: 1 };
    return {
      opacity: interpolate(Math.abs(swipeX.get()), [0, 80], [1, 0], Extrapolation.CLAMP),
    };
  });
  const underScrimStyle = useAnimatedStyle(() => {
    if (!swipeX || !isUnderCard) return { opacity: 0 };
    return {
      opacity: interpolate(Math.abs(swipeX.get()), [0, 40, 160], [1, 0.45, 0], Extrapolation.CLAMP),
    };
  });

  return (
    <Container {...containerProps}>
      <Animated.View
        collapsable={false}
        needsOffscreenAlphaCompositing
        renderToHardwareTextureAndroid
        style={styles.swipeCard}
      >
        <View style={styles.hero}>
          {remoteHeroImage ? (
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              recyclingKey={candidate?.id}
              priority="high"
              source={{ uri: remoteHeroImage }}
              style={styles.heroImage}
              transition={0}
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
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, heroBlurStyle]}>
                <BlurView intensity={isDark ? 28 : 34} tint="dark" style={StyleSheet.absoluteFill} />
                <View pointerEvents="none" style={styles.heroBlurScrim} />
              </Animated.View>
            </MaskedView>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.16)', 'rgba(0,0,0,0.48)']}
            locations={[0, 0.46, 1]}
            pointerEvents="none"
            style={styles.heroGradient}
          />
          <View style={styles.heroCopy}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.heroName}>{safeDisplayName}{ageDisplay ? `, ${ageDisplay}` : ''}</Text>
              {candidate?.isFaceVerified === true ? (
                <View style={{ backgroundColor: 'rgba(35, 123, 231, 0.85)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <FeatureIcon color="#FFFFFF" name="checkmark.seal.fill" size={13} />
                  <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>ยืนยันใบหน้า</Text>
                </View>
              ) : null}
            </View>
            {activityDisplay ? <Text style={styles.heroActivity}>{activityDisplay}</Text> : null}
          </View>
        </View>

        <View style={styles.body}>
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

          <InfoList styles={styles}>
            {ageDisplay ? <InfoRow icon="calendar" label="อายุ" value={`${ageDisplay} ปี`} colors={colors} styles={styles} /> : null}
            {genderDisplay ? <InfoRow icon="person.2.fill" label="เพศ" value={genderLabel(genderDisplay)} colors={colors} styles={styles} /> : null}
            {(facultyDisplay && !hasCorruptMarker(facultyDisplay)) ? <InfoRow icon="building.columns.fill" label="คณะ" value={facultyDisplay} colors={colors} styles={styles} /> : null}
            {(yearDisplay && !hasCorruptMarker(yearDisplay)) ? <InfoRow icon="graduationcap.fill" label="ชั้นปี" value={yearDisplay} colors={colors} styles={styles} /> : null}
            {activityTags.length > 0 ? (
                <View style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
                    <FeatureIcon name="figure.run" size={16} color={colors.inkSoft || '#6B7078'} />
                    <Text style={{ color: colors.inkSoft || '#6B7078', fontSize: type.caption || 13, fontWeight: '800' }}>กิจกรรมที่ชอบ</Text>
                  </View>
                  <View style={styles.tagRow}>
                    {activityTags.map((tag, idx) => (
                      <View key={idx} style={styles.tagChip}>
                        <Text style={styles.tagChipText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            {availabilityDisplay ? (
              <InfoRow
                icon="clock.fill"
                label="วันและเวลาที่สะดวก"
                value={availabilityDisplay}
                colors={colors}
                styles={styles}
              />
            ) : null}
            {safeDistance != null ? <InfoRow icon="location.circle.fill" label="ระยะห่างจากคุณ" value={formatDistance(safeDistance)} colors={colors} styles={styles} /> : null}
          </InfoList>

          {!hasVisibleDetails ? (
            <View style={styles.privacyNotice}>
              <FeatureIcon color={colors.primary} name="eye.slash.fill" size={18} />
              <Text style={styles.privacyNoticeText}>ข้อมูลรายละเอียดอื่นถูกซ่อนไว้ตามการตั้งค่าความเป็นส่วนตัว</Text>
            </View>
          ) : null}



          <View style={styles.bioSection}>
            <View style={styles.bioTitleRow}>
              <FeatureIcon color={colors.primary} name="text.quote" size={17} />
              <Text style={styles.sectionTitle}>แนะนำตัว</Text>
            </View>
            <Text numberOfLines={5} style={styles.bio}>{bioDisplay}</Text>
          </View>

            {galleryImages.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm, paddingHorizontal: spacing.md }}>
                  <FeatureIcon name="photo.on.rectangle.angled" size={16} color={colors.inkSoft || '#6B7078'} />
                  <Text style={{ color: colors.inkSoft || '#6B7078', fontSize: type.caption || 13, fontWeight: '800' }}>แกลเลอรีรูปภาพ</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md, gap: 12 }}>
                  {galleryImages.map((uri, idx) => (
                    <Image
                      key={idx}
                      contentFit="cover"
                      source={{ uri }}
                      style={{ width: 120, height: 160, borderRadius: 12, backgroundColor: '#f0f0f0' }}
                      transition={0}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}


            {tasteMatch && (tasteMatch.hasMatch || candidateTracks.length > 0 || (Array.isArray(candidate?.spotifyTopArtists) && candidate.spotifyTopArtists.length > 0)) ? (
            <SpotifyTasteMatchCard
              matchResult={tasteMatch}
              peerName={safeDisplayName}
            />
          ) : null}

          {Array.isArray(candidate?.spotifyTopArtists) && candidate.spotifyTopArtists.length > 0 ? (
            <View style={{ marginVertical: 6 }}>
              <SpotifyTopArtistsView
                artists={candidate.spotifyTopArtists}
                title={`ศิลปินที่ ${safeDisplayName} ฟังบ่อย`}
              />
            </View>
          ) : null}

          {sharedTracks.length ? (
            <View style={styles.tracksSection}>
              <Text style={styles.tagsTitle}>เพลงที่ชอบเหมือนกัน</Text>
              <View style={styles.trackList}>
                {sharedTracks.map((track) => (
                  <Pressable
                    key={`shared-${track.id}`}
                    onPress={() => openInSpotify(track)}
                    style={({ pressed }) => [styles.trackRow, pressed && { opacity: 0.85 }]}
                  >
                    {track.albumArt ? (
                      <Image contentFit="cover" source={{ uri: track.albumArt }} style={styles.trackArt} />
                    ) : (
                      <View style={[styles.trackArt, styles.trackArtPlaceholder]}>
                        <FeatureIcon color={colors.primary} name="music.note" size={14} />
                      </View>
                    )}
                    <View style={styles.trackMeta}>
                      <Text numberOfLines={1} style={styles.trackName}>{track.name}</Text>
                      <Text numberOfLines={1} style={styles.trackArtists}>{track.artists || 'Unknown'}</Text>
                    </View>
                    <TrackPreviewButton
                      backgroundColor={colors.primarySoft}
                      color={colors.primary}
                      previewEndMs={track.previewEndMs}
                      previewStartMs={track.previewStartMs}
                      previewUrl={track.previewUrl}
                      size={32}
                      track={track}
                      trackArtists={track.artists}
                      trackName={track.name}
                      youtubeVideoId={track.youtubeVideoId}
                    />
                    <Pressable
                      accessibilityLabel={`เปิดใน Spotify ${track.name}`}
                      hitSlop={8}
                      onPress={() => openInSpotify(track)}
                      style={({ pressed }) => [{ marginHorizontal: 4 }, pressed && { opacity: 0.7 }]}
                    >
                      <FontAwesome5 name="spotify" size={18} color="#1DB954" />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {candidateTracks.length ? (
            <View style={styles.tracksSection}>
              <Text style={styles.tagsTitle}>เพลงโปรด</Text>
              <View style={styles.trackList}>
                {candidateTracks.map((track) => (
                  <Pressable
                    key={`fav-${track.id}`}
                    onPress={() => openInSpotify(track)}
                    style={({ pressed }) => [styles.trackRow, pressed && { opacity: 0.85 }]}
                  >
                    {track.albumArt ? (
                      <Image contentFit="cover" source={{ uri: track.albumArt }} style={styles.trackArt} />
                    ) : (
                      <View style={[styles.trackArt, styles.trackArtPlaceholder]}>
                        <FeatureIcon color={colors.primary} name="music.note" size={14} />
                      </View>
                    )}
                    <View style={styles.trackMeta}>
                      <Text numberOfLines={1} style={styles.trackName}>{track.name}</Text>
                      <Text numberOfLines={1} style={styles.trackArtists}>{track.artists || 'Unknown'}</Text>
                    </View>
                    <TrackPreviewButton
                      backgroundColor={colors.primarySoft}
                      color={colors.primary}
                      previewEndMs={track.previewEndMs}
                      previewStartMs={track.previewStartMs}
                      previewUrl={track.previewUrl}
                      size={32}
                      track={track}
                      trackArtists={track.artists}
                      trackName={track.name}
                      youtubeVideoId={track.youtubeVideoId}
                    />
                    <Pressable
                      accessibilityLabel={`เปิดใน Spotify ${track.name}`}
                      hitSlop={8}
                      onPress={() => openInSpotify(track)}
                      style={({ pressed }) => [{ marginHorizontal: 4 }, pressed && { opacity: 0.7 }]}
                    >
                      <FontAwesome5 name="spotify" size={18} color="#1DB954" />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {!isUnderCard && !isViewOnly ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.cardSwipeWash,
                { backgroundColor: colors.primary },
                likeGlowStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.cardSwipeWash,
                { backgroundColor: swipeCoral || colors.danger },
                skipGlowStyle,
              ]}
            />
          </>
        ) : null}

        {isUnderCard ? (
          <Animated.View
            pointerEvents="none"
            style={[
              { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
              {
                borderRadius: 24,
                overflow: 'hidden',
                zIndex: 20,
              },
              underScrimStyle,
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
      </Animated.View>
    </Container>
  );
}

export default function DiscoverProfileScreen({ isViewOnlyParam, profileId, onClose, onToast }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors, isDark);
  const swipeCoral = isDark ? colors.coral : colors.danger;
  const {
    acceptedIncomingLikes,
    availableProfiles,
    hasMoreProfiles,
    isLoadingMoreProfiles,
    outgoingLikes,
    pendingIncomingLikes,
  } = useAppFeed();
  const { conversations } = useAppConversations();
  const { profile: myProfile } = useAppProfile();
  const myFavoriteTracks = Array.isArray(myProfile?.favoriteTracks) ? myProfile.favoriteTracks : [];
  const { dismissProfile, loadMoreProfiles, matchProfile, sendActivityInvite } = useAppActions();
  const [processing, setProcessing] = useState(false);
  const [sessionExcludedIds, setSessionExcludedIds] = useState([]);
  const [rawDirectProfile, setDirectProfile] = useState(null);
  const [profileLookupState, setProfileLookupState] = useState(() => (profileId ? 'loading' : 'idle'));

  // Direct profile links follow the same verification requirement as discovery.
  const isDirectAdmin = (rawDirectProfile?.email || '').toLowerCase().trim() === '6710210317@psu.ac.th'
    || rawDirectProfile?.isAdmin === true || rawDirectProfile?.role === 'admin';
  const directProfileHidden = Boolean(rawDirectProfile)
    && !isDirectAdmin
    && rawDirectProfile.isFaceVerified !== true;
  const directProfile = directProfileHidden ? null : rawDirectProfile;
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const cardScale = useSharedValue(1);
  const cardOpacity = useSharedValue(1);
  const flyX = useSharedValue(0);
  const flyOpacity = useSharedValue(1);
  const swipeLock = useSharedValue(0);
  const decisionStarted = useRef(false);
  const candidateCache = useRef(new Map());
  const [exitingCard, setExitingCard] = useState(null);

  useEffect(() => {
    setDirectProfile(null);
    if (!profileId) {
      setDirectProfile(null);
      setProfileLookupState('idle');
      return;
    }
    if (secureDiscoveryConfigured()) {
      setProfileLookupState('loading');
      return subscribeSecureProfile(profileId, (fresh) => {
        setDirectProfile(fresh);
        setProfileLookupState(fresh ? 'ready' : 'not-found');
      }, () => setProfileLookupState('error'));
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

  // Everyone this user has already decided on: swipes made in this session
  // plus likes that already exist on the server (sent from here, from the
  // Likes tab, or accepted incoming likes). The feed snapshots that hide
  // those people can lag behind the like write by a moment, and without
  // this set a card that was just liked would flash back in.
  const decidedIds = useMemo(() => {
    const ids = new Set(sessionExcludedIds);
    (Array.isArray(outgoingLikes) ? outgoingLikes : []).forEach((like) => {
      if (like?.id && like.status !== 'rejected' && like.status !== 'removed') ids.add(like.id);
    });
    (Array.isArray(acceptedIncomingLikes) ? acceptedIncomingLikes : []).forEach((like) => {
      if (like?.id) ids.add(like.id);
    });
    return ids;
  }, [acceptedIncomingLikes, outgoingLikes, sessionExcludedIds]);

  const candidatePool = useMemo(() => {
    const seenIds = new Set();
    const availableList = Array.isArray(availableProfiles) ? availableProfiles : [];
    const pendingLikes = Array.isArray(pendingIncomingLikes) ? pendingIncomingLikes : [];
    return mergeCandidateProfiles(availableList, pendingLikes).filter((item) => {
      const isItemAdmin = (item?.email || '').toLowerCase().trim() === '6710210317@psu.ac.th'
        || item?.isAdmin === true || item?.role === 'admin';
      if (!isItemAdmin && item.isFaceVerified !== true) return false;
      const id = item?.id;
      if (!id || decidedIds.has(id) || seenIds.has(id) || !isProfileReadyForDiscovery(item)) return false;
      seenIds.add(id);
      return true;
    });
  }, [availableProfiles, decidedIds, pendingIncomingLikes]);

  // Keep the last known pool so a short Firestore refresh cannot leave the
  // card blank while the decision request is still being completed. The cache
  // mirrors the current pool whenever the pool has content, so someone who
  // dropped out of discovery (liked elsewhere, hidden, blocked) is not kept
  // around only to reappear during the next swipe.
  useEffect(() => {
    if (!candidatePool.length && !secureDiscoveryConfigured()) return;
    candidateCache.current = new Map(candidatePool.map((item) => [item.id, item]));
  }, [candidatePool]);

  const candidate = useMemo(() => {
    if (isViewOnly) {
      // Do not revive a hidden direct profile from an old chat snapshot.
      return directProfile;
    }

    const isDecisionExcluded = (id) => decidedIds.has(id);
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
  }, [candidatePool, conversations, decidedIds, directProfile, isViewOnly, processing, profileId]);

  const nextCandidate = useMemo(() => {
    if (isViewOnly || !candidate) return null;
    const isDecisionExcluded = (id) => decidedIds.has(id) || id === candidate.id;
    return candidatePool.find((item) => !isDecisionExcluded(item.id)) || null;
  }, [candidate, candidatePool, decidedIds, isViewOnly]);

  useProfileImagePrefetch(candidatePool.filter((item) => item.id !== candidate?.id && !decidedIds.has(item.id)));


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
  const activityDetailRows = useMemo(
    () => describeActivityDetails(candidate?.activityDetails, safeStringList(candidate?.activities)),
    [candidate]
  );
  // The running row already spells out the pace; only fall back to the
  // legacy column when there is no structured detail for it.
  const paceDisplay = activityDetailRows.some((row) => row.id === 'running') ? '' : displayText(candidate?.pace);
  const activityTags = useMemo(() => {
    const candidateToUse = typeof candidate !== 'undefined' ? candidate : null;
    if (!candidateToUse) return [];
    const tags = [];
    const act = Array.isArray(candidateToUse.activity)
      ? safeStringList(candidateToUse.activity)
      : displayText(candidateToUse.activity);
    const actLabel = displayText(candidateToUse.activityLabel);
    const acts = safeStringList(candidateToUse.activities);
    const mainLabels = getActivityLabel(act, actLabel, acts);

    if (mainLabels) {
      tags.push(...mainLabels.split(',').map(s => s.trim()).filter(Boolean));
    }

    if (typeof activityDetailRows !== 'undefined' && Array.isArray(activityDetailRows)) {
      activityDetailRows.forEach(row => {
        if (!tags.includes(row.label)) {
           tags.push(row.label);
        }
        if (Array.isArray(row.lines)) {
          row.lines.forEach(line => {
             if (!tags.includes(line)) tags.push(line);
          });
        }
      });
    }

    if (typeof skillDisplay !== 'undefined' && skillDisplay && !tags.includes(skillDisplay)) tags.push(`ระดับ: ${skillDisplay}`);
    if (typeof paceDisplay !== 'undefined' && paceDisplay && !tags.includes(paceDisplay)) tags.push(`เพซ: ${paceDisplay}`);

    return Array.from(new Set(tags));
  }, [candidate, typeof activityDetailRows !== 'undefined' ? activityDetailRows : [], typeof skillDisplay !== 'undefined' ? skillDisplay : '', typeof paceDisplay !== 'undefined' ? paceDisplay : '']);

  const formattedSlots = formatAvailabilitySlots(candidate?.availabilitySlots);
  const availabilityDisplay = formattedSlots
    || (!hasCorruptMarker(candidate?.availability) ? displayText(candidate?.availability) : '');
  const distanceValue = candidate?.distance == null
    ? null
    : (typeof candidate.distance === 'number' ? candidate.distance : Number(candidate.distance));
  const safeDistance = Number.isFinite(distanceValue) ? distanceValue : null;
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
    || activityTags.length
    || availabilityDisplay
    || safeDistance != null
  );
  const remoteHeroImage = getImageRequestUri(candidate?.avatarUri, candidate?.avatarRevision);

  const previousCandidateId = useRef(null);
  useEffect(() => {
    if (candidate?.id === previousCandidateId.current) return;
    previousCandidateId.current = candidate?.id || null;
    decisionStarted.current = false;
    swipeLock.set(0);
    translateX.set(0);
    translateY.set(0);
    cardScale.set(1);
    cardOpacity.set(1);
  }, [candidate?.id, cardOpacity, cardScale, swipeLock, translateX, translateY]);

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

  const clearExitingCard = useCallback(() => {
    setExitingCard(null);
  }, []);

  const finishSwipe = useCallback((decision) => {
    if (processing || decisionStarted.current || !candidate) return;
    decisionStarted.current = true;
    swipeLock.set(1);
    const isLike = decision === 'like';
    const flyOutX = isLike ? screenWidth * 1.35 : -screenWidth * 1.35;
    const startX = translateX.get() || (isLike ? 80 : -80);
    const outgoing = candidate;

    flyX.set(startX);
    flyOpacity.set(1);
    setExitingCard({ candidate: outgoing, decision });

    translateX.set(0);
    translateY.set(0);
    cardScale.set(1);
    cardOpacity.set(1);

    void handleDecision(decision);

    flyX.set(withTiming(flyOutX, { duration: 250, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    flyOpacity.set(withTiming(0, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) }, (finished) => {
      if (finished) scheduleOnRN(clearExitingCard);
    }));
  }, [candidate, cardOpacity, cardScale, clearExitingCard, flyOpacity, flyX, handleDecision, processing, swipeLock, translateX, translateY]);

  const resetSwipe = useCallback(() => {
    decisionStarted.current = false;
    swipeLock.set(0);
    translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    cardScale.set(withSpring(1, { duration: 400, dampingRatio: 1 }));
    cardOpacity.set(withTiming(1, { duration: 120, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [cardOpacity, cardScale, swipeLock, translateX, translateY]);

  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(!isViewOnly)
    .activeOffsetX([-18, 18])
    .failOffsetY([-24, 24])
    .onUpdate((event) => {
      if (swipeLock.get()) return;
      translateX.set(event.translationX);
    })
    .onEnd((event) => {
      if (swipeLock.get()) return;
      const projected = translateX.get() + project(event.velocityX);
      if (projected > 100 || (event.translationX > 25 && event.velocityX > 600)) {
        scheduleOnRN(finishSwipe, 'like');
      } else if (projected < -100 || (event.translationX < -25 && event.velocityX < -600)) {
        scheduleOnRN(finishSwipe, 'skip');
      } else {
        translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: event.velocityX }));
        translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: event.velocityY }));
        cardScale.set(withSpring(1, { duration: 400, dampingRatio: 1 }));
        cardOpacity.set(withTiming(1, { duration: 120, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    }), [cardOpacity, cardScale, finishSwipe, isViewOnly, swipeLock, translateX, translateY]);

  const topCardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.get(),
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      {
        rotate: `${interpolate(translateX.get(), [-screenWidth, 0, screenWidth], [-10, 0, 10], Extrapolation.CLAMP)}deg`,
      },
      { scale: cardScale.get() },
    ],
  }));
  const nextCardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [-160, -25, 0, 25, 160], [1, 0.7, 0, 0.7, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(translateX.get(), [-180, 0, 180], [1, 0.94, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(translateX.get(), [-180, 0, 180], [0, 14, 0], Extrapolation.CLAMP) },
      {
        rotate: `${interpolate(translateX.get(), [-180, -60, 0, 60, 180], [0, 4.5, 0, -4.5, 0], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));
  const skipBadgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [-120, -20, 0], [1, 0, 0], Extrapolation.CLAMP),
  }));
  const likeBadgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [0, 20, 120], [0, 0, 1], Extrapolation.CLAMP),
  }));
  const skipActionScaleStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(translateX.get(), [-120, 0, 120], [1.45, 1, 0.88], Extrapolation.CLAMP),
      },
      {
        translateX: interpolate(translateX.get(), [-120, 0, 120], [-22, 0, 6], Extrapolation.CLAMP),
      },
    ],
  }));
  const likeActionScaleStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(translateX.get(), [-120, 0, 120], [0.88, 1, 1.45], Extrapolation.CLAMP),
      },
      {
        translateX: interpolate(translateX.get(), [-120, 0, 120], [-6, 0, 22], Extrapolation.CLAMP),
      },
    ],
  }));
  const skipActionBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [-120, -20, 0], [1, 0, 0], Extrapolation.CLAMP),
  }));
  const likeActionBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [0, 20, 120], [0, 0, 1], Extrapolation.CLAMP),
  }));
  const exitingCardStyle = useAnimatedStyle(() => ({
    opacity: flyOpacity.get(),
    transform: [
      { translateX: flyX.get() },
      {
        rotate: `${interpolate(flyX.get(), [-screenWidth, 0, screenWidth], [-10, 0, 10], Extrapolation.CLAMP)}deg`,
      },
    ],
    zIndex: 35,
  }));

  if (!candidate) {
    // The "not found" copy only applies to a profile that was opened directly
    // and could not be loaded. Once the user has swiped through the deck, an
    // empty deck is the normal end state, not a missing profile.
    const requestedProfileDecided = Boolean(profileId) && decidedIds.has(profileId);
    const lookingUpRequested = Boolean(profileId) && !requestedProfileDecided;
    const waitingForProfile = (lookingUpRequested && profileLookupState === 'loading')
      || (!lookingUpRequested && !isViewOnly && (isLoadingMoreProfiles || hasMoreProfiles));
    const lookupFailed = lookingUpRequested && profileLookupState === 'error';
    const notFound = lookingUpRequested && !waitingForProfile && !lookupFailed;
    const unavailable = notFound && directProfileHidden;
    const title = waitingForProfile
      ? 'กำลังโหลดโปรไฟล์…'
      : lookupFailed
        ? 'โหลดโปรไฟล์ไม่สำเร็จ'
        : unavailable
          ? 'โปรไฟล์นี้ยังไม่พร้อมให้ดู'
          : notFound
            ? 'ไม่พบโปรไฟล์นี้แล้ว'
            : 'ดูโปรไฟล์ครบแล้ว';
    const body = waitingForProfile
      ? 'กำลังดึงข้อมูลจากระบบ กรุณารอสักครู่'
      : lookupFailed
        ? 'ตรวจสอบการเชื่อมต่อแล้วลองเปิดโปรไฟล์อีกครั้ง'
        : unavailable
          ? 'โปรไฟล์จะแสดงหลังจากเจ้าของยืนยันตัวตนด้วยใบหน้าแล้ว'
          : notFound
          ? 'โปรไฟล์อาจถูกซ่อนหรือลบไปแล้ว'
          : 'ยังไม่มีคนใหม่ที่ตรงกับตัวกรองของคุณ ลองปรับตัวกรองหรือกลับมาดูใหม่ภายหลัง';
    return (
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.container}>
        <View style={styles.emptyState}>
          <FeatureIcon
            color={waitingForProfile ? colors.primary : colors.inkMuted}
            name={waitingForProfile
              ? 'clock.arrow.2.circlepath'
              : notFound || lookupFailed
                ? 'person.crop.circle.badge.questionmark'
                : 'checkmark.seal.fill'}
            size={54}
          />
          <Text style={styles.emptyTitle}>{title}</Text>
          <Text style={styles.emptyText}>{body}</Text>
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
        {!isViewOnly && nextCandidate ? (
          <Animated.View
            key={`next-${nextCandidate.id}`}
            collapsable={false}
            pointerEvents="none"
            style={[styles.stackedUnderCard, nextCardStyle]}
          >
            <ProfileCardView
              candidate={nextCandidate}
              colors={colors}
              insets={insets}
              isDark={isDark}
              isUnderCard={true}
              isViewOnly={false}
              myFavoriteTracks={myFavoriteTracks}
              myProfile={myProfile}
              styles={styles}
              swipeX={translateX}
            />
          </Animated.View>
        ) : null}

        <GestureDetector gesture={panGesture}>
          <Animated.View
            key={candidate.id}
            collapsable={false}
            style={[styles.animatedContent, topCardStyle]}
          >
            {!isViewOnly ? (
              <>
                <Animated.View pointerEvents="none" style={[styles.decisionBadge, styles.skipBadge, skipBadgeStyle]}>
                  <Text style={styles.skipBadgeText}>ไม่เลือก</Text>
                </Animated.View>
                <Animated.View pointerEvents="none" style={[styles.decisionBadge, styles.likeBadge, likeBadgeStyle]}>
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
              myFavoriteTracks={myFavoriteTracks}
              myProfile={myProfile}
              styles={styles}
              swipeCoral={swipeCoral}
              swipeX={translateX}
            />
          </Animated.View>
        </GestureDetector>

        {exitingCard ? (
          <Animated.View
            pointerEvents="none"
            collapsable={false}
            style={[styles.animatedContent, exitingCardStyle]}
          >
            <ProfileCardView
              candidate={exitingCard.candidate}
              colors={colors}
              insets={insets}
              isDark={isDark}
              isUnderCard={false}
              isViewOnly={true}
              myFavoriteTracks={myFavoriteTracks}
              myProfile={myProfile}
              styles={styles}
            />
          </Animated.View>
        ) : null}
      </View>

      {!isViewOnly ? (
        <>
          <View pointerEvents="box-none" style={[styles.floatingActions, { bottom: 18 + insets.bottom }]}>
            <Animated.View style={[styles.actionGroup, skipActionScaleStyle]}>
              <Pressable
                accessibilityLabel="ไม่เลือก"
                disabled={processing}
                onPress={() => finishSwipe('skip')}
                style={({ pressed }) => [styles.actionButton, styles.skipButton, pressed && styles.pressed, processing && styles.disabled]}
              >
                <Animated.View pointerEvents="none" style={[styles.actionButtonHighlight, { backgroundColor: swipeCoral }, skipActionBgStyle]} />
                <View style={[styles.actionIcon, styles.skipIcon]}>
                  <FeatureIcon color={swipeCoral} name="xmark" size={25} />
                  <Animated.View pointerEvents="none" style={[styles.actionIconLayer, skipActionBgStyle]}>
                    <FeatureIcon color="#FFFFFF" name="xmark" size={25} />
                  </Animated.View>
                </View>
              </Pressable>
              <Text style={styles.skipButtonText}>ไม่เลือก</Text>
            </Animated.View>
            <Animated.View style={[styles.actionGroup, likeActionScaleStyle]}>
              <Pressable
                accessibilityLabel={isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}
                disabled={processing}
                onPress={() => finishSwipe('like')}
                style={({ pressed }) => [styles.actionButton, styles.likeButton, pressed && styles.pressed, processing && styles.disabled]}
              >
                <Animated.View pointerEvents="none" style={[styles.actionButtonHighlight, { backgroundColor: colors.primary }, likeActionBgStyle]} />
                <View style={[styles.actionIcon, styles.likeIcon]}>
                  <FeatureIcon color={colors.primary} name={isCandidateMatched ? 'message.fill' : 'heart.fill'} size={23} />
                  <Animated.View pointerEvents="none" style={[styles.actionIconLayer, likeActionBgStyle]}>
                    <FeatureIcon color="#FFFFFF" name={isCandidateMatched ? 'message.fill' : 'heart.fill'} size={23} />
                  </Animated.View>
                </View>
              </Pressable>
              <Text style={styles.likeButtonText}>{isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}</Text>
            </Animated.View>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}



export const getStyles = (colors, isDark) => {
  const surfaceRaised = isDark ? colors.surfaceRaised : '#E9EDF4';
  const swipeCoral = isDark ? colors.coral : colors.danger;
  return StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  cardDeckContainer: { flex: 1, height: '100%', position: 'relative', width: '100%' },
  stackedUnderCard: { bottom: 0, height: '100%', left: 0, position: 'absolute', right: 0, top: 0, width: '100%' },
  animatedContent: { bottom: 0, elevation: 4, height: '100%', left: 0, position: 'absolute', right: 0, top: 0, width: '100%' },
  decisionBadge: { borderRadius: radius.pill, borderWidth: 2, elevation: 6, paddingHorizontal: 16, paddingVertical: 9, position: 'absolute', top: 78, zIndex: 25 },
  swipeCard: { alignSelf: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: 24, borderWidth: 1, overflow: 'hidden', position: 'relative', shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, width: '100%' },
  cardSwipeWash: { borderRadius: 24, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 15 },
  skipBadge: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: swipeCoral, left: 20, transform: [{ rotate: '-8deg' }] },
  likeBadge: { backgroundColor: colors.primary, borderColor: '#FFFFFF', right: 20, transform: [{ rotate: '8deg' }] },
  skipBadgeText: { color: swipeCoral, fontSize: type.body, fontWeight: '900' },
  likeBadgeText: { color: '#FFFFFF', fontSize: type.body, fontWeight: '900' },
  fixedHeader: { alignItems: 'center', backgroundColor: colors.glass, borderBottomWidth: 0, flexDirection: 'row', height: 68, left: 0, paddingHorizontal: spacing.lg, position: 'absolute', right: 0, top: 0, zIndex: 20 },
  fixedHeaderSurface: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  headerBackButton: { alignItems: 'center', backgroundColor: colors.glass, borderColor: colors.glassBorder, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { marginLeft: spacing.md },
  headerTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  headerSubtitle: { color: colors.inkMuted, fontSize: type.micro, fontWeight: '600', marginTop: 0 },
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
  heroName: { color: colors.onPrimary, fontSize: 28, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.44)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 5 },
  heroActivity: { color: colors.onPrimary, fontSize: type.body, fontWeight: '700', marginTop: 5, textShadowColor: 'rgba(0,0,0,0.44)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  body: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -20, paddingBottom: 40, paddingHorizontal: 28, paddingTop: 28, width: '100%' },
  identityRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.md },
  identityCopy: { flex: 1, paddingRight: spacing.md },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 4 },
  compatibility: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.pill, minWidth: 72, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  compatibilityValue: { color: colors.primary, fontSize: 17, fontWeight: '900' },
  compatibilityLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '700', marginTop: 1 },
  infoList: { marginBottom: spacing.xs },
  infoRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: 8 },
  infoRowLast: { borderBottomWidth: 0 },
  infoIcon: { alignItems: 'center', height: 22, justifyContent: 'center', width: 22 },
  infoCopy: { flex: 1, marginLeft: spacing.md },
  infoLabel: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '700' },
  infoValue: { color: colors.ink, fontSize: type.body, fontWeight: '800', marginTop: 0 },
  privacyNotice: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md },
  privacyNoticeText: { color: colors.inkMuted, flex: 1, fontSize: type.caption, lineHeight: 18 },
  bioSection: { backgroundColor: colors.primarySoft, borderRadius: 18, marginTop: spacing.md, padding: 15 },
  bioTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  bio: { color: colors.inkMuted, fontSize: type.body, lineHeight: 21, marginTop: spacing.sm },
  tagsTitle: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '800', marginTop: spacing.lg },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, paddingRight: spacing.md },
  tagChip: { backgroundColor: surfaceRaised, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tagChipText: { color: colors.ink, fontSize: type.caption, fontWeight: '700' },
  tracksSection: { marginTop: spacing.xs },
  trackList: { gap: spacing.sm, marginTop: spacing.sm },
  trackRow: { alignItems: 'center', backgroundColor: surfaceRaised, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  trackArt: { borderRadius: 8, height: 40, width: 40 },
  trackArtPlaceholder: { alignItems: 'center', backgroundColor: colors.primarySoft, justifyContent: 'center' },
  trackMeta: { flex: 1, minWidth: 0 },
  trackName: { color: colors.ink, fontSize: type.caption, fontWeight: '800' },
  trackArtists: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '600', marginTop: 1 },
  floatingActions: { alignItems: 'flex-start', bottom: 18, flexDirection: 'row', justifyContent: 'center', gap: 32, left: 0, position: 'absolute', right: 0, zIndex: 30 },
  actionGroup: { alignItems: 'center', justifyContent: 'center', width: actionButtonWidth },
  // Solid, tinted buttons so they read as controls over the white card body
  // instead of blending into it.
  actionButton: { alignItems: 'center', borderRadius: 32, borderWidth: 0, elevation: 8, flexDirection: 'column', height: 64, justifyContent: 'center', overflow: 'hidden', position: 'relative', shadowColor: '#0F1B33', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 14, width: 64 },
  actionButtonHighlight: { borderRadius: 32, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  actionIcon: { alignItems: 'center', height: 42, justifyContent: 'center', position: 'relative', width: 42 },
  actionIconLayer: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  skipButton: { backgroundColor: isDark ? colors.surfaceRaised : colors.card },
  skipIcon: { backgroundColor: 'transparent' },
  skipIconText: { color: colors.primary, fontSize: 28, fontWeight: '500', lineHeight: 34, marginTop: -2 },
  skipButtonText: { color: swipeCoral, fontSize: type.caption, fontWeight: '900', marginTop: 6, textAlign: 'center', width: actionButtonWidth },
  likeButton: { backgroundColor: isDark ? colors.surfaceRaised : colors.card },
  likeIcon: { backgroundColor: 'transparent' },
  likeButtonText: { color: colors.primary, fontSize: type.caption, fontWeight: '900', marginTop: 6, textAlign: 'center', width: actionButtonWidth },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', marginTop: spacing.lg },
  emptyText: { color: colors.inkMuted, fontSize: type.body, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.lg, padding: spacing.md },
  backButtonText: { color: colors.primary, fontSize: type.body, fontWeight: '800', marginLeft: spacing.xs },
  });
};
