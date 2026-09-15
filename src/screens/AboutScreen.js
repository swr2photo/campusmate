import React from 'react';
import Constants from 'expo-constants';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeatureIcon from '../components/FeatureIcon';
import { radius, spacing, type, useTheme } from '../theme';

export default function AboutScreen() {
  const { colors } = useTheme();
  const version = `v${Constants.expoConfig?.version || '1.0.0'}`;
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <Pressable onPress={() => router.back()} style={styles.headerButton}><FeatureIcon color={colors.ink} name="chevron.left" size={24} /></Pressable>
        <Text style={[styles.title, { color: colors.ink }]}>เกี่ยวกับ CampusMate</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.brand, { backgroundColor: colors.primarySoft }]}>
          <FeatureIcon color={colors.primary} name="info.circle.fill" size={30} />
          <Text style={[styles.brandTitle, { color: colors.ink }]}>CampusMate</Text>
          <Text style={[styles.version, { color: colors.inkMuted }]}>{version}</Text>
        </View>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <AboutRow icon="doc.text.fill" label="ข้อกำหนดทางกฎหมาย" onPress={() => router.push('/legal-notice')} colors={colors} />
          <AboutRow icon="hand.raised.fill" label="เงื่อนไขการให้บริการ" onPress={() => router.push('/terms')} colors={colors} />
          <AboutRow icon="lock.shield.fill" label="นโยบายความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} colors={colors} last />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AboutRow({ colors, icon, label, onPress, last }) {
  return <Pressable onPress={onPress} style={[styles.row, !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
    <FeatureIcon color={colors.primary} name={icon} size={18} />
    <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
    <FeatureIcon color={colors.inkSoft} name="chevron.right" size={18} />
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  headerButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  title: { fontSize: type.lg, fontWeight: '900' },
  content: { padding: spacing.lg },
  brand: { alignItems: 'center', borderRadius: radius.lg, marginBottom: spacing.lg, padding: spacing.xl },
  brandTitle: { fontSize: type.h1, fontWeight: '900', marginTop: spacing.sm },
  version: { fontSize: type.caption, marginTop: 4 },
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: spacing.lg },
  label: { flex: 1, fontSize: type.body, fontWeight: '700', marginHorizontal: spacing.md },
});
