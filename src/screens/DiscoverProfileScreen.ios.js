import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import RNText from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getImageRequestUri, useProfileImagePrefetch } from '../utils/useRemoteImage';
import ExpoImage from '../components/CachedImage';
import { Dimensions, Linking, Pressable, StyleSheet, View, useColorScheme, Image as RNImage } from 'react-native';
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
import { HStack, Host, Image, ScrollView, Spacer, VStack, ZStack, RNHostView } from '@expo/ui/swift-ui';
import { accessibilityLabel, aspectRatio, background, buttonBorderShape, buttonStyle, clipShape, clipped, controlSize, disabled, foregroundStyle, frame, labelStyle, lineLimit, multilineTextAlignment, offset, padding, resizable, scrollIndicators, shadow, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppConversations, useAppFeed, useAppProfile } from '../context/AppContext';

import { formatAvailabilitySlots, formatDistance, formatReadableDate, genderLabel, getActivityLabel } from '../utils/formatters';
import { describeActivityDetails } from '../data/activityCategories';
import TrackPreviewButton from '../components/TrackPreviewButton';

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

const darkPalette = {
  background: '#14171B',
  surface: '#20242A',
  surfaceRaised: '#292E35',
  text: '#F7F8FA',
  secondary: '#B6BDC8',
  tertiary: '#7F8896',
  purple: '#88B5F2',
  purpleSoft: 'rgba(112,178,255,0.18)',
  coral: '#FF7A6B',
  white: '#FFFFFF',
};

const lightPalette = {
  background: '#F7F7F8',
  surface: '#FFFFFF',
  surfaceRaised: '#E9EDF4',
  text: '#25272B',
  secondary: '#6B7078',
  tertiary: '#8B98AC',
  purple: '#2869C7',
  purpleSoft: '#EEF2F7',
  coral: '#D65454',
  white: '#FFFFFF',
};

function usePalette() {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

export default function DiscoverProfileScreen({ isViewOnlyParam, profileId, onClose, onToast }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const {
    acceptedIncomingLikes,
    availableProfiles,
    hasMoreProfiles,
    isLoadingMoreProfiles,
    outgoingLikes,
    pendingIncomingLikes,
  } = useAppFeed();
  const { conversations } = useAppConversations();
  const { profile: currentProfile } = useAppProfile();
  const { dismissProfile, loadMoreProfiles, matchProfile, sendActivityInvite } = useAppActions();
  const [processing, setProcessing] = useState(false);
  const [sessionExcludedIds, setSessionExcludedIds] = useState([]);
  const [rawDirectProfile, setDirectProfile] = useState(null);

  // Direct profile links follow the same verification requirement as discovery.
  // Existing chat messages and participant snapshots remain available separately.
  const directProfileHidden = Boolean(rawDirectProfile)
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
      if (item.isFaceVerified !== true) return false;
      const id = item?.id;
      if (!id || decidedIds.has(id) || seenIds.has(id) || !isProfileReadyForDiscovery(item)) return false;
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
          const inviteResult = await sendActivityInvite(candidate);
          if (inviteResult?.matched && inviteResult?.conversationId) {
            onToast?.(`ส่งคำขอร่วมกิจกรรมถึง ${candidate.name} แล้ว! กำลังเปิดห้องแชต...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: inviteResult.conversationId } });
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
        await dismissProfile(candidate.id);
        onToast?.('ไม่เลือกโปรไฟล์นี้แล้ว กำลังหาเพื่อนคนถัดไป', 'info');
      }
    } catch (error) {
      setSessionExcludedIds((current) => current.filter((id) => id !== candidateId));
      onToast?.(`Error: ${error.message}`, 'info');
    } finally {
      setProcessing(false);
      decisionInFlight.current = false;
      decisionCandidateId.current = null;
    }
  }, [candidate, cardOpacity, cardScale, dismissProfile, isCandidateMatched, matchProfile, onToast, processing, sendActivityInvite, translateX, translateY]);

  const finishSwipe = useCallback((decision) => {
    if (processing || decisionStarted.current || decisionInFlight.current) return;
    decisionStarted.current = true;
    swipeLock.set(1);
    const buttonCenterOffset = (screenWidth / 2) - actionSideInset - (actionButtonWidth / 2);
    const targetX = decision === 'like' ? buttonCenterOffset : -buttonCenterOffset;
    const targetY = (screenHeight / 2) - 58;
    const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

    translateX.set(withTiming(targetX, { duration: 280, easing: easeOut }));
    translateY.set(withTiming(targetY, { duration: 280, easing: easeOut }));
    cardScale.set(withTiming(0.08, { duration: 280, easing: easeOut }));
    cardOpacity.set(withDelay(110, withTiming(0, { duration: 170, easing: easeOut }, (finished) => {
      if (finished) scheduleOnRN(handleDecision, decision);
    })));
  }, [handleDecision, processing, swipeLock, translateX, translateY, cardScale, cardOpacity]);

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
        rotate: `${interpolate(translateX.get(), [-screenWidth, 0, screenWidth], [-8, 0, 8], Extrapolation.CLAMP)}deg`,
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
    const notFound = Boolean(profileId) && !decidedIds.has(profileId);
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
            {!waitingForNextProfile ? (
              <Button
                label="กลับไปค้นหาเพื่อน"
                onPress={close}
                systemImage="chevron.left"
                modifiers={[buttonStyle('glassProminent'), buttonBorderShape('capsule'), controlSize('large'), tint(palette.purple)]}
              />
            ) : null}
          </VStack>
        </Host>
      </View>
    );
  }

  const safeTop = Math.max(insets.top, 44);
  const headerHeight = 56 + safeTop;
  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={{ backgroundColor: palette.background, flex: 1 }}>
      <GestureDetector gesture={panGesture}>
      <Animated.View
        key={candidateId}
        style={[{ flex: 1 }, topCardStyle]}
      >
        <Host colorScheme={colorScheme} seedColor={palette.purple} style={{ flex: 1 }}>
          <ScrollView
            showsIndicators={false}
            modifiers={[scrollIndicators('never', 'vertical')]}
          >
            <VStack
              alignment="leading"
              spacing={0}
              modifiers={[
                padding({ bottom: isViewOnly ? 36 : 128 }),
                frame({ maxWidth: Infinity, alignment: 'topLeading' }),
              ]}
            >
              <ZStack modifiers={[
                frame({ maxWidth: Infinity, alignment: 'topLeading' }),
                background(palette.card),
                clipShape('roundedRectangle', 24, { style: 'continuous' }),
              ]}>
                <VStack alignment="leading" spacing={0} modifiers={[
                  frame({ maxWidth: Infinity }),
                ]}>
                  <ProfileHero
                    candidate={candidate}
                    imageUri={imageUri}
                    palette={palette}
                  />
                  <ProfileDetails
                    candidate={candidate}
                    myFavoriteTracks={Array.isArray(currentProfile?.favoriteTracks) ? currentProfile.favoriteTracks : []}
                    palette={palette}
                  />
                </VStack>
              </ZStack>
            </VStack>
          </ScrollView>
        </Host>
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

      <MaskedView
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerHeight + 8, zIndex: 10 }}
        maskElement={<LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />}
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerHeight, zIndex: 20 }}>
        <Host colorScheme={colorScheme} seedColor={palette.purple} style={{ width: '100%', height: headerHeight }}>
          <VStack modifiers={[padding({ top: safeTop + 4, bottom: 8, horizontal: 16 }), frame({ maxWidth: Infinity })]}>
            <Header candidate={candidate} isViewOnly={isViewOnly} onClose={close} palette={palette} />
          </VStack>
        </Host>
      </View>

      {!isViewOnly ? (
        <>
          <View pointerEvents="box-none" style={decisionStyles.actions}>
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
                icon={isCandidateMatched ? 'message.fill' : 'heart.fill'}
                label={isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}
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

function Header({ candidate, isViewOnly, onClose, palette }) {
  const displayName = candidate?.nickname || candidate?.name || 'ผู้ใช้ CampusMate';
  return (
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <Button
        label="ย้อนกลับ"
        onPress={onClose}
        systemImage="chevron.left"
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('large'),
          labelStyle('iconOnly'),
          accessibilityLabel('ย้อนกลับ'),
        ]}
      />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
          {isViewOnly ? `โปรไฟล์ ${displayName}` : 'ค้นหาเพื่อน'}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
          {isViewOnly ? ((candidate?.faculty && !candidate.faculty.includes('???') ? candidate.faculty : null) || (candidate?.activityLabel && !candidate.activityLabel.includes('???') ? candidate.activityLabel : null) || 'เพื่อนใน CampusMate') : 'ปัดเพื่อดูคนถัดไป'}
        </Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function ProfileHero({ candidate, imageUri, palette }) {
  const displayName = candidate?.nickname || candidate?.name || 'ผู้ใช้ CampusMate';
  const activityDisplay = getActivityLabel(candidate?.activity, candidate?.activityLabel, candidate?.activities);

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        frame({ height: 430, maxWidth: Infinity }),
        background(candidate.avatarColor || palette.surfaceRaised),
        clipShape('roundedRectangle', 24, { style: 'continuous' }),
      ]}
    >
      {imageUri ? (
        <RNHostView matchContents={false} modifiers={[frame({ height: 430, maxWidth: Infinity })]}>
          <ExpoImage source={{ uri: imageUri }} contentFit="cover" priority="high" style={{ width: '100%', height: 430 }} />
        </RNHostView>
      ) : (
        <VStack
          alignment="center"
          spacing={10}
          modifiers={[frame({ height: 430, maxWidth: Infinity })]}
        >
          <Image color={palette.secondary} size={86} systemName="person.crop.square.fill" />
          <Text modifiers={[font({ textStyle: 'body', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
            ยังไม่มีรูปโปรไฟล์
          </Text>
        </VStack>
      )}
      {imageUri ? (
        <RNHostView matchContents={false}>
          <View style={{ width: '100%', height: 430, justifyContent: 'flex-end' }} pointerEvents="none">
            <MaskedView
              style={{ position: 'absolute', bottom: 0, width: '100%', height: 180 }}
              maskElement={
                <LinearGradient colors={['transparent', 'black', 'black']} locations={[0, 0.4, 1]} style={{ flex: 1 }} />
              }
            >
              <ExpoImage
                source={{ uri: imageUri }}
                style={{ position: 'absolute', bottom: 0, width: '100%', height: 430 }}
                blurRadius={30}
              />
              <View style={{ position: 'absolute', bottom: 0, width: '100%', height: 180, backgroundColor: 'rgba(0,0,0,0.3)' }} />
            </MaskedView>
          </View>
        </RNHostView>
      ) : null}
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <Spacer />
        <VStack
          alignment="leading"
          spacing={5}
          modifiers={[
            padding({ top: 42, bottom: 50, horizontal: 28 }),
            frame({ maxWidth: Infinity, alignment: 'bottomLeading' }),
          ]}
        >
          <Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.white), lineLimit(1)]}>
            {displayName}{candidate.age ? `, ${candidate.age}` : ''}
          </Text>
          {(activityDisplay || (candidate?.activityLabel && !candidate.activityLabel.includes('???'))) ? (
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.white), lineLimit(1)]}>
              {activityDisplay || candidate.activityLabel}
            </Text>
          ) : null}
        </VStack>
      </VStack>
    </ZStack>
  );
}

function ProfileDetails({ candidate, myFavoriteTracks = [], palette }) {
  const allTags = Array.from(new Set([...(candidate.tags || []), ...(candidate.interests || [])]));
  const activityDisplay = getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities);
  const activityDetailRows = describeActivityDetails(candidate.activityDetails, candidate.activities);
  const paceDisplay = activityDetailRows.some((row) => row.id === 'running') ? '' : candidate.pace;
  const displayName = candidate.nickname || candidate.name || 'ผู้ใช้ CampusMate';
  const candidateTracks = Array.isArray(candidate?.favoriteTracks)
    ? candidate.favoriteTracks.filter((track) => track && typeof track === 'object' && track.id && track.name)
    : [];
  const myIds = new Set((myFavoriteTracks || []).map((track) => track?.id).filter(Boolean));
  const sharedTracks = candidateTracks.filter((track) => myIds.has(track.id));
  const hasVisibleDetails = Boolean(
    candidate.age != null
    || candidate.gender
    || candidate.faculty
    || candidate.year
    || activityDisplay
    || activityDetailRows.length
    || candidate.skill
    || paceDisplay
    || candidate.availability
    || candidate.availabilitySlots?.length
    || candidate.distance != null
  );

  const openTrack = (url) => {
    if (typeof url === 'string' && url.trim()) {
      Linking.openURL(url.trim()).catch(() => {});
    }
  };

  const renderTrackRow = (track, keyPrefix) => (
    <HStack
      key={`${keyPrefix}-${track.id}`}
      spacing={8}
      modifiers={[
        padding({ all: 10 }),
        background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 14, roundedCornerStyle: 'continuous' })),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
      ]}
    >
      <Button onPress={() => openTrack(track.externalUrl)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}>
        <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {track.albumArt ? (
          <RNImage source={{ uri: track.albumArt }} style={{ width: 40, height: 40, borderRadius: 8 }} />
        ) : (
          <VStack
            modifiers={[
              frame({ width: 40, height: 40 }),
              background(palette.violetSoft || palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 8 })),
            ]}
          >
            <Spacer />
            <HStack>
              <Spacer />
              <Image color={palette.purple} size={14} systemName="music.note" />
              <Spacer />
            </HStack>
            <Spacer />
          </VStack>
        )}
        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>
            {track.name}
          </Text>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.tertiary), lineLimit(1)]}>
            {track.artists || 'Unknown'}
          </Text>
        </VStack>
        <Image color={palette.tertiary} size={13} systemName="arrow.up.right.square" />
        </HStack>
      </Button>
      {(track.previewUrl || track.youtubeVideoId || track.name) ? (
        <RNHostView>
          <TrackPreviewButton
            backgroundColor={palette.purpleSoft}
            color={palette.purple}
            previewEndMs={track.previewEndMs}
            previewStartMs={track.previewStartMs}
            previewUrl={track.previewUrl}
            size={32}
            track={track}
            trackArtists={track.artists}
            trackName={track.name}
            youtubeVideoId={track.youtubeVideoId}
          />
        </RNHostView>
      ) : null}
    </HStack>
  );

  return (
    <VStack
      alignment="leading"
      spacing={16}
      modifiers={[
        padding({ top: 28, bottom: 40, horizontal: 28 }),
        frame({ maxWidth: Infinity, alignment: 'topLeading' }),
        background(palette.surface, shapes.roundedRectangle({ cornerRadius: 28, roundedCornerStyle: 'continuous' })),
        offset({ y: -22 }),
        shadow({ radius: 20, y: -6, color: 'rgba(0,0,0,0.12)' }),
      ]}
    >
      <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
        <VStack alignment="leading" spacing={3}>
          <Text modifiers={[font({ textStyle: 'title3', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
            เกี่ยวกับ {displayName}
          </Text>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
            ข้อมูลที่เจ้าของโปรไฟล์เลือกแสดง
          </Text>
        </VStack>
        <Spacer />
        {candidate.compatibility ? (
          <VStack
            alignment="center"
            spacing={0}
            modifiers={[padding({ horizontal: 12, vertical: 8 }), background(palette.purpleSoft, shapes.capsule())]}
          >
            <Text modifiers={[font({ textStyle: 'title3', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.purple)]}>
              {candidate.compatibility}%
            </Text>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
              เข้ากันได้
            </Text>
          </VStack>
        ) : null}
      </HStack>

      <ProfileInfoList palette={palette}>
        {candidate.age ? <ProfileInfoRow icon="calendar" label="อายุ" value={`${candidate.age} ปี`} palette={palette} /> : null}
        {candidate.gender ? <ProfileInfoRow icon="person.2.fill" label="เพศ" value={genderLabel(candidate.gender)} palette={palette} /> : null}
        {(candidate.faculty && !candidate.faculty.includes('???')) ? <ProfileInfoRow icon="building.columns.fill" label="คณะ" value={candidate.faculty} palette={palette} /> : null}
        {(candidate.year && !candidate.year.includes('???')) ? <ProfileInfoRow icon="graduationcap.fill" label="ชั้นปี" value={candidate.year} palette={palette} /> : null}
        {activityDisplay ? <ProfileInfoRow icon="figure.run" label="กิจกรรมที่ชอบ" value={activityDisplay} palette={palette} /> : null}
        {activityDetailRows.map((row) => (
          <ProfileInfoRow icon={row.symbol} key={`detail-${row.id}`} label={row.label} value={row.lines.join('\n')} palette={palette} />
        ))}
        {candidate.skill ? <ProfileInfoRow icon="star.fill" label="ระดับ / ทักษะ" value={candidate.skill} palette={palette} /> : null}
        {paceDisplay ? <ProfileInfoRow icon="speedometer" label="สไตล์ / เพซ" value={paceDisplay} palette={palette} /> : null}
        {(candidate.availabilitySlots && candidate.availabilitySlots.length > 0) ? (
          <ProfileInfoRow
            icon="clock.fill"
            label="วันและเวลาที่สะดวก"
            value={formatAvailabilitySlots(candidate.availabilitySlots)}
            palette={palette}
          />
        ) : (candidate.availability && !candidate.availability.includes('???')) ? (
          <ProfileInfoRow icon="clock.fill" label="วันและเวลาที่สะดวก" value={candidate.availability} palette={palette} />
        ) : null}
        {candidate.distance != null ? <ProfileInfoRow icon="location.circle.fill" label="ระยะห่างจากคุณ" value={formatDistance(candidate.distance)} palette={palette} /> : null}
      </ProfileInfoList>

      {!hasVisibleDetails ? (
        <HStack
          alignment="center"
          spacing={8}
          modifiers={[
            padding({ all: 12 }),
            frame({ maxWidth: Infinity, alignment: 'leading' }),
            background(palette.purpleSoft, shapes.roundedRectangle({ cornerRadius: 16 })),
          ]}
        >
          <Image color={palette.purple} size={16} systemName="eye.slash.fill" />
          <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(palette.secondary)]}>
            ข้อมูลรายละเอียดอื่นถูกซ่อนไว้ตามการตั้งค่าความเป็นส่วนตัว
          </Text>
        </HStack>
      ) : null}

      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[
          padding({ all: 15 }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          background(palette.purpleSoft, shapes.roundedRectangle({ cornerRadius: 18 })),
        ]}
      >
        <HStack spacing={7}>
          <Image color={palette.purple} size={16} systemName="text.quote" />
          <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(palette.text)]}>
            แนะนำตัว
          </Text>
        </HStack>
        <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(palette.secondary), lineLimit(5)]}>
          {candidate.bio || 'ยังไม่ได้เขียนคำแนะนำตัว'}
        </Text>
      </VStack>

      {Array.isArray(candidate.gallery) && candidate.gallery.length > 0 ? (
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.tertiary)]}>
            แกลเลอรีรูปภาพ
          </Text>
          <ScrollView axes="horizontal" showsIndicators={false} modifiers={[scrollIndicators('never', 'horizontal')]}>
            <HStack spacing={12}>
              {candidate.gallery.map((uri, idx) => (
                <Image
                  key={idx}
                  source={{ uri }}
                  modifiers={[
                    frame({ width: 120, height: 160 }),
                    clipShape(shapes.roundedRectangle(12)),
                  ]}
                  resizeMode="cover"
                />
              ))}
            </HStack>
          </ScrollView>
        </VStack>
      ) : null}

      {sharedTracks.length ? (
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.tertiary)]}>
            เพลงที่ชอบเหมือนกัน
          </Text>
          <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            {sharedTracks.map((track) => renderTrackRow(track, 'shared'))}
          </VStack>
        </VStack>
      ) : null}

      {candidateTracks.length ? (
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.tertiary)]}>
            เพลงโปรด
          </Text>
          <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            {candidateTracks.map((track) => renderTrackRow(track, 'fav'))}
          </VStack>
        </VStack>
      ) : null}
    </VStack>
  );
}

function ProfileInfoList({ children, palette }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      {items.map((child, index) => (
        <React.Fragment key={child.key || `info-${index}`}>
          {React.cloneElement(child, { showDivider: index < items.length - 1, palette: child.props.palette || palette })}
        </React.Fragment>
      ))}
    </VStack>
  );
}

function ProfileInfoRow({ icon, label, value, palette, showDivider = false }) {
  const isMulti = typeof value === 'string' && value.includes('\n');
  const dividerColor = palette.separator || 'rgba(60, 60, 67, 0.18)';
  return (
    <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <HStack
        alignment={isMulti ? 'top' : 'center'}
        spacing={12}
        modifiers={[
          padding({ vertical: 11 }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
        ]}
      >
        <Image color={palette.purple} size={18} systemName={icon} />
        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
            {label}
          </Text>
          <Text modifiers={[font({ textStyle: 'body', weight: 'semibold' }), foregroundStyle(palette.text), ...(isMulti ? [] : [lineLimit(2)])]}>
            {value || 'ไม่ระบุ'}
          </Text>
        </VStack>
      </HStack>
      {showDivider ? (
        <HStack
          modifiers={[
            padding({ leading: 30 }),
            frame({ height: 0.5, maxWidth: Infinity }),
            background(dividerColor),
          ]}
        />
      ) : null}
    </VStack>
  );
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
