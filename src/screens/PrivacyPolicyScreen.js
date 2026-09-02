import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, radius, type } from '../theme';
import FeatureIcon from '../components/FeatureIcon';

const LAST_UPDATED = '2 กันยายน 2569';

const SECTIONS = [
  {
    title: '1. ข้อมูลที่เราเก็บรวบรวม',
    content: `CampusMate เก็บรวบรวมข้อมูลส่วนบุคคลดังต่อไปนี้:

• ข้อมูลบัญชี: ชื่อ-นามสกุล, ชื่อเล่น, อีเมล, รหัสผ่าน (เข้ารหัส), เพศ, อายุ
• ข้อมูลการศึกษา: คณะ, ชั้นปี
• ข้อมูลตำแหน่ง: พิกัด GPS (เก็บเฉพาะในพื้นที่ส่วนตัว)
• รูปโปรไฟล์: จัดเก็บบน Cloudflare R2 พร้อมการยืนยันตัวตน
• ข้อมูลการใช้งาน: ข้อความแชท, การจับคู่, กิจกรรมที่สนใจ
• ข้อมูลอุปกรณ์: Push notification token`,
  },
  {
    title: '2. วัตถุประสงค์การเก็บข้อมูล',
    content: `เราใช้ข้อมูลของคุณเพื่อ:

• จับคู่เพื่อนร่วมกิจกรรมในมหาวิทยาลัย
• แสดงโปรไฟล์สาธารณะให้ผู้ใช้คนอื่นเห็น
• คำนวณระยะทางระหว่างผู้ใช้และจุดนัดพบ
• ส่งการแจ้งเตือน (ข้อความ, การจับคู่, คำขอถูกใจ)
• ปรับปรุงประสบการณ์ใช้งานแอปพลิเคชัน`,
  },
  {
    title: '3. การเข้ารหัสและความปลอดภัย',
    content: `ข้อมูลของคุณได้รับการปกป้องด้วย:

• การเข้ารหัสระหว่างส่ง (TLS/HTTPS)
• การเข้ารหัสข้อมูลที่จัดเก็บ (AES-256 โดย Google Cloud)
• การเข้ารหัส offline cache บนอุปกรณ์
• Auth token เก็บใน Keychain (iOS) / EncryptedSharedPreferences (Android)
• การยืนยันตัวตนด้วย Firebase JWT Token`,
  },
  {
    title: '4. การแบ่งปันข้อมูล',
    content: `เราไม่ขายหรือให้เช่าข้อมูลส่วนบุคคลของคุณ ข้อมูลจะถูกแบ่งปันเฉพาะกับ:

• ผู้ใช้คนอื่น: เฉพาะข้อมูลที่คุณเลือกเปิดเผย (โปรไฟล์สาธารณะ)
• Google Firebase: ผู้ให้บริการ backend (มี Data Processing Agreement)
• Cloudflare: ผู้ให้บริการจัดเก็บรูปภาพ (มี Data Processing Agreement)
• Expo: ผู้ให้บริการ push notifications`,
  },
  {
    title: '5. ระยะเวลาจัดเก็บ',
    content: `• ข้อมูลบัญชี: เก็บจนกว่าคุณจะลบบัญชี
• ข้อความแชท: เก็บไม่เกิน 500 ข้อความต่อห้องสนทนา
• Push notification records: ลบอัตโนมัติหลัง 7 วัน
• ข้อมูล offline cache: ลบเมื่อออกจากระบบ`,
  },
  {
    title: '6. สิทธิ์ของคุณตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)',
    content: `คุณมีสิทธิ์ดังนี้:

• สิทธิ์เข้าถึง: ดูข้อมูลที่เราเก็บเกี่ยวกับคุณ (ผ่านหน้าโปรไฟล์)
• สิทธิ์แก้ไข: แก้ไขข้อมูลส่วนตัวได้ตลอดเวลา
• สิทธิ์ลบ: ลบบัญชีและข้อมูลทั้งหมดได้ (ผ่านเมนูตั้งค่า)
• สิทธิ์ถอนความยินยอม: ถอนความยินยอมได้ตลอดเวลา
• สิทธิ์คัดค้าน: คัดค้านการประมวลผลข้อมูลบางประเภท
• สิทธิ์โอนย้าย: ขอสำเนาข้อมูลในรูปแบบที่อ่านได้`,
  },
  {
    title: '7. ข้อมูลติดต่อ',
    content: `เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO):
อีเมล: dpo@campusmate.app

หากมีข้อสงสัยหรือต้องการใช้สิทธิ์ตาม PDPA กรุณาติดต่อเราผ่านอีเมลข้างต้น`,
  },
];

export default function PrivacyPolicyScreen({ onClose }) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>นโยบายความเป็นส่วนตัว</Text>
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
            <FeatureIcon color={colors.ink} name="xmark.circle.fill" size={24} />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
          <FeatureIcon color={colors.primary} name="lock.shield.fill" size={18} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>
            ปรับปรุงล่าสุด: {LAST_UPDATED}
          </Text>
        </View>

        <Text style={[styles.intro, { color: colors.subtle }]}>
          CampusMate ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของคุณตาม
          พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)
        </Text>

        {SECTIONS.map((section, index) => (
          <View key={index} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionContent, { color: colors.subtle }]}>
              {section.content}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    fontSize: type.lg,
    fontWeight: '800',
  },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
    paddingTop: spacing.md,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  intro: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 13,
    lineHeight: 21,
  },
});
