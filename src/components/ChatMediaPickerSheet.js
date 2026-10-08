import Text from './AppText';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Dimensions, Linking, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { FlatList, Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import FeatureIcon from './FeatureIcon';
import { project, rubberband } from '../utils/motion';
import { showAlert } from '../utils/appAlert';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// Keep Android media access usable when Expo PHOTO is missing from the installed APK.


function rubberbandVisibleH(next, maxH, collapsedH) {
  'worklet';
  if (next > maxH) {
    return maxH + rubberband(next - maxH, maxH);
  }
  if (next < 0) {
    const dim = collapsedH > 0 ? collapsedH : 1;
    return -rubberband(-next, dim);
  }
  return next;
}

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
export const MEDIA_PICKER_COLLAPSED_HEIGHT = 310;
const COLLAPSED_HEIGHT = MEDIA_PICKER_COLLAPSED_HEIGHT;
const GRID_ROW_HEIGHT = ITEM_SIZE + SPACING;
const SCRUBBER_WIDTH = 28;
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function formatAssetMonthLabel(timestamp) {
  if (!timestamp && timestamp !== 0) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${TH_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear() + 543}`;
}

function getAssetTimestamp(asset) {
  const raw = asset?.creationTime ?? asset?.modificationTime;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function getAndroidMediaAccess() {
  if (Platform.OS !== 'android') return null;
  const api = Number(Platform.Version);
  const empty = { granted: false, privileges: 'none', images: false, video: false, limited: false };
  try {
    if (api >= 33) {
      let images = false;
      let video = false;
      let limited = false;
      try {
        images = await PermissionsAndroid.check('android.permission.READ_MEDIA_IMAGES');
      } catch (_) {}
      try {
        video = await PermissionsAndroid.check('android.permission.READ_MEDIA_VIDEO');
      } catch (_) {}
      if (api >= 34) {
        try {
          limited = await PermissionsAndroid.check('android.permission.READ_MEDIA_VISUAL_USER_SELECTED');
        } catch (_) {}
      }
      if (images || video) {
        return { granted: true, privileges: images && video ? 'all' : 'limited', images, video, limited };
      }
      if (limited) return { granted: true, privileges: 'limited', images, video, limited };
      return { ...empty, images, video, limited };
    }
    const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
    return { granted: Boolean(ok), privileges: ok ? 'all' : 'none', images: Boolean(ok), video: Boolean(ok), limited: false };
  } catch {
    return empty;
  }
}

async function getExpoLibraryPermission(shouldRequest = false) {
  const requestedMediaTypes = Platform.OS === 'android' ? ['photo', 'video'] : undefined;
  const fallback = {
    granted: false,
    status: 'undetermined',
    canAskAgain: true,
    accessPrivileges: 'none',
  };
  const readOrRequest = async (mediaTypes) => {
    let perm = await MediaLibrary.getPermissionsAsync(false, mediaTypes);
    const needsPrompt = perm.status !== 'granted'
      && perm.accessPrivileges !== 'limited'
      && perm.canAskAgain !== false;
    if (shouldRequest && needsPrompt) {
      perm = await MediaLibrary.requestPermissionsAsync(false, mediaTypes);
    }
    return perm;
  };
  try {
    return await readOrRequest(requestedMediaTypes);
  } catch (err) {
    if (Platform.OS === 'android') {
      try {
        return await readOrRequest(['video']);
      } catch (_) {}
    }
    console.warn('[ChatMediaPickerSheet] expo permission check failed:', err);
    return fallback;
  }
}

function mediaTypesForAccess(androidAccess) {
  if (Platform.OS !== 'android' || !androidAccess) {
    return [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
  }
  const types = [];
  if (androidAccess.images) types.push(MediaLibrary.MediaType.photo);
  if (androidAccess.video || androidAccess.limited) types.push(MediaLibrary.MediaType.video);
  if (types.length === 0) {
    return [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
  }
  return types;
}

function hasLibraryAccess(perm, androidAccess) {
  return Boolean(
    perm?.granted
    || perm?.status === 'granted'
    || perm?.accessPrivileges === 'limited'
    || perm?.accessPrivileges === 'all'
    || androidAccess?.granted
  );
}

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
  overlay = false,
}, ref) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets?.bottom ?? 0;
  const topInset = insets?.top ?? 0;
  const EXPANDED_HEIGHT = Math.round(SCREEN_HEIGHT - topInset - 16);

  const [isExpanded, setIsExpanded] = useState(false);
  const maxH = EXPANDED_HEIGHT + bottomInset;
  const collapsedH = COLLAPSED_HEIGHT + bottomInset;
  const visibleH = useSharedValue(collapsedH);
  const maxHSv = useSharedValue(maxH);
  const collapsedHSv = useSharedValue(collapsedH);
  const dragStartH = useSharedValue(collapsedH);
  const closingSv = useSharedValue(0);
  const previewScale = useSharedValue(0.92);
  const previewOpacity = useSharedValue(0);

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
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [scrubLabel, setScrubLabel] = useState('');
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isClosingRef = useRef(false);
  const requestingPermissionRef = useRef(false);
  const gridListRef = useRef(null);
  const scrubTrackHeightRef = useRef(1);
  const scrubLabelOpacity = useSharedValue(0);
  const scrubThumbY = useSharedValue(0);

  useEffect(() => {
    maxHSv.set(maxH);
    collapsedHSv.set(collapsedH);
  }, [collapsedH, collapsedHSv, maxH, maxHSv]);

  const syncExpanded = useCallback((expanded) => {
    setIsExpanded(expanded);
  }, []);

  const clearClosingFlag = useCallback(() => {
    isClosingRef.current = false;
    closingSv.set(0);
  }, [closingSv]);

  const handleClosed = useCallback(() => {
    isClosingRef.current = false;
    closingSv.set(0);
    setIsExpanded(false);
    onClose?.();
  }, [closingSv, onClose]);

  const expandSheet = useCallback(() => {
    isClosingRef.current = false;
    closingSv.set(0);
    visibleH.set(withTiming(maxH, { duration: 320, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(syncExpanded, true);
    }));
  }, [closingSv, maxH, syncExpanded, visibleH]);

  const collapseSheet = useCallback(() => {
    isClosingRef.current = false;
    closingSv.set(0);
    visibleH.set(withTiming(collapsedH, { duration: 300, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(syncExpanded, false);
    }));
  }, [collapsedH, closingSv, syncExpanded, visibleH]);

  const closeSheetWithAnimation = useCallback(() => {
    if (isClosingRef.current || closingSv.get()) return;
    isClosingRef.current = true;
    closingSv.set(1);
    visibleH.set(withTiming(0, { duration: 250, easing: EASE_OUT }, (finished) => {
      if (finished) {
        scheduleOnRN(handleClosed);
      } else {
        scheduleOnRN(clearClosingFlag);
      }
    }));
  }, [clearClosingFlag, closingSv, handleClosed, visibleH]);

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
    cancelAnimation(previewScale);
    cancelAnimation(previewOpacity);
    previewScale.set(0.92);
    previewOpacity.set(0);
    previewScale.set(withSpring(1, { duration: 300, dampingRatio: 0.8 }));
    previewOpacity.set(withTiming(1, { duration: 180, easing: EASE_OUT }));
  }, [previewOpacity, previewScale]);

  const clearPreviewPhoto = useCallback(() => {
    setPreviewPhoto(null);
  }, []);

  const handleClosePreview = useCallback(() => {
    previewScale.set(withTiming(0.92, { duration: 140, easing: EASE_OUT }));
    previewOpacity.set(withTiming(0, { duration: 140, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(clearPreviewPhoto);
    }));
  }, [clearPreviewPhoto, previewOpacity, previewScale]);

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
      closingSv.set(0);
      setSelectedAssets([]);
      setIsSending(false);
      setPreviewPhoto(null);
      setShowAlbumPicker(false);
      setIsExpanded(false);
      cancelAnimation(visibleH);
      visibleH.set(0);
      visibleH.set(withTiming(collapsedH, { duration: 260, easing: EASE_OUT }));
    }
  }, [collapsedH, closingSv, isOpen, visibleH]);

  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-4, 4])
    .onStart(() => {
      cancelAnimation(visibleH);
      closingSv.set(0);
      dragStartH.set(visibleH.get());
    })
    .onUpdate((event) => {
      const next = dragStartH.get() - event.translationY;
      visibleH.set(rubberbandVisibleH(next, maxHSv.get(), collapsedHSv.get()));
    })
    .onEnd((event) => {
      const collapsed = collapsedHSv.get();
      const max = maxHSv.get();
      const current = visibleH.get();
      const projectedH = current - project(event.velocityY);
      const springVel = -event.velocityY;

      const springTo = (toH, expanded) => {
        'worklet';
        if (toH <= 0) {
          if (closingSv.get()) return;
          closingSv.set(1);
        }
        visibleH.set(withSpring(toH, { duration: 300, dampingRatio: 0.8, velocity: springVel }, (finished) => {
          if (!finished) {
            if (toH <= 0) closingSv.set(0);
            return;
          }
          if (toH <= 0) {
            scheduleOnRN(handleClosed);
          } else {
            scheduleOnRN(syncExpanded, expanded);
          }
        }));
      };

      const isTap = Math.abs(event.translationX) < 6 && Math.abs(event.translationY) < 6;
      if (isTap) {
        if (current > (collapsed + max) / 2) {
          springTo(collapsed, false);
        } else {
          springTo(max, true);
        }
        return;
      }

      // 1. High-velocity flicks (Reanimated velocityY is px/s; old PanResponder vy ≈ /1000)
      if (event.velocityY < -450) {
        springTo(max, true);
        return;
      }
      if (event.velocityY > 550) {
        if (current > collapsed + 80) {
          springTo(collapsed, false);
        } else {
          springTo(0, false);
        }
        return;
      }
      if (projectedH >= max && event.velocityY <= 0) {
        springTo(max, true);
        return;
      }

      // 2. Below collapsed threshold -> close or snap back to collapsed
      if (current < collapsed) {
        if (current < collapsed - 40) {
          springTo(0, false);
        } else {
          springTo(collapsed, false);
        }
        return;
      }

      // 3. Near top expanded (within 40px)
      if (current >= max - 40) {
        springTo(max, true);
        return;
      }

      // 4. Near bottom collapsed (within 35px)
      if (current <= collapsed + 35) {
        springTo(collapsed, false);
        return;
      }

      // In between: retain the exact height the user dragged to
      const retained = Math.min(Math.max(current, 0), max);
      if (retained !== current) {
        springTo(retained, retained > (collapsed + max) / 2);
      } else {
        scheduleOnRN(syncExpanded, current > (collapsed + max) / 2);
      }
    }), [
    collapsedHSv,
    closingSv,
    dragStartH,
    handleClosed,
    maxHSv,
    syncExpanded,
    visibleH,
  ]);

  const spacerStyle = useAnimatedStyle(() => ({
    height: interpolate(
      visibleH.get(),
      [0, collapsedHSv.get()],
      [0, collapsedHSv.get()],
      Extrapolation.CLAMP,
    ),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    height: Math.max(visibleH.get(), 0),
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      visibleH.get(),
      [collapsedHSv.get(), maxHSv.get()],
      [0, 0.45],
      Extrapolation.CLAMP,
    ),
  }));

  const sendBarStyle = useAnimatedStyle(() => ({
    bottom: 0,
  }));

  const previewCardStyle = useAnimatedStyle(() => ({
    opacity: previewOpacity.get(),
    transform: [{ scale: previewScale.get() }],
  }));

  // Load photos from device MediaLibrary.
  // Pass true to show the system permission prompt; opening the sheet only checks current status
  // so the prompt appears when the user taps Allow (and is not swallowed on first paint).
  const loadDevicePhotos = useCallback(async (shouldRequest = false) => {
    try {
      setLoading(true);
      const androidAccess = await getAndroidMediaAccess();
      let perm = await getExpoLibraryPermission(shouldRequest);
      let hasAccess = hasLibraryAccess(perm, androidAccess);
      let currentPrivileges = !hasAccess
        ? 'none'
        : (perm.accessPrivileges === 'limited' || androidAccess?.privileges === 'limited' ? 'limited' : 'all');
      const queryMediaTypes = mediaTypesForAccess(androidAccess);

      if (!hasAccess && Platform.OS === 'android') {
        try {
          const probe = await MediaLibrary.getAssetsAsync({
            first: 1,
            mediaType: queryMediaTypes,
          });
          if (probe) {
            hasAccess = true;
            currentPrivileges = androidAccess?.privileges === 'all' ? 'all' : 'limited';
            perm = { ...perm, status: 'granted', granted: true, accessPrivileges: currentPrivileges };
          }
        } catch (_) {}
      }

      setPermissionStatus(hasAccess ? 'granted' : (perm.status || 'denied'));
      setCanAskPermission(perm.canAskAgain !== false);
      setAccessPrivileges(currentPrivileges);

      if (hasAccess) {
        const queryOptions = {
          first: 60,
          mediaType: queryMediaTypes,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        };
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
        mediaType: mediaTypesForAccess(await getAndroidMediaAccess()),
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

  const handleManageLimitedPhotos = useCallback(async () => {
    try {
      if (typeof MediaLibrary.presentPermissionsPickerAsync === 'function') {
        await MediaLibrary.presentPermissionsPickerAsync(['photo', 'video']);
        await loadDevicePhotos(false);
        return;
      }
      if (Platform.OS === 'android') {
        onClose?.();
        setTimeout(() => onSelectLibrary?.(), 100);
        return;
      }
      Linking.openSettings();
    } catch (_) {
      Linking.openSettings();
    }
  }, [loadDevicePhotos, onClose, onSelectLibrary]);

  const handleRequestMediaAccess = useCallback(async () => {
    if (requestingPermissionRef.current) return;
    requestingPermissionRef.current = true;
    setIsRequestingAccess(true);
    try {
      if (Platform.OS === 'android') {
        const api = Number(Platform.Version);
        if (api >= 33) {
          try {
            await PermissionsAndroid.requestMultiple([
              'android.permission.READ_MEDIA_IMAGES',
              'android.permission.READ_MEDIA_VIDEO',
            ]);
          } catch (requestErr) {
            console.warn('[ChatMediaPickerSheet] native media request failed:', requestErr);
            try {
              await PermissionsAndroid.request('android.permission.READ_MEDIA_VIDEO');
            } catch (_) {}
          }
        } else {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      } else {
        await MediaLibrary.requestPermissionsAsync(false);
      }
    } catch (err) {
      console.warn('[ChatMediaPickerSheet] request media access failed:', err);
    }
    try {
      await loadDevicePhotos(false);
    } catch (err) {
      console.warn('[ChatMediaPickerSheet] reload after media access failed:', err);
    } finally {
      requestingPermissionRef.current = false;
      setIsRequestingAccess(false);
    }
  }, [loadDevicePhotos]);

  useEffect(() => {
    if (isOpen) {
      loadDevicePhotos();
    }
  }, [isOpen, loadDevicePhotos]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') loadDevicePhotos(false);
    });
    return () => sub.remove();
  }, [isOpen, loadDevicePhotos]);

  // Toggle selection (support multiple photos up to 10)
  const handleToggleSelect = useCallback((item) => {
    setSelectedAssets((prev) => {
      const exists = prev.some((a) => a.id === item.id);
      if (exists) {
        return prev.filter((a) => a.id !== item.id);
      }
      if (prev.length > 0 && isVideoAsset(prev[0]) !== isVideoAsset(item)) {
        showAlert('เลือกสื่อทีละประเภท', 'กรุณาเลือกรูปภาพหรือวิดีโออย่างใดอย่างหนึ่งต่อครั้ง', { tone: 'warning' });
        return prev;
      }
      if (prev.length >= 10) {
        showAlert('เลือกได้สูงสุด 10 รายการ', 'คุณสามารถส่งรูปภาพหรือวิดีโอพร้อมกันได้สูงสุด 10 รายการ', { tone: 'warning' });
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
      showAlert('แก้ไขรูปภาพไม่ได้', 'เครื่องมือแก้ไขนี้ใช้ได้กับรูปภาพเท่านั้น', { tone: 'danger' });
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

  // Month marks for the right-edge fast scrubber (Photos-style).
  const monthMarks = useMemo(() => {
    const marks = [];
    safeAssets.forEach((asset, assetIndex) => {
      const timestamp = getAssetTimestamp(asset);
      if (!timestamp) return;
      const date = new Date(timestamp);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (marks.length && marks[marks.length - 1].key === key) return;
      marks.push({
        key,
        label: formatAssetMonthLabel(timestamp),
        gridIndex: assetIndex + 2,
        assetIndex,
      });
    });
    return marks;
  }, [safeAssets]);

  const getGridItemLayout = useCallback((_data, index) => {
    const row = Math.floor(index / NUM_COLUMNS);
    return {
      length: GRID_ROW_HEIGHT,
      offset: SPACING + row * GRID_ROW_HEIGHT,
      index,
    };
  }, []);

  const scrollGridToIndex = useCallback((gridIndex) => {
    const list = gridListRef.current;
    if (!list || gridIndex < 0) return;
    try {
      list.scrollToIndex({
        index: Math.min(gridIndex, Math.max(gridData.length - 1, 0)),
        animated: false,
        viewPosition: 0,
      });
    } catch (_) {
      const row = Math.floor(gridIndex / NUM_COLUMNS);
      list.scrollToOffset?.({
        offset: Math.max(0, SPACING + row * GRID_ROW_HEIGHT),
        animated: false,
      });
    }
  }, [gridData.length]);

  const updateScrubFromY = useCallback((localY, trackHeight) => {
    const height = Math.max(trackHeight || scrubTrackHeightRef.current || 1, 1);
    const clampedY = Math.min(Math.max(localY, 0), height);
    scrubThumbY.set(clampedY);
    const progress = height > 0 ? clampedY / height : 0;

    if (!monthMarks.length || !safeAssets.length) {
      setScrubLabel('');
      return;
    }

    const markIndex = Math.min(
      monthMarks.length - 1,
      Math.max(0, Math.round(progress * (monthMarks.length - 1)))
    );
    const mark = monthMarks[markIndex];
    if (!mark) return;
    setScrubLabel(mark.label);
    scrollGridToIndex(mark.gridIndex);
  }, [monthMarks, safeAssets.length, scrollGridToIndex, scrubThumbY]);

  const beginScrub = useCallback((localY, trackHeight) => {
    if (!isExpanded) expandSheet();
    setIsScrubbing(true);
    scrubLabelOpacity.set(withTiming(1, { duration: 120, easing: EASE_OUT }));
    updateScrubFromY(localY, trackHeight);
  }, [expandSheet, isExpanded, scrubLabelOpacity, updateScrubFromY]);

  const endScrub = useCallback(() => {
    setIsScrubbing(false);
    scrubLabelOpacity.set(withTiming(0, { duration: 180, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(setScrubLabel, '');
    }));
  }, [scrubLabelOpacity]);

  const scrubGesture = useMemo(() => Gesture.Pan()
    .enabled(!showAlbumPicker)
    .onTouchesDown((event) => {
      'worklet';
      const touch = event.allTouches[0];
      if (!touch) return;
      scheduleOnRN(beginScrub, touch.y, scrubTrackHeightRef.current);
    })
    .onUpdate((event) => {
      scheduleOnRN(updateScrubFromY, event.y, scrubTrackHeightRef.current);
    })
    .onFinalize(() => {
      scheduleOnRN(endScrub);
    }), [beginScrub, endScrub, showAlbumPicker, updateScrubFromY]);

  const scrubLabelStyle = useAnimatedStyle(() => ({
    opacity: scrubLabelOpacity.get(),
    transform: [
      { translateY: Math.max(scrubThumbY.get() - 18, 0) },
      { scale: interpolate(scrubLabelOpacity.get(), [0, 1], [0.92, 1], Extrapolation.CLAMP) },
    ],
  }));

  const handleGridScrollBeginDrag = useCallback(() => {
    if (!isExpanded) expandSheet();
  }, [expandSheet, isExpanded]);

  const handleScrollToIndexFailed = useCallback((info) => {
    const row = Math.floor((info?.index || 0) / NUM_COLUMNS);
    gridListRef.current?.scrollToOffset?.({
      offset: Math.max(0, SPACING + row * GRID_ROW_HEIGHT),
      animated: false,
    });
  }, []);

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

  if (!isOpen) return null;

  const content = (
    <View
      collapsable={false}
      pointerEvents="box-none"
      style={overlay ? styles.overlayHost : styles.sheetContainerWrapper}
    >
      {/* Dim backdrop when expanding full screen */}
      <Animated.View
        pointerEvents="none"
        style={[styles.expandBackdrop, backdropStyle]}
      />

      {/* Dynamic Animated Spacer maintaining bottom padding for chat messages & moving input bar in 1:1 sync */}
      {!overlay ? <Animated.View style={spacerStyle} /> : null}

      {/* Main Animated Bottom Sheet */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.drawerContainer,
          {
            backgroundColor: cardBg,
            overflow: 'hidden',
            paddingBottom: bottomInset,
            borderTopColor: line,
          },
          sheetStyle,
        ]}
      >
        {/* Draggable Top Area (both Grabber and Header can be gradually slid up/down) */}
        <GestureDetector gesture={panGesture}>
        <View collapsable={false} style={styles.topDraggableArea}>
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
              onPress={() => {
                setIsScrubbing(false);
                setScrubLabel('');
                scrubLabelOpacity.set(0);
                setShowAlbumPicker((prev) => !prev);
              }}
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
        </GestureDetector>

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
      {Platform.OS === 'android' && permissionStatus !== 'granted' && accessPrivileges !== 'limited' && accessPrivileges !== 'all' ? (
        <View collapsable={false} style={styles.permissionContainer}>
          <View style={[styles.permissionIconCircle, { backgroundColor: 'rgba(59, 90, 254, 0.12)' }]}>
            <FeatureIcon color={primary} name="photo.on.rectangle" size={28} />
          </View>
          <Text style={[styles.permissionTitle, { color: ink }]}>เลือกสื่อจากอัลบั้ม</Text>
          <Text style={[styles.permissionSub, { color: inkSoft }]}>อนุญาตเพื่อแสดงรูปภาพและวิดีโอใน grid ของแอป และเลือกส่งได้ทันที</Text>
          <View collapsable={false} style={{ width: '100%', zIndex: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={canAskPermission ? 'อนุญาตรูปภาพและวิดีโอ' : 'เปิดการตั้งค่าสิทธิ์รูปภาพและวิดีโอ'}
            accessible
            android_ripple={{ color: 'rgba(255,255,255,0.22)' }}
            disabled={isRequestingAccess}
            onPress={handleRequestMediaAccess}
            style={({ pressed }) => [
              styles.permissionBtn,
              { backgroundColor: primary, opacity: pressed || isRequestingAccess ? 0.82 : 1 },
            ]}
          >
            {isRequestingAccess ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.permissionBtnText}>{canAskPermission ? 'อนุญาตรูปภาพและวิดีโอ' : 'เปิดการตั้งค่าสิทธิ์'}</Text>
            )}
          </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="เลือกสื่อผ่านตัวเลือกระบบ"
            onPress={() => { onClose?.(); setTimeout(() => onSelectLibrary?.(), 150); }}
            style={[styles.secondaryBtn, { borderColor: line }]}
          >
            <Text style={[styles.secondaryBtnText, { color: ink }]}>ใช้ตัวเลือกระบบแทน</Text>
          </Pressable>
        </View>
      ) : Platform.OS === 'ios' && permissionStatus === 'denied' ? (
        <View collapsable={false} style={styles.permissionContainer}>
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
            accessibilityRole="button"
            android_ripple={{ color: 'rgba(255,255,255,0.22)' }}
            onPress={handleRequestMediaAccess}
            style={({ pressed }) => [
              styles.permissionBtn,
              { backgroundColor: primary, opacity: pressed ? 0.82 : 1 },
            ]}
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
          <View style={styles.gridHost}>
            <FlatList
              ref={gridListRef}
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
              getItemLayout={getGridItemLayout}
              initialNumToRender={24}
              keyExtractor={(item, index) => (item?.id ? String(item.id) : (item?.uri ? String(item.uri) : `picker-item-${index}`))}
              maxToRenderPerBatch={24}
              nestedScrollEnabled
              numColumns={NUM_COLUMNS}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              onScrollBeginDrag={handleGridScrollBeginDrag}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              renderItem={renderGridItem}
              showsVerticalScrollIndicator={false}
              windowSize={9}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.gridFooterLoader}>
                    <ActivityIndicator color={primary} size="small" />
                  </View>
                ) : null
              }
            />

            {monthMarks.length > 1 && !showAlbumPicker ? (
              <GestureDetector gesture={scrubGesture}>
                <View
                  accessibilityLabel="เลื่อนค้างเพื่อดูช่วงเดือน"
                  accessibilityRole="adjustable"
                  hitSlop={8}
                  onLayout={(event) => {
                    scrubTrackHeightRef.current = Math.max(event.nativeEvent.layout.height, 1);
                  }}
                  style={styles.scrubberTrack}
                >
                  <View
                    pointerEvents="none"
                    style={[
                      styles.scrubberRail,
                      {
                        backgroundColor: isDark
                          ? 'rgba(255, 255, 255, 0.16)'
                          : 'rgba(15, 23, 42, 0.12)',
                      },
                    ]}
                  />
                  {isScrubbing ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.scrubberLabel,
                        {
                          backgroundColor: isDark
                            ? 'rgba(24, 27, 36, 0.94)'
                            : 'rgba(15, 23, 42, 0.88)',
                        },
                        scrubLabelStyle,
                      ]}
                    >
                      <Text numberOfLines={1} style={styles.scrubberLabelText}>
                        {scrubLabel || monthMarks[0]?.label || ''}
                      </Text>
                    </Animated.View>
                  ) : null}
                </View>
              </GestureDetector>
            ) : null}
          </View>
        </MediaPickerListErrorBoundary>
      )}

      {/* Bottom Send Floating iOS Glass Bar */}
      {selectedAssets.length > 0 && (
        <Animated.View
          style={[
            styles.bottomSendBar,
            sendBarStyle,
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
        </Animated.View>
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
              style={[styles.previewCardContainer, previewCardStyle]}
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
  overlayHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
  },
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
    top: 0,
    zIndex: 0,
  },
  drawerContainer: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    elevation: 16,
    flexDirection: 'column',
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
    ...StyleSheet.absoluteFill,
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
    ...StyleSheet.absoluteFill,
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
    minHeight: 0,
  },
  gridHost: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  scrubberTrack: {
    bottom: 8,
    justifyContent: 'flex-start',
    overflow: 'visible',
    position: 'absolute',
    right: 0,
    top: 8,
    width: SCRUBBER_WIDTH,
    zIndex: 20,
  },
  scrubberRail: {
    alignSelf: 'center',
    borderRadius: 2,
    bottom: 12,
    position: 'absolute',
    top: 12,
    width: 3,
  },
  scrubberLabel: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    maxWidth: 140,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
    right: SCRUBBER_WIDTH + 8,
  },
  scrubberLabelText: {
    color: '#FFFFFF',
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
    letterSpacing: -0.2,
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
    ...StyleSheet.absoluteFill,
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    width: '100%',
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
    alignItems: 'center',
    borderRadius: 22,
    elevation: 2,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 12,
    width: '100%',
    zIndex: 2,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 11,
    width: '100%',
    zIndex: 2,
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
