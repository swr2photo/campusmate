import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, type, useTheme } from '../theme';

const SECTIONS = [
  ['1. การใช้งานบริการ', 'CampusMate เป็นพื้นที่สำหรับค้นหาเพื่อนร่วมกิจกรรมในมหาวิทยาลัย ผู้ใช้ต้องให้ข้อมูลที่ถูกต้องและใช้งานแอปด้วยความสุภาพ ไม่แอบอ้างตัวตนหรือใช้บริการเพื่อรบกวนผู้อื่น'],
  ['2. ความปลอดภัยและการเคารพผู้อื่น', 'ห้ามส่งเนื้อหาที่คุกคาม หลอกลวง ล่วงละเมิด แสดงความเกลียดชัง หรือผิดกฎหมาย หากพบพฤติกรรมไม่เหมาะสม กรุณาหยุดการสนทนาและรายงานให้ทีมงานทราบ'],
  ['3. บัญชีและเนื้อหาของผู้ใช้', 'คุณรับผิดชอบต่อบัญชีและข้อมูลที่ส่งผ่านแอป รวมถึงต้องรักษาข้อมูลเข้าสู่ระบบของตนเอง เราอาจจำกัดหรือระงับบัญชีที่ฝ่าฝืนข้อตกลงเพื่อความปลอดภัยของชุมชน'],
  ['4. การนัดพบ', 'ควรนัดพบในสถานที่สาธารณะ แจ้งคนใกล้ตัว และใช้วิจารณญาณของตนเอง CampusMate ไม่รับรองตัวตนหรือความปลอดภัยของผู้ใช้รายอื่น'],
  ['5. การยอมรับข้อตกลง', 'การใช้งาน CampusMate ต่อไปถือว่าคุณยอมรับข้อตกลงนี้และนโยบายความเป็นส่วนตัว หากมีการปรับปรุงข้อตกลง เราจะแสดงเวอร์ชันล่าสุดภายในแอป'],
];

export default function TermsOfServiceScreen({ onClose }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>ข้อตกลงการใช้งาน</Text>
        {onClose ? <Pressable onPress={onClose} style={styles.closeButton}><FeatureIcon color={colors.ink} name="xmark.circle.fill" size={24} /></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
          <FeatureIcon color={colors.primary} name="hand.raised.fill" size={18} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>ข้อตกลงและแนวทางชุมชน</Text>
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
