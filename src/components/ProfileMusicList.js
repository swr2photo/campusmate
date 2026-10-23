import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import React, { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Text from './AppText';
import CachedImage from './CachedImage';
import FeatureIcon from './FeatureIcon';
import TrackPreviewButton from './TrackPreviewButton';
import { useTheme } from '../theme';
import { useToast } from '../context/ToastContext';
import { getUniqueProfileTracks } from '../utils/discoveryPresentation';

export default function ProfileMusicList({ tracks, myTracks = [] }) {
  const { colors } = useTheme();
  const unique = useMemo(() => getUniqueProfileTracks(tracks), [tracks]);
  const shared = new Set(myTracks.map(track => track?.id).filter(Boolean));
  if (!unique.length) return null;
  return <NativeCard style={styles.list}>
    <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '700' }}>เพลงโปรด</Text>
    {unique.map(track => <MusicRow key={track.id} track={track} shared={shared.has(track.id)} />)}
  </NativeCard>;
}

function MusicRow({ track, shared }) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [playback, setPlayback] = useState({ active: false, loading: false, error: '' });
  const status = playback.error || (playback.loading ? 'กำลังเตรียมเสียง · แตะปุ่มเพื่อยกเลิก' : playback.active ? 'กำลังเล่นตัวอย่าง · แตะเพื่อหยุด' : 'ฟังตัวอย่างเพลง');
  const start = Number(track.previewStartMs) || 0;
  const end = Number(track.previewEndMs);
  const time = ms => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
  const open = async () => {
    try { await Linking.openURL(track.externalUrl); }
    catch { showToast('เปิด Spotify ไม่สำเร็จ กรุณาลองอีกครั้ง', 'info'); }
  };
  return <View style={[styles.row, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
    <View style={styles.top}>
      {track.albumArt ? <CachedImage source={{ uri: track.albumArt }} contentFit="cover" style={styles.art} /> : <FeatureIcon name="music.note" color={colors.accentText} size={32} />}
      <View style={styles.meta}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>{track.name}</Text>
        <Text style={{ color: colors.inkMuted, fontSize: 13 }}>{track.artists || 'ไม่ระบุศิลปิน'}</Text>
        {shared ? <Text style={{ color: colors.accentText, fontSize: 13, fontWeight: '700' }}>ชอบเหมือนกัน</Text> : null}
        {Number.isFinite(end) && end > start ? <Text style={{ color: colors.inkMuted, fontSize: 12 }}>ท่อนที่เลือก {time(start)}–{time(end)}</Text> : null}
      </View>
      <TrackPreviewButton track={track} size={48} backgroundColor={colors.primary} color={colors.onPrimary} onStatusChange={setPlayback} />
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: playback.error ? colors.danger : colors.inkMuted, fontSize: 13 }}>{status}</Text>
    {track.externalUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`เปิดใน Spotify ${track.name}`} onPress={open} style={({ pressed }) => [styles.external, { opacity: pressed ? 0.65 : 1 }]}><FeatureIcon name="arrow.up.right.square" color={colors.accentText} size={16} /><Text style={{ color: colors.accentText, fontSize: 14, fontWeight: '600' }}>เปิดใน Spotify</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  list: { width: '100%', gap: 12 },
  row: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  art: { width: 44, height: 44, borderRadius: 9 },
  external: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 48, alignSelf: 'flex-start' },
});
