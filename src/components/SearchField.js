import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  Text,
  Keyboard,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInRight,
  FadeOutRight,
  useAnimatedStyle,
  withSpring,
  useSharedValue,
} from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

/**
 * LiquidGlassSearchField
 * ─────────────────────
 * Authentic Apple Liquid Glass Search Field:
 * 1. Native iOS Ultra-Thin Material (systemUltraThinMaterial).
 * 2. Unclipped physical glass ambient drop shadow.
 * 3. Prismatic refraction rim with chromatic edge dispersion.
 * 4. Specular meniscus curvature across top half for physical glass thickness.
 * 5. High-translucency glass core (no heavy opaque milk wash).
 */
const SearchField = forwardRef(function SearchField({
  value = '',
  onChangeText,
  placeholder = 'ค้นหาสถานที่หรือกิจกรรม',
  onClear,
  style,
  autoCapitalize = 'none',
  showCancelButton = true,
}, ref) {
  const { colors, isDark } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => {
      onChangeText?.('');
      onClear?.();
    },
  }));

  const focusScale = useSharedValue(1);

  const handleClear = () => {
    onChangeText?.('');
    onClear?.();
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setIsFocused(false);
    focusScale.value = withSpring(1, { damping: 20, stiffness: 250 });
    onChangeText?.('');
    onClear?.();
  };

  const handleFocus = () => {
    setIsFocused(true);
    focusScale.value = withSpring(1.015, { damping: 18, stiffness: 280 });
  };

  const handleBlur = () => {
    setIsFocused(false);
    focusScale.value = withSpring(1, { damping: 20, stiffness: 250 });
  };

  const animatedFieldStyle = useAnimatedStyle(() => ({
    transform: [{ scale: focusScale.value }],
  }));

  const iconColor = isDark
    ? 'rgba(235, 235, 245, 0.70)'
    : 'rgba(60, 60, 67, 0.70)';

  // Authentic Prismatic Liquid Glass Refraction Stops
  const rimColors = isDark
    ? (isFocused
        ? ['rgba(10, 132, 255, 0.85)', 'rgba(165, 215, 255, 0.45)', 'rgba(230, 160, 255, 0.35)', 'rgba(255, 255, 255, 0.15)']
        : ['rgba(255, 255, 255, 0.45)', 'rgba(140, 195, 255, 0.25)', 'rgba(220, 160, 255, 0.18)', 'rgba(255, 255, 255, 0.08)'])
    : (isFocused
        ? ['rgba(0, 122, 255, 0.75)', 'rgba(120, 190, 255, 0.60)', 'rgba(255, 180, 230, 0.40)', 'rgba(255, 255, 255, 0.35)']
        : ['rgba(255, 255, 255, 0.95)', 'rgba(190, 225, 255, 0.45)', 'rgba(255, 215, 245, 0.35)', 'rgba(255, 255, 255, 0.20)']);

  const blurTint = isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight';

  return (
    <View style={[styles.outerWrapper, style]}>
      {/* Outer Shadow Wrapper (Unclipped to preserve physical depth shadow on iOS) */}
      <Animated.View style={[styles.shadowWrapper, animatedFieldStyle]}>
        {/* Inner Glass Container with continuous curvature */}
        <View style={styles.glassContainer}>
          {/* Layer 1: Native Ultra-Thin Frosted Glass */}
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
                { backgroundColor: isDark ? 'rgba(32, 32, 36, 0.85)' : 'rgba(250, 250, 252, 0.85)' },
              ]}
            />
          )}

          {/* Layer 2: Crystal Glass Sheer Tint (Ultra-subtle, keeps transparency) */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(255, 255, 255, 0.04)'
                  : 'rgba(255, 255, 255, 0.22)',
              },
            ]}
            pointerEvents="none"
          />

          {/* Layer 3: Prismatic Refraction Rim (1.5px continuous gradient border) */}
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
                ? ['rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.05)', 'transparent']
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
                ? ['transparent', 'rgba(255, 255, 255, 0.08)']
                : ['transparent', 'rgba(255, 255, 255, 0.35)']
            }
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.bottomHairline}
            pointerEvents="none"
          />

          {/* Layer 6: Search Field Interactive Content */}
          <View style={styles.contentRow}>
            {Platform.OS === 'ios' ? (
              <SymbolView
                name="magnifyingglass"
                size={16}
                tintColor={isFocused ? colors.primary : iconColor}
                style={styles.leadingIcon}
              />
            ) : (
              <FeatureIcon
                name="magnifyingglass"
                size={16}
                color={isFocused ? colors.primary : iconColor}
              />
            )}

            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={iconColor}
              autoCapitalize={autoCapitalize}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
              onFocus={handleFocus}
              onBlur={handleBlur}
              style={[
                styles.input,
                { color: isDark ? '#FFFFFF' : '#000000' },
              ]}
            />

            {value?.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="ล้างคำค้นหา"
                hitSlop={8}
                onPress={handleClear}
                style={styles.clearButton}
              >
                {Platform.OS === 'ios' ? (
                  <SymbolView
                    name="xmark.circle.fill"
                    size={16}
                    tintColor={iconColor}
                  />
                ) : (
                  <FeatureIcon
                    name="xmark.circle.fill"
                    size={16}
                    color={iconColor}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>

      {/* Cancel Button with Apple Spring Animation */}
      {showCancelButton && isFocused ? (
        <Animated.View
          entering={FadeInRight.duration(180)}
          exit={FadeOutRight.duration(140)}
          style={styles.cancelWrapper}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ยกเลิกการค้นหา"
            hitSlop={6}
            onPress={handleCancel}
            style={styles.cancelButton}
          >
            <Text style={[styles.cancelText, { color: colors.primary }]}>
              ยกเลิก
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  outerWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  shadowWrapper: {
    flex: 1,
    height: 44,
    borderRadius: 14,
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
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    position: 'relative',
  },
  rimBorder: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  specularHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 22,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  bottomHairline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 9,
  },
  leadingIcon: {
    width: 16,
    height: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
  },
  clearButton: {
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelWrapper: {
    justifyContent: 'center',
  },
  cancelButton: {
    paddingLeft: 12,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
});

export default SearchField;
