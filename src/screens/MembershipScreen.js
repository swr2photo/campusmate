import Text from '../components/AppText';
import React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMembership } from '../context/MembershipContext';
import { useMembershipPackageAutoload } from '../hooks/useMembershipPackages';
import FeatureIcon from '../components/FeatureIcon';
import { useTheme } from '../theme';
import { PLUS_BENEFITS } from '../data/plans';
// Plan copy and the feature matrix live together in src/data/plans.js.
const benefits = PLUS_BENEFITS.map(({ icon, label }) => [icon, label]);

export default function MembershipScreen() {
  const { colors } = useTheme();
  const membership = useMembership();
  const { offline } = useMembershipPackageAutoload();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content}>
    <View style={[styles.hero, { backgroundColor: colors.primarySoft }]}>
      <FeatureIcon name="sparkles" size={40} color={colors.primary} />
      <Text style={[styles.title, { color: colors.ink }]}>CampusMate Plus</Text>
      <Text style={{ color: colors.inkMuted }}>{membership.plus ? 'สมาชิก Plus ของคุณเปิดใช้งานแล้ว' : 'เลือกเพื่อนและกิจกรรมได้ตรงใจยิ่งขึ้น'}</Text>
    </View>
    <View style={[styles.benefits, { backgroundColor: colors.card }]}>{benefits.map(([icon, text]) => <View key={text} style={styles.row}>
      <FeatureIcon name={icon} size={21} color={colors.primary} /><Text style={[styles.copy, { color: colors.ink }]}>{text}</Text>
    </View>)}</View>
    {membership.plus ? <>
      <Text style={{ color: colors.inkMuted }}>สิทธิ์สมาชิกถึง {new Date(membership.activeUntil).toLocaleDateString('th-TH')}</Text>
      {membership.managementUrl ? <Action colors={colors} label="จัดการสมาชิกในสโตร์" onPress={() => void Linking.openURL(membership.managementUrl).catch(() => {})} /> : null}
    </> : !membership.configured ? <Text style={{ color: colors.inkMuted }}>ระบบสมัครสมาชิกยังไม่เปิดให้ใช้งาน</Text>
      : membership.busy ? <ActivityIndicator color={colors.primary} />
      : membership.ready && membership.packages.length ? membership.packages.map((entry) => <Action key={entry.identifier} colors={colors} disabled={membership.busy}
        label={`${entry.packageType === 'ANNUAL' ? 'รายปี' : 'รายเดือน'} · ${entry.product.priceString}`}
        onPress={() => void membership.purchase(entry).catch(() => {})} />)
      : <PackagesLoading colors={colors} offline={offline} />}
    {membership.error ? <Text accessibilityRole="alert" style={{ color: colors.red || colors.ink }}>{membership.error}</Text> : null}
    {membership.configured ? <View style={styles.row}>
      <Action colors={colors} disabled={membership.busy} label="คืนค่าการซื้อ" onPress={() => void membership.restore().catch(() => {})} />
    </View> : null}
    <Text style={{ color: colors.inkMuted, lineHeight: 21 }}>สมาชิกต่ออายุอัตโนมัติ ยกเลิกได้ใน Google Play หรือ App Store การยกเลิกยังใช้สิทธิ์ได้ถึงวันสิ้นสุดรอบที่ชำระแล้ว</Text>
    <View style={styles.row}><Action colors={colors} label="เงื่อนไขการใช้งาน" onPress={() => router.push('/terms')} /><Action colors={colors} label="ความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} /></View>
  </ScrollView>;
}
// Shown until the store answers; loading retries on its own, so there is nothing to tap.
function PackagesLoading({ colors, offline }) {
  const label = offline ? 'รอการเชื่อมต่ออินเทอร์เน็ต…' : 'กำลังโหลดแพ็กเกจ…';
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
    <View style={[styles.skeleton, { backgroundColor: colors.primarySoft }]} />
    <View style={[styles.skeleton, { backgroundColor: colors.primarySoft }]} />
    <View style={styles.row}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={{ color: colors.inkMuted }}>{label}</Text>
    </View>
  </View>;
}
function Action({ colors, label, onPress, disabled }) {
  return <Pressable disabled={disabled} accessibilityRole="button" onPress={onPress} style={[styles.button, { backgroundColor: colors.primarySoft, opacity: disabled ? 0.5 : 1 }]}>
    <Text style={{ color: colors.primary, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ content: { padding: 24, paddingBottom: 48, gap: 18 }, hero: { padding: 24, borderRadius: 24, alignItems: 'center', gap: 12 },
  title: { fontSize: 27, fontWeight: '800' }, benefits: { padding: 20, borderRadius: 20, gap: 18 }, row: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  copy: { flex: 1, fontSize: 15, lineHeight: 22 }, button: { padding: 16, borderRadius: 16 },
  loading: { gap: 12 }, skeleton: { height: 52, borderRadius: 16, opacity: 0.6 } });
