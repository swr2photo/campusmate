import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import AppText from './AppText';
import { useTheme } from '../theme';

export default function PartyFinderEntry() {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
    <View style={styles.heading}><View style={styles.copy}>
      <AppText style={[styles.eyebrow, { color: colors.inkMuted }]}>กิจกรรมกับเพื่อนในมหาวิทยาลัย</AppText>
      <AppText style={[styles.title, { color: colors.ink }]}>หาตี้ใน ม.อ.</AppText>
      <AppText style={[styles.subtitle, { color: colors.inkMuted }]}>เปิดตี้หรือหาเพื่อนไปทำกิจกรรมด้วยกัน</AppText>
    </View><Image source={require('../../assets/mascot/likes-matched.png')} contentFit="contain" style={styles.image} /></View>
    <Pressable accessibilityRole="button" accessibilityLabel="เปิดหน้าหาตี้ใน ม.อ." onPress={() => router.push('/party-finder')} style={({ pressed }) => [styles.button, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}>
      <AppText style={{ color: colors.onPrimary, fontWeight: '600', fontSize: 15 }}>หาตี้</AppText>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ card: { gap: 16, padding: 20, marginVertical: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 }, heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, copy: { flex: 1, minWidth: 170, gap: 6 }, eyebrow: { fontSize: 12, lineHeight: 18 }, title: { fontSize: 22, fontWeight: '700' }, subtitle: { fontSize: 14, lineHeight: 22 }, image: { width: 92, height: 88 }, button: { alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } });
