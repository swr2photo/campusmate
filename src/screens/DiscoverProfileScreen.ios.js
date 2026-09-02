import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { Animated, Dimensions, PanResponder, Text as RNText, View, useColorScheme, Image as RNImage } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useAssets } from 'expo-asset';
import { router } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { requireFirebase } from '../services/dbService';
import {
  Button,
  HStack,
  Host,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  RNHostView,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  aspectRatio,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  offset,
  padding,
  resizable,
  scrollIndicators,
  shadow,
  shapes,
  tint,
  blur,
  opacity,
} from '@expo/ui/swift-ui/modifiers';
import { useApp } from '../context/AppContext';

import { formatDistance, formatReadableDate, genderLabel, getActivityLabel } from '../utils/formatters';

const profilePhoto = require('../../assets/friend-profile-card.png');
const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const actionButtonWidth = 96;
const actionSideInset = 32;

const darkPalette = {
  background: '#14171B',
  surface: '#20242A',
  surfaceRaised: '#292E35',
  text: '#F7F8FA',
  secondary: '#B6BDC8',
  tertiary: '#7F8896',
  purple: '#9A8CFF',
  purpleSoft: 'rgba(154,140,255,0.18)',
  coral: '#FF7A6B',
  white: '#FFFFFF',
};

const lightPalette = {
  background: '#F6F8FC',
  surface: '#FFFFFF',
  surfaceRaised: '#E9EDF4',
  text: '#10203A',
  secondary: '#60708A',
  tertiary: '#8B98AC',
  purple: '#5B5CE2',
  purpleSoft: '#EEF0FF',
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
  const [assets] = useAssets([profilePhoto]);
  const { availableProfiles, conversations, dismissProfile, getMeetupStats, matchProfile, pendingIncomingLikes, sendActivityInvite } = useApp();
  const [processing, setProcessing] = useState(false);
  const [sessionExcludedIds, setSessionExcludedIds] = useState([]);
  const [directProfile, setDirectProfile] = useState(null);
  const [swipeBgColor, setSwipeBgColor] = useState('transparent');
  const [swipeContentOpacity, setSwipeContentOpacity] = useState(1);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const decisionStarted = useRef(false);
  const decisionInFlight = useRef(false);
  const decisionCandidateId = useRef(null);
  const candidateCache = useRef(new Map());

  useEffect(() => {
    if (!profileId) {
      setDirectProfile(null);
      return;
    }
    try {
      const { db } = requireFirebase();
      const unsub = onSnapshot(doc(db, 'profiles', profileId), (snap) => {
        if (snap.exists()) {
          setDirectProfile({ id: snap.id, ...snap.data() });
        }
      });
      return () => unsub();
    } catch (e) {
      console.warn('Realtime profile lookup error:', e);
    }
  }, [profileId]);

  const isViewOnly = Boolean(isViewOnlyParam);

  const candidatePool = useMemo(() => {
    const seenIds = new Set();
    const excludedIds = new Set(sessionExcludedIds);
    return [...(availableProfiles || []), ...(pendingIncomingLikes || [])].filter((item) => {
      const id = item?.id;
      if (!id || excludedIds.has(id) || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
  }, [availableProfiles, pendingIncomingLikes, sessionExcludedIds]);

  // Keep the last known pool so a short Firestore refresh cannot leave the
  // card blank while the decision request is still being completed.
  useEffect(() => {
    if (isViewOnly) return;
    candidatePool.forEach((item) => candidateCache.current.set(item.id, item));
  }, [candidatePool, isViewOnly]);

  const candidate = useMemo(() => {
    if (isViewOnly) {
      if (directProfile && directProfile.id === profileId) return directProfile;
      const matchedConvo = conversations?.find((c) => c.profileId === profileId || c.participants?.includes(profileId));
      if (matchedConvo?.participantProfiles?.[profileId]) {
        return { id: profileId, ...matchedConvo.participantProfiles[profileId] };
      }
      const fromAvailable = candidatePool.find((item) => item.id === profileId);
      if (fromAvailable) return fromAvailable;
      if (directProfile) return directProfile;
      return null;
    }

    // Keep the profile opened from Home as the first card when it is present.
    const isDecisionExcluded = (id) => (
      sessionExcludedIds.includes(id)
      || (decisionInFlight.current && decisionCandidateId.current === id)
    );
    const requestedProfile = profileId && candidatePool.find((item) => (
      item.id === profileId && !isDecisionExcluded(item.id)
    ));
    if (requestedProfile) return requestedProfile;

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
  }, [candidatePool, conversations, directProfile, isViewOnly, processing, profileId, sessionExcludedIds]);

  const candidateId = candidate?.id || null;

  const isCandidateMatched = useMemo(() => {
    if (!candidate) return false;
    return Boolean(
      candidate.isMatched ||
      conversations?.some((c) => c.profileId === candidate.id || c.participants?.includes(candidate.id))
    );
  }, [candidate, conversations]);

  const meetupStats = useMemo(
    () => (candidate ? getMeetupStats(candidate) : null),
    [candidate, getMeetupStats]
  );

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
    translateX.setValue(0);
    translateY.setValue(0);
    cardScale.setValue(1);
    cardOpacity.setValue(1);
    // Animated listeners are asynchronous on iOS. Reset these values
    // explicitly so the next profile cannot inherit an invisible card.
    setSwipeBgColor('transparent');
    setSwipeContentOpacity(1);
    try {
      if (decision === 'like') {
        if (isCandidateMatched) {
          const conversationId = await sendActivityInvite(candidate);
          onToast?.(`ส่งคำขอร่วมกิจกรรมถึง ${candidate.name} แล้ว! กำลังเปิดห้องแชต...`, 'success');
          router.replace({ pathname: '/chat-room', params: { chatId: conversationId } });
        } else {
          const result = await matchProfile(candidate);
          if (result.matched && result.conversationId) {
            onToast?.(`คุณและ ${candidate.name} แมตช์กันแล้ว! กำลังเปิดห้องแชต...`, 'success');
            router.replace({ pathname: '/chat-room', params: { chatId: result.conversationId } });
          } else {
            onToast?.(`ส่งถูกใจให้ ${candidate.name} แล้ว รออีกฝ่ายกดถูกใจกลับ`, 'info');
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
    const buttonCenterOffset = (screenWidth / 2) - actionSideInset - (actionButtonWidth / 2);
    const targetX = decision === 'like' ? buttonCenterOffset : -buttonCenterOffset;
    const targetY = (screenHeight / 2) - 58;

    Animated.parallel([
      Animated.timing(translateX, {
        duration: 280,
        toValue: targetX,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        duration: 280,
        toValue: targetY,
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        duration: 280,
        toValue: 0.08,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        delay: 110,
        duration: 170,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      void handleDecision(decision);
    });
  }, [cardOpacity, cardScale, handleDecision, processing, translateX, translateY]);

  const resetSwipe = useCallback(() => {
    decisionStarted.current = false;
    setSwipeBgColor('transparent');
    setSwipeContentOpacity(1);
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
    },
    onPanResponderMove: (_, gestureState) => {
      if (!decisionStarted.current) translateX.setValue(gestureState.dx);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx > 110 || gestureState.vx > 0.75) {
        finishSwipe('like');
      } else if (gestureState.dx < -110 || gestureState.vx < -0.75) {
        finishSwipe('skip');
      } else {
        resetSwipe();
      }
    },
    onPanResponderTerminate: resetSwipe,
    onPanResponderTerminationRequest: () => false,
  }), [finishSwipe, resetSwipe, translateX]);

  const rotate = translateX.interpolate({
    inputRange: [-screenWidth, 0, screenWidth],
    outputRange: ['-8deg', '0deg', '8deg'],
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

  const remoteAvatar = useRemoteImage(candidate?.avatarUri);
  const imageUri = remoteAvatar || assets?.[0]?.localUri || assets?.[0]?.uri;
  const nextCandidate = useMemo(
    () => candidatePool.find((item) => item.id !== candidateId) || null,
    [candidateId, candidatePool]
  );
  // Start downloading the next profile's image while the current card is on
  // screen. useRemoteImage writes to the same local cache used by the card.
  useRemoteImage(nextCandidate?.avatarUri);

  useEffect(() => {
    if (isViewOnly) return;
    const listenerId = translateX.addListener(({ value }) => {
      let newBgColor = 'transparent';
      if (value > 20) newBgColor = palette.purple;
      else if (value < -20) newBgColor = palette.coral;
      setSwipeBgColor((prev) => prev !== newBgColor ? newBgColor : prev);

      let newOpacity = 1;
      const absValue = Math.abs(value);
      if (absValue > 20) {
        newOpacity = Math.max(0, 1 - ((absValue - 20) / 80));
      }
      setSwipeContentOpacity((prev) => Math.abs(prev - newOpacity) > 0.05 ? newOpacity : prev);
    });
    return () => translateX.removeListener(listenerId);
  }, [translateX, isViewOnly, palette]);

  // A new candidate must always start from a fully visible, neutral card.
  // This also handles a short Firestore refresh where the old card is removed
  // before the next one arrives.
  const previousCandidateId = useRef(null);
  useEffect(() => {
    if (candidateId === previousCandidateId.current) return;
    previousCandidateId.current = candidateId;
    decisionStarted.current = false;
    translateX.stopAnimation();
    translateY.stopAnimation();
    cardScale.stopAnimation();
    cardOpacity.stopAnimation();
    translateX.setValue(0);
    translateY.setValue(0);
    cardScale.setValue(1);
    cardOpacity.setValue(1);
    setSwipeBgColor('transparent');
    setSwipeContentOpacity(1);
  }, [candidateId, cardOpacity, cardScale, translateX, translateY]);

  if (!candidate) {
    const waitingForNextProfile = processing;
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
              systemName={waitingForNextProfile ? 'arrow.triangle.2.circlepath' : 'person.crop.circle.badge.questionmark'}
            />
            <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(palette.text)]}>
              {waitingForNextProfile ? 'กำลังโหลดเพื่อนคนถัดไป...' : 'ไม่พบโปรไฟล์นี้แล้ว'}
            </Text>
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
      <Animated.View
        key={candidateId}
        {...(isViewOnly ? {} : panResponder.panHandlers)}
        style={{
          flex: 1,
          opacity: isViewOnly ? 1 : cardOpacity,
          transform: isViewOnly ? [] : [{ translateX }, { translateY }, { rotate }, { scale: cardScale }],
        }}
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
                background(swipeBgColor),
                clipShape('roundedRectangle', 24, { style: 'continuous' }),
              ]}>
                <VStack alignment="leading" spacing={0} modifiers={[
                  frame({ maxWidth: Infinity }),
                  opacity(swipeContentOpacity)
                ]}>
                  <ProfileHero
                    candidate={candidate}
                    imageUri={imageUri}
                    palette={palette}
                    translateX={translateX}
                  />
                  <ProfileDetails candidate={candidate} meetupStats={meetupStats} palette={palette} />
                </VStack>
              </ZStack>
            </VStack>
          </ScrollView>
        </Host>
      </Animated.View>

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
            <Animated.View style={{ transform: [{ scale: skipActionScale }] }}>
              <DecisionAction
                disabled={processing}
                label="ไม่เลือก"
                onPress={() => finishSwipe('skip')}
                palette={palette}
                colorScheme={colorScheme}
                type="skip"
                activeOpacity={skipActionBgOpacity}
                activeColor={palette.coral}
              />
            </Animated.View>
            <Animated.View style={{ transform: [{ scale: likeActionScale }] }}>
              <DecisionAction
                disabled={processing}
                icon={isCandidateMatched ? 'message.fill' : 'heart.fill'}
                label={isCandidateMatched ? 'ไปห้องแชต' : 'ถูกใจ'}
                onPress={() => finishSwipe('like')}
                palette={palette}
                colorScheme={colorScheme}
                type="like"
                activeOpacity={likeActionBgOpacity}
                activeColor={palette.purple}
              />
            </Animated.View>
          </View>
          <RNText pointerEvents="none" style={[decisionStyles.hint, { color: palette.secondary }]}>
            {isCandidateMatched ? 'ปัดซ้ายเพื่อข้าม · ปัดขวาเพื่อไปห้องแชต' : 'ปัดซ้ายเพื่อไม่เลือก · ปัดขวาเพื่อถูกใจ'}
          </RNText>
        </>
      ) : null}
    </View>
  );
}

function Header({ candidate, isViewOnly, onClose, palette }) {
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
          {isViewOnly ? (candidate?.name ? `โปรไฟล์ ${candidate.name}` : 'ข้อมูลโปรไฟล์') : 'ค้นหาเพื่อน'}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
          {isViewOnly ? (candidate?.faculty || candidate?.activityLabel || 'เพื่อนใน CampusMate') : 'ปัดเพื่อดูคนถัดไป'}
        </Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function ProfileHero({ candidate, imageUri, palette, translateX }) {
  const [blurRadius, setBlurRadius] = useState(0);

  useEffect(() => {
    if (!translateX) return;
    const listenerId = translateX.addListener(({ value }) => {
      const newBlur = Math.min(Math.abs(value) / 8, 20); // 0 to 20
      // Only update if difference is noticeable to avoid too many re-renders
      setBlurRadius((prev) => (Math.abs(prev - newBlur) > 1.5 ? newBlur : prev));
    });
    return () => translateX.removeListener(listenerId);
  }, [translateX]);

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
        <Image
          uiImage={imageUri}
          modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ height: 430, maxWidth: Infinity }), clipped(), blurRadius > 0 ? blur(blurRadius) : null].filter(Boolean)}
        />
      ) : (
        <Image
          color={palette.secondary}
          size={100}
          systemName="person.crop.square.fill"
          modifiers={[frame({ height: 430, maxWidth: Infinity }), background(candidate.avatarColor || palette.surfaceRaised)]}
        />
      )}
      <RNHostView matchContents={false}>
        <View style={{ width: '100%', height: 430, justifyContent: 'flex-end' }} pointerEvents="none">
          <MaskedView
            style={{ position: 'absolute', bottom: 0, width: '100%', height: 180 }}
            maskElement={
              <LinearGradient colors={['transparent', 'black', 'black']} locations={[0, 0.4, 1]} style={{ flex: 1 }} />
            }
          >
            <RNImage
              source={{ uri: imageUri }}
              style={{ position: 'absolute', bottom: 0, width: '100%', height: 430 }}
              blurRadius={30}
            />
            <View style={{ position: 'absolute', bottom: 0, width: '100%', height: 180, backgroundColor: 'rgba(0,0,0,0.3)' }} />
          </MaskedView>
        </View>
      </RNHostView>
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
            {candidate.name}{candidate.age ? `, ${candidate.age}` : ''}
          </Text>
          {candidate.activityLabel ? (
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.white), lineLimit(1)]}>
              {candidate.activityLabel}
            </Text>
          ) : null}
        </VStack>
      </VStack>
    </ZStack>
  );
}

function ProfileDetails({ candidate, meetupStats, palette }) {
  const allTags = Array.from(new Set([...(candidate.tags || []), ...(candidate.interests || [])]));
  const activityDisplay = getActivityLabel(candidate.activity, candidate.activityLabel, candidate.activities);

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
            เกี่ยวกับ {candidate.nickname || candidate.name}
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

      <VStack alignment="leading" spacing={9} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {candidate.age ? <ProfileInfoRow icon="calendar" label="อายุ" value={`${candidate.age} ปี`} palette={palette} /> : null}
        {candidate.gender ? <ProfileInfoRow icon="person.2.fill" label="เพศ" value={genderLabel(candidate.gender)} palette={palette} /> : null}
        {candidate.faculty ? <ProfileInfoRow icon="building.columns.fill" label="คณะ" value={candidate.faculty} palette={palette} /> : null}
        {candidate.year ? <ProfileInfoRow icon="graduationcap.fill" label="ชั้นปี" value={candidate.year} palette={palette} /> : null}
        {activityDisplay ? <ProfileInfoRow icon="figure.run" label="กิจกรรมที่ชอบ" value={activityDisplay} palette={palette} /> : null}
        {candidate.skill ? <ProfileInfoRow icon="star.fill" label="ระดับ / ทักษะ" value={candidate.skill} palette={palette} /> : null}
        {candidate.pace ? <ProfileInfoRow icon="speedometer" label="สไตล์ / เพซ" value={candidate.pace} palette={palette} /> : null}
        {candidate.availability ? <ProfileInfoRow icon="clock.fill" label="เวลาที่สะดวก" value={candidate.availability} palette={palette} /> : null}
        {candidate.distance != null ? <ProfileInfoRow icon="location.circle.fill" label="ระยะห่างจากคุณ" value={formatDistance(candidate.distance)} palette={palette} /> : null}
      </VStack>

      {candidate.meetup && (
        <VStack
          alignment="leading"
          spacing={12}
          modifiers={[
            padding({ all: 16 }),
            frame({ maxWidth: Infinity, alignment: 'leading' }),
            background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 20, roundedCornerStyle: 'continuous' })),
          ]}
        >
          <HStack alignment="center" spacing={8}>
            <Image color={palette.purple} size={18} systemName="mappin.and.ellipse" />
            <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
              จุดนัดหมาย
            </Text>
            <Spacer />
            {meetupStats?.isFull ? (
              <Text modifiers={[padding({ horizontal: 10, vertical: 4 }), background('rgba(255,100,100,0.18)', shapes.capsule()), font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle('#FF453A')]}>
                นัดหมายเต็มแล้ว ({meetupStats.maxPeople}/{meetupStats.maxPeople})
              </Text>
            ) : (
              <Text modifiers={[padding({ horizontal: 10, vertical: 4 }), background(palette.purpleSoft, shapes.capsule()), font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(palette.purple)]}>
                {meetupStats ? `รับสมัคร (ว่างอีก ${meetupStats.remaining} ที่)` : 'นัดพบกันที่นี่'}
              </Text>
            )}
          </HStack>

          <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <HStack alignment="center" spacing={8}>
              <Image color={palette.secondary} size={14} systemName="location.fill" />
              <Text modifiers={[font({ textStyle: 'body', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
                {candidate.meetup.name}
              </Text>
            </HStack>

            {candidate.meetup.schedule?.date ? (
              <HStack alignment="center" spacing={8}>
                <Image color={palette.secondary} size={14} systemName="calendar" />
                <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                  {formatReadableDate(candidate.meetup.schedule.date)}
                  {candidate.meetup.schedule?.startTime && candidate.meetup.schedule?.endTime ? ` · ${candidate.meetup.schedule.startTime}–${candidate.meetup.schedule.endTime}` : ''}
                </Text>
              </HStack>
            ) : null}

            {candidate.meetup.schedule?.maxPeople ? (
              <HStack alignment="center" spacing={8}>
                <Image color={palette.secondary} size={14} systemName="person.2.fill" />
                <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(palette.secondary)]}>
                  {meetupStats
                    ? `ผู้เข้าร่วม ${meetupStats.acceptedCount}/${meetupStats.maxPeople} คน (รวมเจ้าของโพสต์)`
                    : `จำนวน ${candidate.meetup.schedule.maxPeople} คน`}
                </Text>
              </HStack>
            ) : null}

            {candidate.meetup.schedule?.message ? (
              <HStack alignment="top" spacing={8} modifiers={[padding({ top: 2 })]}>
                <Image color={palette.purple} size={14} systemName="text.bubble.fill" />
                <Text modifiers={[font({ textStyle: 'callout' }), foregroundStyle(palette.text)]}>
                  {candidate.meetup.schedule.message}
                </Text>
              </HStack>
            ) : null}
          </VStack>
        </VStack>
      )}

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

      {allTags.length ? (
        <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.tertiary)]}>
            ความสนใจ
          </Text>
          <ScrollView axes="horizontal" showsIndicators={false} modifiers={[scrollIndicators('never', 'horizontal')]}>
            <HStack spacing={8}>
              {allTags.map((tag) => (
                <Text
                  key={tag}
                  modifiers={[
                    padding({ horizontal: 12, vertical: 8 }),
                    background(palette.surfaceRaised, shapes.capsule()),
                    font({ textStyle: 'caption', weight: 'semibold' }),
                    foregroundStyle(palette.text),
                  ]}
                >
                  {tag}
                </Text>
              ))}
            </HStack>
          </ScrollView>
        </VStack>
      ) : null}
    </VStack>
  );
}

function ProfileInfoRow({ icon, label, value, palette }) {
  return (
    <HStack
      alignment="center"
      spacing={12}
      modifiers={[
        padding({ all: 12 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
          background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 16 })),
      ]}
    >
      <ZStack modifiers={[frame({ width: 38, height: 38 }), background(palette.purpleSoft, shapes.circle())]}>
        <Image color={palette.purple} size={18} systemName={icon} />
      </ZStack>
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
          {label}
        </Text>
        <Text modifiers={[font({ textStyle: 'body', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(2)]}>
          {value || 'ไม่ระบุ'}
        </Text>
      </VStack>
    </HStack>
  );
}



function DecisionAction({ colorScheme, disabled: isDisabled, icon, label, onPress, palette, type, activeOpacity, activeColor }) {
  const isLike = type === 'like';
  const systemImageName = icon || (isLike ? 'heart.fill' : 'xmark');
  return (
    <View style={decisionStyles.actionGroup}>
      <View style={[decisionStyles.nativeButtonHost, { position: 'relative' }]}>
        <Animated.View 
          style={{ 
            position: 'absolute', 
            top: 0, left: 0, right: 0, bottom: 0, 
            backgroundColor: activeColor, 
            borderRadius: 32, 
            opacity: activeOpacity || 0 
          }} 
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
  skipBadge: { backgroundColor: 'rgba(255,255,255,0.94)', borderColor: '#5B5CE2', left: 20, transform: [{ rotate: '-8deg' }] },
};
