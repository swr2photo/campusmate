import Text from './AppText';
import React, { useCallback, useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  runOnJS,
  useAnimatedReaction,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

/**
 * LiquidGlassSegmentedControl
 * ──────────────────────────
 * Apple Liquid Glass capsule segmented switcher for iOS 18+.
 * Features:
 * - Continuous capsule outer track with frosted glass blur.
 * - Floating liquid glass lens with chromatic / iridescent specular rim reflection.
 * - Top-half curved specular gloss sheen for authentic optical lens refraction.
 * - Smooth spring physics with interactive pan gesture & direct tap response.
 * - Optional badge count and icon support.
 */
export default function LiquidGlassSegmentedControl({
  activeTab,
  onChangeTab,
  style,
  tabs = [],
}) {
  const { colors, isDark } = useTheme();
  const tabWidth = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const translateX = useSharedValue(0);

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);
  const activeIndexShared = useSharedValue(activeIndex >= 0 ? activeIndex : 0);

  useEffect(() => {
    const nextIndex = tabs.findIndex((t) => t.id === activeTab);
    const validIndex = nextIndex >= 0 ? nextIndex : 0;
    activeIndexShared.value = validIndex;
    if (tabWidth.value > 0 && !isDragging.value) {
      translateX.value = withSpring(validIndex * tabWidth.value, {
        damping: 26,
        stiffness: 350,
        mass: 0.8,
      });
    }
  }, [activeTab, tabs, activeIndexShared, isDragging, tabWidth, translateX]);

  const onChangeTabByIndex = useCallback(
    (index) => {
      if (tabs[index]) {
        onChangeTab?.(tabs[index].id);
      }
    },
    [tabs, onChangeTab]
  );

  useAnimatedReaction(
    () => ({
      width: tabWidth.value,
      index: activeIndexShared.value,
      drag: isDragging.value,
    }),
    (state, prevState) => {
      if (state.width > 0 && !state.drag) {
        if (
          !prevState ||
          state.width !== prevState.width ||
          state.index !== prevState.index ||
          state.drag !== prevState.drag
        ) {
          translateX.value = withSpring(state.index * state.width, {
            damping: 26,
            stiffness: 350,
            mass: 0.8,
          });
        }
      }
    }
  );

  const tabsLength = tabs.length;
  const panGesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onBegin(() => {
      isDragging.value = true;
    })
    .onUpdate((e) => {
      if (tabWidth.value <= 0) return;
      const maxTranslate = (tabsLength - 1) * tabWidth.value;
      let nextTranslate = activeIndexShared.value * tabWidth.value + e.translationX;
      nextTranslate = Math.max(0, Math.min(nextTranslate, maxTranslate));
      translateX.value = nextTranslate;
    })
    .onEnd((e) => {
      isDragging.value = false;
      if (tabWidth.value <= 0) return;
      const numTabs = tabsLength;
      const maxTranslate = (numTabs - 1) * tabWidth.value;
      let nextTranslate =
        activeIndexShared.value * tabWidth.value +
        e.translationX +
        e.velocityX * 0.05;
      nextTranslate = Math.max(0, Math.min(nextTranslate, maxTranslate));

      let newIndex = Math.round(nextTranslate / tabWidth.value);
      newIndex = Math.max(0, Math.min(newIndex, numTabs - 1));

      if (newIndex !== activeIndexShared.value) {
        runOnJS(onChangeTabByIndex)(newIndex);
      } else {
        translateX.value = withSpring(activeIndexShared.value * tabWidth.value, {
          damping: 26,
          stiffness: 350,
          mass: 0.8,
        });
      }
    });

  const animatedPillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: tabWidth.value > 0 ? tabWidth.value : '50%',
  }));

  const blurTint = isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight';

  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  const TRACK_PADDING = 2.5;

  return (
    <View
      onLayout={(e) => {
        const fullWidth = e.nativeEvent.layout.width;
        if (fullWidth > 0 && tabs.length > 0) {
          const singleWidth = (fullWidth - TRACK_PADDING * 2) / tabs.length;
          tabWidth.value = singleWidth;
          const targetIndex = activeIndex >= 0 ? activeIndex : 0;
          translateX.value = targetIndex * singleWidth;
        }
      }}
      style={[
        styles.trackContainer,
        {
          backgroundColor: isDark
            ? 'rgba(32, 34, 40, 0.65)'
            : 'rgba(118, 118, 128, 0.12)',
          borderColor: isDark
            ? 'rgba(255, 255, 255, 0.14)'
            : 'rgba(0, 0, 0, 0.06)',
        },
        style,
      ]}
    >
      <BlurView
        intensity={Platform.OS === 'ios' ? 70 : 40}
        tint={blurTint}
        style={StyleSheet.absoluteFill}
      />

      <GestureDetector gesture={panGesture}>
        <View style={styles.tabsRow}>
          {/* Floating Liquid Glass Lens Pill */}
          <Animated.View style={[styles.activePillContainer, animatedPillStyle]}>
            {/* Iridescent / Chromatic Aberration Rim Highlight */}
            <LinearGradient
              colors={
                isDark
                  ? [
                      'rgba(255, 255, 255, 0.90)', // Specular white on top
                      'rgba(115, 215, 255, 0.80)', // Prismatic cyan
                      'rgba(215, 125, 255, 0.75)', // Violet/magenta reflection
                      'rgba(255, 195, 85, 0.70)',  // Warm amber on rim
                      'rgba(255, 255, 255, 0.40)', // Bottom-left white
                    ]
                  : [
                      'rgba(255, 255, 255, 0.95)',
                      'rgba(130, 220, 255, 0.75)',
                      'rgba(220, 140, 255, 0.65)',
                      'rgba(255, 205, 105, 0.65)',
                      'rgba(255, 255, 255, 0.65)',
                    ]
              }
              end={{ x: 0.9, y: 1.0 }}
              start={{ x: 0.1, y: 0.0 }}
              style={styles.gradientBorder}
            >
              <View style={styles.innerGlass}>
                {/* Frosted glass blur */}
                <BlurView
                  intensity={Platform.OS === 'ios' ? 85 : 60}
                  tint={blurTint}
                  style={StyleSheet.absoluteFill}
                />
                {/* Translucent glass body fill */}
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(255, 255, 255, 0.35)',
                    },
                  ]}
                />
                {/* Convex specular curved reflection (Top gloss sheen) */}
                <LinearGradient
                  colors={
                    isDark
                      ? ['rgba(255, 255, 255, 0.35)', 'rgba(255, 255, 255, 0.05)', 'transparent']
                      : ['rgba(255, 255, 255, 0.65)', 'rgba(255, 255, 255, 0.15)', 'transparent']
                  }
                  end={{ x: 0.5, y: 1.0 }}
                  start={{ x: 0.5, y: 0.0 }}
                  style={styles.specularTopSheen}
                />
              </View>
            </LinearGradient>
          </Animated.View>

          {/* Interactive Tab Buttons */}
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const badgeCount =
              typeof tab.badgeCount === 'number'
                ? tab.badgeCount
                : null;

            return (
              <Pressable
                accessibilityLabel={tab.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                key={tab.id}
                onPress={() => onChangeTab?.(tab.id)}
                style={styles.tabButton}
              >
                <View style={styles.tabContent}>
                  {tab.icon ? (
                    <FeatureIcon
                      color={
                        isActive
                          ? (isDark ? '#FFFFFF' : colors.primary)
                          : (isDark ? 'rgba(255, 255, 255, 0.60)' : colors.inkMuted)
                      }
                      name={tab.icon}
                      size={13}
                    />
                  ) : null}
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.tabLabel,
                      {
                        color: isActive
                          ? (isDark ? '#FFFFFF' : '#1C1C1E')
                          : (isDark ? 'rgba(255, 255, 255, 0.68)' : 'rgba(60, 60, 67, 0.60)'),
                        fontWeight: isActive ? '700' : '600',
                      },
                    ]}
                  >
                    {tab.label}
                  </Text>

                  {badgeCount !== null && badgeCount > 0 ? (
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isActive
                            ? (isDark ? 'rgba(255, 255, 255, 0.24)' : colors.coral)
                            : (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)'),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          {
                            color: isActive
                              ? '#FFFFFF'
                              : (isDark ? 'rgba(255, 255, 255, 0.70)' : colors.inkMuted),
                          },
                        ]}
                      >
                        {badgeCount}
                      </Text>
                    </View>
                  ) : tab.badge ? (
                    tab.badge
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  trackContainer: {
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 1.5,
    overflow: 'hidden',
    padding: 2.5,
    position: 'relative',
    height: 36,
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  activePillContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 0,
    borderRadius: 999,
    borderCurve: 'continuous',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 5,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  gradientBorder: {
    flex: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
    padding: 1,
    overflow: 'hidden',
  },
  innerGlass: {
    flex: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    position: 'relative',
  },
  specularTopSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  tabButton: {
    flex: 1,
    height: '100%',
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 1,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  tabLabel: {
    fontSize: 13,
    letterSpacing: -0.15,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    minWidth: 17,
    height: 16,
    paddingHorizontal: 4,
    marginLeft: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
});
