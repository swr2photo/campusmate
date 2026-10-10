import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Text from './AppText';
import FeatureIcon from './FeatureIcon';
import PlacePhoto from './PlacePhoto';
import { useTheme } from '../theme';
import { placeDetailRows } from '../utils/placeDetails';

export default function PlaceDetailContent({ spot, selected, onClose, onSchedule, onChoose, onOpenMap, bottomInset = 16 }) {
  const { colors } = useTheme();
  return <View style={[styles.page, { backgroundColor: colors.card }]}>
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: colors.ink }]}>รายละเอียดสถานที่</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="ปิดรายละเอียดสถานที่" onPress={onClose} style={[styles.close, { backgroundColor: colors.surfaceRaised }]}><FeatureIcon name="xmark" size={18} color={colors.ink} /></Pressable>
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <PlacePhoto spot={spot} style={styles.photo} />
      <Text selectable style={[styles.title, { color: colors.ink }]}>{spot.name}</Text>
      {selected ? <Text style={[styles.selected, { color: colors.mint }]}>✓ จุดนัดหมายที่เลือกไว้</Text> : null}
      {spot.description ? <Text selectable style={[styles.description, { color: colors.inkMuted }]}>{spot.description}</Text> : null}
      <View style={styles.rows}>{placeDetailRows(spot).map((row) => <View key={row.label} style={styles.row}>
        <FeatureIcon name={row.icon} color={colors.primary} size={19} />
        <View style={{ flex: 1, gap: 2 }}><Text style={[styles.rowLabel, { color: colors.inkMuted }]}>{row.label}</Text><Text selectable style={{ color: colors.ink }}>{String(row.value)}</Text></View>
      </View>)}</View>
    </ScrollView>
    <View style={[styles.actions, { borderTopColor: colors.line, paddingBottom: bottomInset }]}>
      <DetailAction icon="calendar.badge.clock" label="นัดหมายที่นี่" primary onPress={onSchedule} colors={colors} />
      <View style={styles.secondaryActions}>
        <DetailAction disabled={selected} icon={selected ? 'checkmark.circle.fill' : 'mappin.circle.fill'} label={selected ? 'ปักหมุดแล้ว' : 'ปักหมุดสถานที่'} onPress={onChoose} colors={colors} />
        <DetailAction icon="map.fill" label="เปิดแผนที่" onPress={onOpenMap} colors={colors} />
      </View>
    </View>
  </View>;
}

export function DetailAction({ icon, label, onPress, primary, colors, disabled = false }) {
  return <Pressable disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: primary ? colors.primary : colors.primarySoft, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
    <FeatureIcon name={icon} color={primary ? colors.onPrimary : colors.primary} size={18} />
    <Text style={[styles.actionLabel, { color: primary ? colors.onPrimary : colors.primary }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 12, gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  photo: { width: '100%', height: 210, borderRadius: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  selected: { fontSize: 12, fontWeight: '600' },
  description: { fontSize: 15 },
  rows: { gap: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: 12 },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  secondaryActions: { flexDirection: 'row', gap: 8 },
  action: { flexGrow: 1, flexBasis: 0, minHeight: 48, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionLabel: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
});
