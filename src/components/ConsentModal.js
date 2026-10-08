import Text from './AppText';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, TouchableOpacity, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, radius } from '../theme';
import FeatureIcon from './FeatureIcon';
import { useOverlayGate } from '../utils/overlayGate';
import LegalDocumentView from './LegalDocumentView';
import { PRIVACY_INTRO, PRIVACY_SECTIONS, TERMS_INTRO, TERMS_SECTIONS } from '../content/legalDocuments';

const DATA_POINTS = [
  { icon: 'person.fill', label: 'ชื่อ อายุ เพศ คณะ' },
  { icon: 'envelope.fill', label: 'อีเมลบัญชี' },
  { icon: 'location.fill', label: 'ตำแหน่ง (ถ้าอนุญาต)' },
  { icon: 'camera.fill', label: 'รูปและสื่อที่ส่ง' },
  { icon: 'bubble.left.fill', label: 'ข้อความและนัดหมาย' },
  { icon: 'bell.fill', label: 'การแจ้งเตือน' },
];

/**
 * PDPA Consent Modal — shown once when `isNewUser` is true.
 * User must accept before they can use the app.
 */
export default function ConsentModal({ visible, onAccept }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isTablet = windowWidth >= 768;
  const styles = getStyles(colors, insets, isTablet);
  const [documentKey, setDocumentKey] = useState(null);
  // The first-run tour and the Plus upsell wait until consent is done.
  useOverlayGate('consent', visible);

  const document = documentKey === 'terms'
    ? { icon: 'hand.raised.fill', intro: TERMS_INTRO, sections: TERMS_SECTIONS }
    : { icon: 'lock.shield.fill', intro: PRIVACY_INTRO, sections: PRIVACY_SECTIONS };

  const content = (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {documentKey ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDocumentKey(null)}
              style={styles.backRow}
            >
              <FeatureIcon color={colors.primary} name="chevron.left" size={18} />
              <Text style={[styles.backText, { color: colors.primary }]}>กลับไปหน้าความยินยอม</Text>
            </Pressable>
            <View style={styles.documentWrap}>
              <LegalDocumentView
                badgeIcon={document.icon}
                intro={document.intro}
                sections={document.sections}
              />
            </View>
          </>
        ) : (
          <>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primarySoft }]}>
                  <FeatureIcon color={colors.primary} name="lock.shield.fill" size={28} />
                </View>
              </View>

              <Text style={[styles.title, { color: colors.ink }]}>
                ความยินยอมตาม PDPA
              </Text>
              <Text style={[styles.subtitle, { color: colors.inkMuted }]}>
                ผู้ควบคุมข้อมูลคือ CampusMate เราขอความยินยอมเพื่อเก็บ ใช้
                และเปิดเผยข้อมูลส่วนบุคคลเท่าที่จำเป็นต่อการจับคู่เพื่อน แชต นัดหมาย
                การแจ้งเตือน และการรักษาความปลอดภัยของชุมชน ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
              </Text>

              <Text style={[styles.sectionLabel, { color: colors.ink }]}>
                ข้อมูลที่จะประมวลผล
              </Text>
              <View style={styles.dataGrid}>
                {DATA_POINTS.map((item) => (
                  <View key={item.label} style={styles.dataItem}>
                    <FeatureIcon color={colors.primary} name={item.icon} size={16} />
                    <Text style={[styles.dataLabel, { color: colors.ink }]}>{item.label}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: colors.ink }]}>
                ฐานกฎหมายและสิทธิ์ของคุณ
              </Text>
              <Text style={[styles.rightsText, { color: colors.inkMuted }]}>
                ข้อมูลบัญชีและแชตจำเป็นต่อการปฏิบัติตามสัญญาให้บริการ การค้นหาเพื่อน ตำแหน่ง และการแจ้งเตือนอาศัยความยินยอม
                คุณเข้าถึง แก้ไข ลบบัญชี ปิดการค้นหา หรือถอนความยินยอมได้ตลอดเวลาในการตั้งค่า
                การถอนไม่กระทบการประมวลผลที่ได้ทำไปแล้ว ผู้ให้บริการคลาวด์บางรายอาจประมวลผลข้อมูลนอกประเทศไทยเพื่อให้แอปทำงานได้
              </Text>

              <TouchableOpacity onPress={() => setDocumentKey('privacy')} style={styles.policyLink}>
                <FeatureIcon color={colors.primary} name="doc.text.fill" size={14} />
                <Text style={[styles.policyLinkText, { color: colors.primary }]}>
                  อ่านนโยบายความเป็นส่วนตัวฉบับเต็ม
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setDocumentKey('terms')} style={styles.policyLink}>
                <FeatureIcon color={colors.primary} name="hand.raised.fill" size={14} />
                <Text style={[styles.policyLinkText, { color: colors.primary }]}>
                  อ่านเงื่อนไขการให้บริการ
                </Text>
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                onPress={onAccept}
                style={[styles.acceptButton, { backgroundColor: colors.primary }]}
                activeOpacity={0.8}
              >
                <Text style={styles.acceptButtonText}>ยอมรับและเริ่มใช้งาน</Text>
              </TouchableOpacity>
              <Text style={[styles.disclaimer, { color: colors.inkSoft }]}>
                การกดยอมรับ หมายความว่าคุณมีอายุอย่างน้อย 18 ปี และยินยอมให้เก็บ ใช้
                เปิดเผย และโอนข้อมูลตามนโยบายความเป็นส่วนตัว รวมถึงยอมรับเงื่อนไขการให้บริการ
              </Text>
            </View>
          </>
        )}
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
      height: isTablet ? undefined : '88%',
      paddingTop: spacing.lg,
      overflow: 'hidden',
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
    backRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backText: {
      fontSize: 14,
      fontWeight: '700',
    },
    documentWrap: {
      flex: 1,
      minHeight: 280,
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
