import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

export default function AndroidCompactToolbar({ query = '', placeholder = 'ค้นหากิจกรรมหรือสถานที่',
  onPressSearch, onClearSearch, onOpenMap, onCreateParty, style }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.line }, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel="ค้นหาหรือเลื่อนกลับไปด้านบน" onPress={onPressSearch} style={styles.search}>
        <FeatureIcon name="magnifyingglass" size={20} color={colors.inkMuted} />
        <Text numberOfLines={1} style={[styles.query, { color: query ? colors.ink : colors.inkMuted }]}>{query || placeholder}</Text>
      </Pressable>
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="ล้างคำค้นหา" onPress={onClearSearch} style={styles.action}>
        <FeatureIcon name="xmark.circle.fill" size={20} color={colors.inkMuted} />
      </Pressable> : null}
      {onOpenMap ? <Pressable accessibilityRole="button" accessibilityLabel="เปิดแผนที่วิทยาเขต" onPress={onOpenMap} style={styles.action}>
        <FeatureIcon name="map.fill" size={20} color={colors.primary} />
      </Pressable> : null}
      {onCreateParty ? <Pressable accessibilityRole="button" accessibilityLabel="สร้างตี้กิจกรรมใหม่" onPress={onCreateParty} style={styles.action}>
        <FeatureIcon name="plus" size={20} color={colors.primary} />
      </Pressable> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 4, borderRadius: 28, borderWidth: 1 },
  search: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12 },
  query: { flex: 1, fontSize: 14 },
  action: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
