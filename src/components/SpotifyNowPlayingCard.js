import Text from './AppText';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FeatureIcon from './FeatureIcon';
import {
  fetchSpotifyCurrentlyPlaying,
  getValidAccessToken,
  openInSpotify,
  playSpotifyTrack,
} from '../services/spotifyAuthService';
import { useTheme } from '../theme';

const SPOTIFY_GREEN = '#1DB954';
const SPOTIFY_BLACK = '#121212';

export default function SpotifyNowPlayingCard({
  initialTrack = null,
  isLive = true,
  onTrackChange,
  showListenAlong = true,
}) {
  const { colors, isDark } = useTheme();
  const [current, setCurrent] = useState(initialTrack);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const refreshNowPlaying = useCallback(async () => {
    try {
      const token = await getValidAccessToken();
      if (!token) return;
      const res = await fetchSpotifyCurrentlyPlaying(token);
      if (res?.isPlaying && res?.track) {
        setCurrent(res.track);
        onTrackChange?.(res.track);
      } else {
        setCurrent(null);
        onTrackChange?.(null);
      }
    } catch (_) {}
  }, [onTrackChange]);

  useEffect(() => {
    if (!isLive) return;
    refreshNowPlaying();
    const interval = setInterval(refreshNowPlaying, 15000); // Check every 15s
    return () => clearInterval(interval);
  }, [isLive, refreshNowPlaying]);

  const handleListenAlong = useCallback(async () => {
    if (!current?.id && !current?.uri) return;
    setActing(true);
    try {
      const token = await getValidAccessToken();
      if (token) {
        const result = await playSpotifyTrack(token, current.uri || current.id);
        if (!result.success) {
          // If no active device or failed, open Spotify app directly
          await openInSpotify(current);
        }
      } else {
        await openInSpotify(current);
      }
    } catch (_) {
      await openInSpotify(current);
    } finally {
      setActing(false);
    }
  }, [current]);

  if (!current) return null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? '#181818' : '#F3F4F6',
          borderColor: isDark ? '#282828' : '#E5E7EB',
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.liveIndicator}>
          <View style={styles.greenDot} />
          <Text style={[styles.liveText, { color: isDark ? '#4ADE80' : '#16A34A' }]}>
            กำลังฟังใน Spotify ตอนนี้
          </Text>
        </View>
        <FontAwesome5 name="spotify" size={16} color={SPOTIFY_GREEN} />
      </View>

      <View style={styles.trackRow}>
        {current.albumArt ? (
          <Image
            source={{ uri: current.albumArt }}
            style={styles.albumArt}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.albumArt, styles.fallbackArt]}>
            <FeatureIcon color={SPOTIFY_GREEN} name="music.note" size={18} />
          </View>
        )}

        <View style={styles.trackInfo}>
          <Text numberOfLines={1} style={[styles.trackName, { color: colors.ink || '#111827' }]}>
            {current.name}
          </Text>
          <Text numberOfLines={1} style={[styles.artistName, { color: colors.inkSoft || '#6B7280' }]}>
            {current.artists}
          </Text>
        </View>

        {showListenAlong ? (
          <Pressable
            disabled={acting}
            onPress={handleListenAlong}
            style={({ pressed }) => [
              styles.actionButton,
              pressed && { opacity: 0.8 },
            ]}
          >
            {acting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <FeatureIcon color="#FFFFFF" name="play.fill" size={12} />
                <Text style={styles.actionText}>ฟังด้วยกัน</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 6,
    padding: 12,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  liveIndicator: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  greenDot: {
    backgroundColor: SPOTIFY_GREEN,
    borderRadius: 4,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  trackRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  albumArt: {
    borderRadius: 8,
    height: 44,
    marginRight: 10,
    width: 44,
  },
  fallbackArt: {
    alignItems: 'center',
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  trackInfo: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  trackName: {
    fontSize: 13,
    fontWeight: '700',
  },
  artistName: {
    fontSize: 12,
    marginTop: 2,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: SPOTIFY_GREEN,
    borderRadius: 20,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
