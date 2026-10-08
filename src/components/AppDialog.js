import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FullWindowOverlay } from 'react-native-screens';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

/**
 * CampusMate in-app dialog (replaces the native system AlertDialog).
 *
 * Presentational only: the imperative queue lives in src/utils/appAlert.js and is
 * rendered by AppAlertHost; ConfirmContext and AppAlert reuse this same visual.
 *
 * Android renders inside a transparent Modal (its own window, so it stacks above
 * any Modal already open). iOS renders inside react-native-screens'
 * FullWindowOverlay so it also appears above presented modals (a second RN Modal
 * presented from the root view controller would fail while another is open).
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

function toneColors(colors, tone) {
  switch (tone) {
    case 'success':
      return { accent: colors.green, soft: colors.greenSoft };
    case 'warning':
      return { accent: colors.amber, soft: colors.amberSoft };
    case 'danger':
      return { accent: colors.danger, soft: colors.dangerSoft };
    default:
      return { accent: colors.primary, soft: colors.primarySoft };
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
  let backgroundColor = isDark ? colors.primaryDark : colors.primary;
  let textColor = colors.onPrimary;
  let borderColor = 'transparent';
  if (isDestructive) {
    backgroundColor = isDark ? '#E5534B' : colors.danger;
  } else if (isCancel) {
    backgroundColor = isDark ? colors.surfaceRaised : '#F1F5FA';
    borderColor = colors.line;
    textColor = colors.ink;
  } else if (!primary) {
    backgroundColor = colors.primarySoft;
    textColor = colors.primary;
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
        isCancel && styles.buttonOutline,
        pressed && styles.buttonPressed,
        button.disabled && !button.loading && styles.buttonDisabled,
      ]}
    >
      {button.loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text numberOfLines={2} style={[styles.buttonText, { color: textColor }]}>
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
          damping: 16,
          mass: 0.9,
          stiffness: 220,
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

  const { accent, soft } = toneColors(colors, content.tone);
  const ordered = orderButtons(content.buttons);
  const stacked = ordered.length > 2;
  const lastPrimaryIndex = ordered.reduce(
    (found, b, index) => (b.style !== 'cancel' && b.style !== 'destructive' ? index : found),
    -1,
  );

  const card = (
    <View style={styles.root}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.62)' : 'rgba(12, 22, 40, 0.5)', opacity: progress },
        ]}
      />
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
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: isDark ? colors.line : 'rgba(16, 32, 58, 0.06)',
            opacity: progress,
            transform: [
              { scale },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.badgeRing, { backgroundColor: soft }]}>
          <View style={[styles.badge, { backgroundColor: accent }]}>
            <DialogIcon color={isDark ? '#0B1424' : '#FFFFFF'} markColor={accent} icon={content.icon} size={28} tone={content.tone} />
          </View>
        </View>
        {content.title ? (
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {content.title}
          </Text>
        ) : null}
        {content.message ? (
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.messageContent}
            showsVerticalScrollIndicator={false}
            style={styles.messageScroll}
          >
            <Text style={[styles.message, { color: colors.inkMuted }]}>{content.message}</Text>
          </ScrollView>
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
              { backgroundColor: isDark ? colors.surfaceRaised : '#F4F8FC', borderColor: colors.line, color: colors.ink },
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
    paddingHorizontal: 28,
  },
  card: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 24,
    maxHeight: '86%',
    maxWidth: 380,
    overflow: 'hidden',
    paddingBottom: 20,
    paddingHorizontal: 22,
    paddingTop: 26,
    shadowColor: '#0B1424',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 32,
    width: '100%',
  },
  badgeRing: {
    alignItems: 'center',
    borderRadius: 38,
    height: 76,
    justifyContent: 'center',
    marginBottom: 14,
    width: 76,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  shieldMark: {
    position: 'absolute',
    top: '18%',
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
    lineHeight: 28,
    textAlign: 'center',
  },
  messageScroll: {
    alignSelf: 'stretch',
    flexGrow: 0,
    marginTop: 6,
  },
  messageContent: {
    paddingHorizontal: 2,
  },
  message: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
  },
  input: {
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttons: {
    alignSelf: 'stretch',
    marginTop: 22,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonsStacked: {
    gap: 10,
  },
  button: {
    alignItems: 'center',
    borderRadius: 16,
    borderCurve: 'continuous',
    justifyContent: 'center',
    minHeight: 50,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonOutline: {
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    textAlign: 'center',
  },
});
