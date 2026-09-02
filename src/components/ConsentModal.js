import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme, spacing, radius, type } from '../theme';
import FeatureIcon from '../components/FeatureIcon';

const DATA_POINTS = [
  { icon: 'person.fill', label: 'ชื่อ อายุ เพศ คณะ' },
  { icon: 'envelope.fill', label: 'อีเมล' },
  { icon: 'location.fill', label: 'ตำแหน่ง GPS' },
  { icon: 'camera.fill', label: 'รูปโปรไฟล์' },
  { icon: 'bubble.left.fill', label: 'ข้อความแชท' },
  { icon: 'bell.fill', label: 'การแจ้งเตือน' },
];

/**
 * PDPA Consent Modal — shown once when `isNewUser` is true.
 * User must accept before they can use the app.
 */
export default function ConsentModal({ visible, onAccept, onViewPolicy }) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={[styles.iconCircle, { backgroundColor: colors.primarySoft }]}>
                <FeatureIcon color={colors.primary} name="lock.shield.fill" size={28} />
              </View>
            </View>

            <Text style={[styles.title, { color: colors.ink }]}>
              ขอความยินยอมเก็บข้อมูล
            </Text>
            <Text style={[styles.subtitle, { color: colors.subtle }]}>
              ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) เราขอแจ้งให้ทราบว่า CampusMate
              จำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของคุณเพื่อให้บริการจับคู่เพื่อนร่วมกิจกรรม
            </Text>

            {/* Data points */}
            <Text style={[styles.sectionLabel, { color: colors.ink }]}>
              ข้อมูลที่เราจะเก็บ:
            </Text>
            <View style={styles.dataGrid}>
              {DATA_POINTS.map((item, idx) => (
                <View key={idx} style={[styles.dataItem, { backgroundColor: colors.bg }]}>
                  <FeatureIcon color={colors.primary} name={item.icon} size={16} />
                  <Text style={[styles.dataLabel, { color: colors.ink }]}>{item.label}</Text>
                </View>
              ))}
            </View>

            {/* Rights summary */}
            <Text style={[styles.sectionLabel, { color: colors.ink }]}>
              สิทธิ์ของคุณ:
            </Text>
            <Text style={[styles.rightsText, { color: colors.subtle }]}>
              คุณสามารถเข้าถึง แก้ไข ลบข้อมูล หรือถอนความยินยอมได้ตลอดเวลา
              ผ่านเมนูตั้งค่าในแอป
            </Text>

            {/* Policy link */}
            <Pressable onPress={onViewPolicy} style={styles.policyLink}>
              <FeatureIcon color={colors.primary} name="doc.text.fill" size={14} />
              <Text style={[styles.policyLinkText, { color: colors.primary }]}>
                อ่านนโยบายความเป็นส่วนตัวฉบับเต็ม
              </Text>
            </Pressable>
          </ScrollView>

          {/* Accept button */}
          <View style={styles.buttonContainer}>
            <Pressable
              onPress={onAccept}
              style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.acceptButtonText}>ยอมรับและเริ่มใช้งาน</Text>
            </Pressable>
            <Text style={[styles.disclaimer, { color: colors.subtle }]}>
              การกด "ยอมรับ" หมายความว่าคุณยินยอมให้เราเก็บรวบรวม
              ใช้ และเปิดเผยข้อมูลตามนโยบายความเป็นส่วนตัว
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingTop: spacing.lg,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: { elevation: 24 },
    }),
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
  },
  dataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.lg,
  },
  dataItem: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dataLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  rightsText: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  policyLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.sm,
    paddingVertical: 4,
  },
  policyLinkText: {
    fontSize: 13,
    fontWeight: '700',
  },
  buttonContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  acceptButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingVertical: 16,
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    textAlign: 'center',
  },
});
