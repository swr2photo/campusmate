import { Pressable } from './NativePressable';
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

/**
 * LiquidGlassCompactToolbar
 * ─────────────────────────
 * Apple HIG-compliant compact collapsed toolbar designed with Apple Liquid Glass aesthetic.
 * Appears when scrolling down in the Activities/Meetup screen:
 * - Left: Compact search pill (shows current query or placeholder; tap to scroll up and expand).
 * - Middle: Subtle vertical glass hairline divider.
 * - Right: Quick actions (Map & Create Party) with native glass button feedback.
 */
export default function LiquidGlassCompactToolbar({
  query = '',
  placeholder = 'ค้นหากิจกรรมหรือสถานที่',
  onPressSearch,
  onClearSearch,
  onOpenMap,
  onCreateParty,
  spotCount,
  style,
}) {
  const { colors, isDark } = useTheme();

  const iconColor = isDark
    ? 'rgba(235, 235, 245, 0.75)'
    : 'rgba(60, 60, 67, 0.75)';

  const secondaryColor = isDark
    ? 'rgba(235, 235, 245, 0.55)'
    : 'rgba(60, 60, 67, 0.55)';

  // Authentic Prismatic Dispersion Rim Stops
  const rimColors = isDark
    ? ['rgba(255, 255, 255, 0.45)', 'rgba(140, 195, 255, 0.25)', 'rgba(220, 160, 255, 0.18)', 'rgba(255, 255, 255, 0.08)']
    : ['rgba(255, 255, 255, 0.95)', 'rgba(190, 225, 255, 0.45)', 'rgba(255, 215, 245, 0.35)', 'rgba(255, 255, 255, 0.20)'];

  const blurTint = isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight';

  const buttonBg = isDark
    ? 'rgba(255, 255, 255, 0.10)'
    : 'rgba(0, 0, 0, 0.05)';

  return (
    <View style={[styles.outerWrapper, style]}>
      {/* Outer Shadow Wrapper (Unclipped to preserve physical floating depth shadow on iOS) */}
      <View style={styles.shadowWrapper}>
        {/* Inner Glass Container with continuous curvature */}
        <View style={styles.glassContainer}>
          {/* Layer 1: Native Ultra-Thin Frosted Glass Material */}
          {Platform.OS === 'ios' ? (
            <BlurView
              intensity={85}
              tint={blurTint}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? 'rgba(32, 32, 36, 0.88)' : 'rgba(250, 250, 252, 0.88)' },
              ]}
            />
          )}

          {/* Layer 2: Crystal Glass Sheer Tint (Preserves true glass transparency) */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(255, 255, 255, 0.04)'
                  : 'rgba(255, 255, 255, 0.18)',
              },
            ]}
            pointerEvents="none"
          />

          {/* Layer 3: Prismatic Refraction Rim (1.2px continuous gradient border) */}
          <LinearGradient
            colors={rimColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.rimBorder]}
            pointerEvents="none"
          />

          {/* Layer 4: Specular Meniscus Highlight (Upper curvature glass volume) */}
          <LinearGradient
            colors={
              isDark
                ? ['rgba(255, 255, 255, 0.20)', 'rgba(255, 255, 255, 0.05)', 'transparent']
                : ['rgba(255, 255, 255, 0.65)', 'rgba(255, 255, 255, 0.18)', 'transparent']
            }
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.specularHighlight}
            pointerEvents="none"
          />

          {/* Layer 5: Inner Bottom Reflection Hairline */}
          <LinearGradient
            colors={
              isDark
                ? ['transparent', 'rgba(255, 255, 255, 0.12)', 'transparent']
                : ['transparent', 'rgba(255, 255, 255, 0.45)', 'transparent']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.bottomHairline}
            pointerEvents="none"
          />

          {/* Layer 6: Toolbar Interactive Controls */}
          <View style={styles.controlsRow}>
            {/* Search Pill (Tap to scroll up & focus search) */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ค้นหาหรือเลื่อนกลับไปด้านบน"
              onPress={onPressSearch}
              style={({ pressed }) => [
                styles.searchPill,
                pressed && styles.searchPillPressed,
              ]}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="magnifyingglass"
                  size={15}
                  tintColor={query ? colors.primary : iconColor}
                  style={styles.searchIcon}
                />
              ) : (
                <FeatureIcon
                  name="magnifyingglass"
                  size={15}
                  color={query ? colors.primary : iconColor}
                />
              )}

              <Text
                numberOfLines={1}
                style={[
                  styles.searchText,
                  { color: query ? (isDark ? '#FFFFFF' : '#1C1C1E') : secondaryColor },
                  query && styles.searchQueryActive,
                ]}
              >
                {query ? query : placeholder}
              </Text>

              {query ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ล้างคำค้นหา"
                  hitSlop={8}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onClearSearch?.();
                  }}
                  style={styles.clearMiniButton}
                >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name="xmark.circle.fill"
                  size={14}
                  tintColor={iconColor}
                />
              ) : (
                <FeatureIcon
                  name="xmark.circle.fill"
                  size={14}
                  color={iconColor}
                />
              )}
            </Pressable>
          ) : null}
        </Pressable>

        {/* Vertical Glass Hairline Divider */}
        <View
          style={[
            styles.divider,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)' },
          ]}
        />

        {/* Quick Action 1: Map Modal */}
        {onOpenMap ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="เปิดแผนที่วิทยาเขต"
            hitSlop={6}
            onPress={onOpenMap}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: buttonBg },
              pressed && styles.actionButtonPressed,
            ]}
          >
            {Platform.OS === 'ios' ? (
              <SymbolView
                name="map.fill"
                size={16}
                tintColor={colors.primary}
              />
            ) : (
              <FeatureIcon
                name="map.fill"
                size={16}
                color={colors.primary}
              />
            )}
          </Pressable>
        ) : null}

        {/* Quick Action 2: Create Party Modal */}
        {onCreateParty ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="สร้างตี้กิจกรรมใหม่"
            hitSlop={6}
            onPress={onCreateParty}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: isDark
                  ? 'rgba(255, 91, 107, 0.22)'
                  : 'rgba(255, 91, 107, 0.14)',
              },
              pressed && styles.actionButtonPressed,
            ]}
          >
            {Platform.OS === 'ios' ? (
              <SymbolView
                name="plus"
                size={16}
                tintColor="#FF5B6B"
              />
            ) : (
              <FeatureIcon
                name="plus"
                size={16}
                color="#FF5B6B"
              />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  </View>
</View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    width: '100%',
  },
  shadowWrapper: {
    width: '100%',
    height: 44,
    borderRadius: 999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  glassContainer: {
    flex: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
    position: 'relative',
  },
  rimBorder: {
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: 'transparent',
  },
  specularHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 22,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  bottomHairline: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 1,
  },
  controlsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 8,
    gap: 8,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
  },
  searchPillPressed: {
    opacity: 0.65,
  },
  searchIcon: {
    width: 15,
    height: 15,
  },
  searchText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
  },
  searchQueryActive: {
    fontWeight: '600',
  },
  clearMiniButton: {
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 22,
    borderRadius: 0.5,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.94 }],
  },
});
