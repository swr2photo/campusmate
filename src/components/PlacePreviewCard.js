import { Pressable } from './NativePressable';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { useTheme } from '../theme';

export default React.memo(function PlacePreviewCard({ spot, selected = false, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable nativeCardSurface accessibilityRole="button" accessibilityLabel={`ดูรายละเอียด ${spot.name}`}
      accessibilityHint="เปิดข้อมูลสถานที่ นัดหมาย ปักหมุด และแผนที่"
      onPress={() => onPress?.(spot)}
      style={({ pressed }) => [styles.card, { backgroundColor: selected ? colors.mintSoft : colors.card, borderColor: selected ? colors.mint : colors.line, opacity: pressed ? 0.75 : 1 }]}>
      <View style={[styles.photo, { backgroundColor: colors.surfaceRaised }]}>
        <PlacePhoto spot={spot} showCredit={false} style={StyleSheet.absoluteFill} />
        {selected ? <View style={[styles.selected, { backgroundColor: colors.mint }]}><FeatureIcon name="checkmark" size={12} color="#FFFFFF" /></View> : null}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.category, { color: colors.primary }]}>{spot.categoryLabel || 'สถานที่ใน ม.อ.'}</Text>
        <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>{spot.name}</Text>
        {spot.description ? <Text numberOfLines={1} style={[styles.description, { color: colors.inkMuted }]}>{spot.description}</Text> : null}
        <View style={styles.footer}>
          {spot.distance ? <Text numberOfLines={1} style={[styles.distance, { color: colors.inkMuted }]}>{spot.distance}</Text> : null}
          <View style={styles.detailHint}><Text style={[styles.hint, { color: colors.primary }]}>รายละเอียด</Text><FeatureIcon name="chevron.right" size={11} color={colors.primary} /></View>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 0,
    width: '100%',
    aspectRatio: 4,
    minHeight: 84,
  },
  photo: {
    height: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  selected: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: 1,
    justifyContent: 'center',
  },
  category: { fontSize: 10.5, fontWeight: '600' },
  name: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  description: { fontSize: 11.5, lineHeight: 15 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    marginTop: 2,
    paddingTop: 1,
  },
  distance: { fontSize: 10.5, flexShrink: 1 },
  detailHint: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
    marginLeft: 'auto',
  },
  hint: { fontSize: 10.5, fontWeight: '600' },
});
