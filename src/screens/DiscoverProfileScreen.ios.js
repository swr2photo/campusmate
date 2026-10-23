import { Pressable } from '../components/NativePressable';
import { withTimeout } from '../utils/withTimeout';
import { noteProfileOpened, noteSwipeDismiss, rewindEligibleProfileId, subscribeRewindEligibility } from '../utils/rewindEligibility';
import { ProfileCardView, getStyles as getProfileCardStyles } from './DiscoverProfileScreen.js';
import ProfileSafetyActions from '../components/ProfileSafetyActions';
import ProfileMusicList from '../components/ProfileMusicList';
import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import RNText from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getImageRequestUri, useProfileImagePrefetch } from '../utils/useRemoteImage';
import { Dimensions, Linking, StyleSheet, View, useColorScheme, Image as RNImage, Platform, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { project } from '../utils/motion';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaskedView from '@react-native-masked-view/masked-view';
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
import { DisclosureGroup, HStack, Host, Image, ScrollView, Spacer, VStack, ZStack, RNHostView } from '@expo/ui/swift-ui';
import { accessibilityLabel, aspectRatio, background, buttonBorderShape, buttonStyle, clipShape, clipped, controlSize, disabled, foregroundStyle, frame, labelStyle, lineLimit, multilineTextAlignment, offset, padding, resizable, scrollIndicators, shadow, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppConversations, useAppFeed, useAppProfile } from '../context/AppContext';

import { formatAvailabilitySlots, formatDistance, formatReadableDate, genderLabel, getActivityLabel } from '../utils/formatters';
import { describeActivityDetails } from '../data/activityCategories';
import ProfilePhotoCarousel from '../components/ProfilePhotoCarousel';
import FeatureIcon from '../components/FeatureIcon';
import { getDiscoverySummary } from '../utils/discoveryPresentation';

const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const actionButtonWidth = 96;
const actionSideInset = 32;

function mergeCandidateProfiles(...lists) {
  const byId = new Map();
  lists.flat().forEach((item) => {
    if (!item?.id) return;
    byId.set(item.id, mergeProfileRecords(byId.get(item.id), item));
  });
  return Array.from(byId.values());
}

function usePalette() {
  const palette = useNativePalette();
  return { ...palette, purpleSoft: palette.primarySoft };
}

function useRewindEligibleId() {
  const [id, setId] = useState(rewindEligibleProfileId);
  useEffect(() => subscribeRewindEligibility(setId), []);
  return id;
}

export default function DiscoverProfileScreen({ isViewOnlyParam, profileId, onClose, onToast }) {
  const palette = usePalette();
  const profileCardStyles = getProfileCardStyles(palette, useColorScheme() === 'dark');
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [cardViewportHeight, setCardViewportHeight] = useState(windowHeight);
  const isTablet = (Platform.OS === 'ios' && Boolean(Platform.isPad)) || windowWidth >= 700;
  const contentHorizPadding = isTablet ? Math.max(0, Math.round((windowWidth - 680) / 2)) : 0;
  const {
    acceptedIncomingLikes,
    availableProfiles,
    hasMoreProfiles,
    isLoadingMoreProfiles,
    outgoingLikes,
    pendingIncomingLikes,
    canRewindSkippedProfiles,
    discoveryRecycledProfileIds,
  } = useAppFeed();
  const { conversations } = useAppConversations();
  const { profile: currentProfile } = useAppProfile();
  const { dismissProfile, loadMoreProfiles, matchProfile, recycleSkippedProfiles, ensureConversation } = useAppActions();
  const rewindingRef = useRef(false);
  const [processing, setProcessing] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [sessionExcludedIds, setSessionExcludedIds] = useState([]);
  useEffect(() => {
    if (!discoveryRecycledProfileIds?.length) return;
    setSessionExcludedIds(ids => ids.filter(id => !discoveryRecycledProfileIds.includes(id)));
  }, [discoveryRecycledProfileIds]);
  const [rawDirectProfile, setDirectProfile] = useState(null);

  const rewindEligibleId = useRewindEligibleId();
  const handleRewind = useCallback(async () => {
    if (rewindingRef.current) return;
    rewindingRef.current = true;
    try {
      const result = await recycleSkippedProfiles();
      if (!result?.profile && !result?.busy && !result?.plusRequired) {
        onToast?.('ไม่มีรายการที่ย้อนกลับได้ในขณะนี้', 'info');
      } else if (result?.profile) {
        setSessionExcludedIds((ids) => ids.filter((id) => id !== result.profile.id));
        onToast?.(`ย้อนกลับไปยังโปรไฟล์ของ ${result.profile.name || 'เพื่อน'} แล้ว`, 'success');
      }
    } catch (error) {
      if (error?.details?.reason === 'PLUS_REQUIRED') router.push('/membership');
      else onToast?.(error?.message || 'ย้อนกลับไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
    } finally {
      rewindingRef.current = false;
    }
  }, [onToast, recycleSkippedProfiles]);

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
  const swipeLock = useSharedValue(0);
  const decisionStarted = useRef(false);
  const decisionInFlight = useRef(false);
  const decisionCandidateId = useRef(null);
  const candidateCache = useRef(new Map());

  useEffect(() => {
    setDirectProfile(null);
    if (!profileId) {
      setDirectProfile(null);
      return;
    }
    if (secureDiscoveryConfigured()) return subscribeSecureProfile(profileId, setDirectProfile);
    let active = true;
    let serverReadComplete = false;
    try {
      const { db } = requireFirebase();
      const profileRef = doc(db, 'profiles', profileId);
      void getPublicProfile(profileId).then((freshProfile) => {
        if (!active) return;
        serverReadComplete = true;
        if (freshProfile) setDirectProfile(freshProfile);
      }).catch((error) => {
        if (active) console.warn('Fresh profile lookup error:', error);
      });
      const unsub = onSnapshot(profileRef, (snap) => {
        if (!active || (serverReadComplete && snap.metadata?.fromCache)) return;
        if (snap.exists()) {
          setDirectProfile(toSafePublicProfile(snap.id, snap.data()));
        } else {
          setDirectProfile(null);
        }
      }, (error) => {
        if (active) console.warn('Realtime profile lookup error:', error?.message || error);
      });
      return () => {
        active = false;
        unsub();
      };
    } catch (e) {
      console.warn('Realtime profile lookup error:', e);
    }
  }, [profileId]);

  const isViewOnly = Boolean(isViewOnlyParam);

  // Everyone this user already decided on: session swipes plus likes that
  // exist on the server. Feed snapshots hiding those people can lag the like
  // write, so without this a just-liked card can flash back in briefly.
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
    return mergeCandidateProfiles(availableProfiles || [], pendingIncomingLikes || []).filter((item) => {
      const isItemAdmin = (item?.email || '').toLowerCase().trim() === '6710210317@psu.ac.th'
        || item?.isAdmin === true || item?.role === 'admin';
      if (!isItemAdmin && item.isFaceVerified !== true) return false;
      const id = item?.id;
      if (!id || decidedIds.has(id) || seenIds.has(id) || !isProfileReadyForDiscovery(item, { publicProjection: secureDiscoveryConfigured() })) return false;
      seenIds.add(id);
      return true;
    });
  }, [availableProfiles, decidedIds, pendingIncomingLikes]);

  // Keep the last known pool so a short Firestore refresh cannot leave the
  // card blank while the decision request is still being completed. Mirror
  // the pool whenever it has content so people who left discovery are not
  // kept around only to reappear on the next swipe.
  useEffect(() => {
    if (isViewOnly || (!candidatePool.length && !secureDiscoveryConfigured())) return;
    candidateCache.current = new Map(candidatePool.map((item) => [item.id, item]));
  }, [candidatePool, isViewOnly]);

  const candidate = useMemo(() => {
    if (isViewOnly) {
      // Do not revive a hidden direct profile from an old chat snapshot.
      return directProfile;
    }

    // Keep the profile opened from Home as the first card when it is present.
    const isDecisionExcluded = (id) => (
      decidedIds.has(id)
      || (decisionInFlight.current && decisionCandidateId.current === id)
    );
    const restored = [...candidatePool]
      .filter((item) => Number.isFinite(item.rewindPriority) && !isDecisionExcluded(item.id))
      .sort((a, b) => b.rewindPriority - a.rewindPriority)[0];
    if (restored) return restored;
    const requestedProfile = profileId && candidatePool.find((item) => (
      item.id === profileId && !isDecisionExcluded(item.id)
    ));
    if (requestedProfile || (directProfile?.id === profileId && !isDecisionExcluded(profileId))) {
      return mergeCandidateProfiles(requestedProfile, directProfile?.id === profileId ? directProfile : null)[0] || null;
    }

    const nextProfile = candidatePool.find((item) => !isDecisionExcluded(item.id));
    if (nextProfile) return nextProfile;

    // The Firestore profile subscription can briefly be ahead of the profiles
    // list. Use the direct snapshot for the initial card instead of showing an
    // empty state during that short window. It is excluded after a decision.
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

  useEffect(() => {
    if (isViewOnly || candidate || !hasMoreProfiles || isLoadingMoreProfiles) return undefined;
    void loadMoreProfiles();
    return undefined;
  }, [candidate, hasMoreProfiles, isLoadingMoreProfiles, isViewOnly, loadMoreProfiles]);

  const candidateId = candidate?.id || null;
  useEffect(() => {
    if (!isViewOnly && candidateId) noteProfileOpened(candidateId);
  }, [candidateId, isViewOnly]);

  const isCandidateMatched = useMemo(() => {
    if (!candidate) return false;
    const isMutualAccepted = acceptedIncomingLikes?.some((like) => like.id === candidate.id);
    const isOutgoingAccepted = Boolean(candidate.isMatched);
    const hasLiveConvo = conversations?.some(
      (c) => (c.profileId === candidate.id || c.participants?.includes(candidate.id)) && !c.isHidden
    );
    return Boolean((isMutualAccepted || isOutgoingAccepted) && hasLiveConvo);
  }, [candidate, conversations, acceptedIncomingLikes]);

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [onClose]);

  const handleDecision = useCallback(async (decision) => {
    if (!candidate || processing || decisionInFlight.current) return;

    const candidateId = candidate.id;
    decisionInFlight.current = true;
    decisionCandidateId.current = candidateId;
    setProcessing(true);
    setSessionExcludedIds((current) => [...current, candidateId]);
    decisionStarted.current = false;
    translateX.set(0);
    translateY.set(0);
    cardScale.set(1);
    cardOpacity.set(1);
    try {
      if (decision === 'like') {
        if (isCandidateMatched) {
          const inviteResult = await withTimeout(() => ensureConversation(candidate));
          if (inviteResult) {
            onToast?.(`กำลังเปิดห้องแชตกับ ${candidate.name}...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: inviteResult } });
          } else {
            onToast?.(`ส่งถูกใจให้ ${candidate.name} แล้ว รออีกฝ่ายกดถูกใจกลับเพื่อเริ่มคุยกัน`, 'info');
          }
        } else {
          const result = await matchProfile(candidate);
          if (result.matched && result.conversationId) {
            onToast?.(`คุณและ ${candidate.name} แมตช์กันแล้ว! กำลังเปิดห้องแชต...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: result.conversationId } });
          } else {
            onToast?.(`ส่งถูกใจให้ ${candidate.name} แล้ว รออีกฝ่ายกดถูกใจกลับเพื่อเริ่มคุยกัน`, 'info');
          }
        }
      } else {
        noteSwipeDismiss(candidate.id);
        await dismissProfile(candidate.id);
      }
    } catch (error) {
      setSessionExcludedIds((current) => current.filter((id) => id !== candidateId));
      onToast?.(`Error: ${error.message}`, 'info');
    } finally {
      setProcessing(false);
      decisionInFlight.current = false;
      decisionCandidateId.current = null;
    }
  }, [candidate, cardOpacity, cardScale, dismissProfile, isCandidateMatched, matchProfile, onToast, processing, ensureConversation, translateX, translateY]);

  const finishSwipe = useCallback((decision) => {
    if (processing || decisionStarted.current || decisionInFlight.current) return;
    decisionStarted.current = true;
    swipeLock.set(1);
    const buttonCenterOffset = (windowWidth / 2) - actionSideInset - (actionButtonWidth / 2);
    const targetX = decision === 'like' ? buttonCenterOffset : -buttonCenterOffset;
    const targetY = (windowHeight / 2) - 58;
    const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

    translateX.set(withTiming(targetX, { duration: 280, easing: easeOut }));
    translateY.set(withTiming(targetY, { duration: 280, easing: easeOut }));
    cardScale.set(withTiming(0.08, { duration: 280, easing: easeOut }));
    cardOpacity.set(withDelay(110, withTiming(0, { duration: 170, easing: easeOut }, (finished) => {
      if (finished) scheduleOnRN(handleDecision, decision);
    })));
  }, [handleDecision, processing, swipeLock, translateX, translateY, cardScale, cardOpacity, windowWidth, windowHeight]);

  const resetSwipe = useCallback(() => {
    decisionStarted.current = false;
    swipeLock.set(0);
    translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    cardScale.set(withSpring(1, { duration: 400, dampingRatio: 1 }));
    cardOpacity.set(withTiming(1, { duration: 120, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [cardOpacity, cardScale, swipeLock, translateX, translateY]);

  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(!isViewOnly && !processing && !detailsExpanded)
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
    }), [cardOpacity, cardScale, finishSwipe, isViewOnly, processing, detailsExpanded, swipeLock, translateX, translateY]);

  const topCardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.get(),
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      {
        rotate: `${interpolate(translateX.get(), [-windowWidth, 0, windowWidth], [-8, 0, 8], Extrapolation.CLAMP)}deg`,
      },
      { scale: cardScale.get() },
    ],
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
  const likeWashStyle = useAnimatedStyle(() => {
    if (isViewOnly) return { opacity: 0 };
    return {
      opacity: interpolate(translateX.get(), [0, 16, 110], [0, 0.18, 0.5], Extrapolation.CLAMP),
    };
  });
  const skipWashStyle = useAnimatedStyle(() => {
    if (isViewOnly) return { opacity: 0 };
    return {
      opacity: interpolate(translateX.get(), [-110, -16, 0], [0.5, 0.18, 0], Extrapolation.CLAMP),
    };
  });

  const imageUri = getImageRequestUri(candidate?.avatarUri, candidate?.avatarRevision);
  useProfileImagePrefetch(isViewOnly ? [] : candidatePool.filter((item) => item.id !== candidateId && !decidedIds.has(item.id)));



  // A new candidate must always start from a fully visible, neutral card.
  // This also handles a short Firestore refresh where the old card is removed
  // before the next one arrives.
  const previousCandidateId = useRef(null);
  useEffect(() => {
    if (candidateId === previousCandidateId.current) return;
    previousCandidateId.current = candidateId;
    setDetailsExpanded(false);
    decisionStarted.current = false;
    swipeLock.set(0);
    translateX.set(0);
    translateY.set(0);
    cardScale.set(1);
    cardOpacity.set(1);
  }, [candidateId, cardOpacity, cardScale, swipeLock, translateX, translateY]);

  if (!candidate) {
    const waitingForNextProfile = processing || (!isViewOnly && (isLoadingMoreProfiles || hasMoreProfiles));
    // "Not found" is only meaningful for a profile opened directly that was
    // never decided on; an empty deck after swiping is the normal end state.
    const notFound = isViewOnly && Boolean(profileId) && !decidedIds.has(profileId);
    return (
      <View style={{ backgroundColor: palette.background, flex: 1 }}>
        <Host colorScheme={colorScheme} seedColor={palette.purple} style={{ flex: 1 }}>
          <VStack
            alignment="center"
            spacing={16}
            modifiers={[padding({ horizontal: 24 }), frame({ maxWidth: Infinity, maxHeight: Infinity })]}
          >
            <Image
              color={palette.secondary}
              size={54}
              systemName={waitingForNextProfile
                ? 'arrow.triangle.2.circlepath'
                : notFound
                  ? 'person.crop.circle.badge.questionmark'
                  : 'checkmark.seal.fill'}
            />
            <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(palette.text)]}>
              {waitingForNextProfile ? 'กำลังโหลดเพื่อนคนถัดไป...' : notFound && directProfileHidden ? 'โปรไฟล์นี้ยังไม่พร้อมให้ดู' : notFound ? 'ไม่พบโปรไฟล์นี้แล้ว' : 'ดูโปรไฟล์ครบแล้ว'}
            </Text>
            {!waitingForNextProfile ? (
              <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(palette.secondary), multilineTextAlignment('center')]}>
                {notFound && directProfileHidden ? 'โปรไฟล์จะแสดงหลังจากเจ้าของยืนยันตัวตนด้วยใบหน้าแล้ว' : notFound ? 'โปรไฟล์อาจถูกซ่อนหรือลบไปแล้ว' : 'ยังไม่มีคนใหม่ที่ตรงกับตัวกรองของคุณ ลองปรับตัวกรองหรือกลับมาดูใหม่ภายหลัง'}
              </Text>
            ) : null}
            {!isViewOnly && canRewindSkippedProfiles && !processing ? (
              <Button label="ย้อนกลับคนที่ข้าม" onPress={handleRewind} systemImage="arrow.counterclockwise" modifiers={[buttonStyle('glass'), buttonBorderShape('capsule'), controlSize('large'), tint(palette.purple)]} />
            ) : null}
              <Button
                label="กลับไปค้นหาเพื่อน"
                onPress={close}
                systemImage="chevron.left"
                modifiers={[buttonStyle('glassProminent'), buttonBorderShape('capsule'), controlSize('large'), tint(palette.purple)]}
              />
          </VStack>
        </Host>
      </View>
    );
  }

  const safeTop = Math.max(insets.top, 0);

  return (
    <View onLayout={(event) => { const height = Math.round(event.nativeEvent.layout.height); if (height > 0 && height !== cardViewportHeight) setCardViewportHeight(height); }} style={{ backgroundColor: palette.background, flex: 1 }}>
      <GestureDetector gesture={panGesture}>
      <Animated.View
        key={candidateId}
        style={[{ flex: 1 }, topCardStyle]}
      >
        <View style={{ flex: 1 }}>
          <ProfileCardView fullScreen candidate={candidate} cardHeight={cardViewportHeight} onDetailsExpandedChange={setDetailsExpanded} colors={palette} insets={insets} isDark={colorScheme === 'dark'} isViewOnly={isViewOnly} myProfile={currentProfile} myFavoriteTracks={Array.isArray(currentProfile?.favoriteTracks) ? currentProfile.favoriteTracks : []} styles={profileCardStyles} swipeX={translateX} />
        </View>
        {!isViewOnly ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                { backgroundColor: palette.purple, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
                likeWashStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                { backgroundColor: palette.coral, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
                skipWashStyle,
              ]}
            />
          </>
        ) : null}
      </Animated.View>
      </GestureDetector>

      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.64)', 'rgba(0,0,0,0.2)', 'transparent']} locations={[0, 0.6, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: safeTop + 140 }} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: safeTop + 12, left: insets.left + 16, right: insets.right + 16, height: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <FloatingProfileControl label="ย้อนกลับ" icon="chevron.left" onPress={close} palette={palette} colorScheme={colorScheme} />
        <View pointerEvents="none" style={{ flex: 1, minWidth: 0 }}><RNText numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700', textAlign: 'center' }}>{isViewOnly ? 'โปรไฟล์' : 'ค้นหาเพื่อน'}</RNText></View>
        {canRewindSkippedProfiles && !isViewOnly ? <FloatingProfileControl label="ย้อนกลับคนที่ข้าม" icon="arrow.counterclockwise" onPress={handleRewind} disabled={processing} palette={palette} colorScheme={colorScheme} /> : null}
        <ProfileSafetyActions key={candidate.id} profile={candidate} onBlocked={close} renderTrigger={({ label, disabled: busy, onPress }) => <FloatingProfileControl label={label} icon="ellipsis" onPress={onPress} disabled={busy} palette={palette} colorScheme={colorScheme} />} />
      </View>

      {!isViewOnly ? (
        <>
          <View pointerEvents="box-none" style={[decisionStyles.actions, { bottom: Math.max(insets.bottom, 12) + 16 }, isTablet && { justifyContent: 'center', gap: 54, left: 0, right: 0 }]}>
            <Animated.View style={skipActionScaleStyle}>
              <DecisionAction
                disabled={processing}
                label="ไม่เลือก"
                onPress={() => finishSwipe('skip')}
                palette={palette}
                colorScheme={colorScheme}
                type="skip"
                activeStyle={skipActionBgStyle}
                activeColor={palette.coral}
              />
            </Animated.View>
            <Animated.View style={likeActionScaleStyle}>
              <DecisionAction
                disabled={processing}
                label={isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}
                icon={isCandidateMatched ? 'bubble.left.fill' : 'heart.fill'}
                onPress={() => finishSwipe('like')}
                palette={palette}
                colorScheme={colorScheme}
                type="like"
                activeStyle={likeActionBgStyle}
                activeColor={palette.purple}
              />
            </Animated.View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function FloatingProfileControl({ label, icon, onPress, disabled: isDisabled = false, palette, colorScheme }) {
  return <Host colorScheme={colorScheme} style={{ width: 48, height: 48 }}><Button label={label} systemImage={icon} onPress={onPress} modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly'), frame({ width: 48, height: 48 }), foregroundStyle('#FFFFFF'), tint(palette.accentText), disabled(isDisabled)]} /></Host>;
}

function DecisionAction({ colorScheme, disabled: isDisabled, icon, label, onPress, palette, type, activeStyle, activeColor }) {
  const isLike = type === 'like';
  const systemImageName = icon || (isLike ? 'heart.fill' : 'xmark');
  return (
    <View style={decisionStyles.actionGroup}>
      <View style={[decisionStyles.nativeButtonHost, { position: 'relative' }]}>
        <Animated.View
          style={[{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: activeColor,
            borderRadius: 32,
          }, activeStyle]}
        />
        <Host colorScheme={colorScheme} seedColor={palette.purple} style={decisionStyles.nativeButtonHost}>
          <Button
            label={label}
            onPress={onPress}
            systemImage={systemImageName}
            modifiers={[
              buttonStyle('glass'),
              buttonBorderShape('circle'),
              controlSize('large'),
              labelStyle('iconOnly'),
              disabled(isDisabled),
              tint(isLike ? palette.purple : palette.secondary),
            ]}
          />
        </Host>
      </View>
      <RNText style={[decisionStyles.actionLabel, { color: palette.secondary }]}>{label}</RNText>
    </View>
  );
}

const decisionStyles = {
  actions: {
    alignItems: 'center',
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: actionSideInset,
    position: 'absolute',
    right: actionSideInset,
    zIndex: 30,
  },
  actionGroup: {
    alignItems: 'center',
    justifyContent: 'center',
    width: actionButtonWidth,
  },
  actionLabel: { fontSize: 13, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  nativeButtonHost: { height: 64, width: 64 },
  badge: {
    borderRadius: 24,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 9,
    position: 'absolute',
    top: 92,
    zIndex: 12,
  },
  badgeText: { fontSize: 16, fontWeight: '900' },
  hint: { bottom: 6, fontSize: 11, left: 0, position: 'absolute', right: 0, textAlign: 'center', zIndex: 29 },
  likeBadge: { borderColor: '#FFFFFF', right: 20, transform: [{ rotate: '8deg' }] },
  skipBadge: { backgroundColor: 'rgba(255,255,255,0.94)', borderColor: '#2869C7', left: 20, transform: [{ rotate: '-8deg' }] },
};
