import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Keyboard, Modal, Platform, Pressable, ScrollView, SectionList, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import { browseMusicTracks, getCachedBrowseMusicTracks, searchSpotifyTracksPage } from '../services/spotifyService';
import { getValidAccessToken, fetchSpotifyTopTracks } from '../services/spotifyAuthService';
import { getTrackLyrics } from '../services/musicLyricsService';
import { resolveYouTubeTrack } from '../services/youtubeAudioService';
import YouTubeAudioPlayer from './YouTubeAudioPlayer';
import { ensureAudioPlaybackMode, formatAudioDuration } from '../services/chatMediaService';
import { scheduleIdleTask } from '../utils/scheduleIdleTask';
import { getAlbumCardColor } from '../utils/albumArtColor';
import { project, rubberband } from '../utils/motion';
import { spacing, type, useTheme } from '../theme';

export const MAX_FAVORITE_TRACKS = 10;
const DEBOUNCE_MS = 550;
const MIN_QUERY_LENGTH = 1;
const MIN_SEGMENT_MS = 1000;
const DEFAULT_SEGMENT_MS = 30000;
const WAVE_BARS = 56;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMs(ms) {
  return formatAudioDuration(Math.max(0, Math.floor((Number(ms) || 0) / 1000)));
}

function hashSeed(input) {
  const text = String(input || 'track');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

function buildWaveHeights(trackId, count = WAVE_BARS) {
  const seed = hashSeed(trackId);
  const heights = [];
  for (let i = 0; i < count; i += 1) {
    const n = Math.sin((i + 1) * 0.55 + seed * 0.001) * 0.35
      + Math.sin((i + 3) * 1.15 + seed * 0.002) * 0.25
      + Math.cos((i + 7) * 0.33 + seed * 0.0015) * 0.2
      + 0.42;
    heights.push(clamp(n, 0.18, 1));
  }
  return heights;
}

function moveSegmentHandle(startMs, endMs, handle, value, durationMs, isFullSong) {
  'worklet';
  if (isFullSong) {
    const windowMs = Math.min(30000, durationMs);
    const position = Math.round(Math.max(0, Math.min(durationMs, value)));
    if (handle === 'start') {
      const nextStart = Math.min(position, durationMs - windowMs);
      return { startMs: Math.max(0, nextStart), endMs: Math.max(0, nextStart) + windowMs };
    }
    const nextEnd = Math.max(position, windowMs);
    return { startMs: Math.max(0, Math.min(durationMs, nextEnd) - windowMs), endMs: Math.min(durationMs, nextEnd) };
  }
  const minimum = Math.min(MIN_SEGMENT_MS, durationMs);
  const position = Math.round(Math.max(0, Math.min(durationMs, value)));
  if (handle === 'start') {
    const nextStart = Math.min(position, endMs - minimum);
    return { startMs: Math.max(0, nextStart), endMs };
  }
  const nextEnd = Math.max(position, startMs + minimum);
  return { startMs, endMs: Math.min(durationMs, nextEnd) };
}

function scrubPosition(x, width, durationMs, startMs, endMs) {
  'worklet';
  if (!width || !durationMs) return startMs;
  const position = (Math.max(0, Math.min(width, x)) / width) * durationMs;
  return Math.max(startMs, Math.min(endMs, Math.round(position)));
}

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
          <FeatureIcon color={colors.primary || '#3986E8'} name="music.note" size={18} />
        </View>
      )}
      <View style={styles.trackCopy}>
        <View style={styles.trackTitleRow}>
          {selected && isPlaying ? (
            <FeatureIcon color={colors.primary || '#3986E8'} name="speaker.wave.3.fill" size={12} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.trackName,
              { color: selected ? (colors.primary || '#3986E8') : (colors.ink || '#25272B'), flex: 1 },
            ]}
          >
            {item.name}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.trackArtists, { color: colors.inkSoft || '#6B7078' }]}>
          {item.artists || 'Unknown'}
        </Text>
      </View>
      <Text style={[styles.addHint, { color: alreadyAdded ? colors.inkSoft : (colors.primary || '#3986E8') }]}>
        {alreadyAdded ? 'เพิ่มแล้ว' : (selected ? 'แตะเพื่อเลือก' : 'เลือก')}
      </Text>
    </Pressable>
  );
}

function MiniPlayerBar({ colors, hasPreview, insets, isPlaying, onNext, onTogglePlay, track }) {
  const fallback = colors.ink || '#1A2333';
  const [cardColor, setCardColor] = useState(fallback);
  const volumePulse = useSharedValue(0);

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

  useEffect(() => {
    if (isPlaying) {
      volumePulse.set(withRepeat(
        withSequence(
          withTiming(1, { duration: 210, easing: Easing.out(Easing.quad) }),
          withTiming(0.22, { duration: 170 }),
          withTiming(0.78, { duration: 250 }),
          withTiming(0.32, { duration: 190 }),
          withTiming(0.92, { duration: 150 }),
          withTiming(0.18, { duration: 230 }),
        ),
        -1,
        false,
      ));
      return undefined;
    }
    cancelAnimation(volumePulse);
    volumePulse.set(withTiming(0, { duration: 280 }));
    return undefined;
  }, [isPlaying, track?.id, volumePulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.04 + volumePulse.get() * 0.2,
  }));

  if (!track) return null;
  return (
    <MotiView
      animate={{ backgroundColor: cardColor }}
      style={[
        styles.miniBar,
        { bottom: Math.max(insets.bottom, 10) },
      ]}
      transition={{
        backgroundColor: { type: 'timing', duration: 560 },
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.miniVolumeWash, pulseStyle]}
      />
      <Pressable accessibilityLabel="ต่อไป เลือกท่อน" onPress={onNext} style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 10 }}>
        {track.albumArt ? (
          <Image contentFit="cover" source={{ uri: track.albumArt }} style={styles.miniArt} />
        ) : (
          <View style={[styles.miniArt, styles.albumArtFallback, { backgroundColor: '#334155' }]}>
            <FeatureIcon color="#FFFFFF" name="music.note" size={14} />
          </View>
        )}
        <View style={styles.miniCopy}>
          <Text numberOfLines={1} style={styles.miniTitle}>{track.name}</Text>
          <Text numberOfLines={1} style={styles.miniArtists}>{track.artists || 'Unknown'}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={hasPreview ? (isPlaying ? 'หยุดชั่วคราว' : 'เล่น') : 'ไม่มีเสียงตัวอย่าง'}
        disabled={!hasPreview}
        hitSlop={8}
        onPress={onTogglePlay}
        style={({ pressed }) => [styles.miniIconBtn, !hasPreview && { opacity: 0.6 }, pressed && { opacity: 0.75 }]}
      >
        <FeatureIcon color="#FFFFFF" name={hasPreview ? (isPlaying ? 'pause.fill' : 'play.fill') : 'speaker.slash.fill'} size={22} />
      </Pressable>
      <Pressable
        accessibilityLabel="ต่อไป เลือกท่อน"
        onPress={onNext}
        style={({ pressed }) => [
          styles.nextBtn,
          pressed && { opacity: 0.88 },
        ]}
      >
        <FeatureIcon color={colors.ink || '#1A2333'} name="chevron.right" size={22} />
      </Pressable>
    </MotiView>
  );
}

function WaveHandle({
  colors,
  disabled,
  durationMs,
  durationSV,
  endMs,
  endMsSV,
  onCommit,
  side,
  startMs,
  startMsSV,
  widthSV,
  isFullSong,
}) {
  const originStart = useSharedValue(0);
  const originEnd = useSharedValue(0);
  const pan = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onStart(() => {
      originStart.set(startMsSV.get());
      originEnd.set(endMsSV.get());
    })
    .onUpdate((event) => {
      const trackWidth = widthSV.get();
      const trackDuration = durationSV.get();
      if (!trackWidth || !trackDuration) return;
      const origin = side === 'start' ? originStart.get() : originEnd.get();
      const value = origin + (event.translationX / trackWidth) * trackDuration;
      const next = moveSegmentHandle(originStart.get(), originEnd.get(), side, value, trackDuration, isFullSong);
      startMsSV.set(next.startMs);
      endMsSV.set(next.endMs);
    })
    .onEnd(() => {
      scheduleOnRN(onCommit, startMsSV.get(), endMsSV.get());
    }), [disabled, durationSV, endMsSV, onCommit, originEnd, originStart, side, startMsSV, widthSV]);

  const handleStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    const trackDuration = durationSV.get() || 1;
    const ms = side === 'start' ? startMsSV.get() : endMsSV.get();
    return { transform: [{ translateX: 10 + (ms / trackDuration) * trackWidth - 12 }] };
  });

  const onAccessibilityAdjust = useCallback((event) => {
    const action = event?.nativeEvent?.actionName;
    if (action !== 'increment' && action !== 'decrement') return;
    const current = side === 'start' ? startMs : endMs;
    const delta = action === 'increment' ? 1000 : -1000;
    const next = moveSegmentHandle(startMs, endMs, side, current + delta, durationMs, isFullSong);
    onCommit(next.startMs, next.endMs);
  }, [durationMs, endMs, onCommit, side, startMs]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityActions={[
          { name: 'increment', label: 'เพิ่มเวลา 1 วินาที' },
          { name: 'decrement', label: 'ลดเวลา 1 วินาที' },
        ]}
        accessibilityHint="ปัดขึ้นหรือลงเพื่อปรับทีละ 1 วินาที"
        accessibilityLabel={side === 'start' ? 'จุดเริ่มท่อน' : 'จุดจบท่อน'}
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: 0,
          max: Math.round(durationMs / 1000),
          now: Math.round((side === 'start' ? startMs : endMs) / 1000),
          text: formatMs(side === 'start' ? startMs : endMs),
        }}
        onAccessibilityAction={onAccessibilityAdjust}
        style={[styles.waveHandle, handleStyle]}
      >
        <View style={[styles.waveHandleGrip, { backgroundColor: colors.primary || '#3986E8' }]} />
      </Animated.View>
    </GestureDetector>
  );
}

function TrimModule({
  colors,
  currentMs,
  durationMs,
  hasPreview,
  initialStartMs = 0,
  insets,
  isFullSong,
  isPlaying,
  onBack,
  onConfirm,
  onPause,
  onSeek,
  onSeekPlay,
  onTogglePlay,
  player,
  track,
  ytLoading,
}) {
  const { height: viewportHeight } = useWindowDimensions();
  const safeDuration = durationMs > 0 ? durationMs : (Number(track?.durationMs) > 0 ? Number(track.durationMs) : 30000);
  const numBars = useMemo(() => {
    return isFullSong && safeDuration > 30000 ? Math.max(40, Math.round(40 * (safeDuration / 30000))) : 40;
  }, [isFullSong, safeDuration]);
  const waveHeights = useMemo(() => buildWaveHeights(track?.id, numBars), [track?.id, numBars]);
  const defaultInitialStart = (track?.previewStartMs != null && track.previewStartMs >= 0)
    ? track.previewStartMs
    : (initialStartMs > 0 && initialStartMs < safeDuration ? initialStartMs : 0);
  const [startMs, setStartMs] = useState(defaultInitialStart);
  const [endMs, setEndMs] = useState(Math.min(safeDuration, defaultInitialStart + DEFAULT_SEGMENT_MS));
  const [width, setWidth] = useState(0);
  const [segmentLoop, setSegmentLoop] = useState(false);
  const [lyricsResult, setLyricsResult] = useState({ status: 'loading' });
  const [lyricsRetry, setLyricsRetry] = useState(0);
  const rangeReadyRef = useRef(false);

  const startMsSV = useSharedValue(defaultInitialStart);
  const endMsSV = useSharedValue(Math.min(safeDuration, defaultInitialStart + DEFAULT_SEGMENT_MS));
  const durationSV = useSharedValue(safeDuration);
  const widthSV = useSharedValue(0);
  const currentMsSV = useSharedValue(defaultInitialStart);
  const progressWidthSV = useSharedValue(0);
  const scrubbingSV = useSharedValue(false);
  const scrubbedMsRef = useRef(null);
  const originScrollSV = useSharedValue(0);

  useEffect(() => {
    if (!scrubbingSV.get()) currentMsSV.set(currentMs);
  }, [currentMs, currentMsSV, scrubbingSV]);

  useEffect(() => {
    durationSV.set(safeDuration);
    if (!rangeReadyRef.current && safeDuration > 0) {
      const initStart = (track?.previewStartMs != null && track.previewStartMs >= 0)
        ? track.previewStartMs
        : (initialStartMs > 0 && initialStartMs < safeDuration ? initialStartMs : 0);
      const nextEnd = Math.min(safeDuration, initStart + DEFAULT_SEGMENT_MS);
      setStartMs(initStart);
      setEndMs(nextEnd);
      startMsSV.set(initStart);
      endMsSV.set(nextEnd);
      rangeReadyRef.current = true;
    }
  }, [durationSV, endMsSV, initialStartMs, safeDuration, startMsSV, track?.previewStartMs]);

  useEffect(() => {
    widthSV.set(width);
  }, [width, widthSV]);

  useEffect(() => {
    rangeReadyRef.current = false;
    const initStart = (track?.previewStartMs != null && track.previewStartMs >= 0)
      ? track.previewStartMs
      : (initialStartMs > 0 && initialStartMs < safeDuration ? initialStartMs : 0);
    const nextEnd = Math.min(safeDuration, initStart + DEFAULT_SEGMENT_MS);
    setStartMs(initStart);
    setEndMs(nextEnd);
    startMsSV.set(initStart);
    endMsSV.set(nextEnd);
    setSegmentLoop(false);
  }, [endMsSV, initialStartMs, safeDuration, startMsSV, track?.id, track?.previewStartMs]);

  // Boundary check: pause automatically as soon as playback reaches or exceeds the trim window
  useEffect(() => {
    if (!isPlaying) return;
    if (currentMs >= endMs - 40 || currentMs < startMs - 500) {
      try {
        onPause?.();
        player?.pause?.();
        setSegmentLoop(false);
        onSeek?.(startMs);
        currentMsSV.set(startMs);
      } catch (_) {}
    }
  }, [currentMs, endMs, isPlaying, onPause, onSeek, player, startMs]);

  useEffect(() => {
    let active = true;
    setLyricsResult({ status: 'loading' });
    getTrackLyrics({ track })
      .then((result) => {
        if (!active) return;
        setLyricsResult(result);
        // If user hasn't set custom trim and hook is detected, auto-position the window to the hook
        if (result?.suggestedLineStartMs && !track?.previewStartMs && startMs === 0) {
          const hookStart = clamp(result.suggestedLineStartMs, 0, Math.max(0, safeDuration - MIN_SEGMENT_MS));
          const hookEnd = clamp(hookStart + DEFAULT_SEGMENT_MS, hookStart + MIN_SEGMENT_MS, safeDuration);
          setStartMs(hookStart);
          setEndMs(hookEnd);
          startMsSV.set(hookStart);
          endMsSV.set(hookEnd);
        }
      })
      .catch(() => {
        if (active) setLyricsResult({ status: 'error' });
      });
    return () => { active = false; };
  }, [lyricsRetry, safeDuration, startMs, startMsSV, endMsSV, track?.id, track?.name, track?.artists, track?.previewStartMs]);

  const commitRange = useCallback((nextStart, nextEnd) => {
    try {
      onPause?.();
      player?.pause?.();
    } catch (_) {}
    setSegmentLoop(false);
    const start = clamp(Math.round(nextStart), 0, Math.max(0, safeDuration - MIN_SEGMENT_MS));
    const end = clamp(Math.round(nextEnd), start + MIN_SEGMENT_MS, safeDuration);
    setStartMs(start);
    setEndMs(end);
    startMsSV.set(start);
    endMsSV.set(end);
    scrubbedMsRef.current = null;
    currentMsSV.set(start);
    onSeek?.(start);
  }, [currentMsSV, endMsSV, onPause, onSeek, player, safeDuration, startMsSV]);

  const commitScrub = useCallback((ms) => {
    const position = clamp(ms, startMs, endMs);
    scrubbedMsRef.current = position;
    currentMsSV.set(position);
    onSeek?.(position);
  }, [currentMsSV, endMs, onSeek, startMs]);

  const windowPan = useMemo(() => Gesture.Pan()
    .enabled(isFullSong)
    .onStart(() => {
      originScrollSV.set(startMsSV.get());
    })
    .onUpdate((event) => {
      const trackDuration = durationSV.get() || 1;
      // Dragging left = scroll forward (increase startMs), right = backward
      const deltaMs = - (event.translationX / 200) * 30000;
      let nextStart = originScrollSV.get() + deltaMs;
      nextStart = Math.max(0, Math.min(nextStart, Math.max(0, trackDuration - 30000)));
      startMsSV.set(nextStart);
      endMsSV.set(Math.min(trackDuration, nextStart + 30000));
    })
    .onEnd(() => {
      scheduleOnRN(commitRange, startMsSV.get(), endMsSV.get());
    }), [isFullSong, commitRange, originScrollSV, startMsSV, endMsSV, durationSV]);

  const progressScrub = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onStart((event) => {
      scrubbingSV.set(true);
      currentMsSV.set(scrubPosition(event.x, progressWidthSV.get(), durationSV.get(), startMsSV.get(), endMsSV.get()));
    })
    .onUpdate((event) => {
      currentMsSV.set(scrubPosition(event.x, progressWidthSV.get(), durationSV.get(), startMsSV.get(), endMsSV.get()));
    })
    .onEnd(() => {
      scheduleOnRN(commitScrub, currentMsSV.get());
      scrubbingSV.set(false);
    }), [commitScrub, currentMsSV, durationSV, endMsSV, progressWidthSV, scrubbingSV, startMsSV]);

  const waveScrub = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onStart((event) => {
      scrubbingSV.set(true);
      currentMsSV.set(scrubPosition(event.x, widthSV.get(), durationSV.get(), startMsSV.get(), endMsSV.get()));
    })
    .onUpdate((event) => {
      currentMsSV.set(scrubPosition(event.x, widthSV.get(), durationSV.get(), startMsSV.get(), endMsSV.get()));
    })
    .onEnd(() => {
      scheduleOnRN(commitScrub, currentMsSV.get());
      scrubbingSV.set(false);
    }), [commitScrub, currentMsSV, durationSV, endMsSV, scrubbingSV, startMsSV, widthSV]);

  const handlePlaySegment = useCallback(async () => {
    setSegmentLoop(true);
    const resumeAt = scrubbedMsRef.current;
    await onSeekPlay?.(resumeAt != null && resumeAt >= startMs && resumeAt < endMs - 250 ? resumeAt : startMs);
  }, [endMs, onSeekPlay, startMs]);

  const handleToggle = useCallback(async () => {
    if (isPlaying) {
      setSegmentLoop(false);
      onTogglePlay?.();
      return;
    }
    await handlePlaySegment();
  }, [handlePlaySegment, isPlaying, onTogglePlay]);

  const handleConfirm = useCallback(() => {
    onConfirm?.(hasPreview ? {
      ...track,
      previewStartMs: Math.round(startMs),
      previewEndMs: Math.round(endMs),
      durationMs: safeDuration,
    } : track);
  }, [endMs, hasPreview, onConfirm, safeDuration, startMs, track]);

  const selectionStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    if (isFullSong) {
      return {
        left: 10,
        width: trackWidth,
      };
    }
    const trackDuration = durationSV.get() || 1;
    const left = (startMsSV.get() / trackDuration) * trackWidth;
    const right = (endMsSV.get() / trackDuration) * trackWidth;
    return { left: 10 + left, width: Math.max(4, right - left) };
  });

  const playheadStyle = useAnimatedStyle(() => {
    const trackWidth = widthSV.get();
    if (isFullSong) {
      const relativeMs = Math.max(0, currentMsSV.get() - startMsSV.get());
      const ratio = Math.min(1, Math.max(0, relativeMs / 30000));
      return { transform: [{ translateX: 10 + ratio * trackWidth - 1 }] };
    }
    const trackDuration = durationSV.get() || 1;
    const ratio = Math.min(1, Math.max(0, currentMsSV.get() / trackDuration));
    return { transform: [{ translateX: 10 + ratio * trackWidth - 1 }] };
  });

  const waveBarsStyle = useAnimatedStyle(() => {
    if (!isFullSong) return { width: '100%', transform: [{ translateX: 0 }] };
    const trackWidth = widthSV.get();
    const trackDuration = durationSV.get() || 1;
    const waveBarsWidth = trackWidth * (trackDuration / 30000);
    const tx = - (startMsSV.get() / trackDuration) * waveBarsWidth;
    return {
      width: waveBarsWidth,
      transform: [{ translateX: tx }],
    };
  });

  const progressPlayheadStyle = useAnimatedStyle(() => ({
    left: `${Math.min(100, Math.max(0, (currentMsSV.get() / (durationSV.get() || 1)) * 100))}%`,
  }));

  const previewSeconds = Math.max(1, Math.round(safeDuration / 1000));
  const hasSyncedLines = Boolean(lyricsResult?.lines?.length);
  const lyricText = hasSyncedLines
    ? lyricsResult.lines.map((line) => line.text).join('\n')
    : lyricsResult?.plainLyrics || '';
  const suggestedLines = Array.isArray(lyricsResult?.suggestedLines)
    ? lyricsResult.suggestedLines
    : [];

  const theme = useTheme();
  const colorScheme = useColorScheme();
  const isDark = theme?.dark ?? (colorScheme === 'dark');

  const lyricsCardBg = isDark ? '#141416' : (colors.surface || '#FFFFFF');
  const lyricsCardBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : (colors.line || '#E2E8F0');
  const lyricsOverlayBg = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.85)';
  const lyricsAlbumArtOpacity = isDark ? 0.65 : 0.2;
  const lyricsTitleColor = isDark ? 'rgba(255, 255, 255, 0.95)' : (colors.ink || '#25272B');
  const lyricsSourceColor = isDark ? 'rgba(255, 255, 255, 0.5)' : (colors.inkSoft || '#6B7078');
  const lyricsBadgeBg = isDark ? 'rgba(255, 255, 255, 0.18)' : (colors.primarySoft || '#EEF2F7');
  const lyricsBadgeColor = isDark ? '#FFFFFF' : (colors.primary || '#3986E8');
  const lyricsPlainBadgeBg = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)';
  const lyricsPlainBadgeColor = isDark ? 'rgba(255, 255, 255, 0.7)' : (colors.inkSoft || '#6B7078');
  const lyricsActiveLineColor = isDark ? '#FFFFFF' : (colors.primary || '#2563EB');
  const lyricsInactiveLineColor = isDark ? '#FFFFFF' : (colors.ink || '#25272B');
  const lyricsBodyColor = isDark ? 'rgba(255, 255, 255, 0.92)' : (colors.ink || '#25272B');

  const lyricsScrollViewRef = useRef(null);
  const lineLayoutsRef = useRef([]);
  const userScrolledRef = useRef(false);
  const userScrollTimeoutRef = useRef(null);
  const [lyricsNotice, setLyricsNotice] = useState('');
  const lyricsNoticeTimeoutRef = useRef(null);

  const activeLineIndex = useMemo(() => {
    if (!hasSyncedLines) return -1;
    let idx = -1;
    for (let i = 0; i < lyricsResult.lines.length; i += 1) {
      if (lyricsResult.lines[i].timeMs <= currentMs + 250) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [currentMs, hasSyncedLines, lyricsResult?.lines]);

  useEffect(() => {
    if (activeLineIndex < 0 || userScrolledRef.current) return;
    const layout = lineLayoutsRef.current[activeLineIndex];
    if (layout && lyricsScrollViewRef.current) {
      lyricsScrollViewRef.current.scrollTo({
        y: Math.max(0, layout.y - 36),
        animated: true,
      });
    }
  }, [activeLineIndex]);

  const handleLinePress = useCallback((line) => {
    if (!hasPreview || !Number.isFinite(line?.timeMs)) return;
    userScrolledRef.current = false;
    if (line.timeMs <= safeDuration) {
      const segLen = Math.max(MIN_SEGMENT_MS, endMs - startMs);
      const nextStart = clamp(line.timeMs, 0, Math.max(0, safeDuration - MIN_SEGMENT_MS));
      const nextEnd = clamp(nextStart + segLen, nextStart + MIN_SEGMENT_MS, safeDuration);
      commitRange(nextStart, nextEnd);
      onSeekPlay?.(line.timeMs);
    } else {
      setLyricsNotice(`ท่อนนี้อยู่ที่ ${formatMs(line.timeMs)} (ตัวอย่างเพลงมีถึง ${formatMs(safeDuration)})`);
      if (lyricsNoticeTimeoutRef.current) clearTimeout(lyricsNoticeTimeoutRef.current);
      lyricsNoticeTimeoutRef.current = setTimeout(() => { setLyricsNotice(''); }, 3500);
    }
  }, [commitRange, endMs, hasPreview, onSeekPlay, safeDuration, startMs]);

  return (
    <View style={styles.trimContainer}>
      <View style={styles.trimTopRow}>
        <Pressable
          accessibilityLabel="กลับไปเลือกเพลง"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [
            styles.backPill,
            { backgroundColor: colors.surface || '#FFFFFF', borderColor: colors.line || '#E2E8F0' },
            pressed && { opacity: 0.8 },
          ]}
        >
          <FeatureIcon color={colors.ink || '#25272B'} name="chevron.left" size={13} />
          <Text style={[styles.backPillText, { color: colors.ink || '#25272B' }]}>เพลงทั้งหมด</Text>
        </Pressable>
        <Text style={[styles.trimScreenTitle, { color: colors.ink || '#25272B' }]}>เลือกท่อนเพลง</Text>
        <Pressable
          accessibilityLabel="ยืนยันท่อน"
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleConfirm}
          style={({ pressed }) => [
            styles.donePill,
            { backgroundColor: colors.primary || '#3986E8' },
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text style={styles.donePillText}>ใช้ท่อนนี้</Text>
        </Pressable>
      </View>

      <View style={[styles.trimSongCard, { backgroundColor: colors.surface || '#FFFFFF', borderColor: colors.line || '#E2E8F0' }]}>
        {track.albumArt ? (
          <Image contentFit="cover" source={{ uri: track.albumArt }} style={styles.trimArt} />
        ) : (
          <View style={[styles.trimArt, styles.albumArtFallback, { backgroundColor: colors.primarySoft || '#EEF2F7' }]}>
            <FeatureIcon color={colors.primary || '#3986E8'} name="music.note" size={20} />
          </View>
        )}
        <View style={styles.trimSongCopy}>
          <Text numberOfLines={1} style={[styles.trimTitle, { color: colors.ink || '#25272B' }]}>{track.name}</Text>
          <Text numberOfLines={1} style={[styles.trimArtists, { color: colors.inkSoft || '#6B7078' }]}>
            {track.artists || 'Unknown'}
          </Text>
        </View>
        <View style={[styles.durationBadge, { backgroundColor: isFullSong ? '#ECFDF5' : (colors.primarySoft || '#EEF2F7') }]}>
          <Text style={[styles.durationBadgeText, { color: isFullSong ? '#059669' : (colors.primary || '#3986E8') }]}>
            {isFullSong ? `เพลงเต็ม ${formatMs(safeDuration)}` : (hasPreview ? `${previewSeconds}วิ` : (ytLoading ? 'กำลังโหลด...' : 'ไม่มีเสียง'))}
          </Text>
        </View>
      </View>

      {hasPreview ? (
        <View style={[styles.trimWaveCard, { backgroundColor: colors.surface || '#FFFFFF', borderColor: colors.line || '#E2E8F0', paddingVertical: 20, paddingHorizontal: 0, overflow: 'hidden' }]}>
          {/* Top Controls: (30) | Timeline | Play/Pause */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 30, paddingHorizontal: 16 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.ink || '#25272B', justifyContent: 'center', alignItems: 'center', marginRight: 16 }}>
              <Text style={{ color: colors.ink || '#25272B', fontSize: 10, fontWeight: '700' }}>30</Text>
            </View>
            
            <GestureDetector gesture={progressScrub}>
              <View 
                style={{ flex: 1, height: 20, justifyContent: 'center', marginRight: 16 }}
                onLayout={(e) => {
                  progressWidthSV.set(e.nativeEvent.layout.width);
                }}
              >
                <View style={{ height: 2, backgroundColor: colors.line || '#E2E8F0', width: '100%', borderRadius: 1 }} />
              {/* Chorus dots (fake markers for popular parts at 30% and 60%) */}
              <View style={{ position: 'absolute', left: '30%', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.danger || '#E85D5D', top: 8 }} />
              <View style={{ position: 'absolute', left: '60%', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.danger || '#E85D5D', top: 8 }} />
              
              {/* Macro progress segment */}
              <Animated.View style={[
                { position: 'absolute', height: 2, backgroundColor: colors.primary || '#3986E8', borderRadius: 1, top: 9 },
                useAnimatedStyle(() => {
                  const trackDuration = durationSV.get() || 1;
                  const left = (startMsSV.get() / trackDuration) * 100;
                  const width = (30000 / trackDuration) * 100;
                  return { left: `${left}%`, width: `${width}%` };
                })
              ]} />
              
              {/* Macro playhead */}
              <Animated.View style={[
                { position: 'absolute', height: 6, width: 6, borderRadius: 3, backgroundColor: colors.primary || '#3986E8', top: 7, marginLeft: -3 },
                useAnimatedStyle(() => {
                  const trackDuration = durationSV.get() || 1;
                  const left = (currentMsSV.get() / trackDuration) * 100;
                  return { left: `${left}%` };
                })
              ]} />
            </View>
            </GestureDetector>

            <Pressable onPress={handleToggle} style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink || '#25272B', justifyContent: 'center', alignItems: 'center' }}>
                <FeatureIcon color={colors.surface || '#FFFFFF'} name={isPlaying ? "pause.fill" : "play.fill"} size={16} />
              </View>
            </Pressable>
          </View>

          {/* Bottom Waveform */}
          <View style={{ height: 60, justifyContent: 'center' }}>
            <GestureDetector gesture={isFullSong ? windowPan : waveScrub}>
              <View style={{ height: 60, width: '100%' }}>
                <Animated.View style={[
                  { flexDirection: 'row', alignItems: 'center', height: '100%', paddingLeft: (global.screenWidth || 390) / 2 - 100 },
                  useAnimatedStyle(() => {
                    if (!isFullSong) return { transform: [{ translateX: 0 }] };
                    const tx = - (startMsSV.get() / 30000) * 200;
                    return { transform: [{ translateX: tx }] };
                  })
                ]}>
                  {waveHeights.map((height, index) => {
                    const numBars = waveHeights.length;
                    const barStart = (index / numBars) * safeDuration;
                    const inRange = isFullSong ? true : (barStart >= startMs && barStart <= endMs);
                    return (
                      <View
                        key={`bar-${index}`}
                        style={{
                          width: 3,
                          height: 10 + height * 40,
                          backgroundColor: inRange ? (colors.primary || '#3986E8') : 'rgba(150,150,150,0.3)',
                          marginRight: 2,
                          borderRadius: 1.5,
                        }}
                      />
                    );
                  })}
                </Animated.View>
              </View>
            </GestureDetector>

            {/* Fixed Center Frame */}
            <View pointerEvents="none" style={{
              position: 'absolute',
              left: (global.screenWidth || 390) / 2 - 100,
              width: 200,
              height: 70,
              borderWidth: 3,
              borderColor: 'transparent',
              borderRadius: 8,
              overflow: 'hidden'
            }}>
              {/* Gradient border effect */}
              <View style={{
                position: 'absolute',
                top: -2, left: -2, right: -2, bottom: -2,
                backgroundColor: '#E1306C',
                borderWidth: 3,
                borderColor: '#F56040',
                borderRadius: 10,
                opacity: 0.8
              }} />
              <View style={{ flex: 1, backgroundColor: 'transparent', borderWidth: 2, borderColor: '#C13584', borderRadius: 6 }} />
            </View>

            {/* Center Playhead */}
            <Animated.View pointerEvents="none" style={[
              { position: 'absolute', top: 5, bottom: -5, width: 2, backgroundColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
              useAnimatedStyle(() => {
                if (isFullSong) {
                  const relativeMs = Math.max(0, currentMsSV.get() - startMsSV.get());
                  const ratio = Math.min(1, Math.max(0, relativeMs / 30000));
                  const left = ((global.screenWidth || 390) / 2 - 100) + (ratio * 200);
                  return { left };
                }
                const trackWidth = widthSV.get() || 1;
                const trackDuration = durationSV.get() || 1;
                const ratio = Math.min(1, Math.max(0, currentMsSV.get() / trackDuration));
                return { left: 10 + ratio * trackWidth };
              })
            ]} />
          </View>
        </View>
      ) : (
        <View style={[styles.noPreviewNotice, { backgroundColor: colors.surface || '#FFFFFF', borderColor: colors.line || '#E2E8F0' }]}>
          {ytLoading ? (
            <>
              <ActivityIndicator color={colors.primary || '#3986E8'} size="small" />
              <Text style={[styles.noPreviewText, { color: colors.ink || '#25272B' }]}>
                กำลังเตรียมระบบเสียงเต็มเพลง...
              </Text>
            </>
          ) : (
            <>
              <FeatureIcon color={colors.inkSoft || '#6B7078'} name="speaker.slash.fill" size={20} />
              <Text style={[styles.noPreviewText, { color: colors.inkSoft || '#6B7078' }]}>
                เพลงนี้ไม่มีเสียงตัวอย่าง จึงเลือกช่วงเสียงไม่ได้ แต่ยังเพิ่มเพลงได้
              </Text>
            </>
          )}
        </View>
      )}

      {suggestedLines.length > 0 && lyricsResult?.status === 'found' ? (
        <Pressable
          accessibilityLabel="กระโดดไปท่อนฮิต"
          accessibilityRole="button"
          onPress={() => {
            const hookMs = lyricsResult.suggestedLineStartMs;
            if (Number.isFinite(hookMs) && hookMs >= 0) {
              const segLen = Math.max(MIN_SEGMENT_MS, endMs - startMs);
              const nextStart = clamp(hookMs, 0, Math.max(0, safeDuration - MIN_SEGMENT_MS));
              const nextEnd = clamp(nextStart + segLen, nextStart + MIN_SEGMENT_MS, safeDuration);
              commitRange(nextStart, nextEnd);
              onSeekPlay?.(nextStart);
            }
          }}
          style={({ pressed }) => [
            styles.hitCard,
            { backgroundColor: colors.primarySoft || '#EEF2F7' },
            pressed && { opacity: 0.8 },
          ]}
        >
          <FeatureIcon color={colors.primary || '#3986E8'} name="flame.fill" size={13} />
          <Text numberOfLines={1} style={[styles.hitCardTitle, { color: colors.primary || '#3986E8', flex: 1 }]}>
            ท่อนฮิต: {suggestedLines.join(' / ')} (แตะเพื่อใช้ท่อนนี้)
          </Text>
        </Pressable>
      ) : null}

      {lyricsResult?.status === 'found' && (hasSyncedLines || lyricText) ? (
        <View style={[styles.lyricsCard, { backgroundColor: lyricsCardBg, borderColor: lyricsCardBorder, borderWidth: 1, overflow: 'hidden' }]}>
          {track?.albumArt ? (
            <Image 
              source={{ uri: track.albumArt }} 
              style={[StyleSheet.absoluteFill, { opacity: lyricsAlbumArtOpacity }]} 
              blurRadius={50} 
              contentFit="cover" 
            />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: lyricsOverlayBg }]} />
          
          <View style={styles.lyricsHeading}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.lyricsTitle, { color: lyricsTitleColor }]}>เนื้อเพลง</Text>
              {hasSyncedLines ? (
                <View style={[styles.syncedBadge, { backgroundColor: lyricsBadgeBg }]}>
                  <FeatureIcon color={lyricsBadgeColor} name="waveform" size={10} />
                  <Text style={[styles.syncedBadgeText, { color: lyricsBadgeColor }]}>แตะเพื่อเล่นท่อนนี้</Text>
                </View>
              ) : (
                <View style={[styles.syncedBadge, { backgroundColor: lyricsPlainBadgeBg }]}>
                  <FeatureIcon color={lyricsPlainBadgeColor} name="doc.text" size={10} />
                  <Text style={[styles.syncedBadgeText, { color: lyricsPlainBadgeColor }]}>เนื้อเพลงแบบข้อความ</Text>
                </View>
              )}
            </View>
            <Text style={[styles.lyricsSource, { color: lyricsSourceColor }]}>LRCLIB</Text>
          </View>

          {lyricsNotice ? (
            <View style={[styles.lyricsNoticeBar, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
              <FeatureIcon color="#D97706" name="info.circle.fill" size={12} />
              <Text style={[styles.lyricsNoticeText, { color: '#B45309' }]}>{lyricsNotice}</Text>
            </View>
          ) : null}

          <ScrollView
            ref={lyricsScrollViewRef}
            contentContainerStyle={styles.lyricsScrollContent}
            nestedScrollEnabled
            onScrollBeginDrag={() => {
              userScrolledRef.current = true;
              if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
              userScrollTimeoutRef.current = setTimeout(() => {
                userScrolledRef.current = false;
              }, 4000);
            }}
            showsVerticalScrollIndicator
            style={styles.lyricsScroll}
          >
            {hasSyncedLines ? (
              lyricsResult.lines.map((line, index) => {
                const isActive = index === activeLineIndex;
                const isPast = activeLineIndex >= 0 && index < activeLineIndex;
                const isWithinPreview = line.timeMs <= safeDuration;
                return (
                  <Pressable
                    key={`synced-line-${index}-${line.timeMs}`}
                    onLayout={(e) => {
                      lineLayoutsRef.current[index] = e.nativeEvent.layout;
                    }}
                    onPress={() => handleLinePress(line)}
                    style={({ pressed }) => [
                      styles.syncedLineRow,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.syncedLineText,
                        {
                          color: isActive ? lyricsActiveLineColor : lyricsInactiveLineColor,
                          opacity: isActive ? 1.0 : (isDark ? 0.4 : 0.35),
                          fontWeight: isActive ? '800' : '700',
                          fontSize: isActive ? 24 : 18,
                          lineHeight: isActive ? 32 : 24,
                          transform: [{ scale: isActive ? 1.05 : 1 }],
                          textShadowColor: isActive && isDark ? 'rgba(0,0,0,0.3)' : 'transparent',
                          textShadowOffset: { width: 0, height: 2 },
                          textShadowRadius: 6,
                        },
                      ]}
                    >
                      {line.text}
                    </Text>
                  </Pressable>
                );
              })
            ) : (
              <Text selectable style={[styles.lyricsBody, { color: lyricsBodyColor }]}>{lyricText}</Text>
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Search / browse tracks → tap plays in mini bar → Next opens waveform trim module.
 */
export default function SpotifyTrackSearchSheet({
  colors: colorsProp,
  excludeIds = [],
  isOpen,
  onClose,
  onSelect,
  onSelectTrack,
  subtitle = 'แตะเพื่อฟัง แล้วกดต่อไปเพื่อเลือกท่อน',
  title = 'ค้นหาเพลง',
  visible,
}) {
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const isDark = theme?.dark ?? (colorScheme === 'dark');
  const rawColors = colorsProp || theme?.colors || {};
  
  const colors = {
    canvas: rawColors.canvas || rawColors.background || (isDark ? '#000000' : '#F7F7F8'),
    surface: rawColors.surface || rawColors.card || (isDark ? '#1C1C1E' : '#FFFFFF'),
    ink: rawColors.ink || rawColors.text || (isDark ? '#FFFFFF' : '#25272B'),
    inkSoft: rawColors.inkSoft || (isDark ? '#A1A1AA' : '#6B7078'),
    line: rawColors.line || rawColors.border || (isDark ? '#333336' : '#E2E8F0'),
    primary: rawColors.primary || '#3986E8',
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

  const hasPreview = typeof selectedTrack?.previewUrl === 'string' && selectedTrack.previewUrl.length > 0;
  const sourceRef = useRef(null);
  if (hasPreview && sourceRef.current?.uri !== selectedTrack.previewUrl) {
    sourceRef.current = { uri: selectedTrack.previewUrl };
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
    setYtLoading(true);
    setYtCurrentMs(0);
    setYtDurationMs(Number(selectedTrack?.durationMs) || 0);
    setHookStartMs(0);
    hookStartMsRef.current = 0;
    hasJumpedToHookRef.current = false;

    // Prefetch lyrics to identify hook/chorus timestamp immediately
    getTrackLyrics({ track: selectedTrack })
      .then((lyrics) => {
        if (!active) return;
        const hook = lyrics?.suggestedLineStartMs;
        if (Number.isFinite(hook) && hook > 0) {
          hookStartMsRef.current = hook;
          setHookStartMs(hook);
          // If already playing near start in search list, jump right into the hook!
          if (!hasJumpedToHookRef.current && ytPlayerRef.current) {
            hasJumpedToHookRef.current = true;
            ytPlayerRef.current.seekTo(hook / 1000);
          }
        }
      })
      .catch(() => {});

    resolveYouTubeTrack(selectedTrack)
      .then((data) => {
        if (!active) return;
        setYtTrackData(data);
        if (data?.durationMs) {
          setYtDurationMs(data.durationMs);
        }
        setYtLoading(false);
      })
      .catch(() => {
        if (active) setYtLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedTrack?.artists, selectedTrack?.id, selectedTrack?.name]);

  const activeDurationMs = ytDurationMs > 0
    ? ytDurationMs
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
        player.seekTo(0);
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
      setRecommended(topList);
      setTrending(Array.isArray(result?.trending) ? result.trending : []);
      setTrendingHasMore(true);
      setBrowseError('');

      if (topList.length > 0) {
        scheduleIdleTask(() => {
          topList.slice(0, 2).forEach((track) => {
            if (!track?.previewUrl) resolveYouTubeTrack(track).catch(() => {});
            getTrackLyrics({ track }).catch(() => {});
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
          foundTracks.slice(0, 3).forEach((track) => {
            if (!track?.previewUrl) resolveYouTubeTrack(track).catch(() => {});
            getTrackLyrics({ track }).catch(() => {});
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
    
    // Always pause Spotify when entering Trim mode
    try { player?.pause?.(); } catch (_) {}
    
    setSelectedTrack(track);
    setShowTrim(true);
    
    // If YouTube is ready, play it from hook. Otherwise onReady will handle auto-play.
    if (ytTrackData?.videoId) {
      try {
        const startSec = Math.floor((hookStartMsRef.current || 0) / 1000);
        if (startSec > 0) {
          ytPlayerRef.current?.seekTo?.(startSec);
        }
        ytPlayerRef.current?.play?.();
      } catch (_) {}
    }
    // Do NOT change autoPlayToken here - that would trigger Spotify auto-play effect
  }, [player, ytTrackData?.videoId]);

  const handleNext = useCallback(() => {
    if (!selectedTrack) return;
    openTrimForTrack(selectedTrack);
  }, [openTrimForTrack, selectedTrack]);

  const togglePlay = useCallback(async () => {
    // === TRIM + FULL SONG MODE: control YouTube only ===
    if (showTrim && isFullSongActive) {
      // Always silence Spotify in this mode
      try { player?.pause?.(); } catch (_) {}
      if (ytIsPlaying) {
        ytPlayerRef.current?.pause?.();
      } else {
        ytPlayerRef.current?.play?.();
      }
      return;
    }

    // === LIST MODE (Spotify preview) ===
    if (hasPreview && player) {
      // Always silence YouTube in this mode
      try { ytPlayerRef.current?.pause?.(); } catch (_) {}
      try {
        await ensureAudioPlaybackMode();
        if (playerPlaying) {
          player.pause();
          return;
        }
        if (durationMs > 0 && currentMs >= durationMs - 120) {
          player.seekTo(0);
        }
        player.play();
      } catch (_) {}
      return;
    }

    // === FALLBACK: YouTube only (no Spotify preview) ===
    if (isFullSongActive) {
      if (ytIsPlaying) {
        ytPlayerRef.current?.pause?.();
      } else {
        ytPlayerRef.current?.play?.();
      }
    }
  }, [currentMs, durationMs, hasPreview, isFullSongActive, playerPlaying, player, showTrim, ytIsPlaying]);

  const seekAndPlay = useCallback(async (ms) => {
    if (showTrim && isFullSongActive) {
      try { player?.pause?.(); } catch (_) {}
      ytPlayerRef.current?.seekTo?.(Math.max(0, ms) / 1000);
      ytPlayerRef.current?.play?.();
      return;
    }

    if (hasPreview && player) {
      try {
        await ensureAudioPlaybackMode();
        player.seekTo(Math.max(0, ms) / 1000);
        player.play();
      } catch (_) {}
      return;
    }

    if (isFullSongActive) {
      ytPlayerRef.current?.seekTo?.(Math.max(0, ms) / 1000);
      ytPlayerRef.current?.play?.();
    }
  }, [hasPreview, isFullSongActive, player, showTrim]);

  const seekPreview = useCallback((ms) => {
    if (showTrim && isFullSongActive) {
      ytPlayerRef.current?.seekTo?.(Math.max(0, ms) / 1000);
      return;
    }

    if (hasPreview && player) {
      try { player.seekTo(Math.max(0, ms) / 1000); } catch (_) {}
      return;
    }

    if (isFullSongActive) {
      ytPlayerRef.current?.seekTo?.(Math.max(0, ms) / 1000);
    }
  }, [hasPreview, isFullSongActive, player, showTrim]);

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

  const handleBackFromTrim = useCallback(() => {
    setShowTrim(false);
    if (hasPreview) {
      try { ytPlayerRef.current?.pause?.(); } catch (_) {}
      if (player) {
        try {
          player.seekTo(0);
          player.play();
        } catch (_) {}
      }
    } else {
      // If no preview, YouTube is our main source in list mode too, so keep it playing (or start it)
      ytPlayerRef.current?.play?.();
    }
  }, [hasPreview, player]);

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

          <Animated.View
            style={[
              styles.jsSheet,
              {
                backgroundColor: colors.canvas || colors.bg || colors.background || '#F7F7F8',
                paddingBottom: Math.max(insets.bottom, 10),
              },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={panGesture}>
              <View collapsable={false} style={styles.sheetHeader}>
                <View style={styles.grabberHit}>
                  <View style={[styles.grabber, { backgroundColor: colors.inkSoft || '#94A3B8' }]} />
                </View>
              </View>
            </GestureDetector>

            <View style={styles.sheetBody}>
              {showTrim && selectedTrack ? (
                <TrimModule
                  colors={colors}
                  currentMs={activeCurrentMs}
                  durationMs={activeDurationMs}
                  hasPreview={activeHasAudio}
                  initialStartMs={hookStartMs}
                  insets={insets}
                  isFullSong={isFullSongActive}
                  isPlaying={activeIsPlaying}
                  onBack={handleBackFromTrim}
                  onConfirm={handleConfirmTrim}
                  onPause={pauseAudio}
                  onSeek={seekPreview}
                  onSeekPlay={seekAndPlay}
                  onTogglePlay={togglePlay}
                  player={player}
                  track={selectedTrack}
                  ytLoading={ytLoading}
                />
              ) : (
                <>
                  <View style={styles.header}>
                    <View style={styles.headerCopy}>
                      <Text style={[styles.title, { color: colors.ink || '#25272B' }]}>{title}</Text>
                      <Text style={[styles.subtitle, { color: colors.inkSoft || '#6B7078' }]}>{subtitle}</Text>
                    </View>
                    <Pressable
                      accessibilityLabel="ปิด"
                      hitSlop={10}
                      onPress={closeWithAnimation}
                      style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
                    >
                      <FeatureIcon color={colors.ink || '#25272B'} name="xmark" size={20} />
                    </Pressable>
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
                          <Text style={[styles.showMoreText, { color: colors.primary || '#6E56FF' }]}>
                            {trendingLoadingMore ? 'กำลังโหลด...' : 'แสดงเพิ่มเติม'}
                          </Text>
                        </Pressable>
                      ) : null}
                      sections={browseSections}
                      stickySectionHeadersEnabled={false}
                      windowSize={5}
                    />
                  )}

                  {!showTrim ? (
                    <MiniPlayerBar
                      colors={colors}
                      hasPreview={activeHasAudio}
                      insets={insets}
                      isPlaying={activeIsPlaying}
                      onNext={handleNext}
                      onTogglePlay={togglePlay}
                      track={selectedTrack}
                    />
                  ) : null}
                </>
              )}
            </View>

            <YouTubeAudioPlayer
              ref={ytPlayerRef}
              videoId={ytTrackData?.videoId}
              candidates={ytTrackData?.candidates}
              initialSeconds={Math.floor((hookStartMsRef.current || 0) / 1000)}
              onError={(code) => {
                console.warn('[SpotifyTrackSearchSheet] YouTube audio error:', code);
              }}
              onReady={(data) => {
                if (data?.duration > 0) {
                  setYtDurationMs(Math.round(data.duration * 1000));
                }
                const startSec = Math.floor((hookStartMsRef.current || 0) / 1000);
                // Auto-play YouTube when user is in Trim screen OR if there is no Spotify preview
                if (showTrimRef.current || !hasPreview) {
                  try {
                    // CRITICAL: force-pause Spotify before playing YouTube
                    player?.pause?.();
                  } catch (_) {}
                  // Small delay to ensure Spotify is fully paused
                  setTimeout(() => {
                    if (showTrimRef.current || !hasPreview) {
                      if (startSec > 0) {
                        hasJumpedToHookRef.current = true;
                        ytPlayerRef.current?.seekTo?.(startSec);
                      }
                      ytPlayerRef.current?.play?.();
                    }
                  }, 120);
                }
              }}
              onStateChange={(state, info) => {
                setYtState(state);
                const isNowPlaying = state === 'PLAYING';
                setYtIsPlaying(isNowPlaying);
                if (isNowPlaying && !hasJumpedToHookRef.current && (hookStartMsRef.current || 0) > 0) {
                  const cur = Number(info?.currentTime) || 0;
                  if (cur < 3) {
                    hasJumpedToHookRef.current = true;
                    ytPlayerRef.current?.seekTo?.(hookStartMsRef.current / 1000);
                  }
                }
                if (info?.duration > 0 && Math.abs((ytDurationMs || 0) - info.duration * 1000) > 2000) {
                  setYtDurationMs(Math.round(info.duration * 1000));
                }
              }}
              onTimeUpdate={({ currentTime, duration }) => {
                setYtCurrentMs(Math.round(currentTime * 1000));
                if (duration > 0 && Math.abs((ytDurationMs || 0) - duration * 1000) > 2000) {
                  setYtDurationMs(Math.round(duration * 1000));
                }
              }}
              videoId={ytTrackData?.videoId}
            />
          </Animated.View>
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
  closeBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
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
  miniVolumeWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
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
