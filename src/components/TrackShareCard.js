import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { chatTrackWidth } from '../utils/chatMediaLayout';

/**
 * Compact responsive media row. The sleeve and vinyl stay within an explicit art stage.
 */
export default function TrackShareCard({
  albumArt,
  artists,
  children,
  name,
  onLongPress,
  size,
  isPreview = false,
}) {
  const [playing, setPlaying] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  // 210 / 240 / 260 by phone size (225 in the long-press preview), never over 68% of the screen.
  const cardWidth = Math.min(size || Infinity, chatTrackWidth(screenWidth, isPreview));
  const cover = 52;
  const playControl = React.isValidElement(children)
    ? React.cloneElement(children, {
      fill: false, size: 36, nativeGestureSurface: true,
      onStatusChange: (status) => {
        children.props.onStatusChange?.(status);
        setPlaying(Boolean(status?.active));
      },
    })
    : children;

  return (
    <NativeCard accessibilityLabel={`${name || 'เพลง'}${artists ? ` โดย ${artists}` : ''}`} style={[styles.card, { width: cardWidth }]}>
      <View pointerEvents="none" style={styles.artwork}>
        <View style={[styles.sleeve, { width: cover, height: cover }]}>
          {albumArt ? <Image contentFit="cover" source={{ uri: albumArt }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]}><FeatureIcon color="#FFFFFF" name="music.note" size={24} /></View>}
        </View>
      </View>
      <Pressable onLongPress={onLongPress} style={styles.meta}>
        <Text numberOfLines={1} style={styles.title}>{name || 'เพลง'}</Text>
        <Text numberOfLines={1} style={styles.artists}>{artists || 'ไม่ระบุศิลปิน'}</Text>
      </Pressable>
      <View style={styles.playButton}>{playControl}</View>
    </NativeCard>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', height: 72, padding: 10, gap: 8, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#202738' },
  artwork: { width: 52, height: 52, flexShrink: 0, borderRadius: 12, overflow: 'hidden' },
  meta: { flex: 1, minWidth: 0, justifyContent: 'center' },
  playButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sleeve: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  cover: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    borderRadius: 12,
  },
  title: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  artists: { color: 'rgba(255,255,255,0.76)', fontSize: 12, fontWeight: '500', marginTop: 1 },
});
