import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { signInWithGoogle } from '../services/authService';
import { colors, radius, shadow, spacing, type } from '../theme';

const BENEFITS = [
  { icon: '✓', title: 'ยืนยันตัวตนปลอดภัย', text: 'เข้าใช้งานด้วยบัญชี Google ของมหาวิทยาลัย' },
  { icon: '✦', title: 'จับคู่ตามความสนใจ', text: 'เลือกกิจกรรม เวลา และทักษะที่ตรงกัน' },
  { icon: '⌖', title: 'นัดหมายในพื้นที่จริง', text: 'เลือกจุดนัดพบยอดนิยมภายในมหาวิทยาลัย' },
];

export default function LoginScreen({ onLoginSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      onLoginSuccess();
    } catch (loginError) {
      setError(loginError.message || 'เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>CM</Text></View>
          <Text style={styles.brandName}>CampusMate</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroOrbOne} />
          <View style={styles.heroOrbTwo} />
          <Text style={styles.heroEmoji}>🤝</Text>
          <Text style={styles.heroTitle}>เพื่อนที่ใช่{`\n`}เริ่มต้นที่ในรั้วมหาวิทยาลัย</Text>
          <Text style={styles.heroText}>
            ค้นหาเพื่อนร่วมวิ่ง เพื่อนติว หรือคนที่อยากทำกิจกรรมแบบเดียวกับคุณ
          </Text>
        </View>

        <View style={styles.benefitList}>
          {BENEFITS.map((benefit) => (
            <View key={benefit.title} style={styles.benefitRow}>
              <View style={styles.benefitIcon}><Text style={styles.benefitIconText}>{benefit.icon}</Text></View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitText}>{benefit.text}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.loginCard}>
          <Text style={styles.loginTitle}>พร้อมเริ่มต้นหรือยัง?</Text>
          <Text style={styles.loginSubtitle}>เข้าใช้งานด้วยบัญชี Google ได้ในขั้นตอนเดียว</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="เข้าสู่ระบบด้วย Google"
            disabled={loading}
            onPress={handleGoogleLogin}
            style={({ pressed }) => [styles.googleButton, pressed && styles.pressed, loading && styles.loadingButton]}
          >
            <View style={styles.googleBadge}><Text style={styles.googleBadgeText}>G</Text></View>
            <Text style={styles.googleButtonText}>{loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย Google'}</Text>
          </Pressable>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <Text style={styles.privacyText}>ข้อมูลโปรไฟล์จะแสดงเฉพาะคนที่จับคู่กับคุณเท่านั้น</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  brandRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.xxxl },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 15,
    height: 42,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 42,
    ...shadow.card,
  },
  brandMarkText: { color: colors.card, fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  brandName: { color: colors.ink, fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: 30,
    marginBottom: spacing.xl,
    minHeight: 274,
    overflow: 'hidden',
    padding: spacing.xxl,
  },
  heroOrbOne: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 120,
    height: 220,
    position: 'absolute',
    right: -80,
    top: -75,
    width: 220,
  },
  heroOrbTwo: {
    backgroundColor: 'rgba(255,181,166,0.28)',
    borderRadius: 100,
    bottom: -55,
    height: 150,
    left: -50,
    position: 'absolute',
    width: 150,
  },
  heroEmoji: { fontSize: 44, marginBottom: spacing.lg },
  heroTitle: { color: colors.card, fontSize: 28, fontWeight: '900', lineHeight: 35 },
  heroText: { color: '#E8E8FF', fontSize: type.body, lineHeight: 21, marginTop: spacing.md },
  benefitList: { marginBottom: spacing.xl, paddingHorizontal: spacing.xs },
  benefitRow: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.lg },
  benefitIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 15,
    height: 42,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 42,
  },
  benefitIconText: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  benefitCopy: { flex: 1 },
  benefitTitle: { color: colors.ink, fontSize: type.body, fontWeight: '800', marginBottom: 2 },
  benefitText: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 18 },
  loginCard: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    ...shadow.card,
  },
  loginTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  loginSubtitle: { color: colors.inkMuted, fontSize: type.caption, marginBottom: spacing.lg, marginTop: 4 },
  googleButton: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  loadingButton: { backgroundColor: '#FAFBFD' },
  googleBadge: {
    alignItems: 'center',
    backgroundColor: '#4285F4',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 24,
  },
  googleBadgeText: { color: colors.card, fontSize: 15, fontWeight: '900' },
  googleButtonText: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  errorText: { color: colors.danger, fontSize: type.caption, marginTop: spacing.sm, textAlign: 'center' },
  privacyText: { color: colors.inkSoft, fontSize: type.micro, lineHeight: 16, marginTop: spacing.md, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});

