import Text from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import FeatureIcon from './FeatureIcon';

let currentBannerListener = null;
let bannerQueue = [];
let nextBannerId = 1;

/**
 * Imperative trigger for Instagram-style top dropdown notification banner.
 * Supports rich options or status shorthand:
 *   showInAppNotification({ title, message, tone: 'success', ... })
 *   showInAppNotification('บันทึกสำเร็จ', 'success')
 *   showInAppNotification('ข้อผิดพลาด', 'danger')
 */
export function showInAppNotification(options = {}, fallbackTone = 'info') {
  let opts = options;
  if (typeof options === 'string') {
    opts = { message: options, tone: fallbackTone };
  } else if (!options || typeof options !== 'object') {
    opts = { message: String(options ?? ''), tone: fallbackTone };
  }

  // Automatic tone inference if tone was not explicitly specified or is generic
  let tone = opts.tone;
  const rawText = String(opts.message || opts.title || '');
  if (!tone || tone === 'info' || tone === 'general') {
    if (/ไม่สำเร็จ|ไม่สามารถ|ผิดพลาด|ไม่ได้|ไม่ถูกต้อง|ถูกระงับ|ล้มเหลว|error|failed/i.test(rawText)) {
      tone = 'danger';
    } else if (/สำเร็จ|เรียบร้อย|แล้ว$|success|saved|copied/i.test(rawText)) {
      tone = 'success';
    } else if (/คำเตือน|ต้อง|กรุณา|เกินไป|สูงสุด|warning|ขาดการเชื่อมต่อ/i.test(rawText)) {
      tone = 'warning';
    } else if (!tone) {
      tone = opts.type === 'admin_announcement' ? 'info' : 'general';
    }
  }

  const isStatus = opts.type === 'status' || tone !== 'general';

  let defaultTitle = isStatus ? 'แจ้งเตือน' : 'CampusMate';
  let defaultIcon = 'bell.fill';

  if (opts.type === 'admin_announcement') {
    defaultTitle = 'ประกาศจาก CampusMate';
    defaultIcon = 'megaphone';
  } else if (tone === 'success') {
    defaultTitle = 'สำเร็จ';
    defaultIcon = 'checkmark.circle.fill';
  } else if (tone === 'danger' || tone === 'error') {
    defaultTitle = 'ข้อผิดพลาด';
    defaultIcon = 'exclamationmark.circle.fill';
  } else if (tone === 'warning') {
    defaultTitle = 'แจ้งเตือน';
    defaultIcon = 'exclamationmark.triangle.fill';
  } else if (tone === 'info') {
    defaultTitle = 'แจ้งเตือน';
    defaultIcon = 'info.circle.fill';
  } else if (opts.type === 'like' || opts.type === 'match') {
    defaultTitle = opts.type === 'match' ? "It's a Match!" : 'มีคนถูกใจคุณ';
    defaultIcon = 'heart.fill';
  }

  let finalTitle = opts.title;
  let finalMessage = opts.message != null ? String(opts.message) : '';

  // If title was not provided, but message is concise (<= 42 chars) and it's a status notification,
  // promote message to title so it renders as a sleek, single-line status banner.
  if (!finalTitle) {
    if (isStatus && finalMessage.length <= 42 && !finalMessage.includes('\n')) {
      finalTitle = finalMessage;
      finalMessage = '';
    } else {
      finalTitle = defaultTitle;
    }
  }

  const item = {
    id: nextBannerId++,
    title: finalTitle,
    message: finalMessage,
    avatarUri: opts.avatarUri || null,
    icon: opts.icon || defaultIcon,
    tone,
    type: opts.type || (isStatus ? 'status' : 'general'),
    showTimestamp: typeof opts.showTimestamp === 'boolean' ? opts.showTimestamp : !isStatus,
    data: opts.data || null,
    onPress: typeof opts.onPress === 'function' ? opts.onPress : null,
    duration:
      typeof opts.duration === 'number'
        ? opts.duration
        : tone === 'success' || tone === 'info'
        ? 3400
        : 4500,
  };

  if (currentBannerListener) {
    currentBannerListener(item);
  } else {
    bannerQueue.push(item);
  }
}

export function hideInAppNotification() {
  if (currentBannerListener) {
    currentBannerListener(null);
  }
}

import LiquidGlassView from './LiquidGlassView';

export default function InAppNotificationHost() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [current, setCurrent] = useState(null);

  const translateY = useRef(new Animated.Value(-160)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const dismissTimer = useRef(null);
  const isDismissing = useRef(false);

  const dismiss = useCallback(
    (callback) => {
      if (isDismissing.current) return;
      isDismissing.current = true;
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }

      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -160,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.92,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrent(null);
        isDismissing.current = false;
        if (typeof callback === 'function') callback();
        if (bannerQueue.length > 0) {
          const next = bannerQueue.shift();
          setTimeout(() => displayBanner(next), 120);
        }
      });
    },
    [scale, translateY]
  );

  const displayBanner = useCallback(
    (bannerItem) => {
      if (!bannerItem) {
        dismiss();
        return;
      }
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      isDismissing.current = false;
      setCurrent(bannerItem);

      translateY.setValue(-160);
      scale.setValue(0.92);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();

      const duration = bannerItem.duration || 4500;
      dismissTimer.current = setTimeout(() => {
        dismiss();
      }, duration);
    },
    [dismiss, scale, translateY]
  );

  useEffect(() => {
    currentBannerListener = (item) => {
      displayBanner(item);
    };

    if (bannerQueue.length > 0) {
      const initial = bannerQueue.shift();
      displayBanner(initial);
    }

    return () => {
      currentBannerListener = null;
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [displayBanner]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy < 0) {
          translateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy < -18 || gesture.vy < -0.4) {
          dismiss();
        } else if (Math.abs(gesture.dy) < 6 && Math.abs(gesture.dx) < 6) {
          const banner = current;
          dismiss(() => {
            if (banner?.onPress) banner.onPress(banner.data);
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            friction: 7,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!current) return null;

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 14 : 20);

  const getBadgeStyle = (item) => {
    if (item.tone === 'success') {
      return {
        bg: isDark ? 'rgba(24, 168, 120, 0.22)' : 'rgba(24, 168, 120, 0.14)',
        borderColor: isDark ? 'rgba(24, 168, 120, 0.45)' : 'rgba(24, 168, 120, 0.3)',
        iconColor: colors.green || '#18A878',
      };
    }
    if (item.tone === 'danger' || item.tone === 'error') {
      return {
        bg: isDark ? 'rgba(214, 84, 84, 0.24)' : 'rgba(214, 84, 84, 0.14)',
        borderColor: isDark ? 'rgba(214, 84, 84, 0.45)' : 'rgba(214, 84, 84, 0.3)',
        iconColor: colors.danger || '#D65454',
      };
    }
    if (item.tone === 'warning') {
      return {
        bg: isDark ? 'rgba(216, 144, 27, 0.24)' : 'rgba(216, 144, 27, 0.15)',
        borderColor: isDark ? 'rgba(216, 144, 27, 0.45)' : 'rgba(216, 144, 27, 0.3)',
        iconColor: colors.amber || '#D8901B',
      };
    }
    if (item.tone === 'info') {
      return {
        bg: isDark ? 'rgba(40, 105, 199, 0.24)' : 'rgba(40, 105, 199, 0.14)',
        borderColor: isDark ? 'rgba(40, 105, 199, 0.45)' : 'rgba(40, 105, 199, 0.3)',
        iconColor: colors.blue || '#2869C7',
      };
    }
    if (item.type === 'like' || item.type === 'match') {
      return {
        bg: isDark ? 'rgba(244, 124, 107, 0.25)' : 'rgba(244, 124, 107, 0.15)',
        borderColor: isDark ? 'rgba(244, 124, 107, 0.45)' : 'rgba(244, 124, 107, 0.3)',
        iconColor: colors.coral || '#F47C6B',
      };
    }
    if (item.type === 'admin_announcement') {
      return {
        bg: isDark ? 'rgba(40, 105, 199, 0.24)' : 'rgba(40, 105, 199, 0.14)',
        borderColor: isDark ? 'rgba(40, 105, 199, 0.45)' : 'rgba(40, 105, 199, 0.3)',
        iconColor: colors.primary || '#2869C7',
      };
    }
    return {
      bg: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
      borderColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)',
      iconColor: colors.primary || '#2869C7',
    };
  };

  const badgeStyle = getBadgeStyle(current);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlayContainer, { top: topInset + 6 }]}
    >
      <Animated.View
        style={[
          styles.bannerAnimatedWrapper,
          {
            transform: [{ translateY }, { scale }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <LiquidGlassView
          glassEffectStyle="regular"
          style={styles.bannerGlass}
        >
          {/* Specular highlight rim at top */}
          <View
            pointerEvents="none"
            style={[
              styles.specularTopLine,
              {
                backgroundColor: isDark
                  ? 'rgba(255, 255, 255, 0.25)'
                  : 'rgba(255, 255, 255, 0.85)',
              },
            ]}
          />

          <View style={styles.contentRow}>
            {/* Avatar / Glass Icon Badge */}
            <View style={styles.avatarContainer}>
              {current.avatarUri ? (
                <Image
                  source={{ uri: current.avatarUri }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[
                    styles.iconBadge,
                    {
                      backgroundColor: badgeStyle.bg,
                      borderColor: badgeStyle.borderColor,
                    },
                  ]}
                >
                  <FeatureIcon
                    name={current.icon || 'bell.fill'}
                    size={20}
                    color={badgeStyle.iconColor}
                  />
                </View>
              )}
            </View>

            {/* Text Content */}
            <View style={styles.textContainer}>
              <View style={[styles.headerLine, !current.message && styles.headerLineSingle]}>
                <Text
                  style={[
                    styles.title,
                    { color: colors.ink || '#25272B' },
                    !current.message && styles.titleSingleLine,
                  ]}
                  numberOfLines={!current.message ? 2 : 1}
                >
                  {current.title}
                </Text>
                {current.showTimestamp && (
                  <>
                    <View style={styles.dotSeparator} />
                    <Text style={styles.timeLabel}>ตอนนี้</Text>
                  </>
                )}
              </View>
              {Boolean(current.message) && (
                <Text
                  style={[styles.message, { color: colors.inkMuted || '#6B7078' }]}
                  numberOfLines={2}
                >
                  {current.message}
                </Text>
              )}
            </View>
          </View>
        </LiquidGlassView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 99999,
    elevation: 99999,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  bannerAnimatedWrapper: {
    width: '100%',
    maxWidth: 440,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 14,
  },
  bannerGlass: {
    width: '100%',
    borderRadius: 24,
    borderCurve: 'continuous',
    paddingVertical: 11,
    paddingHorizontal: 15,
  },
  specularTopLine: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    borderRadius: 0.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: 11,
    flexShrink: 0,
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E2E8F0',
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerLineSingle: {
    marginBottom: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  titleSingleLine: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#94A3B8',
    marginHorizontal: 5,
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
});
