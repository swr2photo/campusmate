import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import AppText from './AppText';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

export default function PartyFinderEntry() {
  const { colors, isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  // ขนาดรูปการ์ตูนเทียบกับความกว้างหน้าจอ (ขนาดสัมพันธ์กับจอ สวยงาม ไม่เล็กหรือใหญ่เกินไป)
  const cartoonWidth = Math.min(Math.max(Math.round(windowWidth * 0.24), 80), 105);
  const cartoonHeight = Math.round(cartoonWidth * (1024 / 1536));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="เปิดหน้าหาตี้ใน ม.อ."
      onPress={() => router.push('/party-finder')}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.card,
          {
            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.75)',
            backgroundColor: isDark ? 'rgba(28, 32, 42, 0.72)' : 'rgba(242, 246, 253, 0.78)',
          },
        ]}
      >
        <BlurView
          intensity={isDark ? 40 : 55}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />

        {/* ตกแต่งแสงเรืองระเรื่อให้มิติสวยคมชัด */}
        <View
          style={[
            styles.glowAccent,
            { backgroundColor: colors.primary, opacity: isDark ? 0.08 : 0.06 },
          ]}
        />

        <View style={styles.innerRow}>
          {/* คอลัมน์ซ้าย: ข้อความกระชับ ชัดเจน ไม่รก */}
          <View style={styles.copyCol}>
            <View style={styles.headerGroup}>
              <AppText style={[styles.eyebrow, { color: colors.primary }]}>
                ไปด้วยกัน สนุกกว่า
              </AppText>
              <AppText numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
                หาตี้ใน ม.อ.
              </AppText>
              <AppText numberOfLines={1} style={[styles.subtitle, { color: colors.inkMuted }]}>
                หาเพื่อนกินข้าว กีฬา หรือเปิดตี้เอง
              </AppText>
            </View>

            <View style={[styles.actionBtn, { backgroundColor: colors.primary }]}>
              <AppText style={[styles.actionText, { color: colors.onPrimary }]}>
                ดูตี้และสร้างตี้
              </AppText>
              <FeatureIcon name="arrow.right" color={colors.onPrimary} size={13} />
            </View>
          </View>

          {/* คอลัมน์ขวา: การ์ตูนเทียบขนาดหน้าจอ */}
          <View style={[styles.mascotWrap, { width: cartoonWidth, height: cartoonHeight }]}>
            <Image
              source={require('../../assets/mascot/likes-matched.png')}
              contentFit="contain"
              style={{ width: cartoonWidth, height: cartoonHeight }}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    width: '94%',
    maxWidth: 342,
    marginVertical: 4,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1.2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  glowAccent: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  copyCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
    gap: 9,
  },
  headerGroup: {
    gap: 2,
  },
  eyebrow: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 17.5,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  actionBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 5.5,
    borderRadius: 12,
    gap: 5,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  mascotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
