import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ActivityIndicator, Dimensions, Keyboard, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import FeatureIcon from './FeatureIcon';
import DecryptedChatImage from './DecryptedChatImage';
import { getDecryptedMediaUri, getSyncCachedMediaUri } from '../services/chatMediaService';
import { measureImageAspectRatio, getCachedAspectRatio, copyImageToClipboard, saveImageToGallery } from '../utils/chatImageUtils';
import { project, rubberband } from '../utils/motion';
import { showAlert } from '../utils/appAlert';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * ChatImageViewerModal
 * Fullscreen Interactive Image Viewer:
 * - 2-finger pinch-to-zoom (Pinch Gesture) up to 4.5x with smooth 1-finger panning.
 * - Auto-hides top header and bottom input bar when zooming in (Immersive Mode).
 * - Tap to toggle controls / Double-tap to quick-zoom.
 * - Top header with close button, image counter (1/N), and navigation arrows.
 * - Bottom input box with capsule text input and send button to reply directly while viewing the image.
 * - Preserves natural aspect ratio (portrait & landscape) with contain scaling.
 */
export default function ChatImageViewerModal({
  visible = false,
  images = [],
  initialIndex = 0,
  conversationId,
  currentUserId,
  onClose,
  onSendMessage,
  partnerName = '',
  protectedMedia = false,
}) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isKeyboardOpenRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const keyboardTranslateY = useSharedValue(0);
  const keyboardOpenSV = useSharedValue(0);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const controlsOpacity = useSharedValue(1);
  const pinchActive = useSharedValue(0);
  /** 1 = double-tap zoom stays until reset; pinch never sets this. */
  const lockedZoom = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const totalSV = useSharedValue(0);
  const currentIndexSV = useSharedValue(initialIndex);
  const cardWidthSV = useSharedValue(0);
  const cardHeightSV = useSharedValue(0);
  const controlsVisible = useRef(true);
  const [controlsShown, setControlsShown] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        isKeyboardOpenRef.current = true;
        keyboardOpenSV.set(1);
        const keyboardHeight = e?.endCoordinates?.height || 0;
        const bottomPadding = Math.max(insets.bottom, 12);
        const targetOffset = keyboardHeight > 0
          ? -(keyboardHeight - bottomPadding + 6)
          : 0;
        keyboardTranslateY.set(withTiming(targetOffset, {
          duration: Platform.OS === 'ios' ? (e?.duration || 250) : 0,
        }));
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        isKeyboardOpenRef.current = false;
        keyboardOpenSV.set(0);
        keyboardTranslateY.set(withTiming(0, {
          duration: Platform.OS === 'ios' ? (e?.duration || 250) : 0,
        }));
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible, keyboardTranslateY, keyboardOpenSV, insets.bottom]);

  const total = images.length;
  const currentImageUri = images[currentIndex] || null;
  const [imageRatio, setImageRatio] = useState(() => getCachedAspectRatio(currentImageUri) || null);

  useEffect(() => {
    if (!currentImageUri) return;
    const cached = getCachedAspectRatio(currentImageUri);
    if (cached) {
      setImageRatio(cached);
      return;
    }
    measureImageAspectRatio(currentImageUri, (ratio) => {
      if (ratio && ratio > 0) {
        setImageRatio(ratio);
      }
    });
  }, [currentImageUri]);

  const handleCopyCurrentImage = useCallback(async () => {
    if (protectedMedia) return;
    if (!currentImageUri) return;
    let uriToCopy = currentImageUri;
    try {
      uriToCopy =
        getSyncCachedMediaUri(currentImageUri, 'image') ||
        (await getDecryptedMediaUri(currentImageUri, {
          conversationId,
          currentUserId,
          mediaType: 'image',
        })) ||
        currentImageUri;
    } catch (_) {
      uriToCopy = currentImageUri;
    }
    const success = await copyImageToClipboard(uriToCopy);
    if (success) {
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2200);
    }
  }, [currentImageUri, conversationId, currentUserId, protectedMedia]);

  const handleSaveCurrentImage = useCallback(async () => {
    if (protectedMedia) return;
    if (!currentImageUri || isSaving) return;
    setIsSaving(true);
    let uriToSave = currentImageUri;
    try {
      uriToSave =
        getSyncCachedMediaUri(currentImageUri, 'image') ||
        (await getDecryptedMediaUri(currentImageUri, {
          conversationId,
          currentUserId,
          mediaType: 'image',
        })) ||
        currentImageUri;
    } catch (_) {
      uriToSave = currentImageUri;
    }
    const res = await saveImageToGallery(uriToSave);
    setIsSaving(false);
    if (res?.success) {
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 2200);
    } else if (res?.error === 'permission_denied' || res?.error === 'permission_blocked') {
      showAlert('ต้องได้รับอนุญาต', 'กรุณาอนุญาตการเข้าถึงรูปภาพในตั้งค่าเพื่อบันทึกรูปลงในเครื่อง', { tone: 'warning' });
    } else {
      showAlert('บันทึกรูปไม่สำเร็จ', 'เกิดข้อผิดพลาดในการบันทึกรูปภาพ กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    }
  }, [currentImageUri, conversationId, currentUserId, isSaving, protectedMedia]);

  // Optimal floating card dimensions: leaves margins on left/right and safe bounds between bars
  // so the photo is not edge-to-edge ("ไม่ต้องเต็มจอ") and has rounded corners ("ให้โค้งมน")
  const maxCardWidth = Math.min(SCREEN_WIDTH - 36, 440);
  const topReserved = Math.max(insets.top, 24) + 54;
  const bottomReserved = Math.max(insets.bottom, 12) + 64;
  const maxCardHeight = Math.max(SCREEN_HEIGHT - topReserved - bottomReserved - 24, 220);

  const cardDimensions = useMemo(() => {
    const ratio = imageRatio || 0.75;
    const containerRatio = maxCardWidth / maxCardHeight;

    if (ratio >= containerRatio) {
      const width = maxCardWidth;
      const height = Math.min(Math.round(width / ratio), maxCardHeight);
      return { width, height };
    } else {
      const height = maxCardHeight;
      const width = Math.min(Math.round(height * ratio), maxCardWidth);
      return { width, height };
    }
  }, [imageRatio, maxCardWidth, maxCardHeight]);

  useEffect(() => {
    totalSV.set(total);
  }, [total, totalSV]);

  useEffect(() => {
    currentIndexSV.set(currentIndex);
  }, [currentIndex, currentIndexSV]);

  useEffect(() => {
    cardWidthSV.set(cardDimensions.width);
    cardHeightSV.set(cardDimensions.height);
  }, [cardDimensions.height, cardDimensions.width, cardHeightSV, cardWidthSV]);

  const resetZoom = useCallback((immediate = false) => {
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    pinchActive.set(0);
    lockedZoom.set(0);
    if (immediate) {
      scale.set(1);
      translateX.set(0);
      translateY.set(0);
      return;
    }
    scale.set(withSpring(1, { duration: 400, dampingRatio: 0.8 }));
    translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
  }, [lockedZoom, pinchActive, scale, translateX, translateY]);

  const hideControls = useCallback(() => {
    Keyboard.dismiss();
    controlsVisible.current = false;
    setControlsShown(false);
    cancelAnimation(controlsOpacity);
    controlsOpacity.set(withTiming(0, { duration: 160, easing: EASE_OUT }));
  }, [controlsOpacity]);

  const showControls = useCallback(() => {
    controlsVisible.current = true;
    setControlsShown(true);
    cancelAnimation(controlsOpacity);
    controlsOpacity.set(withTiming(1, { duration: 180, easing: EASE_OUT }));
  }, [controlsOpacity]);

  const resetZoomAndControls = useCallback((immediate = false) => {
    resetZoom(immediate);
    showControls();
  }, [resetZoom, showControls]);

  const toggleControls = useCallback(() => {
    if (controlsVisible.current) {
      hideControls();
    } else {
      showControls();
    }
  }, [hideControls, showControls]);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const openingIndex = initialIndex >= 0 && initialIndex < images.length ? initialIndex : 0;
  const openingImage = images[openingIndex];
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (visible) {
      setCurrentIndex(openingIndex);
      setImageRatio(getCachedAspectRatio(openingImage) || null);
      setReplyText('');
      setJustSent(false);
      keyboardTranslateY.set(0);
      keyboardOpenSV.set(0);
      isKeyboardOpenRef.current = false;
      resetZoom(true);
      controlsVisible.current = false;
      showControls();
    } else if (wasVisible) {
      Keyboard.dismiss();
      keyboardTranslateY.set(0);
      keyboardOpenSV.set(0);
      isKeyboardOpenRef.current = false;
      resetZoomAndControls(true);
    }
  }, [keyboardOpenSV, keyboardTranslateY, openingImage, openingIndex, resetZoom, resetZoomAndControls, showControls, visible]);

  useAnimatedReaction(
    () => scale.get() > 1.05,
    (zoomed, previous) => {
      if (zoomed === previous) return;
      if (zoomed) {
        scheduleOnRN(hideControls);
      } else {
        scheduleOnRN(showControls);
      }
    },
    [hideControls, showControls]
  );

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const totalRef = useRef(total);
  totalRef.current = total;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const commitIndex = useCallback((dir) => {
    const cur = currentIndexRef.current;
    const tot = totalRef.current;
    const imgs = imagesRef.current;
    const nextIdx = cur + dir;
    if (nextIdx < 0 || nextIdx >= tot) {
      translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      return;
    }
    setCurrentIndex(nextIdx);
    setImageRatio(getCachedAspectRatio(imgs[nextIdx]) || null);
    scale.set(1);
    translateY.set(0);
    lockedZoom.set(0);
    pinchActive.set(0);
    translateX.set(-dir * SCREEN_WIDTH * 0.7);
    translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
    showControls();
  }, [lockedZoom, pinchActive, scale, showControls, translateX, translateY]);

  const closeViewer = useCallback(() => {
    translateY.set(0);
    translateX.set(0);
    scale.set(1);
    lockedZoom.set(0);
    pinchActive.set(0);
    showControls();
    onCloseRef.current?.();
  }, [lockedZoom, pinchActive, scale, showControls, translateX, translateY]);

  const imageGestures = useMemo(() => {
    const springFit = (velocity = 0) => {
      'worklet';
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      lockedZoom.set(0);
      // Keep pinchActive until the spring settles so Simultaneous pan cannot fight the reset.
      pinchActive.set(1);
      scale.set(withSpring(1, { duration: 400, dampingRatio: 0.8, velocity }, (finished) => {
        if (finished) pinchActive.set(0);
      }));
      translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      scheduleOnRN(showControls);
    };

    const pinch = Gesture.Pinch()
      .onTouchesDown((_e, state) => {
        if (keyboardOpenSV.get()) state.fail();
      })
      .onStart((event) => {
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        lockedZoom.set(0);
        pinchActive.set(1);
        pinchStartScale.set(scale.get());
        pinchStartX.set(translateX.get());
        pinchStartY.set(translateY.get());
        pinchFocalX.set(event.focalX);
        pinchFocalY.set(event.focalY);
        scheduleOnRN(hideControls);
      })
      .onUpdate((event) => {
        const nextScale = Math.min(Math.max(pinchStartScale.get() * event.scale, 0.75), 4.5);
        scale.set(nextScale);
        translateX.set(pinchStartX.get() + (event.focalX - pinchFocalX.get()));
        translateY.set(pinchStartY.get() + (event.focalY - pinchFocalY.get()));
      })
      .onEnd((event) => {
        // Pinch is temporary: always return to the original fit when fingers lift.
        springFit(event.velocity || 0);
      })
      .onFinalize((_event, success) => {
        // Interrupted / cancelled pinch must still restore fit + chrome.
        // Do not clear pinchActive on success — springFit owns it until scale settles.
        if (!success) {
          if (scale.get() > 1.02 || scale.get() < 0.98 || translateX.get() !== 0 || translateY.get() !== 0) {
            springFit(0);
          } else {
            pinchActive.set(0);
          }
        }
      });

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(8)
      .onTouchesDown((_e, state) => {
        if (keyboardOpenSV.get()) state.fail();
      })
      .onStart(() => {
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        panStartX.set(translateX.get());
        panStartY.set(translateY.get());
      })
      .onUpdate((event) => {
        if (pinchActive.get()) return;
        const currentScale = scale.get();
        // Pan-while-zoomed only for double-tap lock — never during/after pinch.
        if (lockedZoom.get() && currentScale > 1.02) {
          const maxX = Math.max(0, (cardWidthSV.get() * (currentScale - 1)) / 2);
          const maxY = Math.max(0, (cardHeightSV.get() * (currentScale - 1)) / 2);
          let nextX = panStartX.get() + event.translationX;
          let nextY = panStartY.get() + event.translationY;
          if (nextX > maxX) nextX = maxX + rubberband(nextX - maxX, cardWidthSV.get() || SCREEN_WIDTH);
          else if (nextX < -maxX) nextX = -maxX - rubberband(-maxX - nextX, cardWidthSV.get() || SCREEN_WIDTH);
          if (nextY > maxY) nextY = maxY + rubberband(nextY - maxY, cardHeightSV.get() || SCREEN_HEIGHT);
          else if (nextY < -maxY) nextY = -maxY - rubberband(-maxY - nextY, cardHeightSV.get() || SCREEN_HEIGHT);
          translateX.set(nextX);
          translateY.set(nextY);
          return;
        }
        if (currentScale > 1.02) return;
        const absX = Math.abs(event.translationX);
        const absY = Math.abs(event.translationY);
        if (absX > absY && totalSV.get() > 1) {
          const atStart = currentIndexSV.get() === 0 && event.translationX > 0;
          const atEnd = currentIndexSV.get() >= totalSV.get() - 1 && event.translationX < 0;
          translateX.set((atStart || atEnd) ? rubberband(event.translationX, SCREEN_WIDTH) : event.translationX);
          translateY.set(0);
        } else {
          translateY.set(event.translationY);
          translateX.set(0);
        }
      })
      .onEnd((event) => {
        if (pinchActive.get()) return;
        const currentScale = scale.get();
        if (lockedZoom.get() && currentScale > 1.02) {
          const maxX = Math.max(0, (cardWidthSV.get() * (currentScale - 1)) / 2);
          const maxY = Math.max(0, (cardHeightSV.get() * (currentScale - 1)) / 2);
          const nextX = Math.min(maxX, Math.max(-maxX, translateX.get()));
          const nextY = Math.min(maxY, Math.max(-maxY, translateY.get()));
          translateX.set(withSpring(nextX, { duration: 400, dampingRatio: 0.8, velocity: event.velocityX }));
          translateY.set(withSpring(nextY, { duration: 400, dampingRatio: 0.8, velocity: event.velocityY }));
          return;
        }
        // Mid pinch-reset: do not swipe/dismiss from residual pan.
        if (currentScale > 1.02) return;
        const dx = event.translationX;
        const dy = event.translationY;
        const vx = event.velocityX;
        const vy = event.velocityY;
        const isMostlyHorizontal = Math.abs(dx) > Math.abs(dy);
        if (isMostlyHorizontal && totalSV.get() > 1) {
          const projected = dx + project(vx);
          if (dx < -50 || vx < -350 || projected < -50) {
            translateX.set(withTiming(-SCREEN_WIDTH * 0.9, { duration: 160, easing: EASE_OUT }, (finished) => {
              if (finished) scheduleOnRN(commitIndex, 1);
            }));
            return;
          }
          if (dx > 50 || vx > 350 || projected > 50) {
            translateX.set(withTiming(SCREEN_WIDTH * 0.9, { duration: 160, easing: EASE_OUT }, (finished) => {
              if (finished) scheduleOnRN(commitIndex, -1);
            }));
            return;
          }
          translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: vx }));
          return;
        }
        if (Math.abs(dy) > 10) {
          const projected = dy + project(vy);
          if (Math.abs(dy) > 110 || Math.abs(vy) > 600 || Math.abs(projected) > SCREEN_HEIGHT * 0.28) {
            const to = dy > 0 || vy > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT;
            translateY.set(withSpring(to, {
              duration: 300,
              dampingRatio: 1,
              velocity: vy,
              overshootClamping: true,
            }, (finished) => {
              if (finished) scheduleOnRN(closeViewer);
            }));
            return;
          }
          translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: vy }));
          return;
        }
        translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: vx }));
        translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: vy }));
      })
      .onFinalize((_event, success) => {
        if (success || pinchActive.get() || lockedZoom.get() || scale.get() > 1.02) return;
        translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
        translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        if (scale.get() > 1.1 || lockedZoom.get()) {
          springFit(0);
        } else {
          cancelAnimation(scale);
          cancelAnimation(translateX);
          cancelAnimation(translateY);
          lockedZoom.set(1);
          pinchActive.set(0);
          scale.set(withSpring(2.2, { duration: 400, dampingRatio: 0.8 }));
          translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
          translateY.set(withSpring(0, { duration: 400, dampingRatio: 0.8 }));
          scheduleOnRN(hideControls);
        }
      });

    const tap = Gesture.Tap()
      .maxDuration(250)
      .onEnd(() => {
        if (keyboardOpenSV.get()) {
          scheduleOnRN(dismissKeyboard);
          return;
        }
        if (scale.get() <= 1.05) {
          scheduleOnRN(toggleControls);
        }
      });

    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, tap));
  }, [
    cardHeightSV,
    cardWidthSV,
    closeViewer,
    commitIndex,
    currentIndexSV,
    dismissKeyboard,
    hideControls,
    keyboardOpenSV,
    lockedZoom,
    panStartX,
    panStartY,
    pinchActive,
    pinchFocalX,
    pinchFocalY,
    pinchStartScale,
    pinchStartX,
    pinchStartY,
    scale,
    showControls,
    toggleControls,
    totalSV,
    translateX,
    translateY,
  ]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));

  const headerStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.get(),
    transform: [{ translateY: interpolate(controlsOpacity.get(), [0, 1], [-30, 0]) }],
  }));

  const bottomBarStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.get(),
    transform: [{
      translateY: interpolate(controlsOpacity.get(), [0, 1], [40, 0]) + keyboardTranslateY.get(),
    }],
  }));

  // Handle Send Reply from Bottom Input Bar
  const handleSend = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed || isSending) return;

    try {
      setIsSending(true);
      Keyboard.dismiss();
      await onSendMessage?.(trimmed);
      setReplyText('');
      setJustSent(true);
      setTimeout(() => setJustSent(false), 2400);
    } catch (err) {
      console.warn('Failed to send message from image viewer:', err);
    } finally {
      setIsSending(false);
    }
  }, [replyText, isSending, onSendMessage]);

  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <GestureHandlerRootView style={styles.container}>
        {/* Zoomable Image Container */}
        <GestureDetector gesture={imageGestures}>
          <Animated.View style={styles.imageLayer}>
            <Animated.View style={[styles.imageTransformWrapper, imageStyle]}>
            {currentImageUri ? (
              <View style={[styles.cardWrapper, cardDimensions]}>
                <DecryptedChatImage
                  conversationId={conversationId}
                  currentUserId={currentUserId}
                  mediaUrl={currentImageUri}
                  onAspectRatioMeasured={(ratio) => {
                    if (ratio && ratio > 0) setImageRatio(ratio);
                  }}
                  pointerEvents="none"
                  resizeMode="cover"
                  showExpandBadge={false}
                  style={styles.cardImage}
                />
              </View>
            ) : null}
            </Animated.View>
          </Animated.View>
        </GestureDetector>



        {/* Top Header Bar (disappears when zoomed) */}
        <Animated.View
          pointerEvents={controlsShown ? 'box-none' : 'none'}
          style={[
            styles.headerBar,
            { paddingTop: Math.max(insets.top, 24) + 6 },
            headerStyle,
          ]}
        >
          <Pressable
            accessibilityLabel="ปิดหน้าดูรูปภาพ"
            hitSlop={12}
            onPress={onClose}
            style={({ pressed }) => [styles.headerCloseBtn, pressed && styles.pressed]}
          >
            <FeatureIcon color="#FFFFFF" name="xmark" size={18} />
          </Pressable>

          {/* Counter Badge or Title */}
          {total > 1 ? (
            <View style={styles.counterBadge}>
              <Text style={styles.counterText}>
                {currentIndex + 1} / {total}
              </Text>
            </View>
          ) : (
            <Text numberOfLines={1} style={styles.headerTitle}>
              {partnerName ? `รูปภาพจาก ${partnerName}` : 'รูปภาพ'}
            </Text>
          )}

          {!protectedMedia && <View style={styles.headerRightActions}>
            <Pressable
              accessibilityLabel="บันทึกรูปภาพ"
              disabled={isSaving}
              hitSlop={12}
              onPress={handleSaveCurrentImage}
              style={({ pressed }) => [styles.headerCloseBtn, pressed && styles.pressed]}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <FeatureIcon color="#FFFFFF" name="arrow.down.to.line" size={18} />
              )}
            </Pressable>

            <Pressable
              accessibilityLabel="คัดลอกรูปภาพ"
              hitSlop={12}
              onPress={handleCopyCurrentImage}
              style={({ pressed }) => [styles.headerCloseBtn, pressed && styles.pressed]}
            >
              <FeatureIcon color="#FFFFFF" name="doc.on.doc" size={17} />
            </Pressable>
          </View>}
        </Animated.View>

        {/* Save Success Toast */}
        {saveToast && (
          <View style={styles.copyToast}>
            <FeatureIcon color="#34D399" name="checkmark.circle.fill" size={15} />
            <Text style={styles.copyToastText}>บันทึกรูปภาพแล้ว</Text>
          </View>
        )}

        {/* Copy Success Toast */}
        {copyToast && (
          <View style={styles.copyToast}>
            <FeatureIcon color="#34D399" name="checkmark.circle.fill" size={15} />
            <Text style={styles.copyToastText}>คัดลอกรูปภาพแล้ว</Text>
          </View>
        )}

        {/* Bottom Input Box Bar (disappears when zoomed, smoothly slides up with keyboard) */}
        <Animated.View
          pointerEvents={controlsShown ? 'box-none' : 'none'}
          style={[styles.bottomBarContainer, bottomBarStyle]}
        >
          {justSent && (
            <View style={styles.sentToast}>
              <FeatureIcon color="#34D399" name="checkmark.circle.fill" size={14} />
              <Text style={styles.sentToastText}>ส่งข้อความแล้ว</Text>
            </View>
          )}

          <View
            style={[
              styles.inputCapsuleWrapper,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            <View style={styles.inputCapsule}>
              <TextInput
                accessibilityLabel="พิมพ์ข้อความตอบกลับ"
                autoCapitalize="sentences"
                autoCorrect={false}
                clearButtonMode="while-editing"
                editable={!isSending}
                multiline={false}
                onChangeText={setReplyText}
                onSubmitEditing={handleSend}
                placeholder="ตอบกลับ..."
                placeholderTextColor="rgba(255, 255, 255, 0.45)"
                returnKeyType="send"
                style={styles.textInput}
                value={replyText}
              />

              {replyText.length > 0 && (
                <Pressable
                  accessibilityLabel="ลบข้อความทั้งหมด"
                  hitSlop={8}
                  onPress={() => setReplyText('')}
                  style={styles.clearBtn}
                >
                  <Ionicons color="rgba(255, 255, 255, 0.65)" name="close-circle" size={18} />
                </Pressable>
              )}

              <Pressable
                accessibilityLabel="ส่งข้อความ"
                disabled={!replyText.trim() || isSending}
                hitSlop={8}
                onPress={handleSend}
                style={({ pressed }) => [
                  styles.sendBtn,
                  (!replyText.trim() || isSending) && styles.sendBtnDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={styles.sendIconContainer}>
                    <Ionicons
                      color="#FFFFFF"
                      name="send"
                      size={16}
                      style={styles.sendIcon}
                    />
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },
  imageLayer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  imageTransformWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrapper: {
    backgroundColor: '#10131B',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 14,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
  },
  cardImage: {
    borderRadius: 24,
    height: '100%',
    width: '100%',
  },
  headerBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  headerCloseBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerRightActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  headerTitle: {
    color: 'rgba(255, 255, 255, 0.90)',
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 200,
  },
  counterBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  counterText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  bottomBarContainer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 20,
  },
  sentToast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  sentToastText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  inputCapsuleWrapper: {
    backgroundColor: 'rgba(10, 12, 16, 0.78)',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  inputCapsule: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    maxHeight: 48,
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 0,
  },
  textInput: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 14.5,
    height: 38,
    lineHeight: 19,
    marginVertical: 0,
    paddingVertical: 0,
  },
  sendBtn: {
    alignItems: 'center',
    alignSelf: 'center',
    aspectRatio: 1,
    backgroundColor: '#3B5AFE',
    borderRadius: 18,
    elevation: 2,
    flexShrink: 0,
    height: 36,
    justifyContent: 'center',
    marginLeft: 8,
    maxHeight: 36,
    maxWidth: 36,
    minHeight: 36,
    minWidth: 36,
    overflow: 'hidden',
    shadowColor: '#3B5AFE',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    width: 36,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  clearBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    marginRight: 4,
    width: 28,
  },
  sendIconContainer: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  sendIcon: {
    includeFontPadding: false,
    marginLeft: 2,
    marginTop: 1,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.94 }],
  },
  copyToast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderColor: 'rgba(52, 211, 153, 0.45)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 9,
    position: 'absolute',
    top: 75,
    zIndex: 99,
  },
  copyToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
