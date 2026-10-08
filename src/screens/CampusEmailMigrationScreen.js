import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppAlert from '../components/AppAlert';
import FeatureIcon from '../components/FeatureIcon';
import { OutlineButton, PrimaryButton } from '../components/ui';
import { useAppActions } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import {
  CAMPUS_EMAIL_PLACEHOLDER,
  getCampusEmailErrorMessage,
  isCampusEmail,
  isCampusStudentEmail,
} from '../utils/campusEmail';
import {
  reloadCampusEmailStatus,
  requestCampusEmailChange,
} from '../services/authService';
import { radius, shadow, spacing, type, useTheme } from '../theme';

const PENDING_EMAIL_KEY = 'campusmate.pendingCampusEmail';
const appIcon = require('../../assets/icon.png');

export default function CampusEmailMigrationScreen() {
  const { colors, isDark } = useTheme();
  const { login, logout } = useAuth();
  const { saveProfile } = useAppActions();
  const [email, setEmail] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [alertState, setAlertState] = useState(null);
  const completeMigrationRef = useRef(null);

  const completeMigration = useCallback(async (nextUser) => {
    if (!isCampusEmail(nextUser?.email)) return false;
    await login(nextUser);
    await AsyncStorage.removeItem(PENDING_EMAIL_KEY).catch(() => {});
    try {
      await saveProfile({
        email: nextUser.email,
        campusEmail: nextUser.email,
      });
    } catch (error) {
      console.warn('[CampusEmailMigration] Profile email update failed:', error?.message || error);
    }
    return true;
  }, [login, saveProfile]);

  completeMigrationRef.current = completeMigration;

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PENDING_EMAIL_KEY).then((stored) => {
      if (cancelled || !stored) return;
      setPendingEmail(stored);
      setEmail(stored);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pendingEmail) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const nextUser = await reloadCampusEmailStatus();
        if (!cancelled) await completeMigrationRef.current?.(nextUser);
      } catch (_) {}
    };
    const intervalId = setInterval(tick, 4000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick();
    });
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [pendingEmail]);

  const checkVerification = async () => {
    if (checking || loading) return;
    setEmailError('');
    setChecking(true);
    try {
      const nextUser = await reloadCampusEmailStatus();
      if (await completeMigration(nextUser)) return;
      setEmailError('ยังไม่พบการยืนยัน เปิดลิงก์ในอีเมลแล้วลองอีกครั้ง');
    } catch (error) {
      setEmailError(getCampusEmailErrorMessage(error) || error?.message || 'ตรวจสอบไม่สำเร็จ ลองใหม่');
    } finally {
      setChecking(false);
    }
  };

  const handleSend = async () => {
    if (loading) return;
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setEmailError('กรอกอีเมล @psu.ac.th');
      return;
    }
    if (!isCampusStudentEmail(cleanEmail)) {
      setEmailError('ใช้อีเมลที่ขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th');
      return;
    }
    setEmailError('');
    setLoading(true);
    try {
      const result = await requestCampusEmailChange(cleanEmail);
      if (result.alreadyCampus) {
        await completeMigration(result.user);
        return;
      }
      const nextEmail = result.email;
      setPendingEmail(nextEmail);
      setEmail(nextEmail);
      await AsyncStorage.setItem(PENDING_EMAIL_KEY, nextEmail).catch(() => {});
      setAlertState({
        title: 'ส่งลิงก์แล้ว',
        message: 'ส่งลิงก์ยืนยันไปที่ ' + nextEmail + ' แล้ว',
      });
    } catch (error) {
      setEmailError(
        getCampusEmailErrorMessage(error) || error?.message || 'ส่งลิงก์ไม่สำเร็จ ลองใหม่'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.line, backgroundColor: colors.card }]}>
        <View style={styles.brandMark}>
          <Image
            accessibilityLabel="โลโก้ CampusMate"
            source={appIcon}
            style={styles.brandIcon}
          />
        </View>
        <View style={styles.brandCopy}>
          <Text style={[styles.brandName, { color: colors.ink }]}>CampusMate</Text>
          <Text style={[styles.brandMeta, { color: colors.inkMuted }]}>ยืนยันบัญชี</Text>
        </View>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: colors.ink }]}>ยืนยันอีเมล</Text>
          <Text style={[styles.copy, { color: colors.inkMuted }]}>
            ใช้อีเมล @psu.ac.th เพื่อยืนยันบัญชี
          </Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
            <View style={styles.cardHeader}>
              <FeatureIcon color={colors.inkMuted} name="envelope.fill" size={16} />
              <Text style={[styles.cardKicker, { color: colors.inkMuted }]}>อีเมลยืนยัน</Text>
            </View>
            <Text style={[styles.cardCopy, { color: colors.inkMuted }]}>
              ลิงก์จะส่งไปที่อีเมลนี้
            </Text>

            <Text style={[styles.label, { color: colors.ink }]}>อีเมล @psu.ac.th</Text>
            <View
              style={[
                styles.inputShell,
                {
                  backgroundColor: colors.canvas,
                  borderColor: emailError ? colors.danger : colors.line,
                },
                emailError && styles.inputShellError,
              ]}
            >
              <FeatureIcon color={colors.inkSoft} name="envelope.fill" size={17} />
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                cursorColor={colors.primary}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                keyboardType="email-address"
                onChangeText={(value) => {
                  setEmail(value);
                  if (emailError) setEmailError('');
                }}
                placeholder={CAMPUS_EMAIL_PLACEHOLDER}
                placeholderTextColor={colors.inkSoft}
                spellCheck={false}
                style={[styles.input, { color: colors.ink }]}
                value={email}
              />
            </View>
            {emailError ? (
              <Text accessibilityRole="alert" style={[styles.fieldError, { color: colors.danger }]}>
                {emailError}
              </Text>
            ) : null}

            {pendingEmail ? (
              <View style={styles.steps}>
                <StepRow colors={colors} done label={`ส่งลิงก์แล้ว: ${pendingEmail}`} />
                <StepRow colors={colors} label="เปิดลิงก์ในอีเมล" />
                <StepRow colors={colors} label="กลับมากดยืนยัน" />
              </View>
            ) : null}

            <PrimaryButton
              label={pendingEmail ? 'ส่งอีกครั้ง' : 'ส่งลิงก์'}
              loading={loading}
              onPress={handleSend}
            />
            {pendingEmail ? (
              <PrimaryButton
                label="ยืนยันแล้ว"
                loading={checking}
                onPress={checkVerification}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
            {pendingEmail ? (
              <OutlineButton
                label="เปิด Outlook"
                onPress={() => Linking.openURL('https://outlook.office.com/mail/')}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
          </View>

          <OutlineButton
            label="ออกจากระบบ"
            onPress={() => logout()}
            style={{ marginTop: spacing.md }}
          />
          <Text style={[styles.footer, { color: colors.inkSoft }]}>
            ลิงก์ใช้ได้ครั้งเดียว
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <AppAlert
        message={alertState?.message}
        onClose={() => setAlertState(null)}
        title={alertState?.title}
        visible={Boolean(alertState)}
      />
    </SafeAreaView>
  );
}

function StepRow({ colors, done = false, label }) {
  return (
    <View style={styles.stepRow}>
      <View
        style={[
          styles.stepDot,
          {
            borderColor: done ? colors.primary : colors.line,
            backgroundColor: done ? colors.primary : 'transparent',
          },
        ]}
      >
        {done ? <FeatureIcon color={colors.onPrimary} name="checkmark" size={10} /> : null}
      </View>
      <Text style={[styles.stepLabel, { color: done ? colors.ink : colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brandMark: {
    borderRadius: 11,
    height: 44,
    overflow: 'hidden',
    width: 44,
  },
  brandIcon: {
    height: 72,
    marginLeft: -14,
    marginTop: -14,
    width: 72,
  },
  brandCopy: { flex: 1 },
  brandName: {
    fontSize: type.bodySmall,
    fontWeight: '700',
  },
  brandMeta: {
    fontSize: type.caption2,
    marginTop: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  title: {
    fontSize: type.h2,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  copy: {
    fontSize: type.bodySmall,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardKicker: {
    fontSize: type.caption2,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  cardCopy: {
    fontSize: type.caption,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: type.micro,
    fontWeight: '700',
    marginBottom: 6,
  },
  inputShell: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  inputShellError: {
    borderWidth: 1.5,
  },
  input: {
    flex: 1,
    fontSize: type.body,
    minHeight: 46,
  },
  fieldError: {
    fontSize: type.caption2,
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: spacing.md,
    marginTop: -spacing.sm,
  },
  steps: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stepRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepDot: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  stepLabel: {
    flex: 1,
    fontSize: type.caption,
    lineHeight: 18,
  },
  footer: {
    fontSize: type.caption2,
    lineHeight: 18,
    marginTop: spacing.lg,
  },
});
