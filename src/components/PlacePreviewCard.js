import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { useTheme } from '../theme';

export default React.memo(function PlacePreviewCard({ spot, selected = false, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`ดูรายละเอียด ${spot.name}`}
      accessibilityHint="เปิดข้อมูลสถานที่ นัดหมาย ปักหมุด และแผนที่"
      onPress={() => onPress?.(spot)}
      style={({ pressed }) => [styles.card, { backgroundColor: selected ? colors.mintSoft : colors.card, borderColor: selected ? colors.mint : colors.line, opacity: pressed ? 0.75 : 1 }]}>
      <View style={[styles.photo, { backgroundColor: colors.surfaceRaised }]}>
        <PlacePhoto spot={spot} showCredit={false} style={StyleSheet.absoluteFill} />
        {selected ? <View style={[styles.selected, { backgroundColor: colors.mint }]}><FeatureIcon name="checkmark" size={12} color="#FFFFFF" /></View> : null}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.category, { color: colors.primary }]}>{spot.categoryLabel || 'สถานที่ใน ม.อ.'}</Text>
        <Text numberOfLines={2} style={[styles.name, { color: colors.ink }]}>{spot.name}</Text>
        {spot.description ? <Text numberOfLines={2} style={[styles.description, { color: colors.inkMuted }]}>{spot.description}</Text> : null}
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
    padding: 10,
    borderRadius: 26,
    borderCurve: 'continuous',
    borderWidth: 0,
    width: '100%',
    maxWidth: 336,
    alignSelf: 'center',
  },
  photo: {
    width: 102,
    height: 102,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    flexShrink: 0,
    alignSelf: 'center',
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
    gap: 4,
    paddingVertical: 1,
    justifyContent: 'center',
  },
  category: { fontSize: 11, fontWeight: '600' },
  name: { fontSize: 14.5, fontWeight: '700', lineHeight: 19 },
  description: { fontSize: 12, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    paddingTop: 2,
  },
  distance: { fontSize: 11, flexShrink: 1 },
  detailHint: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
    marginLeft: 'auto',
  },
  hint: { fontSize: 11, fontWeight: '600' },
});
