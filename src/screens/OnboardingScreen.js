import Text from '../components/AppText';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Asset } from 'expo-asset';
import Image from '../components/CachedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

const pages = [
  {
    image: require('../../assets/onboarding/online-friends.png'),
    eyebrow: 'เพื่อนใหม่อยู่ใกล้กว่าที่คิด',
    title: 'เจอคนที่คุยกันรู้เรื่อง',
    description: 'ค้นหาเพื่อนในรั้วมหาวิทยาลัยจากความสนใจและไลฟ์สไตล์ที่ตรงกัน',
  },
  {
    image: require('../../assets/onboarding/calendar.png'),
    eyebrow: 'ชวนกันออกไปใช้ชีวิต',
    title: 'นัดทำกิจกรรมสนุก ๆ',
    description: 'หาเพื่อนไปกินข้าว อ่านหนังสือ หรือร่วมกิจกรรมที่ชอบได้ง่ายขึ้น',
  },
  {
    image: require('../../assets/onboarding/chat.png'),
    eyebrow: 'เริ่มต้นมิตรภาพดี ๆ',
    title: 'ทักแชต แล้วรู้จักกัน',
    description: 'พูดคุยกับเพื่อนใหม่ในพื้นที่ที่เป็นกันเอง พร้อมเริ่มเรื่องราวของคุณ',
  },
];

export default function OnboardingScreen({ onComplete }) {
  const { colors } = useTheme();
  const { height, width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { void Asset.loadAsync(pages.map((item) => item.image)).catch(() => {}); }, []);
  useEffect(() => { setImageError(false); }, [page]);
  const current = pages[page];
  const compact = height < 700;
  const finish = () => { void onComplete(); };
  const next = () => page === pages.length - 1 ? finish() : setPage(page + 1);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="ข้ามหน้าแนะนำ" onPress={finish} hitSlop={12} style={styles.skipButton}>
          <Text style={[styles.skipText, { color: colors.inkMuted }]}>ข้าม</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={[styles.artArea, compact && styles.artAreaCompact]}>
          <View style={[styles.artBlob, { backgroundColor: colors.primarySoft }]} />
          <View style={[styles.artBubble, { backgroundColor: colors.blueSoft }]} />
          <Image key={`${page}:${retry}`} source={current.image} contentFit="contain" priority="high"
            style={[styles.illustration, { width: Math.min(width - 64, 380), height: compact ? 210 : 300 }]}
            onLoad={() => setImageError(false)} onError={() => setImageError(true)}
            accessibilityLabel={`ภาพประกอบ ${current.title}`} />
          {imageError ? <Pressable accessibilityRole="button" onPress={() => { setImageError(false); setRetry((value) => value + 1); }}
            style={styles.retry}><Text style={{ color: colors.primary }}>โหลดภาพไม่สำเร็จ · ลองอีกครั้ง</Text></Pressable> : null}
        </View>
        <View style={styles.copy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>{current.eyebrow}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{current.title}</Text>
          <Text style={[styles.description, { color: colors.inkMuted }]}>{current.description}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityLabel={`หน้า ${page + 1} จาก ${pages.length}`}>
          {pages.map((_, index) => (
            <View key={index} style={[styles.dot, { backgroundColor: index === page ? colors.primary : colors.line }, index === page && styles.activeDot]} />
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={next} style={[styles.nextButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.nextText, { color: colors.onPrimary }]}>{page === pages.length - 1 ? 'เริ่มใช้งาน' : 'ถัดไป'}</Text>
          <Text style={[styles.arrow, { color: colors.onPrimary }]}>›</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 60, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  skipButton: { paddingVertical: 8, paddingHorizontal: 4 },
  skipText: { fontSize: 15, fontWeight: '600' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  artArea: { height: '50%', minHeight: 210, maxHeight: 340, alignItems: 'center', justifyContent: 'center' },
  artAreaCompact: { minHeight: 180, maxHeight: 260 },
  artBlob: { position: 'absolute', width: '82%', height: '72%', borderRadius: 1000, transform: [{ rotate: '-12deg' }] },
  artBubble: { position: 'absolute', width: 34, height: 34, borderRadius: 17, right: 14, top: 16 },
  illustration: { zIndex: 1 },
  retry: { position: 'absolute', bottom: 0, padding: 12, zIndex: 2 },
  copy: { alignItems: 'center', gap: 7, paddingTop: 8 },
  eyebrow: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  title: { fontSize: 26, lineHeight: 34, textAlign: 'center', fontWeight: '900' },
  description: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300 },
  footer: { paddingHorizontal: 28, paddingBottom: 12, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center', height: 30, marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 8 },
  activeDot: { width: 27 },
  nextButton: { width: '100%', height: 58, borderRadius: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  nextText: { fontSize: 18, fontWeight: '800' },
  arrow: { fontSize: 29, lineHeight: 30, marginTop: -3 },
});
