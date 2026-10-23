import { Pressable } from './NativePressable';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { PressScale } from './activities/motion';
import { categoryMeta } from './activities/categories';
import { radius, shadow, useTheme } from '../theme';

// Mint is too light for small text on its own soft background.
const SELECTED_TEXT = '#0B7A55';

// Height follows the content, so long Thai names and larger text wrap
// instead of being clipped by a fixed aspect ratio.
export default React.memo(function PlacePreviewCard({ spot, selected = false, onPress }) {
  const { colors, isDark } = useTheme();
  const meta = categoryMeta(spot.category);
  return (
    <PressScale>
      <Pressable nativeCardSurface accessibilityRole="button"
        accessibilityLabel={`ดูรายละเอียด ${spot.name}${spot.distance ? ` ห่าง ${spot.distance}` : ''}${selected ? ' จุดนัดหมายของคุณ' : ''}`}
        accessibilityHint="เปิดข้อมูลสถานที่ นัดหมาย ปักหมุด และแผนที่"
        onPress={() => onPress?.(spot)}
        style={({ pressed }) => [styles.card, shadow.card, {
          backgroundColor: selected ? colors.mintSoft : colors.card,
          borderColor: selected ? colors.mint : colors.line,
          opacity: pressed ? 0.9 : 1,
        }]}>
        <View style={[styles.photo, { backgroundColor: colors.surfaceRaised }]}>
          <PlacePhoto spot={spot} showCredit={false} style={StyleSheet.absoluteFill} />
          <View style={[styles.categoryBadge, { backgroundColor: isDark ? 'rgba(20,22,28,0.86)' : 'rgba(255,255,255,0.94)' }]}>
            <FeatureIcon color={meta.color} name={meta.icon} size={12} />
          </View>
          {selected ? <View style={[styles.selected, { backgroundColor: colors.mint }]}><FeatureIcon name="checkmark" size={11} color="#FFFFFF" /></View> : null}
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.category, { color: selected ? (isDark ? colors.mint : SELECTED_TEXT) : colors.inkMuted }]}>
            {selected ? 'จุดนัดหมายของคุณ' : spot.categoryLabel || 'สถานที่ใน ม.อ.'}
          </Text>
          <Text numberOfLines={2} style={[styles.name, { color: colors.ink }]}>{spot.name}</Text>
          <View style={styles.metaRow}>
            {spot.distance ? (
              <View style={styles.distance}>
                <FeatureIcon color={colors.accentText} name="location.fill" size={10} />
                <Text numberOfLines={1} style={[styles.distanceText, { color: colors.accentText }]}>{spot.distance}</Text>
              </View>
            ) : null}
            {spot.description ? <Text numberOfLines={1} style={[styles.description, { color: colors.inkMuted }]}>{spot.description}</Text> : null}
          </View>
        </View>
        <View style={[styles.chevron, { backgroundColor: colors.surfaceRaised }]}>
          <FeatureIcon color={colors.inkMuted} name="chevron.right" size={12} />
        </View>
      </Pressable>
    </PressScale>
  );
});

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 96,
    padding: 10,
    width: '100%',
  },
  photo: {
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    flexShrink: 0,
    height: 76,
    overflow: 'hidden',
    width: 76,
  },
  categoryBadge: {
    alignItems: 'center',
    borderRadius: 12,
    bottom: 5,
    height: 24,
    justifyContent: 'center',
    left: 5,
    position: 'absolute',
    width: 24,
  },
  selected: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 5,
    top: 5,
    width: 22,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  category: { fontSize: 12, fontWeight: '600' },
  name: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  distance: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: 3 },
  distanceText: { fontSize: 12, fontWeight: '700' },
  description: { flex: 1, fontSize: 12 },
  chevron: { alignItems: 'center', borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
});
