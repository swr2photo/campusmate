import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FeatureIcon from './FeatureIcon';
import DecryptedChatImage from './DecryptedChatImage';
import {
  getChatImageBubbleSize,
  measureImageAspectRatio,
  getCachedAspectRatio,
  hasSeenStackFlipHint,
  setStackFlipHintSeen,
} from '../utils/chatImageUtils';

/**
 * StackedImageCards
 * Renders multiple chat photos as an interactive stacked card deck ("การ์ดจะซ้อน ๆ กัน").
 * - Dynamic aspect ratio: auto-adjusts for portrait (รูปตั้ง) and landscape (แนวนอน).
 * - Shows overlapping rotated cards behind the main card (e.g. -5.5deg, +3.5deg).
 * - Glassmorphic counter badge (e.g. 1/3) with stacked cards icon.
 * - Tapping flips to the next photo in the deck with a smooth spring response.
 * - Dedicated expand button opens full-screen gallery viewer.
 */
export default function StackedImageCards({
  borderless = false,
  conversationId,
  currentUserId,
  conversationKey,
  mediaUrls = [],
  isUploading = false,
  mine = false,
  onPreviewImage,
  handleLongPress,
  width,
  height,
  style,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [showFlipHint, setShowFlipHint] = useState(false);
  const flipAnim = useRef(new Animated.Value(1)).current;

  const total = mediaUrls.length;

  useEffect(() => {
    let active = true;
    hasSeenStackFlipHint().then((seen) => {
      if (active && !seen) {
        setShowFlipHint(true);
        setStackFlipHintSeen();
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const [cardSize, setCardSize] = useState(() => {
    const cachedRatio = getCachedAspectRatio(mediaUrls?.[0]);
    if (cachedRatio) return getChatImageBubbleSize(cachedRatio);
    if (width && height) return { width, height };
    return getChatImageBubbleSize(null);
  });

  useEffect(() => {
    const primary = mediaUrls?.[activeIndex] || mediaUrls?.[0];
    if (!primary) return;
    measureImageAspectRatio(primary, (ratio, size) => {
      setCardSize(size);
    });
  }, [mediaUrls, activeIndex]);

  const deckWidth = width || cardSize.width;
  const deckHeight = height || cardSize.height;

  if (!total) return null;

  // Single image fallback
  if (total === 1) {
    return (
      <View style={[styles.singleContainer, { width: deckWidth, height: deckHeight }, style]}>
        <DecryptedChatImage
          conversationId={conversationId}
          conversationKey={conversationKey}
          currentUserId={currentUserId}
          isUploading={isUploading}
          mediaUrl={mediaUrls[0]}
          onLongPress={handleLongPress}
          onPress={(resolved) => onPreviewImage?.(resolved || mediaUrls[0], mediaUrls)}
          resizeMode="cover"
          showExpandBadge={false}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  // Indices for stacked cards
  const nextIndex1 = (activeIndex + 1) % total;
  const nextIndex2 = (activeIndex + 2) % total;

  const handleCycleNext = useCallback(() => {
    if (showFlipHint) {
      setShowFlipHint(false);
      setStackFlipHintSeen();
    }
    Animated.sequence([
      Animated.timing(flipAnim, {
        toValue: 0.94,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.spring(flipAnim, {
        toValue: 1,
        friction: 5,
        tension: 180,
        useNativeDriver: true,
      }),
    ]).start();
    setActiveIndex((prev) => (prev + 1) % total);
  }, [flipAnim, showFlipHint, total]);

  const handleOpenGallery = useCallback((e) => {
    e?.stopPropagation?.();
    onPreviewImage?.(mediaUrls[activeIndex], mediaUrls);
  }, [activeIndex, mediaUrls, onPreviewImage]);

  return (
    <View style={[styles.wrapper, style]}>
      {/* Outer touchable area */}
      <Pressable
        accessibilityLabel={`รูปภาพซ้อนกัน ${total} รูป แตะเพื่อเปลี่ยนรูป`}
        delayLongPress={240}
        disabled={isUploading}
        onLongPress={handleLongPress}
        onPress={handleCycleNext}
        style={[styles.stackContainer, { width: deckWidth, height: deckHeight }]}
      >
        {/* Layer 3: Deepest card (shown if 3 or more photos) */}
        {total >= 3 && (
          <View
            pointerEvents="none"
            style={[
              styles.cardBackDeep,
              borderless && { borderWidth: 0, backgroundColor: 'transparent' },
              {
                width: deckWidth,
                height: deckHeight,
                transform: [
                  { rotate: mine ? '-5.5deg' : '5.5deg' },
                  { translateX: mine ? -8 : 8 },
                  { translateY: 4 },
                  { scale: 0.92 },
                ],
              },
            ]}
          >
            <DecryptedChatImage
              conversationId={conversationId}
              conversationKey={conversationKey}
              currentUserId={currentUserId}
              mediaUrl={mediaUrls[nextIndex2]}
              resizeMode="cover"
              showExpandBadge={false}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.cardBackOverlayDeep} />
          </View>
        )}

        {/* Layer 2: Middle card (shown if 2 or more photos) */}
        {total >= 2 && (
          <View
            pointerEvents="none"
            style={[
              styles.cardBackMiddle,
              borderless && { borderWidth: 0, backgroundColor: 'transparent' },
              {
                width: deckWidth,
                height: deckHeight,
                transform: [
                  { rotate: mine ? '3.5deg' : '-3.5deg' },
                  { translateX: mine ? 6 : -6 },
                  { translateY: 2 },
                  { scale: 0.96 },
                ],
              },
            ]}
          >
            <DecryptedChatImage
              conversationId={conversationId}
              conversationKey={conversationKey}
              currentUserId={currentUserId}
              mediaUrl={mediaUrls[nextIndex1]}
              resizeMode="cover"
              showExpandBadge={false}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.cardBackOverlayMiddle} />
          </View>
        )}

        {/* Layer 1: Front Active Card */}
        <Animated.View
          style={[
            styles.cardFront,
              borderless && { borderWidth: 0, backgroundColor: 'transparent' },
            {
              width: deckWidth,
              height: deckHeight,
              transform: [{ scale: flipAnim }],
            },
          ]}
        >
          <DecryptedChatImage
            conversationId={conversationId}
            conversationKey={conversationKey}
            currentUserId={currentUserId}
            isUploading={isUploading}
            mediaUrl={mediaUrls[activeIndex]}
            onLongPress={handleLongPress}
            onPress={handleCycleNext}
            resizeMode="cover"
            showExpandBadge={false}
            style={StyleSheet.absoluteFill}
          />

          {/* Top-Right Glass Pill Counter Badge (e.g. 1/3 with stacked icon) */}
          <View style={styles.glassCounterBadge}>
            <FeatureIcon color="#FFFFFF" name="square.stack.fill" size={11} />
            <Text style={styles.glassCounterText}>
              {activeIndex + 1}/{total}
            </Text>
          </View>

          {/* Bottom-Right Expand to Fullscreen Gallery Button */}
          {!isUploading && (
            <Pressable
              accessibilityLabel="เปิดดูรูปภาพทั้งหมดขนาดเต็ม"
              hitSlop={8}
              onPress={handleOpenGallery}
              style={({ pressed }) => [
                styles.expandGalleryBtn,
                pressed && { opacity: 0.8, transform: [{ scale: 0.92 }] },
              ]}
            >
              <FeatureIcon color="#FFFFFF" name="arrow.up.left.and.arrow.down.right" size={11} />
            </Pressable>
          )}

          {/* Bottom-Left Tap to Flip Hint Pill (shows only once) */}
          {showFlipHint ? (
            <View style={styles.flipHintBadge}>
              <FeatureIcon color="rgba(255,255,255,0.85)" name="hand.tap.fill" size={9} />
              <Text style={styles.flipHintText}>แตะเพื่อเลื่อน</Text>
            </View>
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  singleContainer: {
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  stackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cardBackDeep: {
    borderColor: 'rgba(255, 255, 255, 0.20)',
    borderRadius: 18,
    borderWidth: 1,
    elevation: 2,
    opacity: 0.72,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  cardBackOverlayDeep: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  cardBackMiddle: {
    borderColor: 'rgba(255, 255, 255, 0.26)',
    borderRadius: 18,
    borderWidth: 1.5,
    elevation: 4,
    opacity: 0.90,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.30,
    shadowRadius: 4,
  },
  cardBackOverlayMiddle: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.16)',
  },
  cardFront: {
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 18,
    borderWidth: 1.5,
    elevation: 6,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.38,
    shadowRadius: 6,
  },
  glassCounterBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 10,
    elevation: 3,
  },
  glassCounterText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
    includeFontPadding: false,
  },
  expandGalleryBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 8,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 26,
    zIndex: 10,
    elevation: 3,
  },
  flipHintBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.60)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 8,
    flexDirection: 'row',
    gap: 3,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    position: 'absolute',
    zIndex: 10,
  },
  flipHintText: {
    color: 'rgba(255, 255, 255, 0.90)',
    fontSize: 9.5,
    fontWeight: '600',
    includeFontPadding: false,
  },
});
