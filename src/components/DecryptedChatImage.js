import Text from './AppText';
import React, { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import FeatureIcon from './FeatureIcon';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { getChatImageBubbleSize, measureImageAspectRatio, getCachedAspectRatio, cacheAspectRatio } from '../utils/chatImageUtils';
import { isRemoteImageUrl } from '../utils/imagePolicy';

/**
 * Drop-in image bubble for chat messages.
 * Seamlessly handles encrypted (.enc) and legacy unencrypted (.jpg, etc.) photos.
 * Dynamically adjusts size based on natural aspect ratio (portrait vs landscape).
 */
export default function DecryptedChatImage({
  mediaUrl,
  conversationId,
  currentUserId,
  conversationKey,
  style,
  resizeMode = 'cover',
  isUploading = false,
  onPress,
  onLongPress,
  showExpandBadge = false,
  useDynamicSize = false,
  onAspectRatioMeasured,
  accessibilityLabel = 'ดูรูปภาพขนาดใหญ่',
}) {
  const { uri, loading, retry } = useDecryptedMedia(mediaUrl, {
    conversationId,
    currentUserId,
    conversationKey,
    mediaType: 'image',
  });
  const [loadError, setLoadError] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);

  const isDirectImage = Boolean(
    mediaUrl && (
      mediaUrl.startsWith('file://') ||
      mediaUrl.startsWith('content://') ||
      mediaUrl.startsWith('data:') ||
      !mediaUrl.includes('.enc')
    )
  );
  const displayUri = uri || (isDirectImage ? mediaUrl : null);
  const isUnavailable = (!displayUri && !loading) || loadError;

  const onAspectRatioMeasuredRef = useRef(onAspectRatioMeasured);
  useEffect(() => {
    onAspectRatioMeasuredRef.current = onAspectRatioMeasured;
  }, [onAspectRatioMeasured]);

  const lastMeasuredUriRef = useRef(null);

  const [bubbleSize, setBubbleSize] = useState(() => {
    const cachedRatio = getCachedAspectRatio(displayUri) || getCachedAspectRatio(mediaUrl);
    return getChatImageBubbleSize(cachedRatio);
  });

  useEffect(() => {
    if (!displayUri) return;
    setLoadError(false);
    // Remote images report dimensions through onLoad. Image.getSize would
    // otherwise start a second download alongside expo-image.
    if (isRemoteImageUrl(displayUri)) return;
    if (lastMeasuredUriRef.current === displayUri) return;
    lastMeasuredUriRef.current = displayUri;

    measureImageAspectRatio(displayUri, (ratio, size) => {
      if (size) {
        setBubbleSize((prev) => {
          if (prev && prev.width === size.width && prev.height === size.height) {
            return prev;
          }
          return size;
        });
      }
      if (mediaUrl && ratio) cacheAspectRatio(mediaUrl, ratio);
      onAspectRatioMeasuredRef.current?.(ratio, size);
    });
  }, [displayUri, mediaUrl]);

  const handlePress = () => {
    if (isUnavailable && !isUploading) {
      setLoadError(false);
      setImageAttempt((value) => value + 1);
      retry();
      return;
    }
    if (onPress && !isUnavailable && !isUploading) {
      onPress(displayUri || mediaUrl);
    }
  };

  const dynamicContainerStyle = useDynamicSize
    ? { width: bubbleSize.width, height: bubbleSize.height }
    : null;

  return (
    <Pressable
      accessibilityLabel={isUnavailable ? 'โหลดรูปภาพอีกครั้ง' : accessibilityLabel}
      delayLongPress={220}
      disabled={isUploading}
      onLongPress={onLongPress}
      onPress={handlePress}
      style={[styles.container, dynamicContainerStyle, style]}
    >
      {loading && !displayUri ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#3B5AFE" size="small" />
        </View>
      ) : isUnavailable ? (
        <View style={styles.unavailableContainer}>
          <FeatureIcon color="#98A2B3" name="exclamationmark.triangle.fill" size={20} />
          <Text style={styles.unavailableText}>โหลดรูปภาพไม่สำเร็จ แตะเพื่อลองอีกครั้ง</Text>
        </View>
      ) : (
        <ExpoImage
          key={imageAttempt}
          cachePolicy="memory-disk"
          contentFit={resizeMode === 'contain' ? 'contain' : 'cover'}
          onError={() => setLoadError(true)}
          onLoad={({ source }) => {
            if (!source?.width || !source?.height) return;
            const ratio = source.width / source.height;
            const size = getChatImageBubbleSize(ratio);
            cacheAspectRatio(displayUri, ratio);
            if (mediaUrl) cacheAspectRatio(mediaUrl, ratio);
            setBubbleSize(size);
            onAspectRatioMeasuredRef.current?.(ratio, size);
          }}
          recyclingKey={displayUri}
          priority="high"
          source={{ uri: displayUri }}
          style={styles.image}
          transition={0}
        />
      )}

      {isUploading ? (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator color="#FFFFFF" size="small" />
          <Text style={styles.uploadingText}>กำลังส่งรูปภาพ...</Text>
        </View>
      ) : null}

      {showExpandBadge && !loading && !isUnavailable && !isUploading ? (
        <View style={styles.expandBadge}>
          <FeatureIcon color="#FFFFFF" name="arrow.up.left.and.arrow.down.right" size={12} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    width: '100%',
    height: '100%',
    minHeight: 160,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableContainer: {
    width: '100%',
    minHeight: 140,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 6,
  },
  unavailableText: {
    color: '#98A2B3',
    fontSize: 12,
    textAlign: 'center',
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  uploadingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
