import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import CachedImage from './CachedImage';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { Pressable } from './NativePressable';
import { EmptyPhotoScene } from './illustrations';
import { getImageRequestUri } from '../utils/useRemoteImage';
import { useTheme } from '../theme';

// Tiles at least this wide get the mascot instead of a plain photo glyph.
const ILLUSTRATED_MIN = 96;

export default function ProfilePhotoThumbnail({ uri, revision, identity }) {
  const source = getImageRequestUri(uri, revision);
  return <Thumbnail key={source || 'empty'} source={source} identity={identity} />;
}

function Thumbnail({ source, identity }) {
  const { colors } = useTheme();
  const [status, setStatus] = useState(source ? 'loading' : 'error');
  const [attempt, setAttempt] = useState(0);
  const [box, setBox] = useState(0);
  const illustrated = box >= ILLUSTRATED_MIN;
  return <View onLayout={({ nativeEvent }) => setBox(Math.min(nativeEvent.layout.width, nativeEvent.layout.height))} style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceRaised }]}>
    {source ? <CachedImage key={attempt} source={{ uri: source }} imageIdentity={identity} contentFit="cover"
      style={StyleSheet.absoluteFill} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} /> : null}
    {status === 'loading' ? <View style={styles.center} pointerEvents="none"><ActivityIndicator color={colors.accentText} accessibilityLabel="กำลังโหลดรูปภาพ" /></View> : null}
    {status === 'error' ? <View style={[styles.center, { backgroundColor: colors.surfaceRaised }]}>
      {illustrated ? <EmptyPhotoScene size={Math.min(130, box * 0.6)} /> : <FeatureIcon name="photo" size={25} color={colors.inkMuted} />}
      <Text style={[styles.label, { color: colors.inkMuted }]}>{illustrated ? 'รูปยังโหลดไม่ขึ้น' : 'โหลดรูปไม่สำเร็จ'}</Text>
      {source ? <Pressable accessibilityRole="button" accessibilityLabel="โหลดรูปภาพอีกครั้ง"
        onPress={(event) => { event.stopPropagation(); setStatus('loading'); setAttempt((value) => value + 1); }} style={styles.retry}>
        <Text style={[styles.label, { color: colors.accentText }]}>ลองใหม่</Text>
      </Pressable> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 4 }, label: { fontSize: 12, lineHeight: 18, textAlign: 'center' }, retry: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 8 } });
