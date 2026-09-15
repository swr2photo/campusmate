import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import FeatureIcon from './FeatureIcon';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 4;
const SPACING = 2;
// 4 columns fill the width with (4-1)*SPACING total gaps
const ITEM_SIZE = Math.floor((SCREEN_WIDTH - (NUM_COLUMNS - 1) * SPACING) / NUM_COLUMNS);
// Center the grid if there is any sub-pixel remainder
const GRID_HORIZONTAL_PADDING = Math.max(
  0,
  Math.floor((SCREEN_WIDTH - (ITEM_SIZE * NUM_COLUMNS + (NUM_COLUMNS - 1) * SPACING)) / 2)
);
const COLLAPSED_HEIGHT = 310;

function isVideoAsset(asset) {
  return asset?.mediaType === 'video' || asset?.type === 'video' ||
    /\.(mp4|mov|m4v|webm|3gp)(?:$|[?#])/i.test(String(asset?.filename || asset?.uri || ''));
}

function VideoGridThumb({ uri, duration, style }) {
  const player = useVideoPlayer(uri, (instance) => { instance.muted = true; });
  const [thumbnail, setThumbnail] = useState(null);
  useEffect(() => {
    let active = true;
    const generate = async () => {
      try {
        const frames = await player.generateThumbnailsAsync(0, { maxWidth: 720 });
        if (active) setThumbnail(frames[0] || null);
      } catch {
        // Keep the neutral tile when a local provider cannot decode a thumbnail.
      }
    };
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') generate();
    });
    if (player.status === 'readyToPlay') generate();
    return () => { active = false; subscription.remove(); };
  }, [player]);

  return (
    <View style={style}>
      {thumbnail ? <Image contentFit="cover" source={thumbnail} style={StyleSheet.absoluteFill} /> : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color="#CBD5E1" size="small" />
        </View>
      )}
      <View pointerEvents="none" style={styles.videoTileBadge}>
        <FeatureIcon color="#FFFFFF" name="play.fill" size={12} />
        <Text style={styles.videoTileDuration}>{Math.ceil(Math.max(0, Number(duration) || 0))} วิ</Text>
      </View>
    </View>
  );
}

function GridAssetThumb({ item, style }) {
  if (isVideoAsset(item)) {
    return <VideoGridThumb duration={item.duration} style={style} uri={item.uri} />;
  }
  return item?.uri ? <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: item.uri }} style={style} transition={100} /> : null;
}

class MediaPickerListErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ChatMediaPickerSheet FlatList Crash]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorFallbackContainer}>
          <Text style={[styles.errorFallbackTitle, { color: this.props.ink || '#0F172A' }]}>
            ไม่สามารถโหลดรายการรูปภาพได้
          </Text>
          <Text style={[styles.errorFallbackSub, { color: this.props.inkSoft || '#64748B' }]}>
            {this.state.error?.message || 'เกิดข้อผิดพลาดในการแสดงผลรายการรูปภาพ'}
          </Text>
          <Pressable
            onPress={() => {
              this.setState({ hasError: false, error: null });
              this.props.onRetry?.();
            }}
            style={[styles.errorRetryBtn, { backgroundColor: this.props.primary || '#3B5AFE' }]}
          >
            <Text style={styles.errorRetryBtnText}>ลองใหม่อีกครั้ง</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const ChatMediaPickerSheet = forwardRef(function ChatMediaPickerSheet({
  isOpen,
  onClose,
  onSelectPhoto,
  onSelectMedia,
  onSelectLibrary,
  onSelectCamera,
  onSelectVideo,
  onOpenEditor,
  colors,
  inline = true,
}, ref) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets?.bottom ?? 0;
  const topInset = insets?.top ?? 0;
  const EXPANDED_HEIGHT = Math.round(SCREEN_HEIGHT - topInset - 16);

  const [isExpanded, setIsExpanded] = useState(false);
  const sheetHeightAnim = useRef(new Animated.Value(COLLAPSED_HEIGHT + bottomInset)).current;
  const currentHeightRef = useRef(COLLAPSED_HEIGHT + bottomInset);
  const startHeightRef = useRef(COLLAPSED_HEIGHT + bottomInset);

  const colorScheme = useColorScheme();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('undetermined');
  const [canAskPermission, setCanAskPermission] = useState(true);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [albums, setAlbums] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [accessPrivileges, setAccessPrivileges] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Animation values for iOS Quick Look photo preview
  const previewScaleAnim = useRef(new Animated.Value(0.92)).current;
  const previewOpacityAnim = useRef(new Animated.Value(0)).current;

  const expandSheet = useCallback(() => {
    setIsExpanded(true);
    Animated.timing(sheetHeightAnim, {
      toValue: EXPANDED_HEIGHT + bottomInset,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      currentHeightRef.current = EXPANDED_HEIGHT + bottomInset;
    });
  }, [EXPANDED_HEIGHT, bottomInset, sheetHeightAnim]);

  const collapseSheet = useCallback(() => {
    setIsExpanded(false);
    Animated.timing(sheetHeightAnim, {
      toValue: COLLAPSED_HEIGHT + bottomInset,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      currentHeightRef.current = COLLAPSED_HEIGHT + bottomInset;
    });
  }, [bottomInset, sheetHeightAnim]);

  const isClosingRef = useRef(false);

  const closeSheetWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsExpanded(false);
    Animated.timing(sheetHeightAnim, {
      toValue: 0,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      isClosingRef.current = false;
      onClose?.();
    });
  }, [sheetHeightAnim, onClose]);

  useImperativeHandle(ref, () => ({
    close: closeSheetWithAnimation,
    expand: expandSheet,
    collapse: collapseSheet,
  }), [closeSheetWithAnimation, expandSheet, collapseSheet]);

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      collapseSheet();
    } else {
      expandSheet();
    }
  }, [isExpanded, collapseSheet, expandSheet]);

  const handleOpenPreview = useCallback((item) => {
    setPreviewPhoto(item);
    Animated.parallel([
      Animated.spring(previewScaleAnim, {
        toValue: 1,
        damping: 22,
        stiffness: 280,
        useNativeDriver: true,
      }),
      Animated.timing(previewOpacityAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [previewScaleAnim, previewOpacityAnim]);

  const handleClosePreview = useCallback(() => {
    Animated.parallel([
      Animated.timing(previewScaleAnim, {
        toValue: 0.92,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(previewOpacityAnim, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setPreviewPhoto(null);
    });
  }, [previewScaleAnim, previewOpacityAnim]);

  // Determine dark mode
  const isDark =
    colorScheme === 'dark' ||
    colors?.card === '#0D0F12' ||
    colors?.card === '#181A20' ||
    colors?.card === '#1A1D22' ||
    colors?.card === '#20242A' ||
    colors?.card === '#14171B' ||
    (typeof colors?.card === 'string' && (colors.card.startsWith('#0') || colors.card.startsWith('#1') || colors.card.startsWith('#2'))) ||
    (typeof colors?.ink === 'string' && (colors.ink === '#F7F8FA' || colors.ink === '#F8FAFC' || colors.ink === '#F8F9FC' || colors.ink === '#FFFFFF'));

  // Reset state and smoothly slide up when opening
  useEffect(() => {
    if (isOpen) {
      isClosingRef.current = false;
      setSelectedAssets([]);
      setIsSending(false);
      setPreviewPhoto(null);
      setShowAlbumPicker(false);
      setIsExpanded(false);
      sheetHeightAnim.setValue(0);
      currentHeightRef.current = 0;
      Animated.timing(sheetHeightAnim, {
        toValue: COLLAPSED_HEIGHT + bottomInset,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        currentHeightRef.current = COLLAPSED_HEIGHT + bottomInset;
      });
    }
  }, [isOpen, bottomInset, sheetHeightAnim]);

  // PanResponder on top bar: smoothly slides gradually to any height, flicks to expand/collapse/close, tap to toggle
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 4;
      },
      onPanResponderGrant: () => {
        startHeightRef.current = currentHeightRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        // dy < 0: dragging up (growing)
        // dy > 0: dragging down (shrinking)
        const targetHeight = startHeightRef.current - gestureState.dy;
        const maxH = EXPANDED_HEIGHT + bottomInset + 12;
        const minH = 0;
        const clamped = Math.min(Math.max(targetHeight, minH), maxH);
        currentHeightRef.current = clamped;
        sheetHeightAnim.setValue(clamped);
      },
      onPanResponderRelease: (_, gestureState) => {
        const isTap = Math.abs(gestureState.dx) < 6 && Math.abs(gestureState.dy) < 6;
        if (isTap) {
          toggleExpand();
          return;
        }

        const totalCollapsed = COLLAPSED_HEIGHT + bottomInset;
        const totalExpanded = EXPANDED_HEIGHT + bottomInset;
        const finalHeight = currentHeightRef.current;

        // 1. High-velocity flicks
        if (gestureState.vy < -0.45) {
          expandSheet();
          return;
        }
        if (gestureState.vy > 0.55) {
          if (finalHeight > totalCollapsed + 80) {
            collapseSheet();
          } else {
            closeSheetWithAnimation();
          }
          return;
        }

        // 2. Below collapsed threshold -> close or snap back to collapsed
        if (finalHeight < totalCollapsed) {
          if (finalHeight < totalCollapsed - 40) {
            closeSheetWithAnimation();
          } else {
            collapseSheet();
          }
          return;
        }

        // 3. Near top expanded (within 40px):
        if (finalHeight >= totalExpanded - 40) {
          expandSheet();
          return;
        }

        // 4. Near bottom collapsed (within 35px):
        if (finalHeight <= totalCollapsed + 35) {
          collapseSheet();
          return;
        }

        // In between: RETAIN THE EXACT HEIGHT USER DRAGGED TO!
        // This gives full freedom to smoothly slide to any intermediate height ("ค่อย ๆ เลื่อนได้")!
        setIsExpanded(finalHeight > (totalCollapsed + totalExpanded) / 2);
        currentHeightRef.current = finalHeight;
      },
    })
  ).current;

  // Load photos from device MediaLibrary
  const loadDevicePhotos = useCallback(async () => {
    try {
      setLoading(true);
      const requestedMediaTypes = Platform.OS === 'android' ? ['photo', 'video'] : undefined;
      let perm;
      perm = await MediaLibrary.getPermissionsAsync(false, requestedMediaTypes);
      if (perm.status !== 'granted' && perm.canAskAgain !== false) {
        perm = await MediaLibrary.requestPermissionsAsync(false, requestedMediaTypes);
      }
      setPermissionStatus(perm.status);
      setCanAskPermission(perm.canAskAgain !== false);
      const currentPrivileges = perm.accessPrivileges || (perm.status === 'granted' ? 'all' : 'none');
      setAccessPrivileges(currentPrivileges);

      if (perm.status === 'granted' || currentPrivileges === 'limited') {
        const queryOptions = {
          first: 60,
          mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        };
        // On iOS PhotoKit, querying a specific album ID when permissions are limited throws E_NO_PERMISSIONS
        if (selectedAlbum?.id && selectedAlbum.id !== '__all__' && currentPrivileges !== 'limited') {
          queryOptions.album = selectedAlbum.id;
        }
        let result;
        try {
          result = await MediaLibrary.getAssetsAsync(queryOptions);
        } catch (queryErr) {
          try {
            queryOptions.sortBy = [[MediaLibrary.SortBy.modificationTime, false]];
            result = await MediaLibrary.getAssetsAsync(queryOptions);
          } catch (_) {
            delete queryOptions.sortBy;
            try {
              result = await MediaLibrary.getAssetsAsync(queryOptions);
            } catch (_) {
              result = { assets: [], hasNextPage: false, endCursor: null };
            }
          }
        }
        setAssets(result?.assets || []);
        setHasNextPage(Boolean(result?.hasNextPage));
        setEndCursor(result?.endCursor || null);

        // Load albums safely (includeSmartAlbums only on iOS; keep Android albums with undefined assetCount)
        try {
          let albumList = [];
          try {
            albumList = await MediaLibrary.getAlbumsAsync(Platform.OS === 'ios' ? { includeSmartAlbums: true } : {});
          } catch (_) {
            try {
              albumList = await MediaLibrary.getAlbumsAsync();
        } catch (_) {}
          }
          const validAlbums = (albumList || []).filter((a) => a && a.title && (a.assetCount === undefined || a.assetCount === null || a.assetCount > 0));
          setAlbums(validAlbums);
        } catch (_) {}
      } else {
        setAssets([]);
        setAlbums([]);
        setHasNextPage(false);
        setEndCursor(null);
      }
    } catch (err) {
      console.warn('[ChatMediaPickerSheet] Error loading photos:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAlbum]);

  // Infinite scroll load more photos
  const handleLoadMore = useCallback(async () => {
    if (!hasNextPage || loadingMore || loading || !endCursor) return;
    try {
      setLoadingMore(true);
      const queryOptions = {
        first: 60,
        after: endCursor,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      };
      if (selectedAlbum?.id && selectedAlbum.id !== '__all__' && accessPrivileges !== 'limited') {
        queryOptions.album = selectedAlbum.id;
      }
      let result;
      try {
        result = await MediaLibrary.getAssetsAsync(queryOptions);
      } catch (_) {
        delete queryOptions.sortBy;
        try {
          result = await MediaLibrary.getAssetsAsync(queryOptions);
        } catch (_) {
          result = { assets: [] };
        }
      }
      if (result?.assets && result.assets.length > 0) {
        setAssets((prev) => [...prev, ...result.assets]);
      }
      setHasNextPage(Boolean(result?.hasNextPage));
      setEndCursor(result?.endCursor || null);
    } catch (err) {
      console.warn('[ChatMediaPickerSheet] Error loading more photos:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [hasNextPage, loadingMore, loading, endCursor, selectedAlbum, accessPrivileges]);

  // Open iOS/Android Photo Picker to select more photos if in limited mode
  const handleManageLimitedPhotos = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        onClose?.();
        setTimeout(() => onSelectLibrary?.(), 100);
        return;
      }
      if (typeof MediaLibrary.presentPermissionsPickerAsync === 'function') {
        await MediaLibrary.presentPermissionsPickerAsync(['photo', 'video']);
        loadDevicePhotos();
      } else {
        Linking.openSettings();
      }
    } catch (_) {
      Linking.openSettings();
    }
  }, [loadDevicePhotos, onClose, onSelectLibrary]);

  useEffect(() => {
    if (isOpen) {
      loadDevicePhotos();
    }
  }, [isOpen, loadDevicePhotos]);

  // Toggle selection (support multiple photos up to 10)
  const handleToggleSelect = useCallback((item) => {
    setSelectedAssets((prev) => {
      const exists = prev.some((a) => a.id === item.id);
      if (exists) {
        return prev.filter((a) => a.id !== item.id);
      }
      if (prev.length > 0 && isVideoAsset(prev[0]) !== isVideoAsset(item)) {
        Alert.alert('เลือกสื่อทีละประเภท', 'กรุณาเลือกรูปภาพหรือวิดีโออย่างใดอย่างหนึ่งต่อครั้ง');
        return prev;
      }
      if (prev.length >= 10) {
        Alert.alert('เลือกได้สูงสุด 10 รายการ', 'คุณสามารถส่งรูปภาพหรือวิดีโอพร้อมกันได้สูงสุด 10 รายการ');
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  // Resolve an asset to a valid local file:// URI
  const resolveAssetToFileUri = useCallback(async (asset) => {
    let finalUri = asset?.uri;
    if (!finalUri) return null;

    // On iOS, convert ph:// to a local file:// URI
    if (Platform.OS === 'ios' && (finalUri.startsWith('ph://') || asset.id)) {
      const assetId = asset.id || finalUri.replace('ph://', '');
      try {
        const info = await MediaLibrary.getAssetInfoAsync(assetId, { shouldDownloadFromNetwork: true });
        if (info?.localUri && info.localUri.startsWith('file://')) {
          finalUri = info.localUri;
        }
      } catch (infoErr) {
        console.warn('[ChatMediaPickerSheet] Failed to get localUri via getAssetInfoAsync:', infoErr?.message || infoErr);
      }

      // Native FileSystem.copyAsync supports ph:// directly on iOS as fallback
      if (finalUri.startsWith('ph://')) {
        try {
          const destPath = `${FileSystem.cacheDirectory}chat_pick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          await FileSystem.copyAsync({ from: finalUri, to: destPath });
          finalUri = destPath;
        } catch (copyErr) {
          console.warn('[ChatMediaPickerSheet] copyAsync ph:// fallback failed:', copyErr?.message || copyErr);
        }
      }
    }
    return finalUri;
  }, []);

  // Send selected photos
  const handleSendSelected = useCallback(async () => {
    if (!selectedAssets.length || isSending) return;
    setIsSending(true);
    try {
      const prepared = [];
      for (const asset of selectedAssets) {
        const u = await resolveAssetToFileUri(asset);
        if (u) {
          const video = isVideoAsset(asset);
          const info = video ? await FileSystem.getInfoAsync(u).catch(() => null) : null;
          const durationMs = video && Number.isFinite(Number(asset.duration))
            ? (Number(asset.duration) <= 60 ? Math.round(Number(asset.duration) * 1000) : Math.round(Number(asset.duration)))
            : asset.duration;
          prepared.push({ ...asset, uri: u, type: video ? 'video' : 'image', duration: durationMs, fileSize: info?.size || asset.fileSize });
        }
      }

      onClose?.();
      setTimeout(() => {
        if (onSelectMedia && prepared.length > 0) {
          onSelectMedia(prepared);
        } else if (prepared[0]?.type === 'video' && onSelectVideo) {
          onSelectVideo(prepared[0]);
        } else if (onSelectPhoto) {
          const finalUris = prepared.map((asset) => asset.uri);
          onSelectPhoto(finalUris.length === 1 ? finalUris[0] : finalUris);
        } else if (onSelectLibrary) {
          onSelectLibrary();
        }
      }, 100);
    } catch (err) {
      console.error('[ChatMediaPickerSheet] Error sending photos:', err);
    } finally {
      setIsSending(false);
    }
  }, [selectedAssets, isSending, resolveAssetToFileUri, onClose, onSelectMedia, onSelectVideo, onSelectPhoto, onSelectLibrary]);

  // Edit selected photos before sending
  const handleEditSelected = useCallback(async () => {
    if (!selectedAssets.length) return;
    if (isVideoAsset(selectedAssets[0])) {
      Alert.alert('แก้ไขรูปภาพไม่ได้', 'เครื่องมือแก้ไขนี้ใช้ได้กับรูปภาพเท่านั้น');
      return;
    }
    try {
      const finalUris = [];
      for (const asset of selectedAssets) {
        const u = await resolveAssetToFileUri(asset);
        if (u) finalUris.push(u);
      }
      if (finalUris.length > 0) {
        onClose?.();
        setTimeout(() => {
          onOpenEditor?.(finalUris[0], finalUris);
        }, 120);
      }
    } catch (err) {
      console.warn('[ChatMediaPickerSheet] Error preparing selected for editor:', err);
    }
  }, [selectedAssets, resolveAssetToFileUri, onClose, onOpenEditor]);

  // Send photo directly from preview modal
  const handleSendPreviewPhoto = useCallback(async (photo) => {
    if (!photo || isSending) return;
    setIsSending(true);
    handleClosePreview();
    try {
      const finalUri = await resolveAssetToFileUri(photo);
      if (finalUri) {
        const video = isVideoAsset(photo);
        const info = video ? await FileSystem.getInfoAsync(finalUri).catch(() => null) : null;
        const durationMs = video && Number.isFinite(Number(photo.duration))
          ? (Number(photo.duration) <= 60 ? Math.round(Number(photo.duration) * 1000) : Math.round(Number(photo.duration)))
          : photo.duration;
        onClose?.();
        setTimeout(() => {
          if (onSelectMedia) {
            onSelectMedia([{ ...photo, uri: finalUri, duration: durationMs, fileSize: info?.size || photo.fileSize, type: video ? 'video' : 'image' }]);
          } else if (onSelectPhoto) {
            onSelectPhoto(finalUri);
          } else if (onSelectLibrary) {
            onSelectLibrary();
          }
        }, 100);
      }
    } catch (err) {
      console.error('[ChatMediaPickerSheet] Error sending preview photo:', err);
    } finally {
      setIsSending(false);
    }
  }, [isSending, handleClosePreview, resolveAssetToFileUri, onClose, onSelectMedia, onSelectPhoto, onSelectLibrary]);

  // Edit single photo from preview modal
  const handleEditPreviewPhoto = useCallback(async (photo) => {
    if (!photo) return;
    handleClosePreview();
    try {
      const finalUri = await resolveAssetToFileUri(photo);
      if (finalUri) {
        onClose?.();
        setTimeout(() => {
          onOpenEditor?.(finalUri, [finalUri]);
        }, 120);
      }
    } catch (err) {
      console.warn('[ChatMediaPickerSheet] Error opening editor for preview photo:', err);
    }
  }, [handleClosePreview, resolveAssetToFileUri, onClose, onOpenEditor]);

  if (!isOpen) return null;

  const cardBg = colors?.card || (isDark ? '#181A20' : '#FFFFFF');
  const line = colors?.line || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)');
  const ink = colors?.ink || (isDark ? '#F8FAFC' : '#0F172A');
  const inkSoft = colors?.inkSoft || (isDark ? '#94A3B8' : '#64748B');
  const primary = colors?.primary || '#3B5AFE';
  const cardTileBg = colors?.bg || (isDark ? '#222631' : '#F1F5F9');

  // iOS Glass tokens
  const glassBg = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.05)';
  const glassBorder = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)';

  // First tile is Camera tile, followed by recent photos (filtered for validity)
  const safeAssets = useMemo(() => {
    if (!Array.isArray(assets)) return [];
    return assets.filter((item) => item && (item.id || item.uri));
  }, [assets]);

  const gridData = useMemo(() => {
    return [
      { id: '__camera__', isCamera: true },
      { id: '__library__', isLibrary: true },
      ...safeAssets,
    ];
  }, [safeAssets]);

  const renderGridItem = useCallback(({ item, index }) => {
    if (!item) return null;
    const isLastInRow = index % NUM_COLUMNS === NUM_COLUMNS - 1;
    const tileMarginRight = isLastInRow ? 0 : SPACING;

    if (item.isCamera) {
      return (
        <Pressable
          accessibilityLabel="ถ่ายภาพด้วยกล้อง"
          onPress={() => {
            onClose?.();
            setTimeout(() => onSelectCamera?.(), 100);
          }}
          style={({ pressed }) => [
            styles.cameraTile,
            {
              width: ITEM_SIZE,
              height: ITEM_SIZE,
              backgroundColor: cardTileBg,
              marginRight: tileMarginRight,
              marginBottom: SPACING,
            },
            pressed && styles.pressedTile,
          ]}
        >
          <View
            style={[
              styles.cameraIconCircle,
              {
                backgroundColor: isDark
                  ? 'rgba(59, 90, 254, 0.22)'
                  : 'rgba(59, 90, 254, 0.12)',
              },
            ]}
          >
            <View style={styles.cameraIconCenter}>
              <FeatureIcon color={primary} name="camera.fill" size={22} />
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.cameraTileText, { color: ink }]}>
            เปิดกล้อง
          </Text>
        </Pressable>
      );
    }

    if (item.isLibrary) {
      return (
        <Pressable
          accessibilityLabel="เลือกจากอัลบั้มหรือคลังภาพ"
          onPress={() => {
            onClose?.();
            setTimeout(() => onSelectLibrary?.(), 100);
          }}
          style={({ pressed }) => [
            styles.cameraTile,
            {
              width: ITEM_SIZE,
              height: ITEM_SIZE,
              backgroundColor: cardTileBg,
              marginRight: tileMarginRight,
              marginBottom: SPACING,
            },
            pressed && styles.pressedTile,
          ]}
        >
          <View
            style={[
              styles.cameraIconCircle,
              {
                backgroundColor: isDark
                  ? 'rgba(168, 85, 247, 0.22)'
                  : 'rgba(168, 85, 247, 0.12)',
              },
            ]}
          >
            <View style={styles.cameraIconCenter}>
              <FeatureIcon color="#A855F7" name="photo.on.rectangle" size={22} />
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.cameraTileText, { color: ink }]}>
            อัลบั้ม
          </Text>
        </Pressable>
      );
    }

    const itemId = item.id || item.uri || String(index);
    const selectedIndex = Array.isArray(selectedAssets)
      ? selectedAssets.findIndex((a) => (a?.id && a.id === itemId) || (a?.uri && a.uri === item.uri))
      : -1;
    const isSelected = selectedIndex >= 0;

    return (
      <Pressable
        accessibilityLabel={`${isVideoAsset(item) ? 'วิดีโอ' : 'รูปภาพ'} ${item.filename || index}`}
        delayLongPress={260}
        onLongPress={() => handleOpenPreview(item)}
        onPress={() => handleToggleSelect(item)}
        style={({ pressed }) => [
          styles.photoTile,
          {
            width: ITEM_SIZE,
            height: ITEM_SIZE,
            marginRight: tileMarginRight,
            marginBottom: SPACING,
          },
          isSelected && { borderColor: primary, borderWidth: 2.5 },
          pressed && styles.pressedTile,
        ]}
      >
        {item.uri ? <GridAssetThumb item={item} style={styles.photoThumb} /> : (
          <View style={[styles.photoThumb, { backgroundColor: cardTileBg }]} />
        )}
        {isSelected && <View style={styles.selectedOverlay} />}

        {/* Selection Circle in top-right */}
        <Pressable
          hitSlop={8}
          onPress={() => handleToggleSelect(item)}
          style={[
            styles.selectCircle,
            isSelected && { backgroundColor: primary, borderColor: primary },
          ]}
        >
          {isSelected ? (
            <Text style={styles.selectBadgeNumber}>{selectedIndex + 1}</Text>
          ) : null}
        </Pressable>
      </Pressable>
    );
  }, [cardTileBg, primary, ink, isDark, selectedAssets, handleOpenPreview, handleToggleSelect, onClose, onSelectCamera, onSelectLibrary]);

  const layoutSpacerHeight = sheetHeightAnim.interpolate({
    inputRange: [0, COLLAPSED_HEIGHT + bottomInset, EXPANDED_HEIGHT + bottomInset],
    outputRange: [0, COLLAPSED_HEIGHT + bottomInset, COLLAPSED_HEIGHT + bottomInset],
    extrapolate: 'clamp',
  });

  const content = (
    <View style={styles.sheetContainerWrapper}>
      {/* Dim backdrop when expanding full screen */}
      <Animated.View
        pointerEvents={isExpanded ? 'auto' : 'none'}
        style={[
          styles.expandBackdrop,
          {
            opacity: sheetHeightAnim.interpolate({
              inputRange: [COLLAPSED_HEIGHT + bottomInset, EXPANDED_HEIGHT + bottomInset],
              outputRange: [0, 0.45],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <Pressable
          accessibilityLabel="ย่อหน้าต่างเลือกรูปภาพ"
          onPress={collapseSheet}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Dynamic Animated Spacer maintaining bottom padding for chat messages & moving input bar in 1:1 sync */}
      <Animated.View style={{ height: layoutSpacerHeight }} />

      {/* Main Animated Bottom Sheet */}
      <Animated.View
        style={[
          styles.drawerContainer,
          {
            backgroundColor: cardBg,
            height: sheetHeightAnim,
            paddingBottom: bottomInset,
            borderTopColor: line,
          },
        ]}
      >
        {/* Draggable Top Area (both Grabber and Header can be gradually slid up/down) */}
        <View {...panResponder.panHandlers} style={styles.topDraggableArea}>
          {/* iOS Top Grabber Handle */}
          <View
            accessibilityLabel={isExpanded ? "ลากหรือแตะเพื่อย่อลง" : "ลากหรือแตะเพื่อขยายเต็มจอ"}
            style={styles.grabberTouchZone}
          >
            <View
              style={[
                styles.grabberBar,
                { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.32)' : 'rgba(0, 0, 0, 0.25)' },
              ]}
            />
          </View>

          {/* iOS Glass Header Bar with Album Dropdown Trigger */}
          <View style={[styles.headerRow, { borderBottomColor: glassBorder }]}>
            {/* iOS Glass Album Dropdown Trigger Button */}
            <Pressable
              accessibilityLabel="เลือกอัลบัมรูปภาพ"
              hitSlop={6}
              onPress={() => setShowAlbumPicker((prev) => !prev)}
              style={({ pressed }) => [
                styles.albumDropdownTrigger,
                {
                  backgroundColor: showAlbumPicker
                    ? isDark
                      ? 'rgba(59, 90, 254, 0.22)'
                      : 'rgba(59, 90, 254, 0.12)'
                    : glassBg,
                  borderColor: showAlbumPicker ? primary : glassBorder,
                },
                pressed && styles.pressedPill,
              ]}
            >
              <View style={styles.triggerIconWrap}>
                <FeatureIcon
                  color={showAlbumPicker ? primary : ink}
                  name={selectedAlbum ? 'folder.fill' : 'clock.fill'}
                  size={13}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.albumDropdownTriggerText,
                  { color: showAlbumPicker ? primary : ink },
                ]}
              >
                {selectedAlbum?.title || 'ล่าสุด'}
              </Text>
              <View style={styles.triggerChevronWrap}>
                <FeatureIcon
                  color={showAlbumPicker ? primary : inkSoft}
                  name={showAlbumPicker ? 'chevron.up' : 'chevron.down'}
                  size={11}
                />
              </View>
            </Pressable>

            {/* Header Right Actions */}
            <View style={styles.headerRightActions}>
              {onSelectVideo && <Pressable accessibilityLabel="เลือกวิดีโอไม่เกิน 60 วินาที" hitSlop={8}
                onPress={() => { onClose?.(); setTimeout(() => onSelectVideo(), 350); }} style={{ padding: 8 }}>
                <Text style={{ color: primary, fontWeight: '600' }}>วิดีโอ</Text>
              </Pressable>}
              {/* Expand / Collapse Button */}
              <Pressable
                accessibilityLabel={isExpanded ? "ย่อหน้าต่างเลือกรูปภาพ" : "ขยายหน้าต่างรูปภาพเต็มจอ"}
                hitSlop={8}
                onPress={toggleExpand}
                style={({ pressed }) => [
                  styles.expandToggleBtn,
                  {
                    backgroundColor: isExpanded
                      ? isDark
                        ? 'rgba(59, 90, 254, 0.25)'
                        : 'rgba(59, 90, 254, 0.12)'
                      : glassBg,
                    borderColor: isExpanded ? primary : glassBorder,
                  },
                  pressed && styles.pressedPill,
                ]}
              >
                <FeatureIcon
                  color={isExpanded ? primary : ink}
                  name={isExpanded ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'}
                  size={13}
                />
              </Pressable>

              {/* Full Library System Picker Button */}
              <Pressable
                accessibilityLabel="เปิดคลังภาพของเครื่อง"
                hitSlop={8}
                onPress={() => {
                  setShowAlbumPicker(false);
                  onClose?.();
                  setTimeout(() => onSelectLibrary?.(), 100);
                }}
                style={({ pressed }) => [
                  styles.libraryGlassBtn,
                  { backgroundColor: glassBg, borderColor: glassBorder },
                  pressed && styles.pressedPill,
                ]}
              >
                <View style={styles.libraryIconWrap}>
                  <FeatureIcon color={ink} name="photo.on.rectangle" size={15} />
                </View>
              </Pressable>
            </View>
          </View>
        </View>

      {/* iOS Frosted Glass Album Dropdown Menu (Scrollable) */}
      {showAlbumPicker && (
        <>
          {/* Backdrop to tap outside and dismiss dropdown */}
          <Pressable
            accessibilityLabel="ปิดตัวเลือกอัลบัม"
            onPress={() => setShowAlbumPicker(false)}
            style={styles.dropdownBackdrop}
          />

          <View
            style={[
              styles.dropdownCard,
              {
                borderColor: glassBorder,
                backgroundColor: isDark
                  ? 'rgba(24, 27, 36, 0.94)'
                  : 'rgba(255, 255, 255, 0.96)',
              },
            ]}
          >
            <BlurView
              intensity={isDark ? 70 : 80}
              style={StyleSheet.absoluteFill}
              tint={isDark ? 'dark' : 'light'}
            />

            {/* Scrollable Album Items */}
            <ScrollView
              contentContainerStyle={styles.dropdownScrollContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={true}
              style={styles.dropdownScrollView}
            >
              {/* "ล่าสุด (ทั้งหมด)" Option */}
              <Pressable
                accessibilityLabel="อัลบัมล่าสุด ทั้งหมด"
                onPress={() => {
                  setSelectedAlbum(null);
                  setShowAlbumPicker(false);
                }}
                style={({ pressed }) => [
                  styles.dropdownItem,
                  !selectedAlbum && [
                    styles.dropdownItemActive,
                    {
                      backgroundColor: isDark
                        ? 'rgba(59, 90, 254, 0.16)'
                        : 'rgba(59, 90, 254, 0.10)',
                    },
                  ],
                  pressed && styles.pressedPill,
                ]}
              >
                <View style={styles.dropdownItemLeft}>
                  <View
                    style={[
                      styles.dropdownItemIconCircle,
                      {
                        backgroundColor: !selectedAlbum
                          ? primary
                          : isDark
                          ? 'rgba(255, 255, 255, 0.1)'
                          : 'rgba(0, 0, 0, 0.06)',
                      },
                    ]}
                  >
                    <View style={styles.dropdownItemIconWrap}>
                      <FeatureIcon
                        color={!selectedAlbum ? '#FFFFFF' : ink}
                        name="clock.fill"
                        size={13}
                      />
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.dropdownItemText,
                      {
                        color: !selectedAlbum ? primary : ink,
                        fontWeight: !selectedAlbum ? '700' : '600',
                      },
                    ]}
                  >
                    ล่าสุด (ทั้งหมด)
                  </Text>
                </View>

                {!selectedAlbum ? (
                  <View style={styles.dropdownCheckWrap}>
                    <FeatureIcon color={primary} name="checkmark" size={13} />
                  </View>
                ) : null}
              </Pressable>

              {/* Dynamic Device Albums */}
              {albums.map((album) => {
                const isSelected = selectedAlbum?.id === album.id;
                return (
                  <Pressable
                    accessibilityLabel={`อัลบัม ${album.title}`}
                    key={album.id}
                    onPress={() => {
                      setSelectedAlbum(album);
                      setShowAlbumPicker(false);
                    }}
                    style={({ pressed }) => [
                      styles.dropdownItem,
                      isSelected && [
                        styles.dropdownItemActive,
                        {
                          backgroundColor: isDark
                            ? 'rgba(59, 90, 254, 0.16)'
                            : 'rgba(59, 90, 254, 0.10)',
                        },
                      ],
                      pressed && styles.pressedPill,
                    ]}
                  >
                    <View style={styles.dropdownItemLeft}>
                      <View
                        style={[
                          styles.dropdownItemIconCircle,
                          {
                            backgroundColor: isSelected
                              ? primary
                              : isDark
                              ? 'rgba(255, 255, 255, 0.1)'
                              : 'rgba(0, 0, 0, 0.06)',
                          },
                        ]}
                      >
                        <View style={styles.dropdownItemIconWrap}>
                          <FeatureIcon
                            color={isSelected ? '#FFFFFF' : ink}
                            name="folder.fill"
                            size={13}
                          />
                        </View>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.dropdownItemText,
                          {
                            color: isSelected ? primary : ink,
                            fontWeight: isSelected ? '700' : '600',
                          },
                        ]}
                      >
                        {album.title}
                      </Text>
                    </View>

                    <View style={styles.dropdownItemRight}>
                      {typeof album.assetCount === 'number' ? (
                        <Text style={[styles.dropdownCountText, { color: inkSoft }]}>
                          {album.assetCount}
                        </Text>
                      ) : null}
                      {isSelected ? (
                        <View style={styles.dropdownCheckWrap}>
                          <FeatureIcon color={primary} name="checkmark" size={13} />
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </>
      )}

      {/* Limited Photo or Android Permission Notice */}
      {accessPrivileges === 'limited' && (
        <View
          style={[
            styles.limitedBanner,
            {
              backgroundColor: isDark
                ? 'rgba(59, 90, 254, 0.12)'
                : 'rgba(59, 90, 254, 0.08)',
              borderBottomColor: glassBorder,
            },
          ]}
        >
          <View style={styles.limitedBannerLeft}>
            <FeatureIcon color={primary} name="info.circle.fill" size={13} />
            <Text numberOfLines={1} style={[styles.limitedBannerText, { color: ink }]}>
              เลือกสื่อไว้บางส่วน
            </Text>
          </View>
          <View style={styles.limitedBannerActions}>
            <Pressable
              hitSlop={4}
              onPress={() => {
                handleManageLimitedPhotos();
              }}
              style={({ pressed }) => [
                styles.limitedActionBtn,
                { backgroundColor: primary },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.limitedActionBtnText}>
                เลือกสื่อเพิ่ม
              </Text>
            </Pressable>
            <Pressable
              hitSlop={4}
              onPress={async () => {
                Linking.openSettings();
              }}
              style={({ pressed }) => [
                styles.limitedActionSecondaryBtn,
                { borderColor: glassBorder },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.limitedActionSecondaryText, { color: inkSoft }]}>
                เปิดการตั้งค่า
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Content: Photo Grid or Permission Banner (Only block on iOS where photo access is mandatory to view) */}
      {Platform.OS === 'android' && (
        permissionStatus === 'undetermined' ||
        permissionStatus === 'denied' ||
        accessPrivileges === 'none'
      ) ? (
        <View style={styles.permissionContainer}>
          <View style={[styles.permissionIconCircle, { backgroundColor: 'rgba(59, 90, 254, 0.12)' }]}>
            <FeatureIcon color={primary} name="photo.on.rectangle" size={28} />
          </View>
          <Text style={[styles.permissionTitle, { color: ink }]}>เลือกสื่อจากอัลบั้ม</Text>
          <Text style={[styles.permissionSub, { color: inkSoft }]}>อนุญาตเพื่อแสดงรูปภาพและวิดีโอใน grid ของแอป และเลือกส่งได้ทันที</Text>
          <Pressable
            accessibilityLabel={canAskPermission ? 'อนุญาตรูปภาพและวิดีโอ' : 'เปิดการตั้งค่าสิทธิ์รูปภาพและวิดีโอ'}
            onPress={() => canAskPermission ? loadDevicePhotos() : Linking.openSettings()}
            style={[styles.permissionBtn, { backgroundColor: primary }]}
          >
            <Text style={styles.permissionBtnText}>{canAskPermission ? 'อนุญาตรูปภาพและวิดีโอ' : 'เปิดการตั้งค่าสิทธิ์'}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="เลือกสื่อผ่านตัวเลือกระบบ"
            onPress={() => { onClose?.(); setTimeout(() => onSelectLibrary?.(), 150); }}
            style={[styles.secondaryBtn, { borderColor: line }]}
          >
            <Text style={[styles.secondaryBtnText, { color: ink }]}>ใช้ตัวเลือกระบบแทน</Text>
          </Pressable>
        </View>
      ) : Platform.OS === 'ios' && permissionStatus === 'denied' ? (
        <View style={styles.permissionContainer}>
          <View style={[styles.permissionIconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
            <FeatureIcon color="#EF4444" name="photo" size={28} />
          </View>
          <Text style={[styles.permissionTitle, { color: ink }]}>
            ต้องการสิทธิ์เข้าถึงคลังรูปภาพ
          </Text>
          <Text style={[styles.permissionSub, { color: inkSoft }]}>
            เปิดสิทธิ์เพื่อให้แสดงภาพถ่ายล่าสุดในเครื่อง และส่งรูปได้ทันทีในห้องแชต
          </Text>
          <Pressable
            onPress={() => canAskPermission ? loadDevicePhotos() : Linking.openSettings()}
            style={[styles.permissionBtn, { backgroundColor: primary }]}
          >
            <Text style={styles.permissionBtnText}>{canAskPermission ? 'อนุญาตการเข้าถึง' : 'เปิดการตั้งค่าสิทธิ์'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onClose?.();
              setTimeout(() => onSelectLibrary?.(), 100);
            }}
            style={[styles.secondaryBtn, { borderColor: line }]}
          >
            <Text style={[styles.secondaryBtnText, { color: ink }]}>เปิดตัวเลือกรูปภาพของเครื่อง</Text>
          </Pressable>
        </View>
      ) : loading && assets.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={primary} size="large" />
            <Text style={[styles.loadingText, { color: inkSoft }]}>กำลังโหลดรูปภาพและวิดีโอ...</Text>
        </View>
      ) : (
        <MediaPickerListErrorBoundary
          ink={ink}
          inkSoft={inkSoft}
          onRetry={loadDevicePhotos}
          primary={primary}
        >
          <FlatList
            key={`media-picker-grid-${NUM_COLUMNS}`}
            style={styles.gridFlatList}
            contentContainerStyle={[
              styles.gridContentContainer,
              {
                paddingHorizontal: GRID_HORIZONTAL_PADDING,
                paddingBottom: selectedAssets.length > 0 ? 64 + bottomInset : bottomInset + 8,
              },
            ]}
            data={gridData}
            extraData={selectedAssets}
            initialNumToRender={20}
            keyExtractor={(item, index) => (item?.id ? String(item.id) : (item?.uri ? String(item.uri) : `picker-item-${index}`))}
            maxToRenderPerBatch={24}
            numColumns={NUM_COLUMNS}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            renderItem={renderGridItem}
            showsVerticalScrollIndicator={false}
            windowSize={7}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.gridFooterLoader}>
                  <ActivityIndicator color={primary} size="small" />
                </View>
              ) : null
            }
          />
        </MediaPickerListErrorBoundary>
      )}

      {/* Bottom Send Floating iOS Glass Bar */}
      {selectedAssets.length > 0 && (
        <View
          style={[
            styles.bottomSendBar,
            {
              borderTopColor: glassBorder,
              paddingBottom: Math.max(bottomInset, 8),
            },
          ]}
        >
          <BlurView
            intensity={isDark ? 65 : 75}
            style={StyleSheet.absoluteFill}
            tint={isDark ? 'dark' : 'light'}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(18, 20, 26, 0.72)'
                  : 'rgba(255, 255, 255, 0.78)',
              },
            ]}
          />

          <View style={styles.selectedPreviewRow}>
            <View style={styles.selectedThumbsStack}>
              {selectedAssets.slice(-3).map((asset, idx) => (
                <GridAssetThumb
                  item={asset}
                  key={asset.id || idx}
                  style={[
                    styles.selectedMiniThumb,
                    idx > 0 && styles.selectedMiniThumbOverlap,
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.selectedInfoText, { color: ink }]}>
              เลือกแล้ว {selectedAssets.length} รายการ
            </Text>
          </View>

          <View style={styles.sendBarActionsRow}>
            {typeof onOpenEditor === 'function' && !isVideoAsset(selectedAssets[0]) && (
              <Pressable
                accessibilityLabel="แก้ไขรูปภาพที่เลือก"
                disabled={isSending}
                onPress={handleEditSelected}
                style={({ pressed }) => [
                  styles.editActionButton,
                  {
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.12)',
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
                  },
                  pressed && styles.pressedPill,
                ]}
              >
                <FeatureIcon color={ink} name="slider.horizontal.3" size={14} />
                <Text style={[styles.editActionButtonText, { color: ink }]}>แก้ไข</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityLabel={`ส่งสื่อ ${selectedAssets.length} รายการ`}
              disabled={isSending}
              onPress={handleSendSelected}
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: primary },
                pressed && styles.pressedSend,
              ]}
            >
              {isSending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <FeatureIcon color="#FFFFFF" name="paperplane.fill" size={14} />
                  <Text style={styles.sendButtonText}>
                    ส่ง ({selectedAssets.length})
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {/* Fullscreen Long-Press Photo Preview Modal (iOS Quick Look / Peek) */}
      <Modal
        animationType="none"
        hardwareAccelerated
        onRequestClose={handleClosePreview}
        statusBarTranslucent
        transparent
        visible={Boolean(previewPhoto)}
      >
        <View style={styles.previewModalRoot}>
          {/* Frosted Glass Backdrop */}
          <BlurView
            intensity={isDark ? 65 : 75}
            style={StyleSheet.absoluteFill}
            tint={isDark ? 'dark' : 'light'}
          />
          <Pressable
            accessibilityLabel="แตะเพื่อปิดภาพตัวอย่าง"
            onPress={handleClosePreview}
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? 'rgba(0, 0, 0, 0.48)'
                  : 'rgba(0, 0, 0, 0.35)',
              },
            ]}
          />

          {/* Centered Floating Preview Card */}
          {previewPhoto && (
            <Animated.View
              style={[
                styles.previewCardContainer,
                {
                  opacity: previewOpacityAnim,
                  transform: [{ scale: previewScaleAnim }],
                },
              ]}
            >
              {/* Photo View with Rounded Corners */}
              <View
                style={[
                  styles.previewImageWrapper,
                  {
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                    backgroundColor: isDark ? '#14161D' : '#E2E8F0',
                  },
                ]}
              >
                <GridAssetThumb item={previewPhoto} style={styles.previewImage} />
              </View>

              {/* iOS Glass Action Bar */}
              <View
                style={[
                  styles.previewActionBar,
                  {
                    backgroundColor: isDark
                      ? 'rgba(26, 29, 38, 0.92)'
                      : 'rgba(255, 255, 255, 0.94)',
                    borderColor: isDark
                      ? 'rgba(255, 255, 255, 0.16)'
                      : 'rgba(0, 0, 0, 0.1)',
                  },
                ]}
              >
                {/* Select / Deselect Button */}
                {(() => {
                  const isPreviewSelected = selectedAssets.some((a) => a.id === previewPhoto.id);
                  return (
                    <Pressable
                      accessibilityLabel={
                        isPreviewSelected
                          ? `ยกเลิกการเลือก${isVideoAsset(previewPhoto) ? 'วิดีโอ' : 'รูปภาพ'}นี้`
                          : `เลือก${isVideoAsset(previewPhoto) ? 'วิดีโอ' : 'รูปภาพ'}นี้`
                      }
                      onPress={() => {
                        handleToggleSelect(previewPhoto);
                        handleClosePreview();
                      }}
                      style={({ pressed }) => [
                        styles.previewActionBtn,
                        pressed && styles.pressedPill,
                      ]}
                    >
                      <FeatureIcon
                        color={
                          isPreviewSelected
                            ? '#EF4444'
                            : primary
                        }
                        name={
                          isPreviewSelected
                            ? 'xmark.circle.fill'
                            : 'checkmark.circle.fill'
                        }
                        size={16}
                      />
                      <Text
                        style={[
                          styles.previewActionText,
                          {
                            color:
                              isPreviewSelected
                                ? '#EF4444'
                                : ink,
                          },
                        ]}
                      >
                        {isPreviewSelected
                          ? 'ยกเลิกเลือก'
                          : `เลือก${isVideoAsset(previewPhoto) ? 'วิดีโอ' : 'รูปภาพ'}นี้`}
                      </Text>
                    </Pressable>
                  );
                })()}

                {typeof onOpenEditor === 'function' && !isVideoAsset(previewPhoto) && (
                  <>
                    <View
                      style={[
                        styles.previewActionDivider,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255, 255, 255, 0.12)'
                            : 'rgba(0, 0, 0, 0.08)',
                        },
                      ]}
                    />

                    {/* Edit Photo Button */}
                    <Pressable
                      accessibilityLabel="แก้ไขรูปภาพนี้"
                      onPress={() => handleEditPreviewPhoto(previewPhoto)}
                      style={({ pressed }) => [
                        styles.previewActionBtn,
                        pressed && styles.pressedPill,
                      ]}
                    >
                      <FeatureIcon color={primary} name="slider.horizontal.3" size={16} />
                      <Text style={[styles.previewActionText, { color: ink }]}>แก้ไข</Text>
                    </Pressable>
                  </>
                )}

                <View
                  style={[
                    styles.previewActionDivider,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255, 255, 255, 0.12)'
                        : 'rgba(0, 0, 0, 0.08)',
                    },
                  ]}
                />

                {/* Send Directly Button */}
                <Pressable
                  accessibilityLabel={`ส่ง${isVideoAsset(previewPhoto) ? 'วิดีโอ' : 'รูปภาพ'}นี้ทันที`}
                  disabled={isSending}
                  onPress={() => handleSendPreviewPhoto(previewPhoto)}
                  style={({ pressed }) => [
                    styles.previewSendBtn,
                    { backgroundColor: primary },
                    pressed && styles.pressedSend,
                  ]}
                >
                  <FeatureIcon color="#FFFFFF" name="paperplane.fill" size={13} />
                  <Text style={styles.previewSendBtnText}>ส่งทันที</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      </Modal>
      </Animated.View>
    </View>
  );

  // If inline (default), render directly under the input bar
  if (inline) {
    return content;
  }

  // Fallback modal presentation
  return (
    <Modal
      animationType="slide"
      hardwareAccelerated
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={isOpen}
    >
      <View style={styles.modalRoot}>
        <Pressable onPress={onClose} style={styles.modalBackdrop} />
        {content}
      </View>
    </Modal>
   );
});

export default ChatMediaPickerSheet;

const styles = StyleSheet.create({
  sheetContainerWrapper: {
    position: 'relative',
    width: '100%',
  },
  expandBackdrop: {
    backgroundColor: '#000000',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: -SCREEN_HEIGHT,
    zIndex: 9998,
  },
  drawerContainer: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    elevation: 16,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    width: '100%',
    zIndex: 9999,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  topDraggableArea: {
    width: '100%',
  },
  grabberTouchZone: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: '100%',
  },
  grabberBar: {
    borderRadius: 2.5,
    height: 4.5,
    width: 40,
  },
  headerRightActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  expandToggleBtn: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  headerRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 42,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  albumDropdownTrigger: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 32,
    justifyContent: 'center',
    maxWidth: '75%',
    paddingLeft: 10,
    paddingRight: 10,
  },
  triggerIconWrap: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'center',
    width: 16,
  },
  albumDropdownTriggerText: {
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
    letterSpacing: -0.2,
    lineHeight: 18,
    textAlignVertical: 'center',
  },
  triggerChevronWrap: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'center',
    width: 14,
  },
  libraryGlassBtn: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  libraryIconWrap: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  pressedPill: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
  },
  dropdownCard: {
    borderRadius: 18,
    borderWidth: 1,
    elevation: 20,
    left: 10,
    maxHeight: 220,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    top: 54,
    width: 240,
    zIndex: 100,
  },
  dropdownScrollView: {
    maxHeight: 220,
  },
  dropdownScrollContent: {
    paddingVertical: 4,
  },
  dropdownItem: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 40,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  dropdownItemActive: {
    borderRadius: 12,
    marginHorizontal: 4,
  },
  dropdownItemLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 9,
  },
  dropdownItemIconCircle: {
    alignItems: 'center',
    borderRadius: 13,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  dropdownItemIconWrap: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  dropdownItemText: {
    fontSize: 13,
    includeFontPadding: false,
    letterSpacing: -0.2,
    lineHeight: 18,
    textAlignVertical: 'center',
  },
  dropdownCheckWrap: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'center',
    width: 16,
  },
  dropdownItemRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  dropdownCountText: {
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
    lineHeight: 16,
  },
  gridFlatList: {
    flex: 1,
  },
  gridContentContainer: {
    paddingTop: SPACING,
  },
  errorFallbackContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  errorFallbackTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  errorFallbackSub: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorRetryBtn: {
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  errorRetryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  limitedBanner: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 34,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  limitedBannerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  limitedBannerText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  limitedBannerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  limitedActionBtn: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  limitedActionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  limitedActionSecondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  limitedActionSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  gridFooterLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    width: '100%',
  },
  cameraTile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIconCircle: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  cameraIconCenter: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  cameraTileText: {
    fontSize: 11.5,
    fontWeight: '600',
    includeFontPadding: false,
    lineHeight: 14,
    marginTop: 5,
    textAlign: 'center',
    width: '100%',
  },
  photoTile: {
    overflow: 'hidden',
    position: 'relative',
  },
  photoThumb: {
    height: '100%',
    width: '100%',
  },
  videoTileBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderRadius: 9,
    bottom: 5,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
    right: 5,
  },
  videoTileDuration: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  selectCircle: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 5,
    top: 5,
    width: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 4,
  },
  selectBadgeNumber: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
    textAlign: 'center',
  },
  pressedTile: {
    opacity: 0.85,
  },
  bottomSendBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 8,
    position: 'absolute',
    right: 0,
    zIndex: 50,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
  },
  selectedPreviewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  selectedThumbsStack: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  selectedMiniThumb: {
    borderColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    height: 36,
    width: 36,
  },
  selectedMiniThumbOverlap: {
    marginLeft: -16,
  },
  selectedInfoText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sendBarActionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  editActionButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editActionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 6,
    minWidth: 78,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  pressedSend: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 30,
  },
  loadingText: {
    fontSize: 12,
    marginTop: 8,
  },
  permissionContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  permissionIconCircle: {
    alignItems: 'center',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    marginBottom: 10,
    width: 52,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  permissionSub: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 14,
    textAlign: 'center',
  },
  permissionBtn: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
    width: '100%',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  previewModalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  previewCardContainer: {
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
  },
  previewImageWrapper: {
    borderRadius: 22,
    borderWidth: 1,
    elevation: 20,
    height: Math.min(Math.round(Dimensions.get('window').height * 0.58), 500),
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    width: '100%',
  },
  previewImage: {
    height: '100%',
    width: '100%',
  },
  previewActionBar: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    width: '100%',
  },
  previewActionBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  previewActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  previewActionDivider: {
    height: 20,
    width: 1,
  },
  previewSendBtn: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  previewSendBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
