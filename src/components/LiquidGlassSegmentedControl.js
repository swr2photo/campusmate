import Text from './AppText';
import React from 'react';
import Animated, { useAnimatedStyle, withSpring, useSharedValue, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import LiquidGlassView from './LiquidGlassView';
import { useTheme } from '../theme';

/**
 * LiquidGlassSegmentedControl
 * ──────────────────────────
 * Apple Liquid Glass segmented switcher for iOS & Expo.
 * Features:
 * - Frosted glass outer track with specular rim lighting.
 * - Elevated luminous active pill with subtle drop shadow and glass sheen.
 * - Icon and label support for crisp, intuitive navigation.
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
  
  const activeIndex = tabs.findIndex(t => t.id === activeTab);
  const activeIndexShared = useSharedValue(activeIndex);
  
  React.useEffect(() => {
    activeIndexShared.value = activeIndex;
  }, [activeIndex]);

  const onChangeTabByIndex = React.useCallback((index) => {
    if (tabs[index]) {
      onChangeTab?.(tabs[index].id);
    }
  }, [tabs, onChangeTab]);

  useAnimatedReaction(
    () => {
      return { width: tabWidth.value, index: activeIndexShared.value, drag: isDragging.value };
    },
    (state, prevState) => {
      if (state.width > 0 && !state.drag) {
        if (!prevState || state.width !== prevState.width || state.index !== prevState.index || state.drag !== prevState.drag) {
          translateX.value = withSpring(state.index * (state.width + 3), { damping: 30, stiffness: 400 });
        }
      }
    }
  );

  const tabsLength = tabs.length;
  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onBegin(() => {
      isDragging.value = true;
    })
    .onUpdate((e) => {
      const maxTranslate = (tabsLength - 1) * (tabWidth.value + 3);
      let nextTranslate = (activeIndexShared.value * (tabWidth.value + 3)) + e.translationX;
      nextTranslate = Math.max(0, Math.min(nextTranslate, maxTranslate));
      translateX.value = nextTranslate;
    })
    .onEnd((e) => {
      isDragging.value = false;
      const numTabs = tabsLength;
      const maxTranslate = (numTabs - 1) * (tabWidth.value + 3);
      let nextTranslate = (activeIndexShared.value * (tabWidth.value + 3)) + e.translationX + (e.velocityX * 0.05);
      nextTranslate = Math.max(0, Math.min(nextTranslate, maxTranslate));
      
      let newIndex = Math.round(nextTranslate / (tabWidth.value + 3));
      newIndex = Math.max(0, Math.min(newIndex, numTabs - 1));
      
      if (newIndex !== activeIndexShared.value) {
        // We cannot access the full `tabs` array in the worklet because it contains React elements (tab.badge).
        // Instead, we pass the newIndex back to JS and let JS resolve the tab ID.
        runOnJS(onChangeTabByIndex)(newIndex);
      } else {
        translateX.value = withSpring(activeIndexShared.value * (tabWidth.value + 3), { damping: 30, stiffness: 400 });
      }
    });

  const animatedPillStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
      width: tabWidth.value,
    };
  });

  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  return (
    <LiquidGlassView
      borderRadius={22}
      borderWidth={StyleSheet.hairlineWidth}
      contentStyle={styles.glassContent}
      glassEffectStyle="regular"
      specular
      style={[styles.container, style]}
    >
      <GestureDetector gesture={panGesture}>
      <View style={styles.tabsRow}>
        <Animated.View style={[styles.tabButton, styles.tabButtonActive, isDark ? styles.tabButtonActiveDark : styles.tabButtonActiveLight, styles.animatedPill, animatedPillStyle]} />
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable onLayout={(e) => { tabWidth.value = e.nativeEvent.layout.width; }}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              key={tab.id}
              onPress={() => onChangeTab?.(tab.id)}
              style={({ pressed }) => [
                styles.tabButton,
                
                pressed && styles.tabButtonPressed,
              ]}
            >
              <View style={styles.tabContent}>
                {tab.icon ? (
                  <FeatureIcon
                    color={isActive ? colors.primary : colors.inkSoft}
                    name={tab.icon}
                    size={15}
                  />
                ) : null}
                <Text
                  numberOfLines={1}
                  style={[
                    styles.tabLabel,
                    { color: isActive ? (isDark ? '#FFFFFF' : colors.primary) : colors.inkMuted },
                    isActive && styles.tabLabelActive,
                  ]}
                >
                  {tab.label}
                </Text>
                {tab.badge ? tab.badge : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      </GestureDetector>
    </LiquidGlassView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 22,
    borderCurve: 'continuous',
    padding: 3,
  },
  glassContent: {
    width: '100%',
    alignItems: 'stretch',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 3,
  },
  tabButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 18,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  animatedPill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 0,
  },
  tabButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  tabButtonActive: {
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 3,
  },
  tabButtonActiveLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: 'rgba(255, 255, 255, 0.85)',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
  },
  tabButtonActiveDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
