import Text from './AppText';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { LEGAL_CONTACT, LEGAL_LAST_UPDATED } from '../content/legalDocuments';
import { radius, spacing, type, useTheme } from '../theme';

export default function LegalDocumentView({
  badgeIcon,
  badgeLabel,
  intro,
  sections,
}) {
  const { colors } = useTheme();

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      style={[styles.container, { backgroundColor: colors.canvas }]}
    >
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <FeatureIcon color={colors.primary} name={badgeIcon} size={18} />
        <Text style={[styles.badgeText, { color: colors.primary }]}>
          {badgeLabel || `ปรับปรุงล่าสุด: ${LEGAL_LAST_UPDATED}`}
        </Text>
      </View>

      {intro ? (
        <Text style={[styles.intro, { color: colors.inkMuted }]}>{intro}</Text>
      ) : null}

      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>{section.title}</Text>
          <Text style={[styles.sectionContent, { color: colors.inkMuted }]}>{section.content}</Text>
        </View>
      ))}

      <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <Text style={[styles.contactTitle, { color: colors.ink }]}>ช่องทางติดต่อ</Text>
        <Text style={[styles.contactCopy, { color: colors.inkMuted }]}>
          เรื่องข้อมูลส่วนบุคคล การสนับสนุน และการใช้สิทธิ์ตาม PDPA
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL(`mailto:${LEGAL_CONTACT.dpoEmail}`)}
        >
          <Text style={[styles.contactLink, { color: colors.primary }]}>{LEGAL_CONTACT.dpoEmail}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
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
  contactCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.lg,
  },
  contactTitle: {
    fontSize: type.body,
    fontWeight: '800',
    marginBottom: 6,
  },
  contactCopy: {
    fontSize: 13,
    lineHeight: 20,
  },
  contactLink: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
});
