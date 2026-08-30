import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithGoogle } from '../services/authService';
import { getSavedAccounts, removeSavedAccount, saveAccount, enrichSavedAccountsWithFirestore } from '../services/accountStorage';
import { radius, shadow, spacing, type, useTheme } from '../theme';

const loginPhoto = require('../../assets/login-campus-hero.png');

export default function LoginScreen({ onLoginSuccess }) {
  const { colors } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const styles = getStyles(colors);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);

  useEffect(() => {
    getSavedAccounts().then((accounts) => {
      const list = accounts || [];
      setSavedAccounts(list);
      if (list.length > 0) {
        setMode('saved');
        enrichSavedAccountsWithFirestore(list).then((enriched) => {
          if (enriched && enriched.length > 0) {
            setSavedAccounts(enriched);
          }
        });
      } else {
        setMode(Platform.OS === 'web' ? 'google' : 'login');
      }
    });
  }, []);

  const showMode = (nextMode) => {
    setError('');
    setPassword('');
    setConfirmPassword('');
    setMode(nextMode);
  };

  const finishAuthentication = (result) => {
    saveAccount(result.user);
    onLoginSuccess(result.user);
  };

  const handleSelectAccount = (acc) => {
    setSelectedAccount(acc);
    setEmail(acc.email || '');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setMode('login');
  };

  const handleRemoveAccount = async (accId) => {
    const nextList = await removeSavedAccount(accId);
    setSavedAccounts(nextList || []);
    if (!nextList || nextList.length === 0) {
      setSelectedAccount(null);
      setMode('login');
    }
  };

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      finishAuthentication(await signInWithGoogle());
    } catch (loginError) {
      setError(loginError.message || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    if (mode === 'signup') {
      if (!email.trim() || !password || !confirmPassword) {
        setError('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
      }
      if (password.length < 6) {
        setError('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
        return;
      }
      if (password !== confirmPassword) {
        setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
        return;
      }
    } else {
      if (!email.trim() || !password) {
        setError('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
        return;
      }
    }

    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const { signInWithEmail, signUpWithEmail } = require('../services/authService');
      const result = mode === 'signup'
        ? await signUpWithEmail(email.trim(), password)
        : await signInWithEmail(email.trim(), password);
      finishAuthentication(result);
    } catch (loginError) {
      setError(mode === 'signup'
        ? 'สมัครสมาชิกไม่สำเร็จ อีเมลนี้อาจถูกใช้งานแล้ว'
        : 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  };

  const isEmailMode = mode === 'login' || mode === 'signup';

  return (
    <ImageBackground
      source={loginPhoto}
      style={styles.fullBackground}
      imageStyle={styles.fullBackgroundImage}
    >
      <LinearGradient
        colors={['rgba(11,13,20,0.38)', 'rgba(11,13,20,0.68)', 'rgba(11,13,20,0.92)']}
        locations={[0, 0.42, 0.85]}
        style={styles.gradientOverlay}
      >
        <SafeAreaView edges={['top']} style={styles.safeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.container}
          >
            <View style={styles.scrollContent}>
              <View style={styles.contentFrame}>
                <View style={styles.headerSection}>
                  <View style={styles.brandIconCircle}>
                    <SymbolView name="person.2.fill" size={32} tintColor="#FFFFFF" />
                  </View>
                  <Text style={styles.heroTitle}>CampusMate</Text>
                  <Text style={styles.heroSubtitle}>พื้นที่เพื่อนใหม่ในรั้วมหาวิทยาลัย</Text>
                </View>

                <View style={styles.loginPanel}>
                  {error ? (
                    <View accessibilityLiveRegion="polite" style={styles.errorBox}>
                      <SymbolView name="exclamationmark.triangle.fill" size={17} tintColor={colors.danger} />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  {mode === 'saved' && savedAccounts.length > 0 ? (
                    <View style={styles.savedSection}>
                      <View style={styles.savedHeader}>
                        <SymbolView name="person.crop.circle.badge.checkmark" size={16} tintColor={colors.primary} />
                        <Text style={styles.savedTitle}>ลงชื่อเข้าใช้อีกครั้ง</Text>
                      </View>

                      {savedAccounts.map((acc) => (
                        <View key={acc.id || acc.email} style={styles.savedAccountCard}>
                          <View style={[styles.savedAvatar, acc.avatarColor && { backgroundColor: acc.avatarColor }]}>
                            {acc.avatarUri || acc.photoURL ? (
                              <Image
                                source={{ uri: acc.avatarUri || acc.photoURL }}
                                style={styles.savedAvatarImage}
                              />
                            ) : (
                              <SymbolView name="person.fill" size={18} tintColor={colors.primary} />
                            )}
                          </View>
                          <View style={styles.savedInfo}>
                            <Text numberOfLines={1} style={styles.savedName}>
                              {acc.displayName || acc.email}
                            </Text>
                            <Text numberOfLines={1} style={styles.savedEmail}>
                              {acc.faculty ? `${acc.faculty} · ` : ''}{acc.email}
                            </Text>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => handleSelectAccount(acc)}
                            style={({ pressed }) => [styles.quickLoginButton, pressed && styles.pressed]}
                          >
                            <Text numberOfLines={1} style={styles.quickLoginText}>เข้าใช้</Text>
                            <SymbolView name="arrow.right" size={11} tintColor="#FFFFFF" />
                          </Pressable>
                          <Pressable
                            accessibilityLabel="ลบบัญชีนี้"
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={() => handleRemoveAccount(acc.id || acc.email)}
                            style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                          >
                            <SymbolView name="xmark" size={13} tintColor={colors.inkSoft} />
                          </Pressable>
                        </View>
                      ))}

                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setSelectedAccount(null);
                          setEmail('');
                          setPassword('');
                          setConfirmPassword('');
                          setMode('login');
                        }}
                        style={({ pressed }) => [styles.otherAccountButton, pressed && styles.pressed]}
                      >
                        <SymbolView name="person.badge.plus" size={17} tintColor="#111318" />
                        <Text style={styles.otherAccountText}>เข้าสู่ระบบด้วยบัญชีอื่น</Text>
                      </Pressable>
                    </View>
                  ) : isEmailMode ? (
                    <View style={styles.form}>
                      {selectedAccount ? (
                        <View style={styles.selectedAccountNotice}>
                          <SymbolView name="person.crop.circle.fill" size={17} tintColor="#111318" />
                          <Text style={styles.selectedAccountNoticeText}>
                            เข้าสู่ระบบในชื่อ {selectedAccount.displayName || selectedAccount.email}
                          </Text>
                        </View>
                      ) : null}

                      <Text style={styles.inputLabel}>อีเมล</Text>
                      <View style={styles.inputShell}>
                        <SymbolView name="envelope.fill" size={17} tintColor={colors.inkSoft} />
                        <TextInput
                          autoCapitalize="none"
                          autoComplete="email"
                          keyboardType="email-address"
                          onChangeText={setEmail}
                          placeholder="name@university.ac.th"
                          placeholderTextColor={colors.inkSoft}
                          style={styles.input}
                          value={email}
                        />
                      </View>

                      <Text style={styles.inputLabel}>รหัสผ่าน</Text>
                      <View style={styles.inputShell}>
                        <SymbolView name="lock.fill" size={17} tintColor={colors.inkSoft} />
                        <TextInput
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          onChangeText={setPassword}
                          placeholder="อย่างน้อย 6 ตัวอักษร"
                          placeholderTextColor={colors.inkSoft}
                          secureTextEntry
                          style={styles.input}
                          value={password}
                        />
                      </View>

                      {mode === 'signup' ? (
                        <>
                          <Text style={styles.inputLabel}>ยืนยันรหัสผ่าน</Text>
                          <View style={styles.inputShell}>
                            <SymbolView name="lock.shield.fill" size={17} tintColor={colors.inkSoft} />
                            <TextInput
                              autoComplete="new-password"
                              onChangeText={setConfirmPassword}
                              placeholder="กรอกรหัสผ่านอีกครั้ง"
                              placeholderTextColor={colors.inkSoft}
                              secureTextEntry
                              style={styles.input}
                              value={confirmPassword}
                            />
                          </View>
                        </>
                      ) : null}

                      <PrimaryButton
                        label={mode === 'signup' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
                        loading={loading}
                        onPress={handleEmailAuth}
                        styles={styles}
                        symbol={mode === 'signup' ? 'person.badge.plus' : 'arrow.right.circle.fill'}
                      />

                      <Pressable
                        accessibilityRole="button"
                        onPress={() => showMode(savedAccounts.length > 0 ? 'saved' : 'google')}
                        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                      >
                        <SymbolView name="chevron.left" size={13} tintColor="#111318" />
                        <Text style={styles.textButtonLabel}>
                          {savedAccounts.length > 0 ? 'กลับไปเลือกบัญชี' : 'ย้อนกลับ'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <PrimaryButton
                        label="เข้าสู่ระบบด้วย Google"
                        loading={loading}
                        onPress={handleGoogleLogin}
                        styles={styles}
                        symbol="person.badge.key.fill"
                      />

                      <Pressable
                        accessibilityRole="button"
                        onPress={() => showMode('login')}
                        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                      >
                        <SymbolView name="envelope.fill" size={18} tintColor="#111318" />
                        <Text style={styles.secondaryButtonText}>เข้าสู่ระบบด้วยอีเมล</Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        onPress={() => showMode('signup')}
                        style={({ pressed }) => [styles.signupRow, pressed && styles.pressed]}
                      >
                        <Text style={styles.signupHint}>ยังไม่มีบัญชี?</Text>
                        <Text style={styles.signupLink}> สมัครสมาชิก</Text>
                      </Pressable>

                      {savedAccounts.length > 0 ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => showMode('saved')}
                          style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                        >
                          <SymbolView name="person.2.circle" size={16} tintColor="#111318" />
                          <Text style={styles.textButtonLabel}>เลือกจากบัญชีที่บันทึกไว้</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </ImageBackground>
  );
}

function PrimaryButton({ label, loading, onPress, styles, symbol }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.pressed,
        loading && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <SymbolView name={symbol} size={19} tintColor="#FFFFFF" />
      )}
      <Text style={styles.primaryButtonText}>{loading ? 'กำลังดำเนินการ...' : label}</Text>
    </Pressable>
  );
}

const getStyles = (colors) => StyleSheet.create({
  fullBackground: { flex: 1, backgroundColor: '#0B0D14' },
  fullBackgroundImage: { resizeMode: 'cover' },
  gradientOverlay: { flex: 1 },
  safeArea: { flex: 1 },
  container: { flex: 1 },
  scrollContent: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  contentFrame: {
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 340,
    width: '100%',
    flex: 1,
  },
  headerSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  brandIconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 38,
    borderWidth: 1,
    height: 76,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 76,
  },
  heroTitle: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center' },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 15, fontWeight: '500', marginTop: 6, textAlign: 'center' },
  loginPanel: {
    backgroundColor: colors.card,
    borderRadius: 28,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    width: '100%',
    ...shadow.card,
  },
  actions: { gap: spacing.md, marginTop: spacing.sm },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 19, 24, 0.05)',
    borderColor: '#111318',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { color: '#111318', fontSize: type.caption, fontWeight: '800' },
  signupRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', minHeight: 34 },
  signupHint: { color: colors.inkMuted, fontSize: type.caption },
  signupLink: { color: '#111318', fontSize: type.caption, fontWeight: '800' },
  form: { marginTop: spacing.xs },
  inputLabel: { color: colors.ink, fontSize: type.micro, fontWeight: '800', marginBottom: 5 },
  inputShell: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  input: { color: colors.ink, flex: 1, fontSize: type.body, minHeight: 46 },
  textButton: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: spacing.md,
    minHeight: 36,
  },
  textButtonLabel: { color: '#111318', fontSize: type.caption, fontWeight: '800' },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, flex: 1, fontSize: type.caption, fontWeight: '700', lineHeight: 18 },
  savedSection: { gap: spacing.xs },
  savedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  savedTitle: { color: colors.inkMuted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  savedAccountCard: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  savedAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 38,
  },
  savedAvatarImage: {
    borderRadius: 19,
    height: 38,
    width: 38,
  },
  savedInfo: { flex: 1 },
  savedName: { color: colors.ink, fontSize: type.caption, fontWeight: '800' },
  savedEmail: { color: colors.inkMuted, fontSize: type.micro, marginTop: 1 },
  quickLoginButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 3,
    justifyContent: 'center',
    minHeight: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  quickLoginText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  removeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 24,
  },
  otherAccountButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 40,
  },
  otherAccountText: { color: '#111318', fontSize: type.caption, fontWeight: '800' },
  selectedAccountNotice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  selectedAccountNoticeText: { color: colors.ink, fontSize: type.caption, fontWeight: '800' },
  privacyRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  privacyText: { color: colors.inkSoft, flex: 1, fontSize: type.micro, lineHeight: 17 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.65 },
});
