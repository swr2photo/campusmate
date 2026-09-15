import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import FeatureIcon from './FeatureIcon';
import DecryptedChatImage from './DecryptedChatImage';
import { getDecryptedMediaUri, getSyncCachedMediaUri } from '../services/chatMediaService';
import { measureImageAspectRatio, getCachedAspectRatio, copyImageToClipboard, saveImageToGallery } from '../utils/chatImageUtils';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const keyboardTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        isKeyboardOpenRef.current = true;
        const keyboardHeight = e?.endCoordinates?.height || 0;
        const bottomPadding = Math.max(insets.bottom, 12);
        // Translate up by keyboardHeight minus bottom safe area padding already present
        const targetOffset = keyboardHeight > 0
          ? -(keyboardHeight - bottomPadding + 6)
          : 0;
        Animated.timing(keyboardTranslateY, {
          toValue: targetOffset,
          duration: Platform.OS === 'ios' ? (e?.duration || 250) : 0,
          useNativeDriver: true,
        }).start();
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        isKeyboardOpenRef.current = false;
        Animated.timing(keyboardTranslateY, {
          toValue: 0,
          duration: Platform.OS === 'ios' ? (e?.duration || 250) : 0,
          useNativeDriver: true,
        }).start();
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible, keyboardTranslateY, insets.bottom]);

  // Animation values for zoom & pan
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  // Animation values for header & bottom input visibility
  const controlsOpacityAnim = useRef(new Animated.Value(1)).current;
  const controlsVisible = useRef(true);

  // Gesture tracking refs
  const currentScale = useRef(1);
  const baseScale = useRef(1);
  const initialDistance = useRef(0);
  const initialCenter = useRef(null);
  const isPinching = useRef(false);
  const currentTranslateX = useRef(0);
  const currentTranslateY = useRef(0);
  const lastPanX = useRef(0);
  const lastPanY = useRef(0);
  const lastTapTime = useRef(0);
  const singleTapTimer = useRef(null);

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
      Alert.alert('ต้องได้รับอนุญาต', 'กรุณาอนุญาตการเข้าถึงรูปภาพในตั้งค่าเพื่อบันทึกรูปลงในเครื่อง');
    } else {
      Alert.alert('บันทึกรูปไม่สำเร็จ', 'เกิดข้อผิดพลาดในการบันทึกรูปภาพ กรุณาลองใหม่อีกครั้ง');
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

  // Reset zoom & pan when image changes or modal opens
  const resetZoom = useCallback((immediate = false) => {
    currentScale.current = 1;
    baseScale.current = 1;
    initialDistance.current = 0;
    initialCenter.current = null;
    isPinching.current = false;
    currentTranslateX.current = 0;
    currentTranslateY.current = 0;
    lastPanX.current = 0;
    lastPanY.current = 0;

    if (immediate) {
      scaleAnim.setValue(1);
      translateXAnim.setValue(0);
      translateYAnim.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 200, useNativeDriver: true }),
      Animated.spring(translateXAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim, translateXAnim, translateYAnim]);

  // Parents may pass a fresh images array on every keystroke. Only reset for
  // an actual opening/selection change, never for array identity alone.
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
      keyboardTranslateY.setValue(0);
      isKeyboardOpenRef.current = false;
      resetZoom(true);
      showControls();
    } else if (wasVisible) {
      Keyboard.dismiss();
      keyboardTranslateY.setValue(0);
      isKeyboardOpenRef.current = false;
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    }
  }, [visible, openingIndex, openingImage, resetZoom, keyboardTranslateY]);

  // Controls visibility functions
  const hideControls = useCallback(() => {
    Keyboard.dismiss();
    if (!controlsVisible.current) return;
    controlsVisible.current = false;
    Animated.timing(controlsOpacityAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [controlsOpacityAnim]);

  const showControls = useCallback(() => {
    if (controlsVisible.current) return;
    controlsVisible.current = true;
    Animated.timing(controlsOpacityAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [controlsOpacityAnim]);

  const toggleControls = useCallback(() => {
    if (controlsVisible.current) {
      hideControls();
    } else {
      showControls();
    }
  }, [hideControls, showControls]);

  const hasZoomed = useRef(false);

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const totalRef = useRef(total);
  totalRef.current = total;
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Next / Previous Image Navigation with smooth slide animation
  const handlePrevImage = useCallback(() => {
    const cur = currentIndexRef.current;
    const imgs = imagesRef.current;
    if (cur > 0) {
      const prevIdx = cur - 1;
      Animated.timing(translateXAnim, {
        toValue: SCREEN_WIDTH * 0.9,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        setCurrentIndex(prevIdx);
        setImageRatio(getCachedAspectRatio(imgs[prevIdx]) || null);
        resetZoom();
        translateXAnim.setValue(-SCREEN_WIDTH * 0.7);
        Animated.spring(translateXAnim, {
          toValue: 0,
          friction: 8,
          tension: 190,
          useNativeDriver: true,
        }).start();
      });
    } else {
      Animated.spring(translateXAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
    }
  }, [resetZoom, translateXAnim]);

  const handleNextImage = useCallback(() => {
    const cur = currentIndexRef.current;
    const tot = totalRef.current;
    const imgs = imagesRef.current;
    if (cur < tot - 1) {
      const nextIdx = cur + 1;
      Animated.timing(translateXAnim, {
        toValue: -SCREEN_WIDTH * 0.9,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        setCurrentIndex(nextIdx);
        setImageRatio(getCachedAspectRatio(imgs[nextIdx]) || null);
        resetZoom();
        translateXAnim.setValue(SCREEN_WIDTH * 0.7);
        Animated.spring(translateXAnim, {
          toValue: 0,
          friction: 8,
          tension: 190,
          useNativeDriver: true,
        }).start();
      });
    } else {
      Animated.spring(translateXAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
    }
  }, [resetZoom, translateXAnim]);

  const handlePrevImageRef = useRef(handlePrevImage);
  handlePrevImageRef.current = handlePrevImage;
  const handleNextImageRef = useRef(handleNextImage);
  handleNextImageRef.current = handleNextImage;

  // PanResponder for 2-finger pinch to zoom, vertical dismiss, and horizontal swipe navigation
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        // When keyboard is open, do NOT claim touches on start (allows input focus and text selection)
        if (isKeyboardOpenRef.current) {
          return false;
        }
        return true;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Intercept if 2 touches (pinch)
        if (evt.nativeEvent.touches.length === 2) {
          return true;
        }
        // When keyboard is open, do NOT intercept 1-finger drags (allows text selection / cursor dragging)
        if (isKeyboardOpenRef.current) {
          return false;
        }
        // If somehow still scaled and 1 finger moves, intercept so we can reset immediately
        if (currentScale.current > 1.02) {
          return true;
        }
        // When not zoomed, intercept vertical slide (dismiss) or horizontal slide (swipe between images)
        const isVertical = Math.abs(gestureState.dy) > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        const isHorizontal = totalRef.current > 1 && Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        return isVertical || isHorizontal;
      },
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          // 2-finger pinch start
          isPinching.current = true;
          hasZoomed.current = true;
          initialDistance.current = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY
          );
          initialCenter.current = {
            x: (touches[0].pageX + touches[1].pageX) / 2,
            y: (touches[0].pageY + touches[1].pageY) / 2,
          };
          baseScale.current = currentScale.current;
        } else if (touches.length === 1) {
          lastPanX.current = currentTranslateX.current;
          lastPanY.current = currentTranslateY.current;
          // If 1 finger touches while zoomed, immediately snap back to 1x
          if (currentScale.current > 1.02 || isPinching.current || hasZoomed.current) {
            isPinching.current = false;
            hasZoomed.current = false;
            resetZoom();
            showControls();
          }
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2 && initialDistance.current > 0) {
          isPinching.current = true;
          hasZoomed.current = true;
          // 2-finger pinch gesture
          const currentDistance = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY
          );
          const ratio = currentDistance / (initialDistance.current || 1);
          let nextScale = baseScale.current * ratio;
          nextScale = Math.min(Math.max(nextScale, 0.75), 4.5);
          currentScale.current = nextScale;
          scaleAnim.setValue(nextScale);

          // Follow 2-finger center point movement
          if (initialCenter.current) {
            const currentCenterX = (touches[0].pageX + touches[1].pageX) / 2;
            const currentCenterY = (touches[0].pageY + touches[1].pageY) / 2;
            const nextX = currentCenterX - initialCenter.current.x;
            const nextY = currentCenterY - initialCenter.current.y;
            currentTranslateX.current = nextX;
            currentTranslateY.current = nextY;
            translateXAnim.setValue(nextX);
            translateYAnim.setValue(nextY);
          }

          // Hide header & input bar when zooming in
          if (nextScale > 1.05) {
            hideControls();
          }
        } else if (touches.length < 2 && (isPinching.current || hasZoomed.current || currentScale.current > 1.02)) {
          // One finger lifted while zooming: immediately spring back to initial scale (1x)
          isPinching.current = false;
          hasZoomed.current = false;
          initialDistance.current = 0;
          initialCenter.current = null;
          resetZoom();
          showControls();
        } else if (touches.length === 1 && currentScale.current <= 1.05 && !isPinching.current) {
          const isMostlyHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
          if (isMostlyHorizontal && totalRef.current > 1) {
            const cur = currentIndexRef.current;
            const tot = totalRef.current;
            // Rubber band resistance when at the first or last image
            if ((cur === 0 && gestureState.dx > 0) || (cur === tot - 1 && gestureState.dx < 0)) {
              translateXAnim.setValue(gestureState.dx * 0.28);
            } else {
              translateXAnim.setValue(gestureState.dx);
            }
          } else {
            // 1-finger vertical slide when not zoomed (rubber-band drag)
            translateYAnim.setValue(gestureState.dy);
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        initialDistance.current = 0;
        initialCenter.current = null;

        // User released gesture: if scaled or was pinching, ALWAYS spring back to 1x and show controls!
        if (isPinching.current || hasZoomed.current || currentScale.current > 1.02) {
          isPinching.current = false;
          hasZoomed.current = false;
          resetZoom();
          showControls();
          return;
        }

        // Check for Tap gesture (minimal move)
        const isTap = Math.abs(gestureState.dx) < 6 && Math.abs(gestureState.dy) < 6;

        if (isTap && evt.nativeEvent.touches.length === 0) {
          const now = Date.now();
          if (now - lastTapTime.current < 280) {
            // Double Tap: toggle zoom
            if (singleTapTimer.current) {
              clearTimeout(singleTapTimer.current);
              singleTapTimer.current = null;
            }
            lastTapTime.current = 0;
            if (currentScale.current > 1.1) {
              // Zoom out to 1x
              resetZoom();
              showControls();
            } else {
              // Zoom in to 2.2x
              currentScale.current = 2.2;
              baseScale.current = 2.2;
              Animated.spring(scaleAnim, { toValue: 2.2, friction: 6, tension: 180, useNativeDriver: true }).start();
              hideControls();
            }
            return;
          }

          // If keyboard is open, single tap on photo dismisses the keyboard immediately
          if (isKeyboardOpenRef.current) {
            Keyboard.dismiss();
            return;
          }

          lastTapTime.current = now;
          singleTapTimer.current = setTimeout(() => {
            lastTapTime.current = 0;
            // Single Tap: toggle controls if not zoomed
            if (currentScale.current <= 1.05) {
              toggleControls();
            }
          }, 280);
          return;
        }

        const isMostlyHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy);

        // Horizontal swipe navigation between multiple images
        if (isMostlyHorizontal && totalRef.current > 1 && currentScale.current <= 1.05) {
          if (gestureState.dx < -50 || gestureState.vx < -0.35) {
            handleNextImageRef.current?.();
            return;
          } else if (gestureState.dx > 50 || gestureState.vx > 0.35) {
            handlePrevImageRef.current?.();
            return;
          } else {
            Animated.spring(translateXAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
            return;
          }
        }

        // Vertical slide up/down dismiss when not zoomed
        if (currentScale.current <= 1.05 && Math.abs(gestureState.dy) > 10) {
          if (Math.abs(gestureState.dy) > 110 || Math.abs(gestureState.vy) > 0.6) {
            // Dragged or flicked far enough: animate off-screen and dismiss
            Animated.timing(translateYAnim, {
              toValue: gestureState.dy > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              onClose?.();
              translateYAnim.setValue(0);
            });
            return;
          } else {
            // Snap back to center
            Animated.spring(translateYAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
            return;
          }
        }

        // Always ensure clean snap back to 1x and reset positions
        Animated.spring(translateXAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
        Animated.spring(translateYAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
        resetZoom();
        showControls();
      },
      onPanResponderTerminate: () => {
        initialDistance.current = 0;
        initialCenter.current = null;
        isPinching.current = false;
        hasZoomed.current = false;
        Animated.spring(translateXAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
        Animated.spring(translateYAnim, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }).start();
        resetZoom();
        showControls();
      },
    })
  ).current;

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
      <View style={styles.container}>
        {/* Zoomable Image Container */}
        <View style={styles.imageLayer} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.imageTransformWrapper,
              {
                transform: [
                  { translateX: translateXAnim },
                  { translateY: translateYAnim },
                  { scale: scaleAnim },
                ],
              },
            ]}
          >
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
        </View>



        {/* Top Header Bar (disappears when zoomed) */}
        <Animated.View
          pointerEvents={controlsVisible.current ? 'box-none' : 'none'}
          style={[
            styles.headerBar,
            {
              paddingTop: Math.max(insets.top, 24) + 6,
              opacity: controlsOpacityAnim,
              transform: [
                {
                  translateY: controlsOpacityAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-30, 0],
                  }),
                },
              ],
            },
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
          pointerEvents={controlsVisible.current ? 'box-none' : 'none'}
          style={[
            styles.bottomBarContainer,
            {
              opacity: controlsOpacityAnim,
              transform: [
                {
                  translateY: Animated.add(
                    controlsOpacityAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [40, 0],
                    }),
                    keyboardTranslateY
                  ),
                },
              ],
            },
          ]}
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
      </View>
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
