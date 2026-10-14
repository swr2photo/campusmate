import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import AppText from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

// Activity hints shown as glyphs on the banner — a glance at what parties are for.
const ACTIVITY_HINTS = [
  { icon: 'fork.knife', label: 'กินข้าว' },
  { icon: 'sportscourt.fill', label: 'กีฬา' },
  { icon: 'book.closed.fill', label: 'ติว' },
  { icon: 'cup.and.saucer.fill', label: 'คาเฟ่' },
];

export function partyBannerGradient(isDark) {
  return isDark ? ['#24508F', '#142B4F'] : ['#3A7EE0', '#1F56A8'];
}

// Content-layer hero (HIG: Liquid Glass stays on controls, so this uses a solid
// gradient surface with capsule buttons instead of glass).
export default function PartyFinderEntry({ onCreateParty }) {
  const { isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const mascotWidth = Math.min(Math.max(Math.round(windowWidth * 0.34), 112), 150);
  const mascotHeight = Math.round(mascotWidth * (1024 / 1536));
  const openFinder = () => router.push('/party-finder');

  return (
    <Pressable
      accessibilityHint="เปิดหน้ารวมตี้กิจกรรม"
      accessibilityLabel="หาตี้ใน ม.อ."
      accessibilityRole="button"
      onPress={openFinder}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={partyBannerGradient(isDark)}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.card}
      >
        <View pointerEvents="none" style={[styles.orb, styles.orbLarge]} />
        <View pointerEvents="none" style={[styles.orb, styles.orbSmall]} />

        <View style={styles.topRow}>
          <View style={styles.copy}>
            <View style={styles.eyebrowPill}>
              <View style={styles.liveDot} />
              <AppText style={styles.eyebrowText}>ตี้กิจกรรมรอบ ม.อ.</AppText>
            </View>
            <AppText style={styles.title}>หาตี้ใน ม.อ.</AppText>
            <AppText style={styles.subtitle}>ชวนเพื่อนไปด้วยกัน หรือเปิดตี้ของคุณเอง</AppText>
          </View>
          <Image
            accessibilityIgnoresInvertColors
            contentFit="contain"
            source={require('../../assets/mascot/likes-matched.png')}
            style={[styles.mascot, { width: mascotWidth, height: mascotHeight }]}
          />
        </View>

        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.hintRow}>
          {ACTIVITY_HINTS.map((hint) => (
            <View key={hint.label} style={styles.hintChip}>
              <FeatureIcon color="#FFFFFF" name={hint.icon} size={13} />
              <AppText style={styles.hintText}>{hint.label}</AppText>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityLabel="ดูตี้ที่เปิดรับ"
            accessibilityRole="button"
            onPress={openFinder}
            style={({ pressed }) => [styles.primaryAction, pressed && styles.actionPressed]}
          >
            <AppText style={styles.primaryActionText}>ดูตี้ที่เปิดรับ</AppText>
            <FeatureIcon color="#1F56A8" name="arrow.right" size={14} />
          </Pressable>
          {onCreateParty ? (
            <Pressable
              accessibilityLabel="เปิดตี้ใหม่"
              accessibilityRole="button"
              onPress={onCreateParty}
              style={({ pressed }) => [styles.secondaryAction, pressed && styles.actionPressed]}
            >
              <FeatureIcon color="#FFFFFF" name="plus" size={14} />
              <AppText style={styles.secondaryActionText}>เปิดตี้</AppText>
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  pressed: { opacity: 0.94, transform: [{ scale: 0.99 }] },
  card: {
    borderRadius: 26,
    borderCurve: 'continuous',
    gap: 14,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  orb: { backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 999, position: 'absolute' },
  orbLarge: { height: 190, right: -50, top: -70, width: 190 },
  orbSmall: { bottom: -40, height: 110, left: -30, width: 110 },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  copy: { flex: 1, gap: 6, minWidth: 0 },
  eyebrowPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveDot: { backgroundColor: '#5BE3AE', borderRadius: 4, height: 7, width: 7 },
  eyebrowText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.4, lineHeight: 34 },
  subtitle: { color: 'rgba(255,255,255,0.86)', fontSize: 14, lineHeight: 20 },
  mascot: { marginRight: -6 },
  hintRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hintChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  hintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryActionText: { color: '#1F56A8', fontSize: 15, fontWeight: '800' },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 18,
  },
  secondaryActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  actionPressed: { opacity: 0.8 },
});
