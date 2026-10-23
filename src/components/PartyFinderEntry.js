import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import AppText from './AppText';
import FeatureIcon from './FeatureIcon';
import { project, rubberband } from '../utils/motion';
import { radius, useTheme } from '../theme';

// Activity hints shown as glyphs on the banner — a glance at what parties are for.
export const ACTIVITY_HINTS = [
  { icon: 'fork.knife', label: 'กินข้าว' },
  { icon: 'sportscourt.fill', label: 'กีฬา' },
  { icon: 'book.closed.fill', label: 'ติว' },
  { icon: 'cup.and.saucer.fill', label: 'คาเฟ่' },
];

export function partyBannerGradient(isDark) {
  return isDark ? ['#24508F', '#142B4F'] : ['#3A7EE0', '#1F56A8'];
}

const BANNER_CARD_ASPECT = 4;
const BANNER_PHOTO_ASPECT = 4 / 3;
const BANNER_ACTION_WIDTH = 84;
const BANNER_SPRING = { duration: 400, dampingRatio: 0.8, overshootClamping: true };
const BANNER_PHOTO_FRACTION = BANNER_PHOTO_ASPECT / BANNER_CARD_ASPECT;

const CAMPUS_BG = require('../assets/images/campus/DSC_5070.jpg');
const MASCOT_IMG = require('../../assets/mascot/likes-matched.png');

export default function PartyFinderEntry({ onCreateParty }) {
  const { colors, isDark } = useTheme();
  const openFinder = () => router.push('/party-finder');

  const actionsCount = onCreateParty ? 2 : 1;
  const actionsWidth = BANNER_ACTION_WIDTH * actionsCount;

  const translateX = useSharedValue(0);
  const dragStart = useSharedValue(0);

  const settle = useCallback((open) => {
    translateX.set(withSpring(open ? -actionsWidth : 0, BANNER_SPRING));
  }, [actionsWidth, translateX]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-8, 8])
    .onStart(() => {
      dragStart.set(translateX.get());
    })
    .onUpdate((e) => {
      const next = dragStart.get() + e.translationX;
      if (next > 0) {
        translateX.set(rubberband(next, actionsWidth) * 0.35);
      } else if (next < -actionsWidth) {
        translateX.set(-actionsWidth + rubberband(next + actionsWidth, actionsWidth));
      } else {
        translateX.set(next);
      }
    })
    .onEnd((e, success) => {
      const projected = success ? translateX.get() + project(e.velocityX) : translateX.get();
      const shouldOpen = projected < -(actionsWidth * 0.45);
      translateX.set(withSpring(shouldOpen ? -actionsWidth : 0, {
        ...BANNER_SPRING,
        velocity: success ? e.velocityX : 0,
      }));
    }), [actionsWidth, dragStart, translateX]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const actionsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.get(), [-actionsWidth, -16, 0], [1, 0.5, 0], Extrapolation.CLAMP),
  }));

  const handleCardPress = () => {
    if (translateX.get() < -(actionsWidth / 2)) {
      settle(false);
      return;
    }
    openFinder();
  };

  const handleViewAction = () => {
    settle(false);
    openFinder();
  };

  const handleCreateAction = () => {
    settle(false);
    onCreateParty?.();
  };

  return (
    <NativeCard style={[styles.card, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
      <View style={styles.swipeContainer}>
        {/* Hidden action buttons revealed on swipe */}
        <Animated.View style={[styles.actions, { width: actionsWidth }, actionsStyle]}>
          <Pressable
            accessibilityLabel="ดูตี้ที่เปิดรับ"
            accessibilityRole="button"
            onPress={handleViewAction}
            style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary }, pressed && styles.actionPressed]}
          >
            <FeatureIcon color="#FFFFFF" name="arrow.right" size={20} />
            <AppText numberOfLines={1} style={styles.actionText}>ดูตี้</AppText>
          </Pressable>
          {onCreateParty ? (
            <Pressable
              accessibilityLabel="เปิดตี้ใหม่"
              accessibilityRole="button"
              onPress={handleCreateAction}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.coral }, pressed && styles.actionPressed]}
            >
              <FeatureIcon color="#FFFFFF" name="plus" size={20} />
              <AppText numberOfLines={1} style={styles.actionText}>เปิดตี้</AppText>
            </Pressable>
          ) : null}
        </Animated.View>

        {/* Foreground Content */}
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.content, contentStyle]}>
            <Pressable
              accessibilityActions={[
                { name: 'activate', label: 'ดูตี้ที่เปิดรับ' },
                ...(onCreateParty ? [{ name: 'create', label: 'เปิดตี้ใหม่' }] : []),
              ]}
              accessibilityHint="แตะเพื่อเปิดหน้ารวมตี้ หรือปัดไปทางซ้ายเพื่อดูตัวเลือก"
              accessibilityLabel="หาตี้ใน ม.อ. กิจกรรม กินข้าว กีฬา ติว คาเฟ่"
              accessibilityRole="button"
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'create') handleCreateAction();
                else handleViewAction();
              }}
              onPress={handleCardPress}
              style={styles.cardRow}
            >
              {/* Full-bleed campus backdrop behind left portion with seamless gradient fade */}
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Image
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  source={CAMPUS_BG}
                  style={[StyleSheet.absoluteFill, { width: '56%' }]}
                />
                <LinearGradient
                  colors={[
                    'rgba(20, 22, 28, 0)',
                    'rgba(20, 22, 28, 0.42)',
                    'rgba(20, 22, 28, 0.90)',
                    '#14161C',
                  ]}
                  end={{ x: 0.65, y: 0.5 }}
                  locations={[0.15, 0.35, 0.52, 0.70]}
                  start={{ x: 0, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>

              {/* Mascot container on the left */}
              <View style={styles.photoContainer}>
                <Image
                  contentFit="contain"
                  source={MASCOT_IMG}
                  style={styles.mascot}
                />
              </View>

              {/* Text Area */}
              <View style={styles.copy}>
                <View style={styles.titleRow}>
                  <AppText numberOfLines={1} style={styles.title}>หาตี้ใน ม.อ.</AppText>
                  <FeatureIcon color="#F59E0B" name="sparkles" size={14} />
                </View>
                <AppText numberOfLines={1} style={styles.subtitle}>
                  กินข้าว · กีฬา · ติว · คาเฟ่
                </AppText>
                <View style={styles.statusPill}>
                  <FeatureIcon color="#6EE7B7" name="person.3.fill" size={12} />
                  <AppText style={styles.statusText}>เปิดรับเพื่อนร่วมตี้</AppText>
                </View>
              </View>

              {/* Swipe chevron hint */}
              <View style={styles.swipeHint}>
                <FeatureIcon color="rgba(255,255,255,0.8)" name="chevron.left" size={14} />
              </View>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </View>
    </NativeCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
    width: '100%',
  },
  swipeContainer: {
    aspectRatio: BANNER_CARD_ASPECT,
    minHeight: 84,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  actions: {
    bottom: 0,
    flexDirection: 'row',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    paddingHorizontal: 4,
    width: BANNER_ACTION_WIDTH,
  },
  actionPressed: { opacity: 0.75 },
  actionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#14161C',
  },
  cardRow: {
    alignItems: 'stretch',
    flex: 1,
    flexDirection: 'row',
  },
  photoContainer: {
    aspectRatio: BANNER_PHOTO_ASPECT,
    height: '100%',
  },
  mascot: {
    ...StyleSheet.absoluteFill,
    margin: 6,
  },
  copy: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 8,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitle: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  statusPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  statusText: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '800',
  },
  swipeHint: {
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
    paddingHorizontal: 10,
  },
});
