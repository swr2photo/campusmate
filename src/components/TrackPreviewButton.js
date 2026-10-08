import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import FeatureIcon from './FeatureIcon';
import YouTubeAudioPlayer from './YouTubeAudioPlayer';
import { resolveYouTubeTrack } from '../services/youtubeAudioService';
import { ensureAudioPlaybackMode } from '../services/chatMediaService';

// A chat or list can show many tracks. Keep just the preview the listener chose active.
let stopCurrentPreview = null;

function ActivePreview({ backgroundColor, color, onStop, previewEndMs, previewStartMs, previewUrl, size, trackName }) {
  const sourceRef = useRef({ uri: previewUrl });
  const player = useAudioPlayer(sourceRef.current);
  const status = useAudioPlayerStatus(player);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    try { player.pause(); } catch (_) {}
    if (stopCurrentPreview === stop) stopCurrentPreview = null;
    onStop();
  }, [onStop, player]);

  useEffect(() => {
    if (!player || !status?.isLoaded || startedRef.current) return;
    startedRef.current = true;
    cancelledRef.current = false;
    if (stopCurrentPreview && stopCurrentPreview !== stop) stopCurrentPreview();
    stopCurrentPreview = stop;
    try { player.timeUpdateEventInterval = 0.1; } catch (_) {}

    const rawStart = Number(previewStartMs);
    const rawEnd = Number(previewEndMs);
    const hasSelection = Number.isFinite(rawStart) && Number.isFinite(rawEnd) && rawEnd > rawStart;
    const durationMs = Math.max(0, Number(status.duration) * 1000 || 0);
    const startMs = hasSelection && (!durationMs || rawStart < durationMs)
      ? Math.max(0, rawStart)
      : 0;

    (async () => {
      try {
        await ensureAudioPlaybackMode();
        if (cancelledRef.current) return;
        await player.seekTo(startMs / 1000);
        if (cancelledRef.current) return;
        player.play();
      } catch (error) {
        console.warn('[TrackPreviewButton] playback error:', error);
        if (!cancelledRef.current) stop();
      }
    })();
  }, [player, previewEndMs, previewStartMs, status?.duration, status?.isLoaded, stop]);

  useEffect(() => {
    if (status?.didJustFinish || status?.error) {
      stop();
      return;
    }
    if (!status?.playing) return;
    const rawStart = Number(previewStartMs);
    const rawEnd = Number(previewEndMs);
    const hasSelection = Number.isFinite(rawStart) && Number.isFinite(rawEnd) && rawEnd > rawStart;
    const duration = Math.max(0, Number(status.duration) || 0);
    const endSeconds = hasSelection ? Math.min(rawEnd / 1000, duration || Infinity) : null;
    if (endSeconds != null && status.currentTime >= endSeconds - 0.04) stop();
  }, [previewEndMs, previewStartMs, status?.currentTime, status?.didJustFinish, status?.duration, status?.error, status?.playing, stop]);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (stopCurrentPreview === stop) stopCurrentPreview = null;
    try { player.pause(); } catch (_) {}
  }, [player, stop]);

  return (
    <Pressable
      accessibilityLabel={`หยุดฟังท่อนเพลง ${trackName || ''}`.trim()}
      accessibilityRole="button"
      hitSlop={6}
      onPress={(event) => {
        event?.stopPropagation?.();
        stop();
      }}
      style={[styles.button, { backgroundColor, height: size, width: size }]}
    >
      {status?.isLoaded ? (
        <FeatureIcon color={color} name="pause.fill" size={16} />
      ) : (
        <ActivityIndicator color={color} size="small" />
      )}
    </Pressable>
  );
}

function ActiveYouTubePreview({ backgroundColor, color, onStop, previewEndMs, previewStartMs, size, trackName, videoId }) {
  const ytPlayerRef = useRef(null);
  const startSec = Math.max(0, (Number(previewStartMs) || 0) / 1000);
  const endSec = Number(previewEndMs) > 0 ? Number(previewEndMs) / 1000 : null;

  const stop = useCallback(() => {
    try { ytPlayerRef.current?.pause(); } catch (_) {}
    if (stopCurrentPreview === stop) stopCurrentPreview = null;
    onStop();
  }, [onStop]);

  useEffect(() => {
    if (stopCurrentPreview && stopCurrentPreview !== stop) stopCurrentPreview();
    stopCurrentPreview = stop;
    return () => {
      if (stopCurrentPreview === stop) stopCurrentPreview = null;
      try { ytPlayerRef.current?.pause(); } catch (_) {}
    };
  }, [stop]);

  return (
    <>
      <Pressable
        accessibilityLabel={`หยุดฟังท่อนเพลง ${trackName || ''}`.trim()}
        accessibilityRole="button"
        hitSlop={6}
        onPress={(event) => {
          event?.stopPropagation?.();
          stop();
        }}
        style={[styles.button, { backgroundColor, height: size, width: size }]}
      >
        <FeatureIcon color={color} name="pause.fill" size={16} />
      </Pressable>
      <YouTubeAudioPlayer
        ref={ytPlayerRef}
        initialSeconds={startSec}
        onError={() => stop()}
        onReady={() => {
          ytPlayerRef.current?.seekTo(startSec);
          ytPlayerRef.current?.play();
        }}
        onTimeUpdate={({ currentTime }) => {
          if (endSec && currentTime >= endSec - 0.05) {
            stop();
          }
        }}
        videoId={videoId}
      />
    </>
  );
}

export default function TrackPreviewButton({
  backgroundColor = 'rgba(59, 90, 254, 0.12)',
  color = '#3986E8',
  previewEndMs,
  previewStartMs,
  previewUrl,
  size = 36,
  track,
  trackArtists = '',
  trackName = '',
  youtubeVideoId,
}) {
  const effectiveName = trackName || track?.name || '';
  const effectiveArtists = trackArtists || track?.artists || '';
  const effectivePreviewUrl = previewUrl ?? track?.previewUrl;
  const effectiveStartMs = previewStartMs ?? track?.previewStartMs;
  const effectiveEndMs = previewEndMs ?? track?.previewEndMs;
  const effectiveYtId = youtubeVideoId || track?.youtubeVideoId;

  const [active, setActive] = useState(false);
  const [resolvedYtId, setResolvedYtId] = useState(effectiveYtId || null);
  const [resolving, setResolving] = useState(false);
  const onStop = useCallback(() => {
    setActive(false);
    setResolving(false);
  }, []);

  const hasPreview = typeof effectivePreviewUrl === 'string' && effectivePreviewUrl.trim().length > 0;
  const targetEnd = Number(effectiveEndMs) || 0;
  const isPastPreview = targetEnd > 30000 || (Number(effectiveStartMs) || 0) >= 30000;
  const canPlayPreview = hasPreview && !isPastPreview && !effectiveYtId;

  const available = Boolean(hasPreview || effectiveYtId || resolvedYtId || effectiveName);

  useEffect(() => {
    if (effectiveYtId) {
      setResolvedYtId(effectiveYtId);
    }
  }, [effectiveYtId]);

  useEffect(() => {
    setActive(false);
    setResolving(false);
  }, [effectiveEndMs, effectivePreviewUrl, effectiveStartMs, effectiveYtId]);

  const handlePressPlay = useCallback(async (event) => {
    event?.stopPropagation?.();
    stopCurrentPreview?.();

    if (canPlayPreview) {
      setActive(true);
      return;
    }

    const currentYtId = resolvedYtId || effectiveYtId;
    if (currentYtId) {
      setActive(true);
      return;
    }

    if (!effectiveName) return;

    setResolving(true);
    setActive(true);
    try {
      const data = await resolveYouTubeTrack({ name: effectiveName, artists: effectiveArtists });
      if (data?.videoId) {
        setResolvedYtId(data.videoId);
      } else if (hasPreview) {
        setResolvedYtId(null);
      } else {
        onStop();
      }
    } catch (_) {
      if (hasPreview) {
        setResolvedYtId(null);
      } else {
        onStop();
      }
    } finally {
      setResolving(false);
    }
  }, [canPlayPreview, effectiveArtists, effectiveName, effectiveYtId, hasPreview, onStop, resolvedYtId]);

  if (!available) return null;

  if (active) {
    if (resolving) {
      return (
        <Pressable
          accessibilityLabel={`กำลังค้นหาเพลง ${effectiveName}`.trim()}
          accessibilityRole="button"
          hitSlop={6}
          onPress={(event) => {
            event?.stopPropagation?.();
            onStop();
          }}
          style={[styles.button, { backgroundColor, height: size, width: size }]}
        >
          <ActivityIndicator color={color} size="small" />
        </Pressable>
      );
    }

    const currentYtId = resolvedYtId || effectiveYtId;
    if (currentYtId) {
      return (
        <ActiveYouTubePreview
          key={`${currentYtId}:${effectiveStartMs}:${effectiveEndMs}`}
          backgroundColor={backgroundColor}
          color={color}
          onStop={onStop}
          previewEndMs={effectiveEndMs}
          previewStartMs={effectiveStartMs}
          size={size}
          trackName={effectiveName}
          videoId={currentYtId}
        />
      );
    }

    if (hasPreview) {
      return (
        <ActivePreview
          key={`${effectivePreviewUrl}:${effectiveStartMs}:${effectiveEndMs}`}
          backgroundColor={backgroundColor}
          color={color}
          onStop={onStop}
          previewEndMs={effectiveEndMs}
          previewStartMs={effectiveStartMs}
          previewUrl={effectivePreviewUrl}
          size={size}
          trackName={effectiveName}
        />
      );
    }
  }

  return (
    <Pressable
      accessibilityLabel={`ฟังท่อนเพลง ${effectiveName}`.trim()}
      accessibilityRole="button"
      hitSlop={6}
      onPress={handlePressPlay}
      style={[styles.button, { backgroundColor, height: size, width: size }]}
    >
      <FeatureIcon color={color} name="play.fill" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
  },
});
