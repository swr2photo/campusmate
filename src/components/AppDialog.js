import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FullWindowOverlay } from 'react-native-screens';
import { BlurView } from 'expo-blur';
import FeatureIcon from './FeatureIcon';
import LiquidGlassView from './LiquidGlassView';
import { useTheme } from '../theme';

/**
 * CampusMate Apple Liquid Glass Dialog (System Alert & Confirm Modal).
 *
 * Implements Apple Liquid Glass design language:
 * - Crystal translucent frosted glass card with continuous curves (iOS HIG)
 * - Single luminous glass icon capsule (no heavy double bullseye rings)
 * - Unclipped typography with full support for Thai vowels and tone marks
 * - Refined Apple glass action buttons with specular reflections and haptic press states
 */

export const DIALOG_TONES = {
  info: { ios: 'info.circle.fill', android: 'information-circle' },
  success: { ios: 'checkmark.circle.fill', android: 'checkmark-circle' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  danger: { ios: 'exclamationmark.circle.fill', android: 'alert-circle' },
};

export const DIALOG_ICONS = {
  'shield-alert': { ios: 'exclamationmark.shield.fill', android: 'shield-alert' },
  megaphone: { ios: 'megaphone.fill', android: 'megaphone' },
};

function toneColors(colors, tone, icon) {
  if (icon === 'crown.fill') {
    return {
      accent: '#FF9500',
      soft: 'rgba(255, 149, 0, 0.15)',
      softBorder: 'rgba(255, 149, 0, 0.35)',
    };
  }
  switch (tone) {
    case 'success':
      return {
        accent: '#34C759',
        soft: 'rgba(52, 199, 89, 0.15)',
        softBorder: 'rgba(52, 199, 89, 0.35)',
      };
    case 'warning':
      return {
        accent: '#FF9500',
        soft: 'rgba(255, 149, 0, 0.15)',
        softBorder: 'rgba(255, 149, 0, 0.35)',
      };
    case 'danger':
      return {
        accent: '#FF3B30',
        soft: 'rgba(255, 59, 48, 0.15)',
        softBorder: 'rgba(255, 59, 48, 0.35)',
      };
    default:
      return {
        accent: colors.primary || '#007AFF',
        soft: 'rgba(0, 122, 255, 0.14)',
        softBorder: 'rgba(0, 122, 255, 0.3)',
      };
  }
}

function DialogIcon({ icon, tone, color, markColor, size }) {
  const resolved = (typeof icon === 'string' && DIALOG_ICONS[icon]) || icon || DIALOG_TONES[tone] || DIALOG_TONES.info;
  if (typeof resolved === 'string') {
    return <FeatureIcon color={color} name={resolved} size={size} />;
  }
  if (Platform.OS === 'ios') {
    return <FeatureIcon color={color} name={resolved.ios || resolved.android} size={size} />;
  }
  if (resolved.android === 'shield-alert') {
    return (
      <View style={{ alignItems: 'center', height: size, justifyContent: 'center', width: size }}>
        <Ionicons color={color} name="shield" size={size} />
        <Ionicons color={markColor} name="alert" size={Math.round(size * 0.52)} style={styles.shieldMark} />
      </View>
    );
  }
  return <Ionicons color={color} name={resolved.android || 'information-circle'} size={size} />;
}

function orderButtons(buttons) {
  const list = (buttons || []).filter(Boolean);
  if (list.length < 2) return list;
  const cancel = list.filter((b) => b.style === 'cancel');
  const rest = list.filter((b) => b.style !== 'cancel');
  // Two buttons: cancel on the left (iOS convention). Three or more: cancel at the bottom.
  return list.length === 2 ? [...cancel, ...rest] : [...rest, ...cancel];
}

function DialogButton({ button, colors, isDark, primary, stacked }) {
  const style = button.style || 'default';
  const isCancel = style === 'cancel';
  const isDestructive = style === 'destructive';

  let backgroundColor = colors.primary || '#007AFF';
  let textColor = '#FFFFFF';
  let borderColor = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.4)';
  let shadowStyle = styles.buttonPrimaryShadow;

  if (isDestructive) {
    backgroundColor = '#FF3B30';
    borderColor = 'rgba(255, 255, 255, 0.35)';
    textColor = '#FFFFFF';
    shadowStyle = styles.buttonDestructiveShadow;
  } else if (isCancel) {
    backgroundColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    borderColor = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.08)';
    textColor = colors.ink;
    shadowStyle = null;
  } else if (!primary) {
    backgroundColor = isDark ? 'rgba(0, 122, 255, 0.18)' : 'rgba(0, 122, 255, 0.1)';
    borderColor = isDark ? 'rgba(0, 122, 255, 0.35)' : 'rgba(0, 122, 255, 0.2)';
    textColor = colors.primary || '#007AFF';
    shadowStyle = null;
  }

  const disabled = Boolean(button.disabled || button.loading);
  return (
    <Pressable
      accessibilityLabel={button.text}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(button.loading), disabled }}
      android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false }}
      disabled={disabled}
      onPress={button.onPress}
      style={({ pressed }) => [
        styles.button,
        !stacked && styles.buttonFlex,
        { backgroundColor, borderColor },
        shadowStyle,
        pressed && styles.buttonPressed,
        button.disabled && !button.loading && styles.buttonDisabled,
      ]}
    >
      {button.loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text numberOfLines={1} style={[styles.buttonText, { color: textColor }]}>
          {button.text}
        </Text>
      )}
    </Pressable>
  );
}

export default function AppDialog({
  visible,
  title,
  message,
  tone = 'info',
  icon,
  buttons,
  onRequestClose,
  onBackdropPress,
  onExited,
  input,
  children,
}) {
  const { colors, isDark } = useTheme();
  const [mounted, setMounted] = useState(Boolean(visible));
  const progress = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const lastContent = useRef(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  // Keep the last content so the exit animation does not flash an empty card.
  if (visible) {
    lastContent.current = { buttons, children, icon, input, message, title, tone };
  }
  const content = visible ? lastContent.current : lastContent.current || {};

  useEffect(() => {
    let cancelled = false;
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      scale.setValue(0.92);
      Animated.parallel([
        Animated.timing(progress, {
          duration: 190,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          damping: 17,
          mass: 0.9,
          stiffness: 240,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(progress, {
          duration: 150,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          duration: 150,
          easing: Easing.in(Easing.quad),
          toValue: 0.96,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (cancelled) return;
        setMounted(false);
        onExitedRef.current?.();
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted && !visible) return null;

  const { accent, soft, softBorder } = toneColors(colors, content.tone, content.icon);
  const ordered = orderButtons(content.buttons);
  const stacked = ordered.length > 2;
  const lastPrimaryIndex = ordered.reduce(
    (found, b, index) => (b.style !== 'cancel' && b.style !== 'destructive' ? index : found),
    -1,
  );

  const isLongMessage = typeof content.message === 'string' && content.message.length > 220;

  const card = (
    <View style={styles.root}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { opacity: progress },
        ]}
      >
        <BlurView
          intensity={isDark ? 36 : 24}
          style={StyleSheet.absoluteFill}
          tint={isDark ? 'dark' : 'systemMaterial'}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(15, 23, 42, 0.24)' },
          ]}
        />
      </Animated.View>
      <Pressable
        accessibilityElementsHidden
        disabled={!onBackdropPress || !visible}
        importantForAccessibility="no"
        onPress={onBackdropPress}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        accessibilityViewIsModal
        accessibilityRole="alert"
        style={[
          styles.cardWrapper,
          {
            transform: [
              { scale },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            ],
          },
        ]}
      >
        <LiquidGlassView
          glassEffectStyle="regular"
          style={styles.cardGlass}
        >
          {/* Frosted Glass Icon Badge */}
          <View style={[styles.badgePill, { backgroundColor: soft, borderColor: softBorder }]}>
            <DialogIcon color={accent} markColor={accent} icon={content.icon} size={26} tone={content.tone} />
          </View>

          {content.title ? (
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
              {content.title}
            </Text>
          ) : null}

          {content.message ? (
            isLongMessage ? (
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.messageContent}
                showsVerticalScrollIndicator
                style={styles.messageScroll}
              >
                <Text style={[styles.message, { color: colors.inkMuted }]}>{content.message}</Text>
              </ScrollView>
            ) : (
              <View style={styles.messageStaticContainer}>
                <Text style={[styles.message, { color: colors.inkMuted }]}>{content.message}</Text>
              </View>
            )
          ) : null}

          {content.input ? (
            <TextInput
              autoFocus
              keyboardType={content.input.keyboardType || 'default'}
              onChangeText={content.input.onChangeText}
              onSubmitEditing={content.input.onSubmitEditing}
              placeholder={content.input.placeholder}
              placeholderTextColor={colors.inkSoft}
              secureTextEntry={Boolean(content.input.secureTextEntry)}
              selectionColor={colors.primary}
              style={[
                styles.input,
                {
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.65)',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.08)',
                  color: colors.ink,
                },
              ]}
              value={content.input.value}
            />
          ) : null}
          {content.children || null}
          {ordered.length ? (
            <View style={[styles.buttons, stacked ? styles.buttonsStacked : styles.buttonsRow]}>
              {ordered.map((button, index) => (
                <DialogButton
                  button={button}
                  colors={colors}
                  isDark={isDark}
                  key={`${button.text}-${index}`}
                  primary={index === lastPrimaryIndex}
                  stacked={stacked}
                />
              ))}
            </View>
          ) : null}
        </LiquidGlassView>
      </Animated.View>
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <FullWindowOverlay>
        <View style={StyleSheet.absoluteFill}>{card}</View>
      </FullWindowOverlay>
    );
  }

  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      onRequestClose={() => {
        if (visible) onRequestClose?.();
      }}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted || Boolean(visible)}
    >
      {card}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  cardWrapper: {
    alignItems: 'center',
    maxWidth: 320,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 30,
    elevation: 20,
  },
  cardGlass: {
    alignItems: 'center',
    borderRadius: 24,
    borderCurve: 'continuous',
    paddingBottom: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    width: '100%',
  },
  badgePill: {
    alignItems: 'center',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginBottom: 2,
    width: 52,
  },
  shieldMark: {
    position: 'absolute',
    top: '18%',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 24,
    marginTop: 12,
    textAlign: 'center',
  },
  messageStaticContainer: {
    alignSelf: 'stretch',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  messageScroll: {
    alignSelf: 'stretch',
    maxHeight: 180,
    marginTop: 6,
  },
  messageContent: {
    paddingHorizontal: 2,
  },
  message: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  input: {
    alignSelf: 'stretch',
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttons: {
    alignSelf: 'stretch',
    marginTop: 20,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonsStacked: {
    gap: 8,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonPrimaryShadow: {
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonDestructiveShadow: {
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.975 }],
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
});
