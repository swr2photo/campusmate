import React from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { Pressable } from './NativePressable';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import TrackPreviewButton from './TrackPreviewButton';
import { useTheme } from '../theme';

const ACTION_SIZE = 36;

export default function ProfileFavoriteTrackRow({ track, onRemove }) {
  const { colors } = useTheme();
  return <View style={[styles.row, { backgroundColor: colors.surfaceContainerLow || colors.surfaceRaised, borderColor: colors.line }]}>
    {track.albumArt ? <Image source={{ uri: track.albumArt }} style={styles.art} /> : <View style={[styles.art, styles.placeholder, { backgroundColor: colors.canvas }]}><FeatureIcon color={colors.inkSoft} name="music.note" size={18} /></View>}
    <View style={styles.meta}>
      <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>{track.name}</Text>
      <Text numberOfLines={1} style={[styles.artists, { color: colors.inkSoft }]}>{track.artists}</Text>
    </View>
    {/* Play and delete share one 36 × 36 slot size and one centre line. */}
    <View style={styles.actions}>
      <View style={styles.slot}>
        <TrackPreviewButton nativeGestureSurface backgroundColor={colors.primarySoft} color={colors.accentText} size={ACTION_SIZE} track={track} />
      </View>
      <View style={styles.slot}>
        <Pressable nativeGestureSurface hitSlop={6} accessibilityRole="button" accessibilityLabel={`ลบ ${track.name}`} onPress={() => onRemove(track.id)} style={({ pressed }) => [styles.remove, { backgroundColor: colors.chipIdle || 'rgba(127,127,127,0.16)' }, pressed && { opacity: 0.7 }]}>
          {({ pressed }) => <FeatureIcon color={pressed ? colors.danger : colors.inkMuted} name="trash" size={17} />}
        </Pressable>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10, paddingLeft: 10, paddingRight: 12, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: Platform.OS === 'ios' ? 20 : 16, borderCurve: 'continuous' },
  art: { width: 40, height: 40, borderRadius: 8 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, minWidth: 0, justifyContent: 'center' },
  name: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  artists: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0, height: ACTION_SIZE },
  slot: { width: ACTION_SIZE, height: ACTION_SIZE, alignItems: 'center', justifyContent: 'center' },
  remove: { alignItems: 'center', justifyContent: 'center', width: ACTION_SIZE, height: ACTION_SIZE, borderRadius: ACTION_SIZE / 2 },
});
