import React from 'react';
import {
  Modal,
  Platform,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, radius } from '../theme';
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
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 768;
  const styles = getStyles(colors, insets, isTablet);

  const content = (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ScrollView
          style={styles.scrollView}
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
          <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
            ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) เราขอแจ้งให้ทราบว่า CampusMate
            จำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของคุณเพื่อให้บริการจับคู่เพื่อนร่วมกิจกรรม
          </Text>

          {/* Data points */}
          <Text style={[styles.sectionLabel, { color: colors.ink }]}>
            ข้อมูลที่เราจะเก็บ:
          </Text>
          <View style={styles.dataGrid}>
            {DATA_POINTS.map((item, idx) => (
              <View key={idx} style={styles.dataItem}>
                <FeatureIcon color={colors.primary} name={item.icon} size={16} />
                <Text style={[styles.dataLabel, { color: colors.ink }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* Rights summary */}
          <Text style={[styles.sectionLabel, { color: colors.ink }]}>
            สิทธิ์ของคุณ:
          </Text>
          <Text style={[styles.rightsText, { color: colors.inkMuted }]}>
            คุณสามารถเข้าถึง แก้ไข ลบข้อมูล หรือถอนความยินยอมได้ตลอดเวลา
            ผ่านเมนูตั้งค่าในแอป
          </Text>

          {/* Policy link */}
          <TouchableOpacity onPress={onViewPolicy} style={styles.policyLink}>
            <FeatureIcon color={colors.primary} name="doc.text.fill" size={14} />
            <Text style={[styles.policyLinkText, { color: colors.primary }]}>
              อ่านนโยบายความเป็นส่วนตัวฉบับเต็ม
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Accept button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={onAccept}
            style={[styles.acceptButton, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={styles.acceptButtonText}>ยอมรับและเริ่มใช้งาน</Text>
          </TouchableOpacity>
          <Text style={[styles.disclaimer, { color: colors.inkSoft }]}>
            การกด "ยอมรับ" หมายความว่าคุณยินยอมให้เราเก็บรวบรวม
            ใช้ และเปิดเผยข้อมูลตามนโยบายความเป็นส่วนตัว
          </Text>
        </View>
      </View>
    </View>
  );

  if (Platform.OS === 'web') {
    if (!visible) return null;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
        {content}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
    >
      {content}
    </Modal>
  );
}

const getStyles = (colors, insets, isTablet) => {
  const safeBottom = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16) + 12;

  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      justifyContent: isTablet ? 'center' : 'flex-end',
      alignItems: isTablet ? 'center' : 'stretch',
      padding: isTablet ? spacing.xl : 0,
    },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderBottomLeftRadius: isTablet ? 28 : 0,
      borderBottomRightRadius: isTablet ? 28 : 0,
      width: '100%',
      maxWidth: isTablet ? 480 : undefined,
      maxHeight: isTablet ? '85%' : '88%',
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
    scrollView: {
      flexGrow: 0,
      flexShrink: 1,
    },
    scrollContent: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.sm,
    },
    headerRow: {
      alignItems: 'center',
      marginBottom: spacing.xs,
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
      marginBottom: spacing.md,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: '800',
      marginBottom: 8,
    },
    dataGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: spacing.md,
    },
    dataItem: {
      alignItems: 'center',
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.line,
      borderRadius: radius.md,
      borderWidth: 1,
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
      marginBottom: spacing.xs,
      paddingVertical: 4,
    },
    policyLinkText: {
      fontSize: 13,
      fontWeight: '700',
    },
    buttonContainer: {
      backgroundColor: colors.card,
      borderTopColor: colors.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingBottom: safeBottom,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
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
      marginTop: 8,
      textAlign: 'center',
    },
  });
};
