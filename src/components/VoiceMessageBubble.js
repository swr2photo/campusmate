import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import FeatureIcon from './FeatureIcon';
import { ensureAudioPlaybackMode, formatAudioDuration } from '../services/chatMediaService';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';

const WAVEFORM_HEIGHTS = [8, 14, 22, 16, 26, 12, 18, 28, 20, 14, 24, 18, 10, 16, 22, 12];
// Throttle UI progress updates so waveform re-renders don't cause audio jitter
const PROGRESS_UPDATE_INTERVAL_MS = 200;

function VoiceMessageView({ colors, displayTime, isPlaying, isUploading, mine, onPress, progress }) {
  const activeColor = mine ? '#FFFFFF' : (colors?.primary || '#3B5AFE');
  const inactiveColor = mine ? 'rgba(255, 255, 255, 0.4)' : (colors?.line || '#E2E8F0');
  const textColor = mine ? '#FFFFFF' : (colors?.ink || '#0F172A');

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={isUploading ? 'กำลังส่ง…' : (isPlaying ? 'หยุดเล่นเสียง' : 'เล่นข้อความเสียง')}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.playBtn,
          { backgroundColor: mine ? 'rgba(255,255,255,0.22)' : (colors?.primarySoft || 'rgba(59,90,254,0.12)') },
          pressed && styles.pressed,
        ]}
      >
        {isUploading ? (
          <ActivityIndicator color={activeColor} size={16} />
        ) : (
          <FeatureIcon
            color={activeColor}
            name={isPlaying ? 'pause.fill' : 'play.fill'}
            size={16}
          />
        )}
      </Pressable>

      <View style={styles.waveColumn}>
        <View style={styles.waveRow}>
          {WAVEFORM_HEIGHTS.map((height, idx) => {
            const barProgress = (idx + 1) / WAVEFORM_HEIGHTS.length;
            const isFilled = progress >= barProgress;
            return (
              <View
                key={idx}
                style={[
                  styles.waveBar,
                  {
                    height,
                    backgroundColor: isFilled ? activeColor : inactiveColor,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.timeRow}>
          <Text style={[styles.timeText, { color: textColor }]}>
            {formatAudioDuration(displayTime)}
          </Text>
          <View style={styles.audioBadge}>
            <FeatureIcon
              color={mine ? 'rgba(255,255,255,0.7)' : (colors?.inkSoft || '#64748B')}
              name="mic"
              size={11}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

// Only the bubble the listener actually started decrypts its file and owns a
// native player; a thread full of voice notes would otherwise do both per row.
function ActiveVoiceMessage({
  audioUrl,
  colors,
  conversationId,
  conversationKey,
  currentUserId,
  duration,
  isUploading,
  mine,
}) {
  const { uri: decryptedAudioUri, loading: decrypting } = useDecryptedMedia(audioUrl, {
    conversationId,
    currentUserId,
    conversationKey,
    mediaType: 'audio',
  });
  const audioUri = decryptedAudioUri || (audioUrl && !audioUrl.includes('.enc') ? audioUrl : null);

  // Stabilise source object reference so player doesn't recreate on every parent render
  const sourceRef = useRef(null);
  if (audioUri && sourceRef.current?.uri !== audioUri) {
    sourceRef.current = { uri: audioUri };
  } else if (!audioUri) {
    sourceRef.current = null;
  }

  const player = useAudioPlayer(sourceRef.current);
  const status = useAudioPlayerStatus(player);

  // Throttled progress to prevent per-native-frame re-renders causing playback jitter
  const [progress, setProgress] = useState(0);
  const [displayTime, setDisplayTime] = useState(duration || 0);
  const lastUpdateRef = useRef(0);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!status) return;
    const now = Date.now();
    // Allow immediate update when paused/stopped; throttle only during active playback
    if (status.playing && now - lastUpdateRef.current < PROGRESS_UPDATE_INTERVAL_MS) return;
    lastUpdateRef.current = now;

    const currentTime = status.currentTime || 0;
    const totalDuration = status.duration || duration || 0;
    const newProgress = totalDuration > 0 ? Math.min(Math.max(currentTime / totalDuration, 0), 1) : 0;
    setProgress(newProgress);
    setDisplayTime(status.playing && currentTime > 0 ? currentTime : totalDuration || duration);
  }, [status, duration]);

  const isPlaying = Boolean(status?.playing);

  useEffect(() => {
    // This bubble is only mounted once the listener has pressed play.
    if (autoStartedRef.current || !player || !audioUri || isUploading) return;
    if (status && status.isLoaded === false) return;
    autoStartedRef.current = true;
    (async () => {
      try {
        await ensureAudioPlaybackMode();
        player.play();
      } catch (e) {
        console.warn('VoiceMessage playback error:', e);
      }
    })();
  }, [audioUri, isUploading, player, status]);

  const handleTogglePlay = useCallback(async () => {
    if (!player || isUploading) return;
    try {
      await ensureAudioPlaybackMode();
      if (isPlaying) {
        player.pause();
      } else {
        if (progress >= 0.98) {
          player.seekTo(0);
        }
        player.play();
      }
    } catch (e) {
      console.warn('VoiceMessage playback error:', e);
    }
  }, [isPlaying, isUploading, player, progress]);

  return (
    <VoiceMessageView
      colors={colors}
      displayTime={displayTime}
      isPlaying={isPlaying}
      isUploading={isUploading || decrypting}
      mine={mine}
      onPress={handleTogglePlay}
      progress={progress}
    />
  );
}

export default function VoiceMessageBubble({
  audioUrl,
  duration = 0,
  mine = false,
  colors,
  conversationId,
  currentUserId,
  conversationKey,
  isUploading = false,
}) {
  const [activated, setActivated] = useState(false);

  const handleStart = useCallback(() => {
    if (isUploading) return;
    setActivated(true);
  }, [isUploading]);

  if (!activated) {
    return (
      <VoiceMessageView
        colors={colors}
        displayTime={duration}
        isPlaying={false}
        isUploading={isUploading}
        mine={mine}
        onPress={handleStart}
        progress={0}
      />
    );
  }

  return (
    <ActiveVoiceMessage
      audioUrl={audioUrl}
      colors={colors}
      conversationId={conversationId}
      conversationKey={conversationKey}
      currentUserId={currentUserId}
      duration={duration}
      isUploading={isUploading}
      mine={mine}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    minWidth: 170,
    paddingVertical: 2,
  },
  playBtn: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },
  waveColumn: {
    flex: 1,
    gap: 4,
    justifyContent: 'center',
  },
  waveRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2.5,
    height: 30,
  },
  waveBar: {
    borderRadius: 1.5,
    width: 3,
  },
  timeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  audioBadge: {
    opacity: 0.85,
  },
});

