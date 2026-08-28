import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ACTIVITY_CATEGORIES } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, PrimaryButton, SectionTitle } from '../components/ui';
import { colors, radius, spacing, type } from '../theme';

export default function MeetupScreen({ onToast }) {
  const { campusSpots, chooseMeetup, clearMeetup, selectedMeetup } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('all');

  const visibleSpots = useMemo(
    () => campusSpots.filter((spot) => selectedCategory === 'all' || spot.category === selectedCategory),
    [campusSpots, selectedCategory]
  );

  const handleChoose = (spot) => {
    chooseMeetup(spot);
    onToast?.(`ปักหมุด ${spot.name} ให้แล้ว`);
  };

  const header = (
    <View>
      <Text style={styles.eyebrow}>CampusMate / MEETUP</Text>
      <Text style={styles.title}>จุดนัดหมายในมอ</Text>
      <Text style={styles.subtitle}>สถานที่แนะนำสำหรับวิ่ง ติว และใช้เวลาร่วมกัน</Text>

      <View style={styles.mapCard}>
        <View style={styles.mapDecorOne} />
        <View style={styles.mapDecorTwo} />
        <View style={styles.mapPin}><Text style={styles.mapPinText}>⌖</Text></View>
        <View style={styles.mapCopy}>
          <Text style={styles.mapTitle}>พื้นที่มหาวิทยาลัยสงขลานครินทร์</Text>
          <Text style={styles.mapText}>เลือกจุดนัดพบที่เดินทางสะดวกและเหมาะกับกิจกรรมของคุณ</Text>
        </View>
        <Text style={styles.mapGrid}>···{`\n`}· · ·{`\n`}···</Text>
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
          <Text style={styles.selectedMeta}>📍 {selectedMeetup.distance}  ·  🕒 {selectedMeetup.scheduledAt}</Text>
          <OutlineButton danger icon="×" label="ยกเลิกจุดนัดหมาย" onPress={() => { clearMeetup(); onToast?.('ยกเลิกจุดนัดหมายแล้ว', 'info'); }} style={styles.cancelButton} />
        </Card>
      )}

      <View style={styles.sectionRow}>
        <SectionTitle title="สถานที่แนะนำ" subtitle="เลือกแล้วส่งต่อให้คู่สนทนาได้ทันที" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        {ACTIVITY_CATEGORIES.map((category) => (
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
                <Text style={styles.spotName}>{item.name}</Text>
                <Text style={styles.spotCategory}>{item.categoryLabel}</Text>
              </View>
              <View style={styles.rating}><Text style={styles.ratingStar}>★</Text><Text style={styles.ratingText}>{item.rating}</Text></View>
            </View>
            <View style={styles.spotDetailBox}>
              <Text style={styles.detailText}>💡 {item.description}</Text>
              <Text style={styles.busyText}>⏰ {item.busyTime}</Text>
              <Text style={styles.distanceText}>⌖ {item.distance}</Text>
            </View>
            <PrimaryButton label={selectedMeetup?.id === item.id ? 'เลือกจุดนี้แล้ว' : 'เลือกเป็นจุดนัดหมาย'} icon="⌖" onPress={() => handleChoose(item)} style={styles.spotButton} />
          </Card>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.3, marginBottom: spacing.sm },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 5 },
  mapCard: { backgroundColor: '#DCE8F0', borderRadius: radius.lg, height: 148, marginBottom: spacing.xl, marginTop: spacing.xl, overflow: 'hidden', padding: spacing.lg, position: 'relative' },
  mapDecorOne: { backgroundColor: '#C2DED3', borderRadius: 55, height: 170, left: -30, position: 'absolute', top: 42, width: 180 },
  mapDecorTwo: { borderColor: 'rgba(91,92,226,0.15)', borderRadius: 100, borderWidth: 18, height: 160, position: 'absolute', right: -55, top: -45, width: 160 },
  mapPin: { alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.card, borderRadius: 23, borderWidth: 4, height: 52, justifyContent: 'center', left: 28, position: 'absolute', top: 32, width: 52 },
  mapPinText: { color: colors.card, fontSize: 26, fontWeight: '900' },
  mapCopy: { left: 94, position: 'absolute', right: 24, top: 32 },
  mapTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900', lineHeight: 20 },
  mapText: { color: colors.inkMuted, fontSize: type.micro, lineHeight: 16, marginTop: 6 },
  mapGrid: { color: 'rgba(91,92,226,0.4)', fontSize: 18, fontWeight: '900', lineHeight: 16, position: 'absolute', right: 28, top: 9 },
  selectedCard: { borderColor: '#CDEFE0', marginBottom: spacing.xl, padding: spacing.lg },
  selectedHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  selectedTitleWrap: { flex: 1 },
  selectedEyebrow: { color: colors.green, fontSize: type.micro, fontWeight: '900', marginBottom: 3 },
  selectedTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  selectedCheck: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 15, color: colors.card, fontSize: 17, fontWeight: '900', height: 30, lineHeight: 30, textAlign: 'center', width: 30 },
  selectedMeta: { color: colors.inkMuted, fontSize: type.caption, marginTop: spacing.sm },
  cancelButton: { marginTop: spacing.md, minHeight: 40 },
  sectionRow: { marginBottom: 0 },
  categoryRow: { paddingBottom: spacing.lg, paddingRight: spacing.lg },
  categoryChip: { marginRight: spacing.sm },
  spotCard: { marginBottom: spacing.md, padding: spacing.lg },
  spotTopRow: { alignItems: 'flex-start', flexDirection: 'row' },
  spotEmojiBox: { alignItems: 'center', borderRadius: 15, height: 52, justifyContent: 'center', marginRight: spacing.md, width: 52 },
  spotEmoji: { fontSize: 27 },
  spotCopy: { flex: 1, paddingRight: spacing.sm },
  spotName: { color: colors.ink, fontSize: type.body, fontWeight: '900', lineHeight: 19 },
  spotCategory: { color: colors.primary, fontSize: type.micro, fontWeight: '700', lineHeight: 16, marginTop: 3 },
  rating: { alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: 10, flexDirection: 'row', paddingHorizontal: 7, paddingVertical: 5 },
  ratingStar: { color: colors.amber, fontSize: 13, marginRight: 3 },
  ratingText: { color: colors.amber, fontSize: type.micro, fontWeight: '900' },
  spotDetailBox: { backgroundColor: colors.canvas, borderRadius: radius.sm, marginTop: spacing.md, padding: spacing.md },
  detailText: { color: colors.ink, fontSize: type.caption, lineHeight: 18 },
  busyText: { color: colors.inkMuted, fontSize: type.micro, marginTop: 5 },
  distanceText: { color: colors.primary, fontSize: type.micro, fontWeight: '800', marginTop: 5 },
  spotButton: { marginTop: spacing.md, minHeight: 44 },
});

