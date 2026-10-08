import Text from './AppText';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';
import { availabilityDateKey, availabilityMonths, availabilityMonthCells } from '../utils/availabilityCalendar';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

export default function AvailabilityCalendar({ days, selectedDate, onSelect, slots }) {
  const { colors } = useTheme();
  const months = availabilityMonths(days);
  const [month, setMonth] = React.useState(() => months[0]);
  React.useEffect(() => { setMonth(selectedDate.slice(0, 7)); }, [selectedDate, days]);
  const activeMonth = months.includes(month) ? month : months[0];
  const page = months.indexOf(activeMonth);
  const [year, monthNumber] = activeMonth.split('-').map(Number);
  const today = availabilityDateKey(days[0]);
  const occupied = new Set(slots.map((slot) => slot.date).filter(Boolean));
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <View style={styles.monthRow}>
        <Text accessibilityRole="header" style={[styles.month, { color: colors.ink }]}>{MONTHS[monthNumber - 1]} {year + 543}</Text>
        <View style={styles.arrows}>
          {[-1, 1].map((direction) => {
            const disabled = !months[page + direction];
            return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction < 0 ? 'เดือนก่อนหน้า' : 'เดือนถัดไป'} accessibilityState={{ disabled }} disabled={disabled}
              onPress={() => setMonth(months[page + direction])}
              style={({ pressed }) => [styles.arrow, { backgroundColor: colors.surfaceRaised, opacity: disabled ? 0.3 : pressed ? 0.65 : 1 }]}>
              <FeatureIcon name={direction < 0 ? 'chevron.left' : 'chevron.right'} size={18} color={colors.ink} />
            </Pressable>;
          })}
        </View>
      </View>
      <Text style={[styles.hint, { color: colors.inkMuted }]}>เลือกวันว่างภายใน 14 วัน รวมวันนี้</Text>
      <View style={styles.grid}>
        {WEEKDAYS.map((day) => <View key={day} style={styles.cell}><Text style={[styles.weekday, { color: colors.inkMuted }]}>{day}</Text></View>)}
        {availabilityMonthCells(activeMonth, days).map((day, index) => {
          if (!day) return <View key={`blank-${index}`} style={styles.cell} />;
          const selected = selectedDate === day.key;
          const hasSlots = occupied.has(day.key);
          const isToday = day.key === today;
          return <View key={day.key} style={styles.cell}>
            <Pressable disabled={!day.available} accessibilityRole="button"
              accessibilityLabel={`${day.day} ${MONTHS[monthNumber - 1]} ${year + 543}${isToday ? ' วันนี้' : ''}${hasSlots ? ' มีเวลาว่างที่เลือกไว้' : ''}`}
              accessibilityState={{ selected, disabled: !day.available }} onPress={() => onSelect(day.key)}
              style={({ pressed }) => [styles.day, { backgroundColor: selected ? colors.primary : isToday ? colors.primarySoft : 'transparent', opacity: !day.available ? 0.25 : pressed ? 0.65 : 1 }]}>
              <Text style={[styles.date, { color: selected ? colors.onPrimary : colors.ink }]}>{day.day}</Text>
              <View style={[styles.dot, { backgroundColor: hasSlots ? selected ? colors.onPrimary : colors.primary : 'transparent' }]} />
            </Pressable>
          </View>;
        })}
      </View>
      <View style={styles.legend}><View style={[styles.dot, { backgroundColor: colors.primary }]} /><Text style={[styles.hint, { color: colors.inkMuted }]}>วันที่เพิ่มช่วงเวลาไว้แล้ว · สีจางอยู่นอกช่วงที่เลือกได้</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 12, marginBottom: 20 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  month: { fontSize: 17, fontWeight: '800', flex: 1 },
  arrows: { flexDirection: 'row', gap: 6 },
  arrow: { minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 18, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  cell: { width: '14.285714%', padding: 2, alignItems: 'stretch', justifyContent: 'center' },
  weekday: { fontSize: 12, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  day: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6 },
  date: { fontSize: 16, fontWeight: '700' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
});
