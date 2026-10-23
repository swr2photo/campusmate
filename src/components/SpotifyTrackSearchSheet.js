import { Pressable } from './NativePressable';
import NativeAnimatedCard from './NativeAnimatedCard';
import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Keyboard, Linking, Modal, Platform, SectionList, StyleSheet, useColorScheme, View } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import { browseMusicTracks, getCachedBrowseMusicTracks, searchSpotifyTracksPage } from '../services/spotifyService';
import { getValidAccessToken, fetchSpotifyTopTracks } from '../services/spotifyAuthService';
import { resolvePlayablePreview } from '../services/previewAudioService';
import { isReliablePreviewUrl, spotifyListenUrl } from '../utils/trackPlayback';
import { ensureAudioPlaybackMode } from '../services/chatMediaService';
import { scheduleIdleTask } from '../utils/scheduleIdleTask';
import { getAlbumCardColor } from '../utils/albumArtColor';
import { project, rubberband } from '../utils/motion';
import { spacing, type, useTheme } from '../theme';
import { GlassBackground, GlassIconButton, useLiquidGlass, useSheetGlassTint } from './LiquidGlassSurface';

export const MAX_FAVORITE_TRACKS = 10;
const DEBOUNCE_MS = 550;
const MIN_QUERY_LENGTH = 1;
function TrackRow({ alreadyAdded, colors, isPlaying, item, onPress, selected }) {
  return (
    <Pressable
      disabled={alreadyAdded}
      onPress={() => onPress?.(item)}
      style={({ pressed }) => [
        styles.trackRow,
        {
          backgroundColor: colors.surface || '#FFFFFF',
          borderColor: selected ? (colors.primary || '#3986E8') : (colors.line || '#E2E8F0'),
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        },
        alreadyAdded && { opacity: 0.45 },
        pressed && !alreadyAdded && { opacity: 0.85 },
      ]}
    >
      {item.albumArt ? (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          recyclingKey={item.id}
          source={{ uri: item.albumArt }}
          style={styles.albumArt}
          transition={0}
        />
      ) : (
        <View style={[styles.albumArt, styles.albumArtFallback, { backgroundColor: colors.primarySoft || '#EEF2F7' }]}>
          <FeatureIcon color={colors.accentText || colors.primary || '#3986E8'} name="music.note" size={18} />
        </View>
      )}
      <View style={styles.trackCopy}>
        <View style={styles.trackTitleRow}>
          {selected && isPlaying ? (
            <FeatureIcon color={colors.accentText || colors.primary || '#3986E8'} name="speaker.wave.3.fill" size={12} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.trackName,
              { color: selected ? (colors.accentText || colors.primary || '#3986E8') : (colors.ink || '#25272B'), flex: 1 },
            ]}
          >
            {item.name}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.trackArtists, { color: colors.inkSoft || '#6B7078' }]}>
          {item.artists || 'Unknown'}
        </Text>
      </View>
      <Text style={[styles.addHint, { color: alreadyAdded ? colors.inkSoft : (colors.accentText || colors.primary || '#3986E8') }]}>
        {alreadyAdded ? 'เพิ่มแล้ว' : (selected ? 'ส่งเพลงนี้' : 'เลือก')}
      </Text>
    </Pressable>
  );
}

// The mini player always draws white text/icons, so its fallback card must stay
// dark in both themes (the theme `ink` token is near-white in dark mode).
const MINI_PLAYER_FALLBACK = '#1F2533';
const MINI_PLAYER_NEXT_ICON = '#1A2333';

function MiniPlayerBar({ hasPreview, insets, isPlaying, loading = false, missingMessage = '', onNext, onTogglePlay, track }) {
  const fallback = MINI_PLAYER_FALLBACK;
  const [cardColor, setCardColor] = useState(fallback);

  useEffect(() => {
    let active = true;
    if (!track?.albumArt) {
      setCardColor(fallback);
      return undefined;
    }
    getAlbumCardColor(track.albumArt, fallback).then((color) => {
      if (active) setCardColor(color);
    });
    return () => { active = false; };
  }, [fallback, track?.albumArt, track?.id]);

  if (!track) return null;
  return (
    <View
      style={[
        styles.miniBar,
        { backgroundColor: cardColor },
        { bottom: Math.max(insets.bottom, 10) },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 10 }}>
        {track.albumArt ? (
          <Image contentFit="cover" source={{ uri: track.albumArt }} style={styles.miniArt} />
        ) : (
          <View style={[styles.miniArt, styles.albumArtFallback, { backgroundColor: '#334155' }]}>
            <FeatureIcon color="#FFFFFF" name="music.note" size={14} />
          </View>
        )}
        <View style={styles.miniCopy}>
          <Text numberOfLines={1} style={styles.miniTitle}>{track.name}</Text>
          <Text numberOfLines={1} style={styles.miniArtists}>{missingMessage || track.artists || 'Unknown'}</Text>
        </View>
      </View>
      <Pressable
        accessibilityLabel={loading ? 'กำลังโหลดเสียงตัวอย่าง' : hasPreview ? (isPlaying ? 'หยุดชั่วคราว' : 'เล่น') : (missingMessage || 'ไม่มีเสียงตัวอย่าง')}
        accessibilityState={{ busy: loading, disabled: loading || !hasPreview }}
        disabled={loading || !hasPreview}
        hitSlop={8}
        onPress={onTogglePlay}
        style={({ pressed }) => [styles.miniIconBtn, !hasPreview && !loading && { opacity: 0.6 }, pressed && { opacity: 0.75 }]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <FeatureIcon color="#FFFFFF" name={hasPreview ? (isPlaying ? 'pause.fill' : 'play.fill') : 'speaker.slash.fill'} size={22} />
        )}
      </Pressable>
      <Pressable
        accessibilityLabel="ส่งเพลงนี้"
        onPress={onNext}
        style={({ pressed }) => [
          styles.nextBtn,
          pressed && { opacity: 0.88 },
        ]}
      >
        <FeatureIcon color={MINI_PLAYER_NEXT_ICON} name="paperplane.fill" size={18} />
      </Pressable>
    </View>
  );
}

/**
 * Search tracks, preview them, then send the selected song.
 */
export default function SpotifyTrackSearchSheet({
  colors: colorsProp,
  excludeIds = [],
  isOpen,
  onClose,
  onSelect,
  onSelectTrack,
  subtitle = 'แตะเพื่อฟัง แล้วกดส่งเพื่อแชร์เพลง',
  title = 'ค้นหาเพลง',
  visible,
}) {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const isDark = theme?.isDark ?? (colorScheme === 'dark');
  const rawColors = colorsProp || theme?.colors || {};
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();
  
  const colors = {
    canvas: rawColors.canvas || rawColors.background || (isDark ? '#000000' : '#F7F7F8'),
    surface: rawColors.surface || rawColors.card || (isDark ? '#1C1C1E' : '#FFFFFF'),
    ink: rawColors.ink || rawColors.text || (isDark ? '#FFFFFF' : '#25272B'),
    inkSoft: rawColors.inkSoft || (isDark ? '#A1A1AA' : '#6B7078'),
    line: rawColors.line || rawColors.border || (isDark ? '#333336' : '#E2E8F0'),
    primary: rawColors.primary || '#3986E8',
    accentText: rawColors.accentText || rawColors.primary || (isDark ? '#7CB8FF' : '#245DAF'),
    primarySoft: rawColors.primarySoft || (isDark ? '#172B4D' : '#EEF2F7'),
    danger: rawColors.danger || rawColors.notification || '#E85D5D',
    ...rawColors,
  };
  const open = visible ?? isOpen ?? false;
  const handlePick = onSelect || onSelectTrack;
  const insets = useSafeAreaInsets();

  const cachedBrowse = getCachedBrowseMusicTracks();
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState([]);
  const [recommended, setRecommended] = useState(() => cachedBrowse?.recommended || []);
  const [trending, setTrending] = useState(() => cachedBrowse?.trending || []);
  const [trendingHasMore, setTrendingHasMore] = useState(true);
  const [trendingLoadingMore, setTrendingLoadingMore] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(() => !(cachedBrowse?.recommended?.length || cachedBrowse?.trending?.length));
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [searchSource, setSearchSource] = useState(null);
  const [pageError, setPageError] = useState('');
  const [browseError, setBrowseError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [showTrim, setShowTrim] = useState(false);
  const [autoPlayToken, setAutoPlayToken] = useState(0);

  // Apple's preview is tried first (one fast request); Spotify's own file is the
  // fallback once that lookup has finished without a match. Before, a track
  // that only had a Spotify preview could never play here.
  const [previewLookup, setPreviewLookup] = useState({ id: null, done: false });
  const lookupDone = Boolean(selectedTrack?.id) && previewLookup.id === selectedTrack.id && previewLookup.done;
  const ownPreviewUrl = typeof selectedTrack?.previewUrl === 'string' && /^https?:\/\//i.test(selectedTrack.previewUrl.trim())
    ? selectedTrack.previewUrl.trim()
    : '';
  const playableUrl = isReliablePreviewUrl(ownPreviewUrl) || lookupDone ? ownPreviewUrl : '';
  const hasPreview = Boolean(playableUrl);
  const previewLookupPending = Boolean(selectedTrack?.name) && !hasPreview && !lookupDone;
  const sourceRef = useRef(null);
  if (hasPreview && sourceRef.current?.uri !== playableUrl) {
    sourceRef.current = { uri: playableUrl };
  } else if (!hasPreview) {
    sourceRef.current = null;
  }

  const player = useAudioPlayer(sourceRef.current);
  const status = useAudioPlayerStatus(player);
  const playerPlaying = Boolean(status?.playing || player?.playing);

  const [ytTrackData, setYtTrackData] = useState(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytCurrentMs, setYtCurrentMs] = useState(0);
  const [ytDurationMs, setYtDurationMs] = useState(0);
  const [ytIsPlaying, setYtIsPlaying] = useState(false);
  const [ytState, setYtState] = useState('UNSTARTED');
  const ytPlayerRef = useRef(null);
  const pendingPlayMsRef = useRef(null);
  const showTrimRef = useRef(false);
  showTrimRef.current = showTrim;

  const [hookStartMs, setHookStartMs] = useState(0);
  const hookStartMsRef = useRef(0);
  const hasJumpedToHookRef = useRef(false);

  const isFullSongActive = Boolean(ytTrackData?.videoId);
  const activeHasAudio = Boolean(hasPreview || isFullSongActive);
  const isPlaying = Boolean(ytIsPlaying || playerPlaying);
  const activeIsPlaying = isPlaying;
  const durationMs = Math.round((Number(status?.duration) || 0) * 1000);
  const currentMs = Math.round((Number(status?.currentTime) || 0) * 1000);

  const handleBackFromTrim = useCallback(async () => {
    setShowTrim(false);
    if (hasPreview) {
      try { ytPlayerRef.current?.pause?.(); } catch (_) {}
      if (player) {
        try {
          await player.seekTo(0);
          player.play();
        } catch (_) {}
      }
    } else {
      // If no preview, YouTube is our main source in list mode too, so keep it playing (or start it)
      ytPlayerRef.current?.play?.();
    }
  }, [hasPreview, player]);

  const translateY = useSharedValue(700);
  const fadeAnim = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const isClosingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const unlockClose = useCallback(() => {
    isClosingRef.current = false;
  }, []);

  const finishClose = useCallback(() => {
    closeRef.current?.();
    isClosingRef.current = false;
  }, []);

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    try {
      player?.pause?.();
      ytPlayerRef.current?.pause?.();
    } catch (_) {}
    translateY.set(withSpring(700, { duration: 300, dampingRatio: 0.8 }, (finished) => {
      if (finished) scheduleOnRN(finishClose);
      else scheduleOnRN(unlockClose);
    }));
    fadeAnim.set(withTiming(0, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [fadeAnim, finishClose, player, translateY, unlockClose]);

  useEffect(() => {
    if (!open) return;
    isClosingRef.current = false;
    translateY.set(700);
    fadeAnim.set(0);
    translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
    fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [fadeAnim, open, translateY]);

  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showTrimRef.current) {
        handleBackFromTrim();
        return true;
      }
      closeWithAnimation();
      return true;
    });
    return () => sub.remove();
  }, [closeWithAnimation, open, handleBackFromTrim]);

  const panGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      cancelAnimation(translateY);
      dragStartY.set(translateY.get());
      scheduleOnRN(unlockClose);
    })
    .onUpdate((event) => {
      const next = dragStartY.get() + event.translationY;
      if (next > 0) translateY.set(next);
      else translateY.set(rubberband(next, 600));
    })
    .onEnd((event) => {
      const projected = translateY.get() + project(event.velocityY);
      if (projected > 70 || event.velocityY > 500) {
        scheduleOnRN(closeWithAnimation);
      } else {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: event.velocityY }));
        fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    })
    .onFinalize((_, success) => {
      if (!success) {
        translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
        fadeAnim.set(withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
      }
    }), [closeWithAnimation, dragStartY, fadeAnim, translateY, unlockClose]);

  const fadeStyle = useAnimatedStyle(() => {
    const dragged = translateY.get();
    const dragFade = dragged > 0 ? Math.max(0.2, 1 - dragged / 420) : 1;
    return { opacity: fadeAnim.get() * dragFade };
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  const debounceRef = useRef(null);
  const idleRef = useRef(null);
  const latestQueryRef = useRef('');
  const requestIdRef = useRef(0);
  const pagingRef = useRef(null);
  const browseRequestRef = useRef(0);
  const lastAutoPlayIdRef = useRef(null);

  const excludeSet = useMemo(
    () => new Set((excludeIds || []).filter(Boolean)),
    [excludeIds],
  );

  useEffect(() => {
    if (!selectedTrack?.name) {
      setYtTrackData(null);
      setYtLoading(false);
      setYtCurrentMs(0);
      setYtDurationMs(0);
      setYtIsPlaying(false);
      setHookStartMs(0);
      hookStartMsRef.current = 0;
      hasJumpedToHookRef.current = false;
      return;
    }

    let active = true;
    pendingPlayMsRef.current = null;
    setYtCurrentMs(0);
    setYtDurationMs(Number(selectedTrack?.durationMs) || 0);
    setHookStartMs(0);
    hookStartMsRef.current = 0;
    hasJumpedToHookRef.current = false;

    return () => {
      active = false;
    };
  }, [selectedTrack?.artists, selectedTrack?.id, selectedTrack?.name]);

  useEffect(() => {
    if (!selectedTrack?.name) return undefined;
    let active = true;
    const trackId = selectedTrack.id;
    const hasDirectPreview = isReliablePreviewUrl(selectedTrack.previewUrl);
    if (!hasDirectPreview) {
      resolvePlayablePreview({ ...selectedTrack, previewUrl: '' })
        .then((hit) => {
          if (!active || !hit?.previewUrl) return;
          setSelectedTrack((current) => {
            if (!current || current.id !== selectedTrack.id) return current;
            if (isReliablePreviewUrl(current.previewUrl)) return current;
            if (current.previewUrl === hit.previewUrl) return current;
            return {
              ...current,
              previewUrl: hit.previewUrl,
              ...(current.durationMs || !hit.durationMs ? {} : { durationMs: hit.durationMs }),
            };
          });
          if (!showTrimRef.current) {
            try { ytPlayerRef.current?.pause?.(); } catch (_) {}
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!active) return;
          setYtLoading(false);
          setPreviewLookup({ id: trackId, done: true });
        });
    }

    if (hasDirectPreview) {
      setYtLoading(false);
      return () => { active = false; };
    }
    setYtLoading(true);
    return () => { active = false; };
  }, [selectedTrack?.artists, selectedTrack?.id, selectedTrack?.name, selectedTrack?.previewUrl]);

  const activeDurationMs = hasPreview
    ? (durationMs > 0 && durationMs <= 35000 ? durationMs : 30000)
    : (Number(selectedTrack?.durationMs) > 0
      ? Number(selectedTrack.durationMs)
      : (durationMs > 0 ? durationMs : 30000));
  const activeCurrentMs = showTrim && isFullSongActive ? ytCurrentMs : (hasPreview ? currentMs : ytCurrentMs);

  const pauseAudio = useCallback(() => {
    try { player?.pause?.(); } catch (_) {}
    try { ytPlayerRef.current?.pause?.(); } catch (_) {}
  }, [player]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    idleRef.current?.cancel?.();
  }, []);

  useEffect(() => {
    if (!player) return undefined;
    try {
      player.timeUpdateEventInterval = 0.08;
      player.loop = false;
    } catch (_) {}
    return () => {
      try { player.pause(); } catch (_) {}
    };
  }, [player]);

  // Auto-play when user taps a track.
  useEffect(() => {
    if (!selectedTrack?.id || !player || !hasPreview || !status?.isLoaded) return;
    if (lastAutoPlayIdRef.current === `${selectedTrack.id}:${autoPlayToken}`) return;
    lastAutoPlayIdRef.current = `${selectedTrack.id}:${autoPlayToken}`;
    
    // Do not play Spotify if we are in Trim UI and using YouTube
    if (showTrim && isFullSongActive) return;

    let cancelled = false;
    (async () => {
      try {
        await ensureAudioPlaybackMode();
        if (cancelled) return;
        await player.seekTo(0);
        if (cancelled) return;
        player.play();
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [autoPlayToken, hasPreview, player, selectedTrack?.id, showTrim, isFullSongActive, status?.isLoaded]);

  const loadBrowse = useCallback(async () => {
    const cached = getCachedBrowseMusicTracks();
    if (cached?.recommended?.length || cached?.trending?.length) {
      setRecommended(cached.recommended || []);
      setTrending(cached.trending || []);
      setBrowseLoading(false);
      setBrowseError('');
    } else {
      setBrowseLoading(true);
    }

    const requestId = ++browseRequestRef.current;
    try {
      const accessToken = await getValidAccessToken().catch(() => null);
      let personalized = [];
      if (accessToken) {
        personalized = await fetchSpotifyTopTracks(accessToken, 20);
      }
      const result = await browseMusicTracks({ limit: 20 });
      if (requestId !== browseRequestRef.current) return;
      
      const topList = personalized.length ? personalized : (Array.isArray(result?.recommended) ? result.recommended : []);
      setRecommended(topList.filter((track) => track?.id && track?.name));
      setTrending(Array.isArray(result?.trending) ? result.trending : []);
      setTrendingHasMore(true);
      setBrowseError('');

      if (topList.length > 0) {
        scheduleIdleTask(() => {
          topList.slice(0, 4).forEach((track) => {
            if (!isReliablePreviewUrl(track?.previewUrl)) resolvePlayablePreview(track, { priority: 'background' }).catch(() => {});
          });
        });
      }
    } catch (err) {
      if (requestId !== browseRequestRef.current) return;
      const stillEmpty = !(
        getCachedBrowseMusicTracks()?.recommended?.length
        || getCachedBrowseMusicTracks()?.trending?.length
      );
      if (stillEmpty) {
        setRecommended([]);
        setTrending([]);
        const raw = String(err?.message || 'โหลดเพลงแนะนำไม่สำเร็จ');
        setBrowseError(
          raw
            .replace(/\s*\([^)]*functions[^)]*\)\s*/i, '')
            .replace(/\s*\[\d+\]\s*$/, '')
            .trim() || 'โหลดเพลงแนะนำไม่สำเร็จ',
        );
      }
    } finally {
      if (requestId === browseRequestRef.current) setBrowseLoading(false);
    }
  }, []);

  const loadMoreTrending = useCallback(async () => {
    if (trendingLoadingMore || !trendingHasMore) return;
    setTrendingLoadingMore(true);
    try {
      const offset = trending.length;
      const result = await searchSpotifyTracksPage({ q: "trending hit", limit: 20, offset });
      if (result?.tracks?.length) {
        setTrending((prev) => {
          const newTracks = result.tracks.filter(t => !prev.some(p => p.id === t.id));
          return [...prev, ...newTracks];
        });
      }
      if (!result?.hasMore) setTrendingHasMore(false);
    } catch (err) {
      // Ignore errors for loading more
    } finally {
      setTrendingLoadingMore(false);
    }
  }, [trending.length, trendingHasMore, trendingLoadingMore]);

  useEffect(() => {
    if (!open) return undefined;
    const task = scheduleIdleTask(() => { loadBrowse(); });
    return () => task?.cancel?.();
  }, [loadBrowse, open]);

  const runSearch = useCallback(async (rawQuery) => {
    const q = String(rawQuery || '').trim();
    if (q !== latestQueryRef.current) return;
    if (q.length < MIN_QUERY_LENGTH) {
      setTracks([]);
      setLoading(false);
      setHasMore(false);
      setNextOffset(0);
      setSearchSource(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setSearchError('');
    setPageError('');
    try {
      const result = await searchSpotifyTracksPage({ q, limit: 20, offset: 0 });
      if (requestId !== requestIdRef.current) return;
      const foundTracks = Array.isArray(result?.tracks) ? result.tracks : [];
      setTracks(foundTracks);
      setHasMore(Boolean(result?.hasMore));
      setNextOffset(Number(result?.nextOffset) || 0);
      setSearchSource(result?.source || null);

      if (foundTracks.length > 0) {
        scheduleIdleTask(() => {
          foundTracks.slice(0, 4).forEach((track) => {
            if (!isReliablePreviewUrl(track?.previewUrl)) resolvePlayablePreview(track, { priority: 'background' }).catch(() => {});
          });
        });
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setTracks([]);
      setHasMore(false);
      setSearchSource(null);
      const raw = String(err?.message || 'ค้นหาเพลงไม่สำเร็จ');
      setSearchError(
        raw
          .replace(/\s*\([^)]*functions[^)]*\)\s*/i, '')
          .replace(/\s*\[\d+\]\s*$/, '')
          .trim() || 'ค้นหาเพลงไม่สำเร็จ',
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const handleChangeQuery = useCallback((text) => {
    setQuery(text);
    latestQueryRef.current = String(text || '').trim();
    requestIdRef.current += 1;
    pagingRef.current = null;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    idleRef.current?.cancel?.();
    setTracks([]);
    setHasMore(false);
    setNextOffset(0);
    setSearchSource(null);
    setPageError('');
    setLoadingMore(false);
    setSearchError('');
    if (!String(text || '').trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      idleRef.current = scheduleIdleTask(() => { runSearch(text); });
    }, DEBOUNCE_MS);
  }, [runSearch]);

  const loadMore = useCallback(async (forceRetry = false) => {
    const q = query.trim();
    if (!q || !hasMore || loading || pagingRef.current !== null || (pageError && !forceRetry)) return;
    const requestId = requestIdRef.current;
    pagingRef.current = requestId;
    setLoadingMore(true);
    try {
      const result = await searchSpotifyTracksPage({ q, limit: 20, offset: nextOffset });
      if (requestId !== requestIdRef.current) return;
      setTracks((current) => {
        const seen = new Set(current.map((track) => track.id));
        const more = (Array.isArray(result?.tracks) ? result.tracks : [])
          .filter((track) => track?.id && !seen.has(track.id));
        return [...current, ...more];
      });
      setHasMore(Boolean(result?.hasMore));
      setNextOffset(Number(result?.nextOffset) || nextOffset + 20);
      setPageError('');
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setPageError(String(err?.message || 'โหลดเพลงเพิ่มเติมไม่สำเร็จ'));
      }
    } finally {
      if (pagingRef.current === requestId) pagingRef.current = null;
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [hasMore, loading, nextOffset, pageError, query, searchSource]);

  const openTrimForTrack = useCallback((track) => {
    if (!track) return;
    Keyboard.dismiss();
    try { player?.pause?.(); } catch (_) {}
    const { previewStartMs, previewEndMs, youtubeVideoId, ...song } = track;
    handlePick?.(song);
    closeWithAnimation();
  }, [closeWithAnimation, handlePick, player]);

  const handleNext = useCallback(() => {
    if (!selectedTrack) return;
    openTrimForTrack(selectedTrack);
  }, [openTrimForTrack, selectedTrack]);

  const playPreviewAt = useCallback(async (ms) => {
    if (!hasPreview || !player) return false;
    try { ytPlayerRef.current?.pause?.(); } catch (_) {}
    try {
      await ensureAudioPlaybackMode();
      await player.seekTo(Math.max(0, ms) / 1000);
      player.play();
      return true;
    } catch (_) {
      return false;
    }
  }, [hasPreview, player]);

  const openFullSong = useCallback(() => {
    pendingPlayMsRef.current = null;
    try { player?.pause?.(); } catch (_) {}
    const url = spotifyListenUrl(selectedTrack);
    if (!url) return false;
    Linking.openURL(url).catch(() => {});
    return true;
  }, [player, selectedTrack]);

  const togglePlay = useCallback(async () => {
    if (playerPlaying || ytIsPlaying) {
      pendingPlayMsRef.current = null;
      try { player?.pause?.(); } catch (_) {}
      try { ytPlayerRef.current?.pause?.(); } catch (_) {}
      return;
    }

    if (!hasPreview || !player) return;
    // At the end of the clip, play again from the start instead of doing nothing.
    const atEnd = durationMs > 0 && currentMs >= durationMs - 300;
    await playPreviewAt(atEnd ? 0 : currentMs);
  }, [currentMs, durationMs, hasPreview, playPreviewAt, player, playerPlaying, ytIsPlaying]);

  const seekAndPlay = useCallback(async (ms) => {
    const at = Math.max(0, Number(ms) || 0);
    if (at < 30000 && await playPreviewAt(at)) {
      pendingPlayMsRef.current = null;
      return;
    }
    openFullSong();
  }, [openFullSong, playPreviewAt]);

  const seekPreview = useCallback((ms) => {
    const at = Math.max(0, Number(ms) || 0);
    if (at < 30000 && hasPreview && player) {
      try { player.seekTo(at / 1000); } catch (_) {}
      return;
    }
    ytPlayerRef.current?.seekTo?.(at / 1000);
  }, [hasPreview, player]);

  const handleTapTrack = useCallback((track) => {
    if (!track?.id || excludeSet.has(track.id)) return;
    if (selectedTrack?.id === track.id) {
      openTrimForTrack(track);
      return;
    }
    setShowTrim(false);
    try {
      player?.pause?.();
      ytPlayerRef.current?.pause?.();
    } catch (_) {}
    setSelectedTrack(track);
    setAutoPlayToken((value) => value + 1);
  }, [excludeSet, openTrimForTrack, player, selectedTrack?.id]);

  const handleConfirmTrim = useCallback((track) => {
    try {
      player?.pause?.();
      ytPlayerRef.current?.pause?.();
    } catch (_) {}
    const finalTrack = {
      ...track,
      youtubeVideoId: ytTrackData?.videoId || track?.youtubeVideoId || selectedTrack?.youtubeVideoId,
    };
    handlePick?.(finalTrack);
    closeWithAnimation();
  }, [closeWithAnimation, handlePick, player, selectedTrack?.youtubeVideoId, ytTrackData?.videoId]);

  const isSearching = query.trim().length >= MIN_QUERY_LENGTH;
  const error = isSearching ? searchError : browseError;
  const browseSections = useMemo(() => {
    const sections = [];
    if (recommended.length) sections.push({ key: 'recommended', title: 'แนะนำสำหรับคุณ', data: recommended });
    if (trending.length) sections.push({ key: 'trending', title: 'กำลังมาแรง', data: trending });
    return sections;
  }, [recommended, trending]);

  const renderTrack = useCallback(({ item }) => (
    <TrackRow
      alreadyAdded={excludeSet.has(item.id)}
      colors={colors}
      isPlaying={isPlaying}
      item={item}
      onPress={handleTapTrack}
      selected={selectedTrack?.id === item.id}
    />
  ), [colors, excludeSet, handleTapTrack, isPlaying, selectedTrack?.id]);

  if (!open) return null;

  const listPadBottom = Math.max(insets.bottom, 16) + (selectedTrack && !showTrim ? 88 : 8);

  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      onRequestClose={showTrim ? handleBackFromTrim : closeWithAnimation}
      statusBarTranslucent
      transparent
      visible
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,24,40,0.42)' }, fadeStyle]}>
            <Pressable accessibilityLabel="ปิดแผง" onPress={closeWithAnimation} style={StyleSheet.absoluteFill} />
          </Animated.View>

          <NativeAnimatedCard
            style={[
              styles.jsSheet,
              {
                backgroundColor: glass ? 'transparent' : (colors.canvas || colors.bg || colors.background || '#F7F7F8'),
                paddingBottom: Math.max(insets.bottom, 10),
              },
              sheetStyle,
            ]}
          >
            <GlassBackground style={styles.sheetGlass} tintColor={glassTint} />
            <GestureDetector gesture={panGesture}>
              <View collapsable={false} style={styles.sheetHeader}>
                <View style={styles.grabberHit}>
                  <View style={[styles.grabber, { backgroundColor: colors.inkSoft || '#94A3B8' }]} />
                </View>
              </View>
            </GestureDetector>

            <View style={styles.sheetBody}>
                <>
                  <View style={styles.header}>
                    <View style={styles.headerCopy}>
                      <Text style={[styles.title, { color: colors.ink || '#25272B' }]}>{title}</Text>
                      <Text style={[styles.subtitle, { color: colors.inkSoft || '#6B7078' }]}>{subtitle}</Text>
                    </View>
                    <GlassIconButton
                      accessibilityLabel="ปิด"
                      fallbackBackgroundColor="transparent"
                      hitSlop={10}
                      icon="xmark"
                      iconColor={colors.ink || '#25272B'}
                      iconSize={18}
                      onPress={closeWithAnimation}
                      size={40}
                    />
                  </View>

                  <View style={[styles.searchRow, { backgroundColor: colors.surface || '#FFFFFF', borderColor: colors.line || '#E2E8F0' }]}>
                    <FeatureIcon color={colors.inkSoft || '#6B7078'} name="magnifyingglass" size={18} />
                    <TextInput
                      autoCorrect={false}
                      autoFocus={false}
                      onChangeText={handleChangeQuery}
                      placeholder="ชื่อเพลงหรือศิลปิน"
                      placeholderTextColor={colors.inkSoft || '#8B98AC'}
                      returnKeyType="search"
                      style={[styles.searchInput, { color: colors.ink || '#25272B' }]}
                      value={query}
                    />
                    {(loading || (!isSearching && browseLoading)) ? (
                      <ActivityIndicator color={colors.primary || '#3986E8'} size="small" />
                    ) : null}
                  </View>

                  {error ? (
                    <Pressable accessibilityRole="button" onPress={() => { if (isSearching) runSearch(query); else loadBrowse(); }}>
                      <Text style={[styles.errorText, { color: colors.danger || '#E85D5D' }]}>
                        {error} · แตะเพื่อลองอีกครั้ง
                      </Text>
                    </Pressable>
                  ) : null}

                  {isSearching ? (
                    <FlatList
                      contentContainerStyle={[styles.listContent, { paddingBottom: listPadBottom }]}
                      data={tracks}
                      initialNumToRender={8}
                      keyExtractor={(item) => item.id}
                      keyboardDismissMode="on-drag"
                      keyboardShouldPersistTaps="handled"
                      ListEmptyComponent={(
                        <Text style={[styles.emptyText, { color: colors.inkSoft || '#6B7078' }]}>
                          {loading ? 'กำลังค้นหา...' : (error ? 'ลองค้นหาอีกครั้ง' : 'ไม่พบเพลงที่ตรงกัน')}
                        </Text>
                      )}
                      ListFooterComponent={loadingMore ? (
                        <ActivityIndicator color={colors.primary || '#3986E8'} style={styles.listFooter} />
                      ) : pageError ? (
                        <Pressable accessibilityRole="button" onPress={() => loadMore(true)} style={styles.listFooter}>
                          <Text style={[styles.errorText, { color: colors.danger || '#E85D5D' }]}>
                            โหลดเพลงเพิ่มเติมไม่สำเร็จ · แตะเพื่อลองอีกครั้ง
                          </Text>
                        </Pressable>
                      ) : null}
                      maxToRenderPerBatch={8}
                      onEndReached={() => loadMore()}
                      onEndReachedThreshold={0.35}
                      removeClippedSubviews={Platform.OS === 'android'}
                      renderItem={renderTrack}
                      windowSize={5}
                    />
                  ) : (
                    <SectionList
                      contentContainerStyle={[styles.listContent, { paddingBottom: listPadBottom }]}
                      initialNumToRender={8}
                      keyExtractor={(item) => item.id}
                      keyboardDismissMode="on-drag"
                      keyboardShouldPersistTaps="handled"
                      ListEmptyComponent={(
                        <Text style={[styles.emptyText, { color: colors.inkSoft || '#6B7078' }]}>
                          {browseLoading ? 'กำลังโหลดเพลงแนะนำ...' : 'ยังไม่มีเพลงแนะนำ ลองค้นหาด้วยชื่อเพลง'}
                        </Text>
                      )}
                      maxToRenderPerBatch={8}
                      renderItem={renderTrack}
                      renderSectionHeader={({ section }) => (
                        <Text style={[styles.sectionTitle, { color: colors.ink || '#25272B' }]}>{section.title}</Text>
                      )}
                      ListFooterComponent={trendingHasMore ? (
                        <Pressable 
                          style={({ pressed }) => [styles.showMoreButton, pressed && { opacity: 0.7 }]}
                          onPress={loadMoreTrending}
                        >
                          <Text style={[styles.showMoreText, { color: colors.accentText || colors.primary || '#6E56FF' }]}>
                            {trendingLoadingMore ? 'กำลังโหลด...' : 'แสดงเพิ่มเติม'}
                          </Text>
                        </Pressable>
                      ) : null}
                      sections={browseSections}
                      stickySectionHeadersEnabled={false}
                      windowSize={5}
                    />
                  )}

                  {selectedTrack ? (
                    <MiniPlayerBar
                      hasPreview={activeHasAudio && !status?.error}
                      insets={insets}
                      isPlaying={activeIsPlaying}
                      loading={previewLookupPending || (hasPreview && !status?.isLoaded && !status?.error)}
                      missingMessage={status?.error
                        ? 'โหลดเสียงตัวอย่างไม่สำเร็จ'
                        : (lookupDone && !hasPreview ? 'ไม่มีเสียงตัวอย่างของเพลงนี้' : '')}
                      onNext={handleNext}
                      onTogglePlay={togglePlay}
                      track={selectedTrack}
                    />
                  ) : null}
                </>
            </View>

          </NativeAnimatedCard>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetGlass: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  jsSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '92%',
    overflow: 'hidden',
    width: '100%',
  },
  sheetHeader: {
    alignItems: 'center',
    paddingBottom: 2,
    paddingTop: 6,
  },
  grabberHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
    paddingVertical: 6,
    width: '100%',
  },
  grabber: {
    borderRadius: 2.5,
    height: 5,
    width: 40,
  },
  sheetBody: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerCopy: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  title: {
    fontSize: type.title || type.h3 || 20,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: type.micro || type.caption || 12,
    fontWeight: '600',
    marginTop: 2,
  },
  searchRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: type.body || 16,
    paddingVertical: 0,
  },
  errorText: {
    fontSize: type.micro || type.caption || 12,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  listContent: {
    flexGrow: 1,
    gap: 8,
  },
  listFooter: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyText: {
    fontSize: type.caption || 13,
    fontWeight: '600',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: type.caption || 13,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: spacing.sm,
  },
  trackRow: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  albumArt: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  albumArtFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCopy: {
    flex: 1,
    minWidth: 0,
  },
  trackTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  trackName: {
    fontSize: type.body || 16,
    fontWeight: '700',
  },
  trackArtists: {
    fontSize: type.micro || type.caption || 12,
    fontWeight: '600',
    marginTop: 2,
  },
  addHint: {
    fontSize: type.micro || type.caption || 12,
    fontWeight: '800',
  },
  miniBar: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    left: spacing.md,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 12,
    position: 'absolute',
    right: spacing.md,
  },
  miniArt: {
    borderRadius: 8,
    height: 42,
    width: 42,
  },
  miniCopy: {
    flex: 1,
    minWidth: 0,
  },
  miniTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  miniArtists: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  miniIconBtn: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  nextBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  trimContainer: {
    flex: 1,
    gap: 8,
  },
  trimTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 2,
  },
  backPill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
  },
  backPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  trimScreenTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  donePill: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  donePillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  trimSongCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    padding: 8,
  },
  trimArt: {
    borderRadius: 8,
    height: 44,
    width: 44,
  },
  trimSongCopy: {
    flex: 1,
    minWidth: 0,
  },
  trimTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  trimArtists: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  durationBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  durationBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  trimWaveCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    padding: 10,
  },
  rangeInfoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeInfoLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  rangeInfoDuration: {
    fontSize: 11,
    fontWeight: '800',
  },
  waveRoot: {
    width: '100%',
  },
  waveTrack: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 60,
    justifyContent: 'center',
    overflow: 'visible',
    paddingHorizontal: 10,
    position: 'relative',
  },
  waveBars: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    height: 48,
    justifyContent: 'space-between',
  },
  waveBar: {
    borderRadius: 2,
    flex: 1,
    maxWidth: 4,
  },
  waveSelection: {
    borderLeftWidth: 2,
    borderRadius: 8,
    borderRightWidth: 2,
    bottom: 4,
    position: 'absolute',
    top: 4,
  },
  playhead: {
    borderRadius: 1,
    bottom: 6,
    position: 'absolute',
    top: 6,
    width: 2,
  },
  waveHandle: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
    width: 24,
    zIndex: 4,
  },
  waveHandleGrip: {
    borderRadius: 3,
    height: 26,
    width: 6,
  },
  trimTransport: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  trimPlayRound: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  trimProgressTouch: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  trimProgress: {
    borderRadius: 999,
    height: 4,
    overflow: 'hidden',
    width: '100%',
  },
  trimProgressFill: {
    bottom: 0,
    position: 'absolute',
    top: 0,
  },
  trimProgressPlayhead: {
    backgroundColor: '#25272B',
    borderRadius: 3,
    height: 10,
    marginLeft: -3,
    position: 'absolute',
    top: -3,
    width: 6,
  },
  transportTime: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 68,
    textAlign: 'right',
  },
  trimHint: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  hitCard: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hitCardTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  lyricsCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minHeight: 70,
    overflow: 'hidden',
    paddingTop: 6,
  },
  lyricsHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 2,
    paddingHorizontal: 10,
  },
  lyricsTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  lyricsSource: {
    fontSize: 10,
    fontWeight: '600',
  },
  lyricsScroll: {
    flex: 1,
  },
  lyricsScrollContent: {
    paddingBottom: 8,
    paddingHorizontal: 10,
  },
  lyricsBody: {
    fontSize: 13,
    lineHeight: 20,
  },
  syncedBadge: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  syncedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  lyricsNoticeBar: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
    marginHorizontal: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lyricsNoticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  syncedLineRow: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  syncedLineRowActive: {
    borderRadius: 8,
  },
  syncedLineTimeBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    minWidth: 44,
  },
  syncedLineTime: {
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  syncedLineText: {
    flex: 1,
    lineHeight: 19,
  },
  lyricsMessage: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  lyricsMessageText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  noPreviewNotice: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    padding: 12,
  },
  noPreviewText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  showMoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  showMoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
