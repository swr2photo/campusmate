import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import TrackPreviewButton from '../TrackPreviewButton';
import { SoundWave } from '../illustrations';

const SPOTIFY_GREEN = '#1DB954';

/**
 * Compact player for someone's favourite track: the record spins and the
 * waveform moves only while the preview is actually playing.
 */
export default function SpotifyMiniPlayer({ track, width, style }) {
  const reduceMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const spin = useSharedValue(0);
  const onStatusChange = useCallback(({ active, loading }) => setPlaying(Boolean(active && !loading)), []);
  useEffect(() => {
    if (!playing || reduceMotion) { cancelAnimation(spin); return undefined; }
    spin.set(withRepeat(withTiming(spin.get() + 360, { duration: 2600, easing: Easing.linear }), -1));
    return () => cancelAnimation(spin);
  }, [playing, reduceMotion, spin]);
  const discStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));
  if (!track?.name) return null;
  const artist = track.artists || track.artist || '';
  return (
    <View style={[styles.player, width ? { width } : null, style]}>
      <Animated.View style={[styles.disc, discStyle]}>
        <View style={[styles.groove, { width: 38, height: 38 }]} />
        <View style={[styles.groove, { width: 30, height: 30 }]} />
        {track.albumArt ? <Image source={{ uri: track.albumArt }} style={styles.label} /> : <View style={[styles.label, styles.labelFallback]}><FeatureIcon name="music.note" size={9} color="#FFFFFF" /></View>}
      </Animated.View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.name}>{track.name}</Text>
        <View style={styles.metaRow}>
          <SoundWave bars={10} height={12} barWidth={2} gap={2} color={SPOTIFY_GREEN} playing={playing} />
          {artist ? <Text numberOfLines={1} style={styles.artist}>{artist}</Text> : null}
        </View>
      </View>
      <View style={styles.play}>
        <TrackPreviewButton nativeGestureSurface backgroundColor={SPOTIFY_GREEN} color="#0B0F0C" size={34} track={track} onStatusChange={onStatusChange} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  player: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 8, paddingRight: 8, paddingVertical: 6, borderRadius: 20, borderCurve: 'continuous', backgroundColor: 'rgba(12,16,28,0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  disc: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' },
  groove: { position: 'absolute', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  label: { width: 18, height: 18, borderRadius: 9 },
  labelFallback: { backgroundColor: SPOTIFY_GREEN, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  artist: { color: 'rgba(255,255,255,0.72)', fontSize: 11, flexShrink: 1 },
  play: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
