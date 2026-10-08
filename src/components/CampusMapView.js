import Text from './AppText';
import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { externalMapUrl } from '../utils/mapCoordinates';
import { useTheme } from '../theme';

export function openInExternalMaps(spot) {
  return Linking.openURL(externalMapUrl(spot)).catch(() => {});
}

// Web uses a provider link. Native platforms resolve CampusMapView.native.js.
export default function CampusMapView({ selectedSpot, spots = [], onSelectSpot, style, height = 360 }) {
  const { colors } = useTheme();
  return <View style={[styles.container, { height, backgroundColor: colors.card }, style]}>
    <Text style={{ color: colors.ink, fontWeight: '700' }}>สถานที่ใกล้ ม.อ. หาดใหญ่</Text>
    {spots.slice(0, 8).map((spot) => <Pressable key={spot.id} accessibilityRole="button" onPress={() => onSelectSpot?.(spot)}>
      <Text style={{ color: colors.primary }}>{spot.name}</Text>
    </Pressable>)}
    <Pressable accessibilityRole="button" onPress={() => openInExternalMaps(selectedSpot)}>
      <Text style={{ color: colors.primary }}>เปิด Google Maps</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ container: { padding: 20, borderRadius: 18, gap: 12 } });
