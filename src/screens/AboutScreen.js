import Text from '../components/AppText';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import FeatureIcon from '../components/FeatureIcon';
import { LEGAL_CONTACT, LEGAL_LAST_UPDATED } from '../content/legalDocuments';
import { radius, spacing, type, useTheme } from '../theme';

export default function AboutScreen() {
  const { colors } = useTheme();
  const version = `v${Constants.expoConfig?.version || '1.0.0'}`;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.container, { backgroundColor: colors.canvas }]}
    >
      <View style={[styles.brand, { backgroundColor: colors.primarySoft }]}>
        <FeatureIcon color={colors.primary} name="info.circle.fill" size={30} />
        <Text style={[styles.brandTitle, { color: colors.ink }]}>CampusMate</Text>
        <Text style={[styles.version, { color: colors.inkMuted }]}>{version}</Text>
      </View>

      <Text style={[styles.intro, { color: colors.inkMuted }]}>
        CampusMate เป็นพื้นที่หาเพื่อนร่วมกิจกรรมในรั้วมหาวิทยาลัย เราเก็บและใช้ข้อมูลส่วนบุคคลตาม
        พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 และคุณสามารถอ่าน ใช้สิทธิ์ หรือถอนความยินยอมได้จากเอกสารด้านล่าง
      </Text>

      <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <AboutRow icon="lock.shield.fill" label="นโยบายความเป็นส่วนตัว (PDPA)" onPress={() => router.push('/privacy-policy')} colors={colors} />
        <AboutRow icon="hand.raised.fill" label="เงื่อนไขการให้บริการ" onPress={() => router.push('/terms')} colors={colors} />
        <AboutRow icon="checkmark.seal.fill" label="นโยบายชุมชนและความปลอดภัย" onPress={() => router.push('/community-guidelines')} colors={colors} />
        <AboutRow icon="doc.text.fill" label="ข้อกำหนดทางกฎหมาย" onPress={() => router.push('/legal-notice')} colors={colors} last />
      </View>

      <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <Text style={[styles.contactTitle, { color: colors.ink }]}>ติดต่อเรื่องข้อมูลส่วนบุคคล</Text>
        <Text style={[styles.contactCopy, { color: colors.inkMuted }]}>
          ปรับปรุงเอกสารล่าสุด {LEGAL_LAST_UPDATED}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${LEGAL_CONTACT.dpoEmail}`)}>
          <Text style={[styles.contactLink, { color: colors.primary }]}>{LEGAL_CONTACT.dpoEmail}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function AboutRow({ colors, icon, label, onPress, last }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}
    >
      <FeatureIcon color={colors.primary} name={icon} size={18} />
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <FeatureIcon color={colors.inkSoft} name="chevron.right" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 40 },
  brand: { alignItems: 'center', borderRadius: radius.lg, marginBottom: spacing.lg, padding: spacing.xl },
  brandTitle: { fontSize: type.h1, fontWeight: '900', marginTop: spacing.sm },
  version: { fontSize: type.caption, marginTop: 4 },
  intro: { fontSize: 14, lineHeight: 22, marginBottom: spacing.lg },
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: spacing.lg },
  label: { flex: 1, fontSize: type.body, fontWeight: '700', marginHorizontal: spacing.md },
  contactCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  contactTitle: { fontSize: type.body, fontWeight: '800', marginBottom: 6 },
  contactCopy: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  contactLink: { fontSize: 14, fontWeight: '700', marginTop: 4 },
});
