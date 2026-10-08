import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import ReplyPreview from './ReplyPreviewNative';
import { ChatVideoCover } from './ChatVideoBubble';
import ChatProtectedImageBubble from './ChatProtectedImageBubble';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { getDecryptedMediaUri, getSyncCachedMediaUri } from '../services/chatMediaService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, {
  Easing as ReanimatedEasing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { project, rubberband } from '../utils/motion';
import { scheduleIdleTask } from '../utils/scheduleIdleTask';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import FeatureIcon from './FeatureIcon';
import { EMOJI_CATEGORIES } from '../data/iosEmojiCategories';
import { useRemoteImage } from '../utils/useRemoteImage';
import { useTheme } from '../theme';
import DecryptedChatImage from './DecryptedChatImage';
import VoiceMessageBubble from './VoiceMessageBubble';
import StackedImageCards from './StackedImageCards';
import CallMessageBubble from './CallMessageBubble';
import {
  copyImageToClipboard,
  getChatImageBubbleSize,
  getCachedAspectRatio,
  measureImageAspectRatio,
  cacheAspectRatio,
  saveImageToGallery,
} from '../utils/chatImageUtils';
import {
  DEFAULT_QUICK_REACTIONS,
  DEFAULT_RECENT_EMOJIS,
  getDefaultMessageReaction,
  getQuickReactionsSync,
  getRecentEmojisSync,
  loadCustomQuickReactions,
  loadRecentEmojis,
  saveCustomQuickReactions,
  recordReactionUsage,
  recordRecentEmoji,
  getTopFrequentReactions,
  resetCustomQuickReactions,
  subscribeQuickReactions,
  subscribeRecentEmojis,
  useQuickReactions,
  useDefaultMessageReaction,
} from '../utils/messageReactions';
import { showAlert } from '../utils/appAlert';
import { showInAppNotification } from './InAppNotificationBanner';

export const QUICK_REACTIONS = DEFAULT_QUICK_REACTIONS;
export const DEFAULT_MESSAGE_REACTION = DEFAULT_QUICK_REACTIONS[0];
export { getDefaultMessageReaction, useQuickReactions, useDefaultMessageReaction };

function toDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp?.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp?.seconds === 'number') return new Date(timestamp.seconds * 1000);
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(item) {
  const date = toDate(item?.createdAt || item?.time);
  if (!date || isNaN(date.getTime())) return '';
  const thaiMillis = date.getTime() + 7 * 60 * 60 * 1000;
  const thaiDate = new Date(thaiMillis);
  const hours = String(thaiDate.getUTCHours()).padStart(2, '0');
  const minutes = String(thaiDate.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function MenuRow({ destructive = false, icon, isDark = false, label, onPress, trailing }) {
  const iconColor = destructive ? '#FF5A5F' : (isDark ? '#FFFFFF' : '#25272B');
  const trailingColor = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(16,32,58,0.38)';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && (isDark ? styles.menuRowPressedDark : styles.menuRowPressedLight),
      ]}
    >
      <View style={styles.menuRowCopy}>
        <FeatureIcon color={iconColor} name={icon} size={18} />
        <Text
          numberOfLines={1}
          style={[
            styles.menuLabel,
            destructive ? styles.destructiveLabel : (isDark ? styles.menuLabelDark : styles.menuLabelLight),
          ]}
        >
          {label}
        </Text>
      </View>
      {trailing ? <FeatureIcon color={trailingColor} name="chevron.right" size={12} /> : null}
    </Pressable>
  );
}

function ForwardAvatar({ conversation, fallbackColor }) {
  const avatarUri = [conversation?.avatarUri, conversation?.photoURL, conversation?.avatarUrl]
    .find((value) => typeof value === 'string' && (
      value.startsWith('http://')
      || value.startsWith('https://')
      || value.startsWith('file://')
      || value.startsWith('data:image/')
    ));
  const cachedAvatarUri = useRemoteImage(
    avatarUri || null,
    conversation?.participantProfiles?.[conversation?.profileId]?.avatarRevision,
    conversation?.profileId
  );
  // Render the remote URI immediately while the cache warms up, then switch
  // to the local cached file when it is ready.
  const imageUri = cachedAvatarUri || avatarUri;
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = conversation?.avatar || (conversation?.name || '?').slice(0, 1);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUri, cachedAvatarUri]);

  return (
    <View style={[styles.forwardAvatar, { backgroundColor: conversation?.avatarColor || fallbackColor }]}>
      {imageUri && !imageFailed ? (
        <Image
          accessibilityLabel={`รูปโปรไฟล์ ${conversation?.name || 'ผู้ใช้'}`}
          onError={() => setImageFailed(true)}
          source={{ uri: imageUri }}
          style={styles.forwardAvatarImage}
        />
      ) : (
        <Text style={styles.forwardAvatarText}>{fallback}</Text>
      )}
    </View>
  );
}

function GlassSurface({ children, intensity = 72, isDark = false, style }) {
  const surfaceStyle = [
    styles.glassSurface,
    isDark ? styles.glassSurfaceDark : styles.glassSurfaceLight,
    style,
  ];
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={intensity}
        tint={isDark ? 'dark' : 'light'}
        style={[...surfaceStyle, isDark ? styles.glassSurfaceIOSDark : styles.glassSurfaceIOSLight]}
      >
        {children}
      </BlurView>
    );
  }
  return (
    <View style={[...surfaceStyle, isDark ? styles.glassSurfaceFallbackDark : styles.glassSurfaceFallbackLight]}>
      {children}
    </View>
  );
}

const CATEGORY_BAR_ITEMS = [
  { id: 'recent', icon: '🕒', label: 'ล่าสุด' },
  { id: 'smileys_people', icon: '😀', label: 'หน้ายิ้มและผู้คน' },
  { id: 'animals', icon: '🐻', label: 'สัตว์และธรรมชาติ' },
  { id: 'food', icon: '🍴', label: 'อาหารและเครื่องดื่ม' },
  { id: 'activities', icon: '🏀', label: 'กิจกรรม' },
  { id: 'travel', icon: '🚗', label: 'การเดินทางและสถานที่' },
  { id: 'objects', icon: '💡', label: 'สิ่งของ' },
  { id: 'symbols', icon: '🔣', label: 'สัญลักษณ์' },
  { id: 'flags', icon: '🏳️', label: 'ธง' },
];

const EASE_OUT = ReanimatedEasing.bezier(0.23, 1, 0.32, 1);

function applySheetDrag(translateY, topFade, isCustomizingSV, sheetHeight, nextY) {
  'worklet';
  if (nextY >= 0) {
    translateY.set(nextY);
  } else {
    translateY.set(rubberband(nextY, sheetHeight));
  }
  if (isCustomizingSV.get()) {
    const dy = Math.max(0, translateY.get());
    topFade.set(Math.max(0, Math.min(1, 1 - (dy / (sheetHeight * 0.6)))));
  }
}

function settleOrDismissSheet(
  translateY,
  topFade,
  isCustomizingSV,
  isClosingSV,
  sheetHeight,
  dy,
  velocityY,
  completeClose,
  dx,
  dyHard,
  dySoft,
  vySoft,
  vyHard,
  tapDismiss
) {
  'worklet';
  const projected = dy + project(velocityY);
  const isTap = tapDismiss && Math.hypot(dx, dy) < 10;
  const shouldClose = isTap
    || dy > dyHard
    || (dy > dySoft && velocityY > vySoft)
    || velocityY > vyHard
    || projected > sheetHeight * 0.4;
  if (shouldClose) {
    if (isClosingSV.get()) return;
    isClosingSV.set(1);
    translateY.set(withSpring(sheetHeight, {
      duration: 300,
      dampingRatio: 1,
      velocity: velocityY,
      overshootClamping: true,
    }, (finished) => {
      if (finished) scheduleOnRN(completeClose);
    }));
    topFade.set(withTiming(0, { duration: 150, easing: EASE_OUT }));
    return;
  }
  translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: velocityY }));
  topFade.set(withTiming(isCustomizingSV.get() ? 1 : 0, { duration: 150, easing: EASE_OUT }));
}

const EmojiCell = React.memo(function EmojiCell({ emoji, onPress }) {
  const handlePress = useCallback(() => {
    onPress?.(emoji);
  }, [emoji, onPress]);

  return (
    <Pressable
      delayPressIn={0}
      hitSlop={3}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.emojiCellSix,
        pressed && styles.emojiCellPressed,
      ]}
    >
      <Text style={styles.emojiGlyphSix}>{emoji}</Text>
    </Pressable>
  );
});

function EmojiReactionPickerSheet({
  accent,
  initialEditingSlot = null,
  isDark = false,
  isOpen,
  onClose,
  onSelect,
  onUpdateQuickReactions,
  quickReactions = DEFAULT_QUICK_REACTIONS,
  selectedReaction,
}) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const bottomSafeInset = Math.max(insets.bottom || 0, Platform.OS === 'android' ? 28 : 16);
  const sheetHeight = Math.min(620, Math.max(470, screenHeight * 0.63 + bottomSafeInset));
  const translateY = useSharedValue(sheetHeight);
  const topFade = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const scrollYSV = useSharedValue(0);
  const isCustomizingSV = useSharedValue(0);
  const isClosingSV = useSharedValue(0);
  const sheetHeightSV = useSharedValue(sheetHeight);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const isClosing = useRef(false);

  const [isReady, setIsReady] = useState(false);
  const readyIdleTask = useRef(null);
  const [isCustomizing, setIsCustomizing] = useState(
    typeof initialEditingSlot === 'number' && initialEditingSlot >= 0
  );
  const [activeSlot, setActiveSlot] = useState(
    typeof initialEditingSlot === 'number' && initialEditingSlot >= 0 && initialEditingSlot < 6
      ? initialEditingSlot
      : 0
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('recent');
  const [recentEmojis, setRecentEmojis] = useState(() => getRecentEmojisSync());

  const scrollRef = useRef(null);
  const scrollOffsetY = useRef(0);
  const sectionOffsets = useRef({});
  const slotScaleAnims = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  useEffect(() => {
    loadRecentEmojis().then((loaded) => {
      if (Array.isArray(loaded) && loaded.length > 0) {
        setRecentEmojis((prev) => {
          if (prev && prev.length === loaded.length && prev.every((v, i) => v === loaded[i])) {
            return prev;
          }
          return loaded;
        });
      }
    });
    return subscribeRecentEmojis((updated) => {
      if (Array.isArray(updated) && updated.length > 0) {
        setRecentEmojis((prev) => {
          if (prev && prev.length === updated.length && prev.every((v, i) => v === updated[i])) {
            return prev;
          }
          return updated;
        });
      }
    });
  }, []);

  useEffect(() => {
    sheetHeightSV.set(sheetHeight);
  }, [sheetHeight, sheetHeightSV]);

  useEffect(() => {
    isCustomizingSV.set(isCustomizing ? 1 : 0);
  }, [isCustomizing, isCustomizingSV]);

  const cancelReadyIdleTask = useCallback(() => {
    readyIdleTask.current?.cancel?.();
    readyIdleTask.current = null;
  }, []);

  const markReady = useCallback(() => {
    cancelReadyIdleTask();
    readyIdleTask.current = scheduleIdleTask(() => {
      readyIdleTask.current = null;
      setIsReady(true);
    });
  }, [cancelReadyIdleTask]);

  const stopCustomizing = useCallback(() => {
    setIsCustomizing(false);
  }, []);

  const completeClose = useCallback(() => {
    onClose?.();
    setTimeout(() => {
      isClosing.current = false;
      isClosingSV.set(0);
    }, 50);
  }, [isClosingSV, onClose]);

  useEffect(() => {
    if (isOpen) {
      cancelReadyIdleTask();
      isClosing.current = false;
      isClosingSV.set(0);
      scrollOffsetY.current = 0;
      scrollYSV.set(0);
      setSearchQuery('');
      setActiveCategory('recent');
      setIsReady(false);
      const shouldCustomize = typeof initialEditingSlot === 'number' && initialEditingSlot >= 0;
      setIsCustomizing(shouldCustomize);
      isCustomizingSV.set(shouldCustomize ? 1 : 0);
      cancelAnimation(translateY);
      cancelAnimation(topFade);
      translateY.set(sheetHeight);
      topFade.set(shouldCustomize ? 1 : 0);
      translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }, (finished) => {
        if (finished) scheduleOnRN(markReady);
      }));
    } else {
      cancelReadyIdleTask();
      setIsReady(false);
      translateY.set(sheetHeight);
    }
  }, [cancelReadyIdleTask, initialEditingSlot, isClosingSV, isCustomizingSV, isOpen, markReady, scrollYSV, sheetHeight, topFade, translateY]);

  useEffect(() => () => cancelReadyIdleTask(), [cancelReadyIdleTask]);

  useEffect(() => {
    if (typeof initialEditingSlot === 'number' && initialEditingSlot >= 0 && initialEditingSlot < 6) {
      setActiveSlot(initialEditingSlot);
      setIsCustomizing(true);
    }
  }, [initialEditingSlot]);

  const handleStartCustomizing = useCallback(() => {
    setIsCustomizing(true);
    isCustomizingSV.set(1);
    setActiveSlot(0);
    topFade.set(0);
    topFade.set(withTiming(1, { duration: 220, easing: EASE_OUT }));
  }, [isCustomizingSV, topFade]);

  const handleFinishCustomizing = useCallback(() => {
    topFade.set(withTiming(0, { duration: 180, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(stopCustomizing);
    }));
  }, [stopCustomizing, topFade]);

  const handleClose = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    isClosingSV.set(1);
    translateY.set(withTiming(sheetHeight, { duration: 180, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(completeClose);
    }));
    topFade.set(withTiming(0, { duration: 150, easing: EASE_OUT }));
  }, [completeClose, isClosingSV, sheetHeight, topFade, translateY]);

  const sheetHandlePan = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      cancelAnimation(translateY);
      cancelAnimation(topFade);
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      applySheetDrag(translateY, topFade, isCustomizingSV, sheetHeightSV.get(), dragStart.get() + event.translationY);
    })
    .onEnd((event) => {
      settleOrDismissSheet(
        translateY, topFade, isCustomizingSV, isClosingSV, sheetHeightSV.get(),
        translateY.get(), event.velocityY, completeClose, event.translationX,
        30, 10, 150, 300, false
      );
    })
    .onFinalize((_event, success) => {
      if (!success && !isClosingSV.get()) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      }
    }), [completeClose, dragStart, isClosingSV, isCustomizingSV, sheetHeightSV, topFade, translateY]);

  const sheetHeaderPan = useMemo(() => Gesture.Pan()
    .activeOffsetY([10000, 6])
    .failOffsetX([-24, 24])
    .onStart(() => {
      cancelAnimation(translateY);
      cancelAnimation(topFade);
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      applySheetDrag(translateY, topFade, isCustomizingSV, sheetHeightSV.get(), dragStart.get() + event.translationY);
    })
    .onEnd((event) => {
      settleOrDismissSheet(
        translateY, topFade, isCustomizingSV, isClosingSV, sheetHeightSV.get(),
        translateY.get(), event.velocityY, completeClose, event.translationX,
        35, 10, 180, 320, false
      );
    })
    .onFinalize((_event, success) => {
      if (!success && !isClosingSV.get()) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      }
    }), [completeClose, dragStart, isClosingSV, isCustomizingSV, sheetHeightSV, topFade, translateY]);

  const sheetListPan = useMemo(() => Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchStartX.set(touch.absoluteX);
      touchStartY.set(touch.absoluteY);
    })
    .onTouchesMove((event, state) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dy = touch.absoluteY - touchStartY.get();
      const dx = touch.absoluteX - touchStartX.get();
      if (scrollYSV.get() > 1) {
        state.fail();
        return;
      }
      if (scrollYSV.get() <= 1 && dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        state.activate();
        return;
      }
      if (dy < -10 || (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy))) {
        state.fail();
      }
    })
    .onStart(() => {
      cancelAnimation(translateY);
      cancelAnimation(topFade);
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      applySheetDrag(translateY, topFade, isCustomizingSV, sheetHeightSV.get(), dragStart.get() + event.translationY);
    })
    .onEnd((event) => {
      settleOrDismissSheet(
        translateY, topFade, isCustomizingSV, isClosingSV, sheetHeightSV.get(),
        translateY.get(), event.velocityY, completeClose, event.translationX,
        45, 15, 200, 350, false
      );
    })
    .onFinalize((_event, success) => {
      if (!success && !isClosingSV.get() && translateY.get() !== 0) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      }
    }), [completeClose, dragStart, isClosingSV, isCustomizingSV, scrollYSV, sheetHeightSV, topFade, touchStartX, touchStartY, translateY]);

  const backdropPan = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      cancelAnimation(translateY);
      cancelAnimation(topFade);
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      applySheetDrag(translateY, topFade, isCustomizingSV, sheetHeightSV.get(), dragStart.get() + event.translationY);
    })
    .onEnd((event) => {
      settleOrDismissSheet(
        translateY, topFade, isCustomizingSV, isClosingSV, sheetHeightSV.get(),
        translateY.get(), event.velocityY, completeClose, event.translationX,
        25, 10, 150, 300, true
      );
    })
    .onFinalize((_event, success) => {
      if (!success && !isClosingSV.get()) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      }
    }), [completeClose, dragStart, isClosingSV, isCustomizingSV, sheetHeightSV, topFade, translateY]);

  const topAreaPan = useMemo(() => Gesture.Pan()
    .activeOffsetY([10000, 6])
    .failOffsetX([-24, 24])
    .onStart(() => {
      cancelAnimation(translateY);
      cancelAnimation(topFade);
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      applySheetDrag(translateY, topFade, isCustomizingSV, sheetHeightSV.get(), dragStart.get() + event.translationY);
    })
    .onEnd((event) => {
      settleOrDismissSheet(
        translateY, topFade, isCustomizingSV, isClosingSV, sheetHeightSV.get(),
        translateY.get(), event.velocityY, completeClose, event.translationX,
        35, 12, 220, 380, false
      );
    })
    .onFinalize((_event, success) => {
      if (!success && !isClosingSV.get()) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
      }
    }), [completeClose, dragStart, isClosingSV, isCustomizingSV, sheetHeightSV, topFade, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  const topAreaStyle = useAnimatedStyle(() => ({
    opacity: topFade.get(),
  }));

  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  const isCustomizingRef = useRef(isCustomizing);
  isCustomizingRef.current = isCustomizing;
  const quickReactionsRef = useRef(quickReactions);
  quickReactionsRef.current = quickReactions;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onUpdateQuickReactionsRef = useRef(onUpdateQuickReactions);
  onUpdateQuickReactionsRef.current = onUpdateQuickReactions;
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  const isResetting = useRef(false);

  const animateSlotPop = useCallback((slotIdx) => {
    if (slotIdx < 0 || slotIdx >= 6) return;
    const anim = slotScaleAnims[slotIdx];
    anim.setValue(0.72);
    Animated.spring(anim, {
      damping: 10,
      mass: 0.6,
      stiffness: 340,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [slotScaleAnims]);

  const handleResetDefaults = useCallback(() => {
    if (isResetting.current) return;
    isResetting.current = true;

    // 1. Instant optimistic UI update with zero delay
    onUpdateQuickReactionsRef.current?.([...DEFAULT_QUICK_REACTIONS]);
    setActiveSlot(0);

    // 2. Play beautiful staggered ripple wave spring animation across all 6 slots
    const animations = slotScaleAnims.map((anim, idx) =>
      Animated.sequence([
        Animated.delay(idx * 36),
        Animated.timing(anim, {
          duration: 90,
          easing: Easing.out(Easing.quad),
          toValue: 0.62,
          useNativeDriver: true,
        }),
        Animated.spring(anim, {
          damping: 9,
          mass: 0.65,
          stiffness: 320,
          toValue: 1,
          useNativeDriver: true,
        }),
      ])
    );

    Animated.parallel(animations).start(() => {
      isResetting.current = false;
    });

    // 3. Persist to storage in background without blocking main thread
    setTimeout(() => {
      void resetCustomQuickReactions();
    }, 0);
  }, [slotScaleAnims]);

  const handleEmojiPress = useCallback((emoji) => {
    if (!isCustomizingRef.current) {
      handleCloseRef.current();
      onSelectRef.current?.(emoji);
      setTimeout(() => {
        void recordReactionUsage(emoji);
      }, 0);
      return;
    }
    const currentSlot = activeSlotRef.current;
    const next = [...quickReactionsRef.current];
    next[currentSlot] = emoji;
    onUpdateQuickReactionsRef.current?.(next);
    setActiveSlot((prev) => (prev + 1) % 6);
    animateSlotPop(currentSlot);
    setTimeout(() => {
      void saveCustomQuickReactions(next);
      void recordReactionUsage(emoji);
    }, 0);
  }, [animateSlotPop]);

  const handleCategoryPress = (catId) => {
    if (!isReady) {
      setIsReady(true);
    }
    setActiveCategory(catId);
    const targetY = sectionOffsets.current[catId];
    if (typeof targetY === 'number' && scrollRef.current) {
      scrollRef.current.scrollTo({ y: Math.max(0, targetY - 4), animated: true });
    }
  };

  const handleScroll = (event) => {
    const scrollY = event.nativeEvent.contentOffset.y;
    scrollOffsetY.current = scrollY;
    scrollYSV.set(scrollY);
    if (scrollY < -30 && !isClosing.current) {
      handleClose();
      return;
    }
    for (let i = CATEGORY_BAR_ITEMS.length - 1; i >= 0; i--) {
      const item = CATEGORY_BAR_ITEMS[i];
      const offset = sectionOffsets.current[item.id];
      if (typeof offset === 'number' && scrollY >= offset - 35) {
        setActiveCategory(item.id);
        break;
      }
    }
  };

  // Compile full sections list: 'recent' + categories from EMOJI_CATEGORIES
  const allSections = useMemo(() => {
    const recentSection = {
      id: 'recent',
      label: 'ล่าสุด',
      icon: '🕒',
      emojis: recentEmojis && recentEmojis.length > 0 ? recentEmojis.slice(0, 24) : DEFAULT_RECENT_EMOJIS.slice(0, 24),
    };
    return [recentSection, ...EMOJI_CATEGORIES];
  }, [recentEmojis]);

  // Render initial sections on open, defer full list until slide-up finishes
  const visibleSections = useMemo(() => {
    if (!isOpen) {
      return [];
    }
    if (isReady || searchQuery.trim().length > 0) {
      return allSections;
    }
    const initialSmileys = {
      ...allSections[1],
      emojis: allSections[1]?.emojis?.slice(0, 24) || [],
    };
    return [allSections[0], initialSmileys];
  }, [allSections, isOpen, isReady, searchQuery]);

  // Filter emojis if search query is entered
  const filteredEmojis = useMemo(() => {
    if (!isOpen) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const matches = [];
    const seen = new Set();
    allSections.forEach((sec) => {
      const secMatches = sec.label.toLowerCase().includes(q);
      sec.emojis.forEach((em) => {
        if (!seen.has(em)) {
          if (secMatches || em.includes(q)) {
            seen.add(em);
            matches.push(em);
          }
        }
      });
    });
    return matches;
  }, [allSections, isOpen, searchQuery]);

  return (
    <View pointerEvents={isOpen ? "box-none" : "none"} style={StyleSheet.absoluteFill}>
      {/* Dismiss backdrop on tap or downward drag in upper half */}
      {isOpen ? (
        <GestureDetector gesture={backdropPan}>
          <View style={[StyleSheet.absoluteFill, { bottom: sheetHeight }]} />
        </GestureDetector>
      ) : null}

      {/* 1. Upper Area: Top Nav (รีเซ็ต | ปรับแต่งความรู้สึก | เรียบร้อย) + 6-slot Pill (shown in customize mode) */}
      {isCustomizing ? (
        <GestureDetector gesture={topAreaPan}>
          <Reanimated.View
            style={[
              styles.customizeTopArea,
              isDark ? styles.customizeTopAreaDark : styles.customizeTopAreaLight,
              {
                bottom: sheetHeight - 26,
                paddingTop: Math.max(insets.top + 6, Platform.OS === 'ios' ? 48 : 28),
              },
              topAreaStyle,
            ]}
          >
          {/* Top Header */}
          <View style={styles.customizeTopNav}>
            <Pressable
              delayPressIn={0}
              hitSlop={14}
              onPress={handleResetDefaults}
              style={({ pressed }) => [
                pressed && { opacity: 0.5, transform: [{ scale: 0.94 }] },
              ]}
            >
              <Text style={[styles.customizeNavBtnText, isDark ? styles.textDark : styles.textLight]}>
                รีเซ็ต
              </Text>
            </Pressable>
            <Text style={[styles.customizeNavTitle, isDark ? styles.textDark : styles.textLight]}>
              ปรับแต่งความรู้สึก
            </Text>
            <Pressable
              delayPressIn={0}
              hitSlop={14}
              onPress={handleFinishCustomizing}
              style={({ pressed }) => [
                pressed && { opacity: 0.5, transform: [{ scale: 0.94 }] },
              ]}
            >
              <Text style={[styles.customizeNavBtnText, styles.customizeNavDoneText, isDark ? styles.textDark : styles.textLight]}>
                เรียบร้อย
              </Text>
            </Pressable>
          </View>

          {/* 6-slot Capsule Pill with wave animation on reset and pop on tap */}
          <View style={styles.customizePillContainer}>
            <View
              style={[
                styles.customizePillCapsule,
                isDark ? styles.customizePillCapsuleDark : styles.customizePillCapsuleLight,
              ]}
            >
              {quickReactions.slice(0, 6).map((emoji, idx) => {
                const isSlotActive = activeSlot === idx;
                const slotScale = slotScaleAnims[idx] || 1;
                return (
                  <Pressable
                    key={`customize-slot-${idx}`}
                    delayPressIn={0}
                    hitSlop={4}
                    onPress={() => {
                      setActiveSlot(idx);
                      animateSlotPop(idx);
                    }}
                    style={({ pressed }) => [
                      styles.customizeSlotCircle,
                      isSlotActive && (isDark ? styles.customizeSlotActiveDark : styles.customizeSlotActiveLight),
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Animated.View style={{ transform: [{ scale: slotScale }] }}>
                      <Text style={styles.customizeSlotEmojiText}>{emoji}</Text>
                    </Animated.View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.customizeSubtitleText, isDark ? styles.customizeSubtitleDark : styles.customizeSubtitleLight]}>
              แตะที่ความรู้สึก แล้วเลือกอีโมจิมาแทนความรู้สึกนั้น
            </Text>
          </View>
        </Reanimated.View>
        </GestureDetector>
      ) : null}

      {/* 2. Bottom Sheet: Search, Sectioned Emoji ScrollView, Docked Category Bar */}
      <Reanimated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[
          styles.bottomSheetContainer,
          { height: sheetHeight },
          sheetStyle,
        ]}
      >
        <View
          style={[
            styles.bottomSheetSurface,
            isDark ? styles.bottomSheetSurfaceDark : styles.bottomSheetSurfaceLight,
          ]}
        >
          {/* Header Drag Area: Handle + Search bar */}
          <GestureDetector gesture={sheetHeaderPan}>
          <View style={styles.sheetHeaderArea}>
            {/* Swipe Drag Handle */}
            <GestureDetector gesture={sheetHandlePan}>
            <View
              hitSlop={{ top: 14, bottom: 14, left: 30, right: 30 }}
              style={styles.sheetHandleTouchArea}
            >
              <View style={[styles.sheetHandleBar, isDark ? styles.sheetHandleBarDark : styles.sheetHandleBarLight]} />
            </View>
            </GestureDetector>

            {/* Search Bar */}
            <View style={[styles.sheetSearchContainer, isDark ? styles.sheetSearchDark : styles.sheetSearchLight]}>
              <FeatureIcon color={isDark ? 'rgba(255,255,255,0.48)' : 'rgba(16,32,58,0.48)'} name="magnifyingglass" size={15} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setSearchQuery}
                placeholder="ค้นหาอีโมจิ"
                placeholderTextColor={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(16,32,58,0.4)'}
                style={[styles.sheetSearchInput, isDark ? styles.textDark : styles.textLight]}
                value={searchQuery}
              />
              {searchQuery ? (
                <Pressable hitSlop={8} onPress={() => setSearchQuery('')}>
                  <FeatureIcon color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(16,32,58,0.5)'} name="xmark.circle.fill" size={15} />
                </Pressable>
              ) : null}
            </View>
          </View>
          </GestureDetector>
          <View style={styles.sheetScrollWrapper}>
          <GestureDetector gesture={sheetListPan}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.sheetScrollContent}
              keyboardShouldPersistTaps="handled"
              onScroll={handleScroll}
              removeClippedSubviews
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
            >
              {filteredEmojis !== null ? (
                <View style={styles.sectionBlock}>
                  <Text style={[styles.sectionTitleText, isDark ? styles.textDark : styles.textLight]}>
                    {filteredEmojis.length > 0 ? 'ผลการค้นหา' : 'ไม่พบอิโมจิ'}
                  </Text>
                  <View style={styles.emojiGridSix}>
                    {filteredEmojis.map((emoji, idx) => (
                      <EmojiCell
                        key={`search-${emoji}-${idx}`}
                        emoji={emoji}
                        onPress={handleEmojiPress}
                      />
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  {/* ความรู้สึกของคุณ with ปรับแต่ง button (shown in normal mode when not customizing) */}
                  {!isCustomizing && (
                    <View style={styles.sectionBlock}>
                      <View style={styles.yourReactionsHeader}>
                        <Text style={[styles.sectionTitleText, isDark ? styles.textDark : styles.textLight, { marginBottom: 0, paddingHorizontal: 0 }]}>
                          ความรู้สึกของคุณ
                        </Text>
                        <Pressable hitSlop={12} onPress={handleStartCustomizing}>
                          <Text style={[styles.customizeLinkText, { color: accent || '#0A84FF' }]}>
                            ปรับแต่ง
                          </Text>
                        </Pressable>
                      </View>
                      <View style={styles.emojiGridSix}>
                        {quickReactions.slice(0, 6).map((emoji, idx) => (
                          <EmojiCell
                            key={`your-reactions-${emoji}-${idx}`}
                            emoji={emoji}
                            onPress={handleEmojiPress}
                          />
                        ))}
                      </View>
                    </View>
                  )}

                  {visibleSections.map((section) => (
                    <View
                      key={section.id}
                      onLayout={(e) => {
                        sectionOffsets.current[section.id] = e.nativeEvent.layout.y;
                      }}
                      style={styles.sectionBlock}
                    >
                      <Text style={[styles.sectionTitleText, isDark ? styles.textDark : styles.textLight]}>
                        {section.label}
                      </Text>
                      <View style={styles.emojiGridSix}>
                        {section.emojis.map((emoji, idx) => (
                          <EmojiCell
                            key={`${section.id}-${emoji}-${idx}`}
                            emoji={emoji}
                            onPress={handleEmojiPress}
                          />
                        ))}
                      </View>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </GestureDetector>
          </View>

          {/* Docked Bottom Category Bar */}
          <View
            style={[
              styles.bottomCategoryBar,
              isDark ? styles.bottomCategoryBarDark : styles.bottomCategoryBarLight,
              {
                paddingTop: 8,
                paddingBottom: bottomSafeInset,
              },
            ]}
          >
            {CATEGORY_BAR_ITEMS.map((item) => {
              const isActive = activeCategory === item.id;
              return (
                <Pressable
                  key={item.id}
                  delayPressIn={0}
                  hitSlop={6}
                  onPress={() => handleCategoryPress(item.id)}
                  style={({ pressed }) => [
                    styles.categoryBarBtn,
                    isActive && (isDark ? styles.categoryBarBtnActiveDark : styles.categoryBarBtnActiveLight),
                    pressed && { opacity: 0.65, transform: [{ scale: 0.88 }] },
                  ]}
                >
                  <Text style={styles.categoryBarIconText}>{item.icon}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Reanimated.View>
    </View>
  );
}

const ReactionItem = React.memo(function ReactionItem({
  emoji,
  index,
  isDark,
  isOpen,
  isSelected,
  onLongPress,
  onPress,
}) {
  const enterScale = useRef(new Animated.Value(0)).current;
  const wiggleAnim = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isOpen) {
      enterScale.setValue(0);
      wiggleAnim.setValue(0);
      pressScale.setValue(1);
      return;
    }

    // Staggered pop-in entrance: each emoji pops in sequentially with a clean, bouncy spring
    // Once open, it stays completely stationary at rest (อยู่นิ่ง ไม่ขยับตลอดเวลา)
    const delay = index * 30;
    const timer = setTimeout(() => {
      Animated.spring(enterScale, {
        toValue: 1,
        friction: 5,
        tension: 220,
        useNativeDriver: true,
      }).start();
    }, delay);

    return () => clearTimeout(timer);
  }, [isOpen, index]);

  const rotate = wiggleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [index % 2 === 0 ? '-8deg' : '8deg', '0deg', index % 2 === 0 ? '8deg' : '-8deg'],
  });

  const translateY = wiggleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [0, 0, -2.5],
  });

  const handlePressIn = () => {
    // Interactive feedback: pops up larger and tilts playfully when touched/pressed
    Animated.parallel([
      Animated.spring(pressScale, {
        toValue: 1.36,
        friction: 4,
        tension: 260,
        useNativeDriver: true,
      }),
      Animated.spring(wiggleAnim, {
        toValue: index % 2 === 0 ? 0.6 : -0.6,
        friction: 4,
        tension: 260,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    // Springs smoothly back to stationary rest position
    Animated.parallel([
      Animated.spring(pressScale, {
        toValue: 1.0,
        friction: 5,
        tension: 220,
        useNativeDriver: true,
      }),
      Animated.spring(wiggleAnim, {
        toValue: 0,
        friction: 5,
        tension: 220,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Pressable
      accessibilityLabel={`แสดงความรู้สึก ${emoji}`}
      accessibilityState={{ selected: isSelected }}
      delayLongPress={360}
      delayPressIn={0}
      hitSlop={4}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        styles.reactionButton,
        isSelected && (isDark ? styles.reactionButtonSelectedDark : styles.reactionButtonSelectedLight),
      ]}
    >
      <Animated.View style={{ transform: [{ scale: enterScale }, { scale: pressScale }] }}>
        <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>
          <Text style={styles.reactionEmoji}>{emoji}</Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
});

const ReactionPlusButton = React.memo(function ReactionPlusButton({
  index,
  isDark,
  isOpen,
  isPanelReactions,
  onPress,
}) {
  const enterScale = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isOpen) {
      enterScale.setValue(0);
      pressScale.setValue(1);
      return;
    }
    const timer = setTimeout(() => {
      Animated.spring(enterScale, {
        toValue: 1,
        friction: 5,
        tension: 200,
        useNativeDriver: true,
      }).start();
    }, index * 30);
    return () => clearTimeout(timer);
  }, [isOpen, index]);

  const handlePressIn = () => {
    Animated.spring(pressScale, { toValue: 1.22, friction: 4, tension: 240, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(pressScale, { toValue: 1.0, friction: 5, tension: 200, useNativeDriver: true }).start();
  };

  return (
    <Pressable
      accessibilityLabel="แสดงความรู้สึกเพิ่มเติม"
      delayPressIn={0}
      hitSlop={4}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        styles.reactionButton,
        pressed && (isDark ? styles.reactionButtonPressedDark : styles.reactionButtonPressedLight),
      ]}
    >
      <Animated.View style={{ transform: [{ scale: enterScale }, { scale: pressScale }] }}>
        <FeatureIcon color={isDark ? 'rgba(255,255,255,0.82)' : '#25272B'} name="plus" size={16} />
      </Animated.View>
    </Pressable>
  );
});

export default function InstagramMessageOverlay({
  conversations = [],
  currentConversationId,
  currentUserId,
  isOpen,
  item,
  onClose,
  onDelete,
  onForward,
  onReact,
  onReply,
  onReport,
  onUnsend,
  palette,
}) {
  const theme = useTheme();
  const isDark = typeof palette?.isDark === 'boolean'
    ? palette.isDark
    : (palette?.background === '#0D0F12' ? true : (palette?.background === '#F5F7FB' ? false : Boolean(theme?.isDark)));
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const { uri: clipboardImageUri } = useDecryptedMedia(isOpen && item?.mediaType !== 'video' ? (item?.mediaUrl || item?.mediaUrls?.[0]) : null, { conversationId: currentConversationId, currentUserId });
  const [panel, setPanel] = useState('actions');
  const [quickReactions, setQuickReactions] = useState(() => getQuickReactionsSync());
  const [editingSlotIndex, setEditingSlotIndex] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return subscribeQuickReactions((updated) => {
      if (Array.isArray(updated) && updated.length >= 5) {
        setQuickReactions(updated);
      }
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setPanel('actions');
    setEditingSlotIndex(null);
    loadCustomQuickReactions().then((loaded) => {
      if (Array.isArray(loaded) && loaded.length >= 5) {
        setQuickReactions(loaded);
      }
    });
    fadeAnim.setValue(0);
    liftAnim.setValue(0);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        duration: 180,
        easing: Easing.out(Easing.ease),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(liftAnim, {
        damping: 20,
        mass: 0.8,
        stiffness: 260,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, isOpen, liftAnim]);

  const isImage = Boolean(
    (item?.mediaUrl && (item?.mediaType === 'image' || item?.mediaType === 'gif' || !item?.mediaType) && !item?.audioUrl)
    || (Array.isArray(item?.mediaUrls) && item?.mediaUrls.length > 0)
    || item?.mediaType === 'image'
    || item?.mediaType === 'gif'
    || item?.text === '[GIF]'
    || item?.text?.toUpperCase() === '[GIF]'
    || (typeof item?.mediaUrl === 'string' && (item.mediaUrl.includes('giphy.com') || item.mediaUrl.includes('.gif')))
  );
  const isMultiImage = Boolean(Array.isArray(item?.mediaUrls) && item?.mediaUrls.length > 1);
  const primaryMediaUrl = item?.mediaUrl || (Array.isArray(item?.mediaUrls) ? item?.mediaUrls[0] : null);

  const resolveInitialSize = () => {
    if (item?.imageSize?.width && item?.imageSize?.height) {
      return item.imageSize;
    }
    const cachedRatio = item?.aspectRatio
      || getCachedAspectRatio(primaryMediaUrl)
      || (clipboardImageUri ? getCachedAspectRatio(clipboardImageUri) : null);
    if (cachedRatio) {
      return getChatImageBubbleSize(cachedRatio);
    }
    const layoutObj = item?.layout;
    const textStr = item?.text?.trim?.() || '';
    const hasCap = Boolean(
      textStr &&
      textStr !== '[รูปภาพ]' &&
      !textStr.startsWith('[รูปภาพ ') &&
      textStr !== '[ข้อความเสียง]' &&
      textStr !== '[GIF]' &&
      textStr.toUpperCase() !== '[GIF]'
    );
    if (layoutObj && layoutObj.width > 0 && layoutObj.height > 0 && !hasCap) {
      return { width: layoutObj.width, height: layoutObj.height };
    }
    return getChatImageBubbleSize(null);
  };

  const [imageBubbleSize, setImageBubbleSize] = useState(resolveInitialSize);

  useEffect(() => {
    if (!isOpen || !isImage) return;

    if (item?.imageSize?.width && item?.imageSize?.height) {
      setImageBubbleSize(item.imageSize);
      return;
    }

    const cachedRatio = item?.aspectRatio
      || getCachedAspectRatio(primaryMediaUrl)
      || (clipboardImageUri ? getCachedAspectRatio(clipboardImageUri) : null);
    if (cachedRatio) {
      setImageBubbleSize(getChatImageBubbleSize(cachedRatio));
      return;
    }

    const layoutObj = item?.layout;
    const textStr = item?.text?.trim?.() || '';
    const hasCap = Boolean(
      textStr &&
      textStr !== '[รูปภาพ]' &&
      !textStr.startsWith('[รูปภาพ ') &&
      textStr !== '[ข้อความเสียง]' &&
      textStr !== '[GIF]' &&
      textStr.toUpperCase() !== '[GIF]'
    );
    if (layoutObj && layoutObj.width > 0 && layoutObj.height > 0 && !hasCap) {
      setImageBubbleSize({ width: layoutObj.width, height: layoutObj.height });
      return;
    }

    const targetUri = clipboardImageUri || primaryMediaUrl;
    if (!targetUri) return;
    measureImageAspectRatio(targetUri, (ratio, size) => {
      if (size) {
        setImageBubbleSize((prev) => {
          if (prev && prev.width === size.width && prev.height === size.height) {
            return prev;
          }
          return size;
        });
      }
      if (primaryMediaUrl && ratio) cacheAspectRatio(primaryMediaUrl, ratio);
    });
  }, [isOpen, isImage, primaryMediaUrl, clipboardImageUri, item?.imageSize, item?.aspectRatio, item?.layout, item?.text]);

  if (!item || !isOpen) return null;

  const mine = item.sender === 'me' || (Boolean(currentUserId) && item.senderId === currentUserId);
  const layout = item.layout;
  const hasLayout = Boolean(layout && typeof layout.y === 'number' && layout.width > 0);
  const emojiReactionPanelHeight = Math.min(540, Math.max(420, screenHeight * 0.62));
  const panelHeight = panel === 'actions'
    ? (mine ? 340 : 292)
    : panel === 'reactions'
      ? emojiReactionPanelHeight
      : 250;
  const isAudio = Boolean(
    item.mediaType === 'audio' || item.audioUrl
  );
  const textVal = item.text?.trim?.() || '';
  const hasCaptionText = Boolean(
    textVal &&
    item.mediaType !== 'call' &&
    textVal !== '[รูปภาพ]' &&
    !textVal.startsWith('[รูปภาพ ') &&
    textVal !== '[ข้อความเสียง]' &&
    textVal !== '[วิดีโอ]' &&
    textVal !== '[GIF]' &&
    textVal.toUpperCase() !== '[GIF]'
  );

  const effectiveImageWidth = (hasLayout && !hasCaptionText && layout.width > 0)
    ? layout.width
    : (item?.imageSize?.width || imageBubbleSize.width);

  const effectiveImageHeight = (hasLayout && !hasCaptionText && layout.height > 0)
    ? layout.height
    : (item?.imageSize?.height || imageBubbleSize.height);

  const fallbackHeight = item.mediaType === 'video' ? (hasCaptionText ? 266 : 220) : isImage
    ? (hasCaptionText ? effectiveImageHeight + 46 : effectiveImageHeight)
    : isAudio
      ? 70
      : 44;
  const bubbleHeight = hasLayout ? layout.height : fallbackHeight;
  const resolvedBubbleWidth = item.mediaType === 'video' ? 250 : isImage
    ? (hasCaptionText ? Math.max(effectiveImageWidth, 220) : effectiveImageWidth)
    : (hasLayout ? Math.ceil(layout.width) + 2 : Math.min(260, screenWidth - 48));
  const bubbleWidth = resolvedBubbleWidth;

  const REACTION_PILL_HEIGHT = 46;
  const GAP = 8;
  const PILL_WIDTH = 246;
  const CARD_WIDTH = panel === 'reactions'
    ? Math.min(320, screenWidth - 24)
    : (panel === 'actions' ? 252 : 270);
  const estimatedMenuHeight = 310;

  const startY = hasLayout ? layout.y : Math.max(90, screenHeight * 0.3);

  // Minimum safe Y for the bubble so the reaction pill above doesn't clip top of screen
  const minBubbleY = 56 + REACTION_PILL_HEIGHT + GAP;

  // Maximum safe Y for the bubble so the menu below doesn't clip bottom of screen
  const maxBubbleY = Math.max(minBubbleY, screenHeight - bubbleHeight - GAP - estimatedMenuHeight - 16);

  let bubbleTargetY;
  if (!hasLayout) {
    bubbleTargetY = Math.max(minBubbleY, Math.min(screenHeight * 0.28, maxBubbleY));
  } else if (minBubbleY > maxBubbleY) {
    // If the bubble itself is very large (e.g. huge image):
    // Only lift by at most 50px from chat position, never lift into the sky!
    bubbleTargetY = Math.max(minBubbleY, startY - 50);
  } else {
    // Normal message: Stay at startY (chat position) as much as possible!
    // If startY <= maxBubbleY: lift is 0! (Message stays at exact chat position)
    // If startY > maxBubbleY: only lift the exact minimum amount needed to fit menu on screen!
    bubbleTargetY = Math.max(minBubbleY, Math.min(startY, maxBubbleY));
  }

  const deltaY = startY - bubbleTargetY;

  const bubbleLeft = hasLayout
    ? Math.max(8, Math.min(layout.x, screenWidth - bubbleWidth - 8))
    : 16;
  const bubbleRight = hasLayout
    ? Math.max(8, Math.min(screenWidth - (layout.x + (layout.width || bubbleWidth)), screenWidth - bubbleWidth - 8))
    : 16;

  const pillLeft = Math.max(12, Math.min(bubbleLeft, screenWidth - PILL_WIDTH - 12));
  const pillRight = Math.max(12, Math.min(bubbleRight, screenWidth - PILL_WIDTH - 12));

  const menuLeft = Math.max(12, Math.min(bubbleLeft, screenWidth - CARD_WIDTH - 12));
  const menuRight = Math.max(12, Math.min(bubbleRight, screenWidth - CARD_WIDTH - 12));

  const accent = palette?.accent || '#EE6B5D';
  const selectedReaction = currentUserId ? item.reactions?.[currentUserId] : null;
  const otherConversations = conversations.filter((conversation) => conversation.id !== currentConversationId);

  const animateClose = (callback) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        duration: 150,
        easing: Easing.out(Easing.ease),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(liftAnim, {
        duration: 150,
        easing: Easing.out(Easing.ease),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => callback?.());
  };

  const chooseReaction = (emoji) => {
    void recordReactionUsage(emoji);
    animateClose(() => onReact?.(item, emoji));
  };
  const handleLongPressEmoji = (idx) => {
    setEditingSlotIndex(idx);
    setPanel('reactions');
  };
  const copyMessage = async () => {
    await Clipboard.setStringAsync(item.text || '');
    animateClose(onClose);
  };
  const copyImage = async () => {
    if (item.viewMode === 'once' || item.viewMode === 'replay') return;
    let imageToCopy = clipboardImageUri;
    if (!imageToCopy) {
      const rawUrl = item?.mediaUrl || (Array.isArray(item?.mediaUrls) ? item?.mediaUrls[0] : null);
      if (rawUrl) {
        try {
          imageToCopy = getSyncCachedMediaUri(rawUrl, 'image')
            || await getDecryptedMediaUri(rawUrl, {
                conversationId: currentConversationId,
                currentUserId,
                mediaType: 'image',
              });
        } catch (_) {
          imageToCopy = rawUrl;
        }
      }
    }
    const copied = await copyImageToClipboard(imageToCopy);
    if (!copied) {
      showInAppNotification({
        title: 'คัดลอกรูปไม่สำเร็จ',
        message: 'กรุณารอให้รูปโหลดเสร็จแล้วลองอีกครั้ง',
        tone: 'danger',
      });
      return;
    }
    showInAppNotification({
      title: 'คัดลอกรูปภาพแล้ว',
      message: 'สามารถแตะปุ่มวางรูปภาพในช่องพิมพ์ข้อความเพื่อส่งได้ทันที',
      tone: 'success',
    });
    animateClose(onClose);
  };
  const saveImage = async () => {
    if (item.viewMode === 'once' || item.viewMode === 'replay') return;
    let imageToSave = clipboardImageUri;
    if (!imageToSave) {
      const rawUrl = item?.mediaUrl || (Array.isArray(item?.mediaUrls) ? item?.mediaUrls[0] : null);
      if (rawUrl) {
        try {
          imageToSave = getSyncCachedMediaUri(rawUrl, 'image')
            || await getDecryptedMediaUri(rawUrl, {
                conversationId: currentConversationId,
                currentUserId,
                mediaType: 'image',
              });
        } catch (_) {
          imageToSave = rawUrl;
        }
      }
    }
    const res = await saveImageToGallery(imageToSave);
    if (!res?.success) {
      if (res?.error === 'permission_denied' || res?.error === 'permission_blocked') {
        showInAppNotification({
          title: 'ต้องได้รับอนุญาต',
          message: 'กรุณาอนุญาตการเข้าถึงรูปภาพในตั้งค่าเพื่อบันทึกรูปลงในเครื่อง',
          tone: 'warning',
        });
      } else {
        showInAppNotification({
          title: 'บันทึกรูปไม่สำเร็จ',
          message: 'กรุณารอให้รูปโหลดเสร็จแล้วลองอีกครั้ง',
          tone: 'danger',
        });
      }
      return;
    }
    showInAppNotification({
      title: 'บันทึกรูปภาพแล้ว',
      message: 'บันทึกรูปภาพลงในอัลบั้มรูปภาพของคุณเรียบร้อยแล้ว',
      tone: 'success',
    });
    animateClose(onClose);
  };
  const shareMessage = () => {
    animateClose(async () => {
      onClose?.();
      await Share.share({ message: item.text || '' });
    });
  };

  return (
    <Modal
      animationType="none"
      onRequestClose={() => animateClose(onClose)}
      statusBarTranslucent
      transparent
      visible={isOpen}
    >
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityLabel="ปิดเมนูข้อความ"
          onPress={() => {
            animateClose(onClose);
          }}
          style={[styles.backdrop, isDark ? styles.backdropDark : styles.backdropLight]}
        >
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>
            <BlurView intensity={isDark ? 92 : 82} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, isDark ? styles.backdropShadeDark : styles.backdropShadeLight]} />
          </Animated.View>

          {panel !== 'reactions' ? (
            <Animated.View
              pointerEvents="box-none"
              style={[
                StyleSheet.absoluteFill,
                {
                  transform: [
                    {
                      translateY: liftAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [deltaY, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
          {/* 1. Quick Reactions Pill - Pops out on top */}
          <Animated.View
            pointerEvents={panel === 'reactions' ? 'none' : 'auto'}
            style={{
              position: 'absolute',
              top: bubbleTargetY - REACTION_PILL_HEIGHT - GAP,
              ...(mine ? { right: pillRight } : { left: pillLeft }),
              opacity: panel === 'reactions'
                ? 0
                : liftAnim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.5, 1] }),
              transform: [
                { translateY: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                { scale: liftAnim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.75, 0.95, 1.0] }) },
              ],
            }}
          >
            <GlassSurface intensity={70} isDark={isDark} style={[styles.reactionPill, isDark ? styles.reactionPillDark : styles.reactionPillLight]}>
              {quickReactions.slice(0, 6).map((emoji, idx) => (
                <ReactionItem
                  emoji={emoji}
                  index={idx}
                  isDark={isDark}
                  isOpen={isOpen}
                  isSelected={selectedReaction === emoji}
                  key={`${emoji}-${idx}`}
                  onLongPress={() => handleLongPressEmoji(idx)}
                  onPress={() => chooseReaction(emoji)}
                />
              ))}
              <ReactionPlusButton
                index={6}
                isDark={isDark}
                isOpen={isOpen}
                isPanelReactions={panel === 'reactions'}
                onPress={() => {
                  setEditingSlotIndex(null);
                  setPanel(panel === 'reactions' ? 'actions' : 'reactions');
                }}
              />
            </GlassSurface>
          </Animated.View>

          {/* 2. Elevated Message Bubble - Lifts from chat with scale and shadow */}
          <Animated.View
            style={[
              styles.messageBubble,
              item.mediaType === 'call'
                ? { backgroundColor: 'transparent', borderWidth: 0, padding: 0 }
                : (isImage && !hasCaptionText
                  ? styles.imageOnlyBubble
                  : (mine ? [styles.myBubble, { backgroundColor: accent }] : (isDark ? styles.theirBubbleDark : styles.theirBubbleLight))),
              isImage && hasCaptionText && styles.imageBubbleWrapper,
              isAudio && styles.audioBubbleWrapper,
              isMultiImage && { backgroundColor: 'transparent', borderWidth: 0, padding: 0 },
              bubbleWidth ? { width: bubbleWidth } : null,
              {
                position: 'absolute',
                top: bubbleTargetY,
                ...(mine ? { right: bubbleRight } : { left: bubbleLeft }),
                opacity: (panel === 'reactions' && typeof editingSlotIndex === 'number' && editingSlotIndex >= 0) ? 0 : 1,
                transform: [
                  {
                    scale: (isImage && !hasCaptionText)
                      ? liftAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1.0, 1.02, 1.0] })
                      : liftAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1.0, 1.025, 1.01] }),
                  },
                ],
                shadowColor: isDark ? '#000000' : '#25272B',
                shadowOffset: { width: 0, height: 10 },
                shadowOpacity: (isImage && !hasCaptionText) ? 0 : liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0.12, isDark ? 0.38 : 0.20] }),
                shadowRadius: liftAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 18] }),
                elevation: (isImage && !hasCaptionText) ? 0 : 10,
              },
            ]}
          >
            {item.forwarded ? <Text style={[styles.forwardedLabel, !mine && !isDark && styles.forwardedLabelLight]}>ส่งต่อ</Text> : null}
            {item.replyTo ? (
              <View style={[styles.replyQuote, !mine && !isDark && styles.replyQuoteLight]}>
                <ReplyPreview reply={item.replyTo} conversationId={currentConversationId} currentUserId={currentUserId} color={mine || isDark ? '#FFFFFF' : '#25272B'} />
              </View>
            ) : null}

            {isImage && (item.viewMode === 'once' || item.viewMode === 'replay') ? (
              <ChatProtectedImageBubble item={item} conversationId={currentConversationId} currentUserId={currentUserId} mine={mine} previewOnly />
            ) : isImage ? (
              isMultiImage ? (
                <View style={[styles.overlayImageContainer, { width: effectiveImageWidth, height: effectiveImageHeight }]}>
                  <StackedImageCards
                    conversationId={currentConversationId}
                    currentUserId={currentUserId}
                    borderless
                    disabled
                    mediaUrls={item.mediaUrls}
                    mine={mine}
                    width={effectiveImageWidth}
                    height={effectiveImageHeight}
                  />
                </View>
              ) : (
                <View style={[styles.overlayImageContainer, { width: effectiveImageWidth, height: effectiveImageHeight }]}>
                  <DecryptedChatImage
                    conversationId={currentConversationId}
                    currentUserId={currentUserId}
                    isUploading={Boolean(item.isUploading)}
                    mediaUrl={primaryMediaUrl}
                    onAspectRatioMeasured={(ratio, size) => {
                      if (size) {
                        setImageBubbleSize((prev) => {
                          if (prev && prev.width === size.width && prev.height === size.height) {
                            return prev;
                          }
                          return size;
                        });
                      }
                      if (primaryMediaUrl && ratio) cacheAspectRatio(primaryMediaUrl, ratio);
                    }}
                    resizeMode="cover"
                    showExpandBadge={false}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              )
            ) : null}

            {item.mediaType === 'video' ? <ChatVideoCover item={item} conversationId={currentConversationId} currentUserId={currentUserId} mine={mine} /> : null}
            {isAudio ? (
              <View style={styles.overlayAudioContainer}>
                <VoiceMessageBubble
                  audioUrl={item.audioUrl || item.mediaUrl}
                  colors={{ primary: accent }}
                  conversationId={currentConversationId}
                  currentUserId={currentUserId}
                  duration={item.audioDuration || item.mediaDuration || 0}
                  isUploading={Boolean(item.isUploading)}
                  mine={mine}
                />
              </View>
            ) : null}

            {item.mediaType === 'call' ? (
              <CallMessageBubble
                colors={{ line: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)', ink: isDark ? '#FFFFFF' : '#25272B', inkSoft: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(16,32,58,0.6)' }}
                isDark={isDark}
                item={item}
                mine={mine}
              />
            ) : null}

            {hasCaptionText ? (
              <Text
                style={[
                  styles.messageText,
                  !mine && !isDark && styles.messageTextLight,
                  isImage && styles.captionText,
                ]}
                textBreakStrategy={Platform.OS === 'android' ? 'highQuality' : undefined}
              >
                {item.text}
              </Text>
            ) : null}
          </Animated.View>

          {/* 3. Actions / Forward Panel - Slides up smoothly below bubble */}
          {panel !== 'reactions' ? (
            <Animated.View
              style={{
                position: 'absolute',
                top: bubbleTargetY + bubbleHeight + GAP,
                ...(mine ? { right: menuRight } : { left: menuLeft }),
                width: CARD_WIDTH,
                maxHeight: Math.max(180, screenHeight - (bubbleTargetY + bubbleHeight + GAP) - 16),
                opacity: liftAnim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.4, 1] }),
                transform: [
                  {
                    translateY: liftAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              }}
            >
              {panel === 'actions' ? (
                <GlassSurface intensity={74} isDark={isDark} style={[styles.actionCard, isDark ? styles.actionCardDark : styles.actionCardLight, { maxHeight: '100%' }]}>
                  <ScrollView
                    bounces={false}
                    contentContainerStyle={{ flexGrow: 0 }}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                  >
                    <Text style={[styles.timestamp, isDark ? styles.timestampDark : styles.timestampLight]}>{formatTime(item)}</Text>
                    <MenuRow isDark={isDark} icon="arrowshape.turn.up.left" label="ตอบกลับ" onPress={() => animateClose(() => onReply?.(item))} />
                    {isImage && item.viewMode !== 'once' && item.viewMode !== 'replay' ? (
                      <MenuRow isDark={isDark} icon="arrow.down.to.line" label="บันทึกรูปภาพ" onPress={saveImage} />
                    ) : null}
                    {isImage && item.viewMode !== 'once' && item.viewMode !== 'replay' ? (
                      <MenuRow isDark={isDark} icon="doc.on.doc" label="คัดลอกรูปภาพ" onPress={copyImage} />
                    ) : null}
                    {hasCaptionText ? (
                      <MenuRow isDark={isDark} icon="text.bubble" label={isImage ? "คัดลอกคำบรรยาย" : "คัดลอกข้อความ"} onPress={copyMessage} />
                    ) : null}
                    {item.mediaType !== 'video' && item.viewMode !== 'once' && item.viewMode !== 'replay' && <MenuRow isDark={isDark} icon="paperplane" label="ส่งต่อ" onPress={() => setPanel('forward')} trailing />}
                    <MenuRow isDark={isDark} icon="trash" label="ลบสำหรับคุณ" onPress={() => animateClose(() => onDelete?.(item))} />
                    {mine ? <MenuRow isDark={isDark} destructive icon="arrow.uturn.backward.circle" label="ยกเลิกการส่ง" onPress={() => animateClose(() => onUnsend?.(item))} /> : null}
                    {!mine && onReport ? (
                      <MenuRow
                        isDark={isDark}
                        destructive
                        icon="exclamationmark.bubble"
                        label={isImage ? 'รายงานรูปภาพนี้' : isAudio ? 'รายงานข้อความเสียงนี้' : 'รายงานข้อความนี้'}
                        onPress={() => animateClose(() => onReport?.(item))}
                      />
                    ) : null}
                    <MenuRow isDark={isDark} icon="ellipsis" label="เพิ่มเติม" onPress={() => setPanel('more')} trailing />
                  </ScrollView>
                </GlassSurface>
              ) : null}

            {panel === 'forward' ? (
              <GlassSurface intensity={74} isDark={isDark} style={[styles.secondaryCard, isDark ? styles.secondaryCardDark : styles.secondaryCardLight]}>
                <View style={styles.panelHeader}>
                  <Text style={[styles.panelTitle, isDark ? styles.textDark : styles.textLight]}>ส่งต่อไปยัง</Text>
                  <Pressable
                    onPress={() => setPanel('actions')}
                    style={({ pressed }) => [
                      styles.closePanelButton,
                      isDark ? styles.closePanelButtonDark : styles.closePanelButtonLight,
                      pressed && (isDark ? styles.menuRowPressedDark : styles.menuRowPressedLight),
                    ]}
                  >
                    <FeatureIcon color={isDark ? '#FFFFFF' : '#25272B'} name="chevron.left" size={14} />
                  </Pressable>
                </View>
                {otherConversations.length ? (
                  <FlatList
                    contentContainerStyle={styles.forwardList}
                    data={otherConversations}
                    initialNumToRender={5}
                    keyExtractor={(conversation) => conversation.id}
                    maxToRenderPerBatch={6}
                    renderItem={({ item: conversation }) => (
                      <Pressable
                        onPress={() => animateClose(() => onForward?.(item, conversation.id))}
                        style={({ pressed }) => [
                          styles.forwardRow,
                          pressed && (isDark ? styles.menuRowPressedDark : styles.menuRowPressedLight),
                        ]}
                      >
                        <ForwardAvatar conversation={conversation} fallbackColor={accent} />
                        <Text numberOfLines={1} style={[styles.forwardName, isDark ? styles.textDark : styles.textLight]}>{conversation.name || 'ห้องสนทนา'}</Text>
                        <FeatureIcon color={accent} name="paperplane.fill" size={15} />
                      </Pressable>
                    )}
                    showsVerticalScrollIndicator={false}
                    style={styles.forwardScroll}
                    windowSize={3}
                  />
                ) : (
                  <Text style={[styles.emptyForward, isDark ? styles.subtextDark : styles.subtextLight]}>ยังไม่มีห้องสนทนาอื่นสำหรับส่งต่อ</Text>
                )}
              </GlassSurface>
            ) : null}

            {panel === 'more' ? (
              <GlassSurface intensity={74} isDark={isDark} style={[styles.secondaryCard, isDark ? styles.secondaryCardDark : styles.secondaryCardLight]}>
                <View style={styles.panelHeader}>
                  <Text style={[styles.panelTitle, isDark ? styles.textDark : styles.textLight]}>เพิ่มเติม</Text>
                  <Pressable
                    onPress={() => setPanel('actions')}
                    style={({ pressed }) => [
                      styles.closePanelButton,
                      isDark ? styles.closePanelButtonDark : styles.closePanelButtonLight,
                      pressed && (isDark ? styles.menuRowPressedDark : styles.menuRowPressedLight),
                    ]}
                  >
                    <FeatureIcon color={isDark ? '#FFFFFF' : '#25272B'} name="chevron.left" size={14} />
                  </Pressable>
                </View>
                {isImage && item.viewMode !== 'once' && item.viewMode !== 'replay' ? (
                  <MenuRow isDark={isDark} icon="arrow.down.to.line" label="บันทึกรูปภาพ" onPress={saveImage} />
                ) : null}
                {isImage && item.viewMode !== 'once' && item.viewMode !== 'replay' ? (
                  <MenuRow isDark={isDark} icon="doc.on.doc" label="คัดลอกรูปภาพ" onPress={copyImage} />
                ) : null}
                {hasCaptionText ? (
                  <MenuRow isDark={isDark} icon="text.bubble" label={isImage ? "คัดลอกคำบรรยาย" : "คัดลอกข้อความ"} onPress={copyMessage} />
                ) : null}
                <MenuRow isDark={isDark} icon="square.and.arrow.up" label="แชร์ไปยังแอปอื่น" onPress={shareMessage} />
              </GlassSurface>
            ) : null}
          </Animated.View>
        ) : null}
        </Animated.View>
        ) : null}
        </Pressable>

        {/* 4. Slide-up Emoji Reaction Bottom Sheet with drag down gesture */}
        <EmojiReactionPickerSheet
          accent={accent}
          initialEditingSlot={editingSlotIndex}
          isDark={isDark}
          isOpen={panel === 'reactions'}
          onClose={() => {
            setEditingSlotIndex(null);
            animateClose(onClose);
          }}
          onSelect={chooseReaction}
          onUpdateQuickReactions={(updated) => setQuickReactions(updated)}
          quickReactions={quickReactions}
          selectedReaction={selectedReaction}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  glassSurface: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  glassSurfaceDark: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  glassSurfaceLight: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderColor: 'rgba(0,0,0,0.08)',
  },
  glassSurfaceFallbackDark: {
    backgroundColor: 'rgba(25,29,37,0.98)',
    borderColor: 'rgba(255,255,255,0.24)',
    borderWidth: 1,
  },
  glassSurfaceFallbackLight: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(16,32,58,0.12)',
    borderWidth: 1,
  },
  glassSurfaceIOSDark: {
    backgroundColor: 'rgba(20,24,31,0.94)',
    borderColor: 'rgba(255,255,255,0.30)',
    borderWidth: 1,
  },
  glassSurfaceIOSLight: {
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderColor: 'rgba(0,0,0,0.08)',
    borderWidth: 1,
  },
  actionCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowOffset: { height: 12, width: 0 },
    shadowRadius: 22,
    width: '100%',
  },
  actionCardDark: {
    backgroundColor: 'rgba(28,32,40,0.94)',
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000000',
    shadowOpacity: 0.38,
  },
  actionCardLight: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: 'rgba(16,32,58,0.08)',
    shadowColor: '#25272B',
    shadowOpacity: 0.15,
  },
  animatedGroup: { gap: 9, maxWidth: 320, width: '100%' },
  backdrop: { flex: 1 },
  backdropDark: { backgroundColor: 'rgba(0,0,0,0.50)' },
  backdropLight: { backgroundColor: 'rgba(0,0,0,0.40)' },
  backdropShadeDark: { backgroundColor: 'rgba(7,9,12,0.35)' },
  backdropShadeLight: { backgroundColor: 'rgba(0,0,0,0.18)' },
  closePanelButton: {
    alignItems: 'center',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  closePanelButtonDark: { backgroundColor: 'rgba(255,255,255,0.10)' },
  closePanelButtonLight: { backgroundColor: 'rgba(16,32,58,0.06)' },
  destructiveLabel: { color: '#FF5A5F' },
  emptyForward: { fontSize: 13, lineHeight: 19, paddingVertical: 18, textAlign: 'center' },
  forwardAvatar: { alignItems: 'center', borderRadius: 17, height: 34, justifyContent: 'center', overflow: 'hidden', width: 34 },
  forwardAvatarImage: { borderRadius: 17, height: 34, width: 34 },
  forwardAvatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  forwardedLabel: { color: 'rgba(255,255,255,0.68)', fontSize: 10.5, fontWeight: '700', marginBottom: 3 },
  forwardedLabelLight: { color: 'rgba(16,32,58,0.62)' },
  forwardList: { gap: 2 },
  forwardName: { flex: 1, fontSize: 14, fontWeight: '600' },
  forwardRow: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 10, minHeight: 48, paddingHorizontal: 7 },
  forwardScroll: { flexGrow: 0, maxHeight: 230 },
  iosCategoryIcon: { fontSize: 19, includeFontPadding: false, lineHeight: 23 },
  iosCategoryLabel: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  iosCategoryLabelDark: { color: 'rgba(255,255,255,0.72)' },
  iosCategoryLabelLight: { color: 'rgba(16,32,58,0.65)' },
  iosCategoryLabelSelected: { color: '#FFFFFF' },
  iosCategoryList: { gap: 6, paddingHorizontal: 1 },
  iosCategoryScroll: { flexGrow: 0, marginBottom: 9 },
  iosCategoryTab: { alignItems: 'center', borderRadius: 13, justifyContent: 'center', minWidth: 52, paddingHorizontal: 7, paddingVertical: 5 },
  iosEmoji: { fontSize: 25, includeFontPadding: false, lineHeight: 31, textAlign: 'center' },
  iosEmojiCell: { alignItems: 'center', borderRadius: 11, height: 42, justifyContent: 'center', width: '14.2857%' },
  iosEmojiCellSelectedDark: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.88)', borderWidth: 1 },
  iosEmojiCellSelectedLight: { backgroundColor: 'rgba(16,32,58,0.08)', borderColor: 'rgba(16,32,58,0.45)', borderWidth: 1 },
  iosEmojiGrid: {
    alignContent: 'flex-start',
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 4,
    paddingHorizontal: 2,
    paddingTop: 2,
    width: '100%',
  },
  iosEmojiScroll: { flex: 1 },
  iosPopupHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  iosPopupSubtitle: { fontSize: 11, marginTop: 1 },
  iosPopupTitle: { fontSize: 16, fontWeight: '700' },
  iosReactionPopup: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowOffset: { height: 12, width: 0 },
    shadowRadius: 22,
    width: '100%',
  },
  cardDark: {
    backgroundColor: 'rgba(28,32,40,0.94)',
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000000',
    shadowOpacity: 0.38,
  },
  cardLight: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: 'rgba(16,32,58,0.08)',
    shadowColor: '#25272B',
    shadowOpacity: 0.15,
  },
  menuLabel: { flexShrink: 1, fontSize: 14.5, fontWeight: '500' },
  menuLabelDark: { color: '#FFFFFF' },
  menuLabelLight: { color: '#25272B' },
  menuRow: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', justifyContent: 'space-between', minHeight: 43, paddingHorizontal: 6 },
  menuRowCopy: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 13 },
  menuRowPressedDark: { backgroundColor: 'rgba(255,255,255,0.09)' },
  menuRowPressedLight: { backgroundColor: 'rgba(16,32,58,0.06)' },
  messageBubble: {
    borderRadius: 16,
    maxWidth: 280,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowOffset: { height: 6, width: 0 },
  },
  imageBubbleWrapper: {
    borderRadius: 18,
    overflow: 'hidden',
    paddingBottom: 4,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  audioBubbleWrapper: {
    borderRadius: 18,
    maxWidth: 290,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  imageOnlyBubble: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 18,
    borderWidth: 0,
    elevation: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    padding: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
  },
  overlayImageContainer: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 18,
    borderWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  overlayImage: {
    borderRadius: 18,
    height: '100%',
    width: '100%',
  },
  overlayAudioContainer: {
    minWidth: 220,
  },
  captionText: {
    marginTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 8,
  },
  messageText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '400',
    includeFontPadding: false,
    lineHeight: Platform.OS === 'android' ? 19 : undefined,
  },
  messageTextLight: { color: '#25272B' },
  myBubble: { borderBottomRightRadius: 4 },
  panelHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  panelTitle: { fontSize: 15, fontWeight: '700' },
  reactionButton: { alignItems: 'center', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  reactionButtonSelectedDark: { backgroundColor: 'rgba(255,255,255,0.22)', borderColor: 'rgba(255,255,255,0.88)', borderWidth: 1 },
  reactionButtonSelectedLight: { backgroundColor: 'rgba(16,32,58,0.08)', borderColor: 'rgba(16,32,58,0.45)', borderWidth: 1 },
  reactionButtonPressedDark: { backgroundColor: 'rgba(255,255,255,0.15)', transform: [{ scale: 1.14 }] },
  reactionButtonPressedLight: { backgroundColor: 'rgba(16,32,58,0.08)', transform: [{ scale: 1.14 }] },
  reactionEmoji: { fontSize: 22, includeFontPadding: false, textAlign: 'center' },
  reactionPill: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 5,
    paddingVertical: 4,
    shadowOffset: { height: 8, width: 0 },
    shadowRadius: 16,
  },
  reactionPillDark: {
    backgroundColor: 'rgba(28,32,40,0.92)',
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000000',
    shadowOpacity: 0.34,
  },
  reactionPillLight: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: 'rgba(16,32,58,0.08)',
    shadowColor: '#25272B',
    shadowOpacity: 0.12,
  },
  replyQuote: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 10, marginBottom: 6, paddingHorizontal: 9, paddingVertical: 6 },
  replyQuoteLight: { backgroundColor: 'rgba(16,32,58,0.08)' },
  replyQuoteText: { color: 'rgba(255,255,255,0.74)', fontSize: 11.5 },
  secondaryCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowOffset: { height: 12, width: 0 },
    shadowRadius: 22,
    width: '100%',
  },
  secondaryCardDark: {
    backgroundColor: 'rgba(28,32,40,0.92)',
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000000',
    shadowOpacity: 0.38,
  },
  secondaryCardLight: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderColor: 'rgba(16,32,58,0.08)',
    shadowColor: '#25272B',
    shadowOpacity: 0.14,
  },
  stackContainer: { position: 'absolute' },
  theirBubbleDark: { backgroundColor: 'rgba(45,48,56,0.98)', borderBottomLeftRadius: 4 },
  theirBubbleLight: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    borderColor: 'rgba(16,32,58,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  timestamp: { fontSize: 11.5, fontWeight: '500', marginBottom: 5, paddingHorizontal: 5 },
  timestampDark: { color: 'rgba(255,255,255,0.45)' },
  timestampLight: { color: 'rgba(16,32,58,0.45)' },
  textDark: { color: '#FFFFFF' },
  textLight: { color: '#25272B' },
  subtextDark: { color: 'rgba(255,255,255,0.52)' },
  subtextLight: { color: 'rgba(16,32,58,0.52)' },
  topReactionsContainer: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  topReactionsContainerDark: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  topReactionsContainerLight: {
    backgroundColor: 'rgba(16,32,58,0.04)',
    borderColor: 'rgba(16,32,58,0.08)',
  },
  topReactionsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  topReactionsLabel: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  topActionSmallText: {
    fontSize: 11,
  },
  topReactionsSlotRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  topReactionSlot: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    height: 46,
    justifyContent: 'center',
    minWidth: 46,
    paddingHorizontal: 3,
    paddingVertical: 2,
    position: 'relative',
  },
  topReactionSlotDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  topReactionSlotLight: {
    backgroundColor: 'rgba(16,32,58,0.05)',
  },
  topReactionSlotActive: {
    borderWidth: 2,
    transform: [{ scale: 1.08 }],
  },
  slotBadgeNumber: {
    alignItems: 'center',
    borderRadius: 7,
    height: 14,
    justifyContent: 'center',
    minWidth: 14,
    paddingHorizontal: 2,
    position: 'absolute',
    right: 2,
    top: 2,
    zIndex: 2,
  },
  slotBadgeDark: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  slotBadgeLight: {
    backgroundColor: 'rgba(16,32,58,0.18)',
  },
  slotBadgeNumberText: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
  topReactionSlotEmoji: {
    fontSize: 22,
    marginTop: 2,
    textAlign: 'center',
  },
  customizeToggleBtn: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  customizeToggleBtnDark: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  customizeToggleBtnLight: {
    backgroundColor: 'rgba(16,32,58,0.08)',
  },
  customizeToggleText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  // Top navigation & customize pill area
  customizeTopArea: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 90,
  },
  customizeTopAreaDark: {
    backgroundColor: '#121418',
  },
  customizeTopAreaLight: {
    backgroundColor: '#F5F7FB',
  },
  customizeTopNav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    width: '100%',
  },
  customizeNavBtnText: {
    fontSize: 16,
    fontWeight: '400',
  },
  customizeNavDoneText: {
    fontWeight: '700',
  },
  customizeNavTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  customizePillContainer: {
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
  },
  customizePillCapsule: {
    alignItems: 'center',
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  customizePillCapsuleDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  customizePillCapsuleLight: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(16, 32, 58, 0.12)',
    elevation: 3,
    shadowColor: '#25272B',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  customizeSlotCircle: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'transparent',
    height: 44,
    justifyContent: 'center',
    marginHorizontal: 3,
    width: 44,
  },
  customizeSlotActiveDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderColor: 'rgba(255, 255, 255, 0.75)',
  },
  customizeSlotActiveLight: {
    backgroundColor: 'rgba(16, 32, 58, 0.12)',
    borderColor: 'rgba(16, 32, 58, 0.5)',
  },
  customizeSlotEmojiText: {
    fontSize: 26,
    includeFontPadding: false,
    textAlign: 'center',
  },
  customizeSubtitleText: {
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  customizeSubtitleDark: {
    color: 'rgba(255, 255, 255, 0.72)',
  },
  customizeSubtitleLight: {
    color: 'rgba(16, 32, 58, 0.65)',
  },

  // Bottom sheet container & surface
  bottomSheetContainer: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    zIndex: 100,
  },
  bottomSheetSurface: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    flex: 1,
    width: '100%',
  },
  bottomSheetSurfaceDark: {
    backgroundColor: '#1E222A',
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  bottomSheetSurfaceLight: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(16, 32, 58, 0.10)',
  },
  sheetHeaderArea: {
    width: '100%',
  },
  sheetHandleTouchArea: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    paddingVertical: 10,
    width: '100%',
  },
  sheetHandleBar: {
    borderRadius: 2.5,
    height: 5,
    width: 44,
  },
  sheetHandleBarDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  sheetHandleBarLight: {
    backgroundColor: 'rgba(16, 32, 58, 0.22)',
  },

  // Search input
  sheetSearchContainer: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    height: 38,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  sheetSearchDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  sheetSearchLight: {
    backgroundColor: '#F0F2F6',
  },
  sheetSearchInput: {
    flex: 1,
    fontSize: 15,
    marginLeft: 8,
    paddingVertical: 0,
  },

  // Scroll & sections
  sheetScrollWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: 24,
  },
  sectionBlock: {
    marginTop: 12,
  },
  sectionTitleText: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  yourReactionsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  customizeLinkText: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  emojiGridSix: {
    alignContent: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 6,
    width: '100%',
  },
  emojiCellSix: {
    alignItems: 'center',
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    width: '16.6666%',
  },
  emojiCellPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.84 }],
  },
  emojiGlyphSix: {
    fontSize: 29,
    includeFontPadding: false,
    textAlign: 'center',
  },

  // Bottom category toolbar
  bottomCategoryBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    width: '100%',
  },
  bottomCategoryBarDark: {
    backgroundColor: '#181A20',
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bottomCategoryBarLight: {
    backgroundColor: '#FFFFFF',
    borderTopColor: 'rgba(16, 32, 58, 0.08)',
  },
  categoryBarBtn: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    minWidth: 34,
    paddingHorizontal: 4,
  },
  categoryBarBtnActiveDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  categoryBarBtnActiveLight: {
    backgroundColor: 'rgba(16, 32, 58, 0.1)',
  },
  categoryBarIconText: {
    fontSize: 18,
    includeFontPadding: false,
  },
});
