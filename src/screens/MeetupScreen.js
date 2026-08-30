import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { ACTIVITY_CATEGORIES } from '../data/activityCategories';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, PrimaryButton, SectionTitle } from '../components/ui';
import { radius, spacing, type, useTheme } from '../theme';

/** สร้างรายการ 7 วันถัดไป สำหรับ picker */
function getNextDays(count = 7) {
  const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const result = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    result.push({ value: iso, label });
  }
  return result;
}

/** สร้างรายการช่วงเวลา */
const TIME_OPTIONS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00',
];

const SPOT_CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด', icon: '✦', color: '#5B5CE2' },
  { id: 'sports', label: 'สนามกีฬา', icon: '🏀', color: '#FF9F43' },
  { id: 'chill', label: 'โซนนั่งเล่น', icon: '🌳', color: '#18A878' },
  { id: 'cafe', label: 'คาเฟ่', icon: '☕', color: '#F47C6B' },
  { id: 'study', label: 'โซนอ่านหนังสือ', icon: '📚', color: '#3986E8' },
  { id: 'running', label: 'วิ่งออกกำลัง', icon: '🏃', color: '#FF7A6B' },
  { id: 'gym', label: 'ยิม/ฟิตเนส', icon: '🏋️', color: '#9A8CFF' },
];

function matchesSpotQuery(spot, query) {
  if (!query) return true;
  return [spot.name, spot.description, spot.categoryLabel, spot.busyTime, spot.group]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export default function MeetupScreen({ onToast }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const { campusSpots, chooseMeetup, updateMeetupSchedule, clearMeetup, selectedMeetup } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Schedule modal state
  const [scheduleModal, setScheduleModal] = useState(false);
  const [pendingSpot, setPendingSpot] = useState(null);
  const [schedDate, setSchedDate] = useState(null);
  const [schedStart, setSchedStart] = useState('14:00');
  const [schedEnd, setSchedEnd] = useState('16:00');
  const [maxPeople, setMaxPeople] = useState('2');
  const [message, setMessage] = useState('');

  const nextDays = useMemo(() => getNextDays(7), []);

  const visibleSpots = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return campusSpots.filter((spot) => (
      (selectedCategory === 'all' || spot.category === selectedCategory)
      && matchesSpotQuery(spot, normalizedQuery)
    ));
  }, [campusSpots, searchQuery, selectedCategory]);

  const openScheduleFor = (spot) => {
    setPendingSpot(spot);
    setSchedDate(nextDays[0].value);
    setSchedStart('14:00');
    setSchedEnd('16:00');
    setMaxPeople('2');
    setMessage('');
    setScheduleModal(true);
  };

  const confirmSchedule = () => {
    if (!pendingSpot) return;
    const schedule = { 
      date: schedDate, 
      startTime: schedStart, 
      endTime: schedEnd,
      maxPeople: parseInt(maxPeople, 10) || 2,
      message: message.trim()
    };
    chooseMeetup(pendingSpot, schedule);
    setScheduleModal(false);
    setPendingSpot(null);
    onToast?.(`ปักหมุด ${pendingSpot.name} แล้ว`);
  };

  const handleQuickChoose = (spot) => {
    chooseMeetup(spot);
    onToast?.(`ปักหมุด ${spot.name} ให้แล้ว`);
  };

  const header = (
    <View>
      <Text style={styles.title}>จุดนัดหมายในมอ</Text>
      <Text style={styles.subtitle}>สถานที่จริงพร้อมระยะห่างจาก GPS ของคุณ</Text>

      <View style={styles.mapCard}>
        <View style={styles.mapDecorOne} />
        <View style={styles.mapDecorTwo} />
        <View style={styles.mapPin}><Text style={styles.mapPinText}>📍</Text></View>
        <View style={styles.mapCopy}>
          <Text numberOfLines={2} style={styles.mapTitle}>มหาวิทยาลัยสงขลานครินทร์</Text>
          <Text numberOfLines={2} style={styles.mapText}>เลือกจุดนัดพบ กำหนดวัน-เวลา แล้วนัดเจอกัน</Text>
        </View>
        <Text style={styles.mapGrid}>···{`\n`}· · ·{`\n`}···</Text>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="ค้นหาสถานที่หรือกิจกรรม"
          autoCapitalize="none"
          onChangeText={setSearchQuery}
          placeholder="ค้นหาสถานที่หรือกิจกรรม"
          placeholderTextColor={colors.tertiary}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery ? (
          <Pressable accessibilityLabel="ล้างคำค้นหา" onPress={() => setSearchQuery('')}>
            <Text style={styles.searchClear}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {selectedMeetup && (
        <Card style={styles.selectedCard}>
          <View style={styles.selectedHeader}>
            <View style={styles.selectedTitleWrap}>
              <Text style={styles.selectedEyebrow}>ปักหมุดล่าสุด</Text>
              <Text style={styles.selectedTitle}>{selectedMeetup.name}</Text>
            </View>
            <Text style={styles.selectedCheck}>✓</Text>
          </View>
          <Text numberOfLines={2} style={styles.selectedMeta}>📍 {selectedMeetup.distance}  ·  🕒 {selectedMeetup.scheduledAt}</Text>
          {selectedMeetup.schedule?.date && (
            <View style={styles.scheduleRow}>
              <View style={styles.scheduleChip}>
                <Text numberOfLines={1} style={styles.scheduleChipText}>📅 {selectedMeetup.schedule.date}</Text>
              </View>
              <View style={styles.scheduleChip}>
                <Text numberOfLines={1} style={styles.scheduleChipText}>🕐 {selectedMeetup.schedule.startTime}–{selectedMeetup.schedule.endTime}</Text>
              </View>
            </View>
          )}
          <View style={styles.selectedActions}>
            <OutlineButton compact icon="🕒" label="เปลี่ยนเวลา" onPress={() => openScheduleFor(selectedMeetup)} style={styles.changeTimeBtn} />
            <OutlineButton compact danger icon="×" label="ยกเลิก" onPress={() => { clearMeetup(); onToast?.('ยกเลิกจุดนัดหมายแล้ว', 'info'); }} style={styles.cancelButton} />
          </View>
        </Card>
      )}

      <View style={styles.sectionRow}>
        <SectionTitle title="สถานที่แนะนำ" subtitle="สถานที่จริงใน มอ. เรียงจากใกล้ไปไกล" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        {SPOT_CATEGORIES.map((category) => (
          <Chip
            key={category.id}
            active={selectedCategory === category.id}
            color={category.color}
            icon={category.icon}
            label={category.label}
            onPress={() => setSelectedCategory(category.id)}
            style={styles.categoryChip}
          />
        ))}
      </ScrollView>
      <View style={styles.resultMeta}>
        <Text style={styles.resultTitle}>สถานที่ใกล้คุณ</Text>
        <Text style={styles.resultCount}>{visibleSpots.length} แห่ง · เรียงจากใกล้สุด</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={visibleSpots}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Card style={styles.spotCard}>
            <View style={styles.spotTopRow}>
              <View style={[styles.spotEmojiBox, { backgroundColor: item.category === 'running' ? colors.coralSoft : item.category === 'study' ? colors.blueSoft : colors.greenSoft }]}>
                <Text style={styles.spotEmoji}>{item.emoji}</Text>
              </View>
              <View style={styles.spotCopy}>
              <Text numberOfLines={2} style={styles.spotName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.spotCategory}>{item.categoryLabel}</Text>
              </View>
              <View style={styles.rating}><Text style={styles.ratingStar}>★</Text><Text style={styles.ratingText}>{item.rating}</Text></View>
            </View>
            <View style={styles.spotDetailBox}>
              <Text numberOfLines={2} style={styles.detailText}>💡 {item.description}</Text>
              <Text numberOfLines={1} style={styles.busyText}>⏰ {item.busyTime}</Text>
              <Text numberOfLines={1} style={styles.distanceText}>📍 {item.distance}</Text>
            </View>
            <View style={styles.spotButtonRow}>
              <PrimaryButton compact label="ปักหมุด + ตั้งเวลา" icon="📅" onPress={() => openScheduleFor(item)} style={styles.spotButtonSchedule} />
              <OutlineButton compact label="ปักหมุดเลย" icon="⌖" onPress={() => handleQuickChoose(item)} style={styles.spotButtonQuick} />
            </View>
          </Card>
        )}
        showsVerticalScrollIndicator={false}
      />

      {/* Schedule Picker Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={scheduleModal}
        onRequestClose={() => setScheduleModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setScheduleModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.modalContent}>
                <View style={styles.modalHandle} />
                <Text numberOfLines={2} style={styles.modalTitle}>ตั้งวันเวลานัดหมาย</Text>
                {pendingSpot && <Text numberOfLines={1} style={styles.modalSpotName}>📍 {pendingSpot.name}</Text>}

                <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll} nestedScrollEnabled>
                  {/* Date Picker */}
                  <Text numberOfLines={2} style={styles.pickerLabel}>📅 เลือกวัน</Text>
                  <View style={styles.pickerWrap}>
                    {nextDays.map((day) => (
                      <TouchableOpacity
                        key={day.value}
                        onPress={() => setSchedDate(day.value)}
                        activeOpacity={0.7}
                        style={[styles.dayChip, schedDate === day.value && styles.dayChipActive]}
                      >
                        <Text style={[styles.dayChipText, schedDate === day.value && styles.dayChipTextActive]}>{day.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Start Time */}
                  <Text numberOfLines={2} style={styles.pickerLabel}>🕐 เวลาเริ่ม</Text>
                  <View style={styles.pickerWrap}>
                    {TIME_OPTIONS.map((t) => (
                      <TouchableOpacity
                        key={`s-${t}`}
                        onPress={() => setSchedStart(t)}
                        activeOpacity={0.7}
                        style={[styles.timeChip, schedStart === t && styles.timeChipActive]}
                      >
                        <Text style={[styles.timeChipText, schedStart === t && styles.timeChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* End Time */}
                  <Text numberOfLines={2} style={styles.pickerLabel}>🕐 เวลาสิ้นสุด</Text>
                  <View style={styles.pickerWrap}>
                    {TIME_OPTIONS.filter((t) => t > schedStart).map((t) => (
                      <TouchableOpacity
                        key={`e-${t}`}
                        onPress={() => setSchedEnd(t)}
                        activeOpacity={0.7}
                        style={[styles.timeChip, schedEnd === t && styles.timeChipActive]}
                      >
                        <Text style={[styles.timeChipText, schedEnd === t && styles.timeChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Settings */}
                  <Text numberOfLines={2} style={styles.pickerLabel}>👥 จำนวนคน (รวมตัวเอง)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={maxPeople}
                    onChangeText={setMaxPeople}
                    keyboardType="number-pad"
                    placeholder="เช่น 2, 4"
                    placeholderTextColor={colors.tertiary}
                  />

                  <Text numberOfLines={2} style={styles.pickerLabel}>💬 ประกาศ/รายละเอียด</Text>
                  <TextInput
                    style={[styles.textInput, styles.textArea]}
                    value={message}
                    onChangeText={setMessage}
                    placeholder="เช่น หาเพื่อนไปวิ่งครับ"
                    placeholderTextColor={colors.tertiary}
                    multiline
                    numberOfLines={3}
                  />

                  {/* Summary */}
                  <View style={styles.summaryBox}>
                    <Text style={styles.summaryText}>
                      📅 {nextDays.find((d) => d.value === schedDate)?.label || '—'}  ·  🕐 {schedStart}–{schedEnd}
                    </Text>
                  </View>
                </ScrollView>

                <View style={styles.modalActions}>
                  <PrimaryButton compact label="ยืนยันนัดหมาย" icon="✓" onPress={confirmSchedule} style={styles.confirmBtn} />
                  <OutlineButton compact label="ยกเลิก" onPress={() => setScheduleModal(false)} style={styles.cancelModalBtn} />
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: 11, lineHeight: 16, marginTop: 4, maxWidth: '96%' },
  mapCard: { backgroundColor: '#DCE8F0', borderRadius: radius.lg, height: 128, marginBottom: spacing.md, marginTop: spacing.lg, overflow: 'hidden', padding: spacing.md, position: 'relative' },
  mapDecorOne: { backgroundColor: '#C2DED3', borderRadius: 55, height: 170, left: -30, position: 'absolute', top: 42, width: 180 },
  mapDecorTwo: { borderColor: 'rgba(91,92,226,0.15)', borderRadius: 100, borderWidth: 18, height: 160, position: 'absolute', right: -55, top: -45, width: 160 },
  mapPin: { alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.card, borderRadius: 19, borderWidth: 3, height: 42, justifyContent: 'center', left: 18, position: 'absolute', top: 27, width: 42 },
  mapPinText: { fontSize: 18 },
  mapCopy: { left: 76, position: 'absolute', right: 14, top: 20 },
  mapTitle: { color: colors.ink, fontSize: 13, fontWeight: '900', lineHeight: 17, maxHeight: 34 },
  mapText: { color: colors.inkMuted, fontSize: 10, lineHeight: 14, marginTop: 4, maxHeight: 28 },
  mapGrid: { color: 'rgba(91,92,226,0.4)', fontSize: 15, fontWeight: '900', lineHeight: 14, position: 'absolute', right: 18, top: 8 },
  searchBar: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.md, minHeight: 44, paddingHorizontal: spacing.md },
  searchIcon: { color: colors.primary, fontSize: 22, fontWeight: '700', marginRight: spacing.sm },
  searchInput: { color: colors.ink, flex: 1, fontSize: 13, minWidth: 0, paddingHorizontal: 0, paddingVertical: 8 },
  searchClear: { color: colors.inkMuted, fontSize: 22, lineHeight: 24, paddingLeft: spacing.sm },
  resultMeta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm, marginTop: spacing.xs },
  resultTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  resultCount: { color: colors.primary, flexShrink: 1, fontSize: 10, fontWeight: '800', marginLeft: spacing.sm, textAlign: 'right' },

  selectedCard: { borderColor: colors.greenSoft, marginBottom: spacing.lg, padding: spacing.md },
  selectedHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  selectedTitleWrap: { flex: 1 },
  selectedEyebrow: { color: colors.green, fontSize: 10, fontWeight: '900', marginBottom: 2 },
  selectedTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', maxHeight: 18 },
  selectedCheck: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 13, color: colors.card, fontSize: 15, fontWeight: '900', height: 26, lineHeight: 26, textAlign: 'center', width: 26 },
  selectedMeta: { color: colors.inkMuted, fontSize: 11, lineHeight: 16, marginTop: spacing.sm, maxHeight: 32 },
  scheduleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  scheduleChip: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 4 },
  scheduleChipText: { color: colors.primary, fontSize: 10, fontWeight: '800' },
  selectedActions: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  changeTimeBtn: { flex: 1, minHeight: 38 },
  cancelButton: { flex: 1, minHeight: 38 },

  sectionRow: { marginBottom: 0 },
  categoryRow: { paddingBottom: spacing.lg, paddingRight: spacing.lg },
  categoryChip: { marginRight: spacing.sm },

  spotCard: { marginBottom: spacing.md, padding: spacing.md },
  spotTopRow: { alignItems: 'flex-start', flexDirection: 'row' },
  spotEmojiBox: { alignItems: 'center', borderRadius: 13, height: 44, justifyContent: 'center', marginRight: spacing.sm, width: 44 },
  spotEmoji: { fontSize: 22 },
  spotCopy: { flex: 1, minWidth: 0, paddingRight: spacing.xs },
  spotName: { color: colors.ink, fontSize: 13, fontWeight: '900', lineHeight: 17, maxHeight: 34 },
  spotCategory: { color: colors.primary, fontSize: 10, fontWeight: '700', lineHeight: 14, marginTop: 2 },
  rating: { alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: 8, flexDirection: 'row', paddingHorizontal: 5, paddingVertical: 4 },
  ratingStar: { color: colors.amber, fontSize: 11, marginRight: 2 },
  ratingText: { color: colors.amber, fontSize: 10, fontWeight: '900' },
  spotDetailBox: { backgroundColor: colors.canvas, borderRadius: radius.sm, marginTop: spacing.sm, padding: 10 },
  detailText: { color: colors.ink, fontSize: 11, lineHeight: 16, maxHeight: 32 },
  busyText: { color: colors.inkMuted, fontSize: 10, lineHeight: 14, marginTop: 4, maxHeight: 14 },
  distanceText: { color: colors.primary, fontSize: 11, fontWeight: '800', lineHeight: 15, marginTop: 4, maxHeight: 15 },
  spotButtonRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  spotButtonSchedule: { flex: 1, minHeight: 38 },
  spotButtonQuick: { flex: 1, minHeight: 38 },

  // Modal styles
  modalOverlay: { backgroundColor: 'rgba(0,0,0,0.5)', flex: 1, justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '90%', padding: spacing.lg, paddingBottom: 24 },
  modalHandle: { alignSelf: 'center', backgroundColor: colors.line, borderRadius: 3, height: 4, marginBottom: spacing.md, width: 36 },
  modalTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', lineHeight: 23, maxHeight: 46, textAlign: 'center' },
  modalSpotName: { color: colors.primary, fontSize: 13, fontWeight: '800', lineHeight: 18, marginTop: spacing.sm, maxHeight: 18, textAlign: 'center' },
  modalScroll: { flexGrow: 0 },
  pickerLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', lineHeight: 18, marginBottom: spacing.sm, marginTop: spacing.md, maxHeight: 36 },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  textInput: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1.5, color: colors.ink, fontSize: 13, paddingHorizontal: spacing.md, paddingVertical: 9 },
  textArea: { minHeight: 68, textAlignVertical: 'top' },

  dayChip: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 9 },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  dayChipTextActive: { color: colors.card },

  timeChip: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.sm, borderWidth: 1.5, minWidth: 54, paddingHorizontal: 8, paddingVertical: 8 },
  timeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timeChipText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  timeChipTextActive: { color: colors.card },
  chipPressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },

  summaryBox: { backgroundColor: colors.primarySoft, borderRadius: radius.md, marginTop: spacing.md, padding: 10 },
  summaryText: { color: colors.primary, fontSize: 12, fontWeight: '800', lineHeight: 17, textAlign: 'center' },

  modalActions: { gap: 6, marginTop: spacing.md },
  confirmBtn: { minHeight: 40 },
  cancelModalBtn: { minHeight: 38 },
});
