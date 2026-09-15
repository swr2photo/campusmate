import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, type, useTheme } from '../theme';

const SECTIONS = [
  ['การใช้บริการ', 'CampusMate ให้บริการเชื่อมต่อผู้ใช้เพื่อค้นหาเพื่อนร่วมกิจกรรมในมหาวิทยาลัย การใช้งานต้องเป็นไปตามกฎหมายที่เกี่ยวข้องและไม่ละเมิดสิทธิของผู้อื่น'],
  ['ความรับผิดชอบของผู้ใช้', 'ผู้ใช้ต้องให้ข้อมูลที่ถูกต้อง รักษาความปลอดภัยของบัญชี และรับผิดชอบต่อเนื้อหาหรือการกระทำของตนเองบนแพลตฟอร์ม'],
  ['ทรัพย์สินทางปัญญา', 'ชื่อ CampusMate เครื่องหมาย โลโก้ ซอฟต์แวร์ และเนื้อหาของแอปเป็นทรัพย์สินของผู้พัฒนา ห้ามคัดลอก ดัดแปลง หรือใช้งานโดยไม่ได้รับอนุญาต'],
  ['ข้อจำกัดความรับผิด', 'บริการอาจมีการหยุดชะงักหรือปรับปรุงเป็นระยะ CampusMate ไม่รับรองความสัมพันธ์ ตัวตน หรือความปลอดภัยจากการติดต่อระหว่างผู้ใช้ โปรดใช้วิจารณญาณและนัดพบในสถานที่สาธารณะ'],
  ['การติดต่อและการปรับปรุง', 'หากพบเนื้อหาที่ผิดกฎหมายหรือไม่เหมาะสม กรุณารายงานให้ทีมงานทราบ เราอาจปรับปรุงข้อกำหนดนี้เพื่อให้สอดคล้องกับกฎหมายและการใช้งาน โดยจะแสดงฉบับล่าสุดภายในแอป'],
];

export default function LegalNoticeScreen({ onClose }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>ข้อกำหนดทางกฎหมาย</Text>
        {onClose ? <Pressable onPress={onClose} style={styles.closeButton}><FeatureIcon color={colors.ink} name="xmark.circle.fill" size={24} /></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
          <FeatureIcon color={colors.primary} name="doc.text.fill" size={18} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>เกี่ยวกับ {Constants.expoConfig?.name || 'CampusMate'}</Text>
        </View>
        {SECTIONS.map(([title, content]) => (
          <View key={title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
            <Text style={[styles.sectionContent, { color: colors.subtle }]}>{content}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { fontSize: type.lg, fontWeight: '800' },
  closeButton: { position: 'absolute', right: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: 40 },
  badge: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: radius.pill, flexDirection: 'row', gap: 6, marginBottom: spacing.lg, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
  sectionContent: { fontSize: 13, lineHeight: 21 },
});
