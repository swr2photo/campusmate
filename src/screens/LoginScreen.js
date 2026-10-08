import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, NativeModules, Platform, Pressable, ScrollView, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSavedAccounts, removeSavedAccount, saveAccount, enrichSavedAccountsWithFirestore } from '../services/accountStorage';
import {
  getFirebaseConfigurationErrorMessage,
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithGoogleCredential,
  signOutUser,
} from '../services/authService';
import FeatureIcon from '../components/FeatureIcon';
import LegalAuthNotice from '../components/LegalAuthNotice';
import {
  CAMPUS_EMAIL_PLACEHOLDER,
  isCampusEmail,
  isCampusStudentEmail,
  isLoginEmailAllowed,
} from '../utils/campusEmail';
import { getPasswordError, PASSWORD_MISMATCH_MESSAGE } from '../utils/passwordPolicy';
import { useRemoteImage } from '../utils/useRemoteImage';
import { radius, shadow, spacing, type, useTheme } from '../theme';

// Keep the login artwork distinct from the first onboarding illustration.
const loginStoryset = require('../../assets/login-storyset.png');

function scheduleWhenIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const requestId = globalThis.requestIdleCallback(callback);
    return () => globalThis.cancelIdleCallback?.(requestId);
  }
  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function getInlineAuthFeedback(error, { mode = 'login' } = {}) {
  const code = String(error?.code || '').replace(/^functions\//, '');
  if (code === 'auth/campus-email-required') return { field: 'email', message: 'ใช้อีเมล @psu.ac.th' };
  if (code === 'auth/student-id-required') return { field: 'email', message: 'อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก' };
  if (code === 'auth/campus-email-login-only') return { field: 'email', message: 'ใช้ @psu.ac.th หรือ Gmail ที่สมัครไว้' };
  if (code === 'auth/invalid-email' || code === 'invalid-argument') return { field: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง' };
  if (code === 'auth/user-not-found') return { field: 'email', message: 'ไม่พบบัญชีนี้' };
  if (code === 'auth/campus-email-not-found' || code === 'not-found') return { field: 'email', message: 'ไม่พบอีเมลนี้ใน Google Workspace' };
  if (code === 'auth/campus-email-check-unavailable' || code === 'failed-precondition') return { field: 'email', message: 'ระบบตรวจสอบอีเมลมหาวิทยาลัยยังไม่พร้อม' };
  if (code === 'auth/email-already-in-use' || code === 'already-exists') return { field: 'email', message: 'อีเมลนี้มีบัญชีแล้ว' };
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return { field: 'password', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return { field: 'password', message: 'รหัสผ่านไม่ตรงตามเงื่อนไข' };
  if (code === 'auth/too-many-requests' || code === 'resource-exhausted') return { message: 'ลองใหม่อีกครั้งภายหลัง' };
  if (code === 'auth/network-request-failed' || code === 'unavailable') return { message: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง' };
  if (code === 'auth/user-disabled') return { message: 'บัญชีนี้ถูกปิดใช้งาน' };
  if (getFirebaseConfigurationErrorMessage(error)) return { message: 'ระบบยังตั้งค่าไม่ครบ ลองใหม่ภายหลัง' };
  return { message: mode === 'signup' ? 'สมัครสมาชิกไม่สำเร็จ ลองใหม่' : 'เข้าสู่ระบบไม่สำเร็จ ลองใหม่' };
}

function getShortPasswordMessage(passwordError) {
  if (passwordError === PASSWORD_MISMATCH_MESSAGE) return 'รหัสผ่านไม่ตรงกัน';
  return '8 ตัวขึ้นไป: A-Z, a-z, 0-9 และอักขระพิเศษ';
}

function reportUnexpectedAuthError(label, error) {
  const code = String(error?.code || '');
  if (code === 'auth/network-request-failed' || code === 'unavailable') return;
  const detail = code || String(error?.message || '').trim();
  if (detail) console.warn(`${label}: ${detail}`);
}

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen({ onLoginSuccess }) {
  const isExpoGo =
    Constants.appOwnership === 'expo' ||
    Constants.executionEnvironment === ExecutionEnvironment?.StoreClient;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const redirectUri = isExpoGo
    ? 'https://auth.expo.io/@doralikon/campusmate'
    : makeRedirectUri({
        scheme: 'campusmate',
        preferLocalhost: true,
      });

  const androidClientId =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    webClientId ||
    '865275661439-1md7lkrhld462jgfn7s1dnmbjrnl2ve4.apps.googleusercontent.com';
  const iosClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    webClientId ||
    '865275661439-88thtqomehff31taquhc4srga14fbvav.apps.googleusercontent.com';

  const [authRequest, authResponse, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId,
    webClientId,
    iosClientId,
    androidClientId,
    selectAccount: true,
    redirectUri,
  });

  const completeGoogleCredential = async (idToken) => {
    try {
      const result = await signInWithGoogleCredential(idToken);
      finishAuthentication(result);
    } catch (loginError) {
      showInlineError('เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่');
    }
  };

  useEffect(() => {
    if (authResponse?.type === 'success') {
      const { id_token } = authResponse.params || {};
      if (id_token) {
        completeGoogleCredential(id_token);
      }
    } else if (authResponse?.type === 'error') {
      showInlineError('เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่');
    }
  }, [authResponse]);

  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mode, setMode] = useState('google');
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [inlineNotice, setInlineNotice] = useState(null);

  const clearFeedback = () => {
    setFieldErrors({});
    setInlineNotice(null);
  };

  const clearFieldError = (field) => {
    setFieldErrors((current) => current[field] ? { ...current, [field]: null } : current);
    setInlineNotice(null);
  };

  const showFieldError = (field, message) => {
    setInlineNotice(null);
    setFieldErrors((current) => ({ ...current, [field]: message }));
  };

  const showInlineError = (message) => {
    if (!message) return;
    setFieldErrors({});
    setInlineNotice({ tone: 'error', message });
  };

  const showInlineSuccess = (message) => {
    if (!message) return;
    setFieldErrors({});
    setInlineNotice({ tone: 'success', message });
  };

  const showAuthError = (error, options) => {
    const feedback = getInlineAuthFeedback(error, options);
    if (feedback.field) showFieldError(feedback.field, feedback.message);
    else showInlineError(feedback.message);
  };

  useEffect(() => {
    let disposed = false;
    let cancelEnrichment = () => {};
    getSavedAccounts().then((accounts) => {
      if (disposed) return;
      const list = accounts || [];
      setSavedAccounts(list);
      if (list.length > 0) {
        cancelEnrichment = scheduleWhenIdle(() => {
          void enrichSavedAccountsWithFirestore(list).then((enriched) => {
            if (!disposed && enriched && enriched.length > 0) setSavedAccounts(enriched);
          });
        });
      }
    });
    return () => {
      disposed = true;
      cancelEnrichment();
    };
  }, []);

  const showMode = (nextMode) => {
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    clearFeedback();
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
    setShowPassword(false);
    setShowConfirmPassword(false);
    clearFeedback();
    setMode('login');
  };

  const handleRemoveAccount = async (accId) => {
    const nextList = await removeSavedAccount(accId);
    setSavedAccounts(nextList || []);
    if (!nextList || nextList.length === 0) {
      setSelectedAccount(null);
      clearFeedback();
      setMode('login');
    }
  };

  const handleNativeGoogleLogin = async () => {
    if (loading) return;

    // Check whether RNGoogleSignin TurboModule or legacy NativeModule is registered in native binary
    const isNativeAvailable = Boolean(
      TurboModuleRegistry?.get?.('RNGoogleSignin') || NativeModules?.RNGoogleSignin
    );

    if (!isNativeAvailable) {
      if (promptAsync) {
        try {
          await promptAsync();
        } catch (err) {
          showInlineError('โหมดทดสอบ: ใช้เข้าสู่ระบบด้วยอีเมล');
        }
        return;
      }
      showInlineError('โหมดทดสอบ: ใช้เข้าสู่ระบบด้วยอีเมล');
      return;
    }

    setLoading(true);
    try {
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');
      if (!webClientId) {
        throw new Error('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing');
      }

      // Native Google Sign-In uses the Web client as the Firebase ID-token audience.
      // The Android client is validated by Google Play services using package/SHA-1.
      GoogleSignin.configure({ webClientId });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();

      if (response?.type !== 'success') return;
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('Google did not return an ID token');

      await completeGoogleCredential(idToken);
    } catch (loginError) {
      if (loginError?.code === 'SIGN_IN_CANCELLED') return;
      if (loginError?.code === '10' || loginError?.code === 'DEVELOPER_ERROR') {
        showInlineError('Google ยังตั้งค่าไม่ครบ ลองเข้าสู่ระบบด้วยอีเมล');
        return;
      }
      showInlineError('เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (loading) return;
    if (Platform.OS === 'web') {
      setLoading(true);
      try {
        const result = await signInWithGoogle();
        finishAuthentication(result);
      } catch (loginError) {
        showInlineError('เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่');
      } finally {
        setLoading(false);
      }
    } else if (Platform.OS === 'android') {
      await handleNativeGoogleLogin();
    } else {
      if (promptAsync) {
        promptAsync();
      } else {
        showInlineError('Google ยังไม่พร้อมใช้งาน ใช้อีเมลแทน');
      }
    }
  };

  const handleForgotPassword = async () => {
    if (loading) return;
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) {
      showFieldError('email', 'กรอกอีเมลก่อน');
      return;
    }
    if (!isLoginEmailAllowed(cleanEmail)) {
      showFieldError('email', 'ใช้ @psu.ac.th หรือ Gmail ที่สมัครไว้');
      return;
    }

    clearFieldError('email');
    setLoading(true);
    try {
      await sendPasswordReset(cleanEmail);
      showInlineSuccess('ส่งลิงก์แล้ว ตรวจ Inbox หรือ Junk/Spam');
    } catch (err) {
      reportUnexpectedAuthError('Password reset error', err);
      const feedback = getInlineAuthFeedback(err);
      if (feedback.field) showFieldError(feedback.field, feedback.message);
      else showInlineError(feedback.message === 'เข้าสู่ระบบไม่สำเร็จ ลองใหม่' ? 'ส่งลิงก์ไม่สำเร็จ ลองใหม่' : feedback.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = unverifiedEmail || email.trim();
    if (!targetEmail) {
      showFieldError('email', 'กรอกอีเมล');
      return;
    }
    if (!password) {
      showFieldError('password', 'กรอกรหัสผ่าน');
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const { resendEmailVerification } = require('../services/authService');
      const res = await resendEmailVerification(targetEmail, password);
      if (res.alreadyVerified) {
        showInlineSuccess('อีเมลนี้ยืนยันแล้ว เข้าสู่ระบบได้');
      } else {
        showInlineSuccess('ส่งอีเมลยืนยันแล้ว ตรวจ Inbox หรือ Junk/Spam');
      }
    } catch (err) {
      reportUnexpectedAuthError('Resend verification error', err);
      if (err.code === 'auth/too-many-requests') {
        showInlineError('ส่งบ่อยเกินไป รอสักครู่แล้วลองใหม่');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        showFieldError('password', 'รหัสผ่านไม่ถูกต้อง');
      } else {
        showInlineError('ส่งอีเมลยืนยันไม่สำเร็จ ลองใหม่');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    const errors = {};
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      errors.email = 'กรอกอีเมล';
    } else if (mode === 'signup' && !isCampusEmail(cleanEmail)) {
      errors.email = 'ใช้อีเมล @psu.ac.th';
    } else if (mode === 'signup' && !isCampusStudentEmail(cleanEmail)) {
      errors.email = 'อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก';
    } else if (mode === 'login' && !isLoginEmailAllowed(cleanEmail)) {
      errors.email = 'ใช้ @psu.ac.th หรือ Gmail ที่สมัครไว้';
    }

    if (!password) {
      errors.password = 'กรอกรหัสผ่าน';
    } else if (mode === 'signup') {
      const passwordError = getPasswordError(password, { email: cleanEmail });
      if (passwordError) errors.password = getShortPasswordMessage(passwordError);
    }

    if (mode === 'signup') {
      if (!confirmPassword) errors.confirmPassword = 'ยืนยันรหัสผ่าน';
      else if (password !== confirmPassword) errors.confirmPassword = 'รหัสผ่านไม่ตรงกัน';
    }

    if (Object.keys(errors).length > 0) {
      setInlineNotice(null);
      setFieldErrors(errors);
      return;
    }

    if (loading) return;
    clearFeedback();
    setLoading(true);
    try {
      const result = mode === 'signup'
        ? await signUpWithEmail(cleanEmail, password)
        : await signInWithEmail(cleanEmail, password);

      if (result.user.providerData?.some(p => p.providerId === 'password') && !result.user.emailVerified) {
        setUnverifiedEmail(cleanEmail);
        if (mode === 'signup') {
          showInlineSuccess('สมัครสำเร็จ ตรวจอีเมลเพื่อยืนยันบัญชี');
        } else {
          let msg = '';
          if (result.verificationSent === true) {
            msg = 'ส่งอีเมลยืนยันแล้ว ตรวจ Inbox หรือ Junk/Spam';
          } else if (result.verificationSent === 'throttled') {
            msg = 'ส่งไปแล้ว รอสักครู่แล้วตรวจ Inbox หรือ Junk/Spam';
          } else {
            msg = 'ยืนยันอีเมลก่อนเข้าใช้งาน';
          }
          showInlineSuccess(msg);
        }
        await signOutUser();
        return;
      }

      finishAuthentication(result);
    } catch (loginError) {
      reportUnexpectedAuthError('Email auth error', loginError);
      showAuthError(loginError, { mode });
    } finally {
      setLoading(false);
    }
  };

  const isEmailMode = mode === 'login' || mode === 'signup';

  return (
    <View style={[styles.fullBackground, { backgroundColor: colors.canvas }]}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
          keyboardVerticalOffset={0}
          style={styles.container}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.loginScroll}
          >
            <View style={styles.contentFrame}>
              <View style={styles.loginHero}>
                <View style={[styles.loginHeroBlob, { backgroundColor: colors.primarySoft }]} />
                <Image
                  accessibilityLabel="ภาพประกอบการเข้าสู่ระบบ"
                  resizeMode="contain"
                  source={loginStoryset}
                  style={styles.loginIllustration}
                />
              </View>

              <View style={styles.loginPanel}>
                  {inlineNotice ? (
                    <View
                      accessibilityRole="alert"
                      style={[
                        styles.inlineNotice,
                        inlineNotice.tone === 'success' ? styles.inlineNoticeSuccess : styles.inlineNoticeError,
                      ]}
                    >
                      <FeatureIcon
                        color={inlineNotice.tone === 'success' ? colors.green : colors.danger}
                        name={inlineNotice.tone === 'success' ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'}
                        size={16}
                      />
                      <Text style={styles.inlineNoticeText}>{inlineNotice.message}</Text>
                    </View>
                  ) : null}
                  {mode === 'saved' && savedAccounts.length > 0 ? (
                    <View style={styles.savedSection}>
                      <View style={styles.savedHeader}>
                        <FeatureIcon color={colors.primary} name="person.crop.circle.badge.checkmark" size={16} />
                        <Text style={styles.savedTitle}>ลงชื่อเข้าใช้อีกครั้ง</Text>
                      </View>

                      {savedAccounts.map((acc) => (
                        <View key={acc.id || acc.email} style={styles.savedAccountCard}>
                          <View style={[styles.savedAvatar, acc.avatarColor && { backgroundColor: acc.avatarColor }]}>
                            <SavedAccountAvatar account={acc} colors={colors} style={styles.savedAvatarImage} />
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
                            <FeatureIcon color="#FFFFFF" name="arrow.right" size={11} />
                          </Pressable>
                          <Pressable
                            accessibilityLabel="ลบบัญชีนี้"
                            accessibilityRole="button"
                            hitSlop={8}
                            onPress={() => handleRemoveAccount(acc.id || acc.email)}
                            style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                          >
                            <FeatureIcon color={colors.inkSoft} name="xmark" size={13} />
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
                          clearFeedback();
                          setMode('login');
                        }}
                        style={({ pressed }) => [styles.otherAccountButton, pressed && styles.pressed]}
                      >
                        <FeatureIcon color={colors.ink} name="person.badge.plus" size={17} />
                        <Text style={styles.otherAccountText}>เข้าสู่ระบบด้วยบัญชีอื่น</Text>
                      </Pressable>

                      <Pressable
                        accessibilityLabel="กลับไปหน้าเข้าสู่ระบบหลัก"
                        accessibilityRole="button"
                        onPress={() => {
                          setSelectedAccount(null);
                          setEmail('');
                          setPassword('');
                          setConfirmPassword('');
                          setUnverifiedEmail(null);
                          clearFeedback();
                          setMode('google');
                        }}
                        style={({ pressed }) => [styles.backToLoginButton, pressed && styles.pressed]}
                      >
                        <FeatureIcon color={colors.primary} name="arrow.left.circle" size={17} />
                        <Text style={styles.backToLoginText}>กลับไปหน้าเข้าสู่ระบบหลัก</Text>
                      </Pressable>
                    </View>
                  ) : isEmailMode ? (
                    <View style={styles.form}>
                      {selectedAccount ? (
                        <View style={styles.selectedAccountNotice}>
                          <FeatureIcon color={colors.primary} name="person.crop.circle.fill" size={17} />
                          <Text style={styles.selectedAccountNoticeText}>
                            เข้าสู่ระบบในชื่อ {selectedAccount.displayName || selectedAccount.email}
                          </Text>
                        </View>
                      ) : null}

                      <Text style={styles.campusHint}>
                        {mode === 'signup' ? 'สมัครใหม่ด้วยอีเมล @psu.ac.th' : 'ใช้ @psu.ac.th หรือ Gmail เดิมที่ยืนยันแล้ว'}
                      </Text>
                      <Text style={styles.inputLabel}>อีเมล</Text>
                      <View style={[styles.inputShell, fieldErrors.email && styles.inputShellError]}>
                        <FeatureIcon color={colors.inkSoft} name="envelope.fill" size={17} />
                        <TextInput
                          autoCapitalize="none"
                          autoComplete="email"
                          keyboardType="email-address"
                          keyboardAppearance={isDark ? 'dark' : 'light'}
                          cursorColor={colors.primary}
                          selectionColor={colors.primary}
                          onChangeText={(value) => {
                            setEmail(value);
                            clearFieldError('email');
                          }}
                          placeholder={CAMPUS_EMAIL_PLACEHOLDER}
                          placeholderTextColor={colors.inkSoft}
                          style={styles.input}
                          value={email}
                        />
                      </View>
                      {fieldErrors.email ? <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.email}</Text> : null}

                      <Text style={styles.inputLabel}>รหัสผ่าน</Text>
                      <View style={[styles.inputShell, fieldErrors.password && styles.inputShellError]}>
                        <FeatureIcon color={colors.inkSoft} name="lock.fill" size={17} />
                        <TextInput
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          keyboardAppearance={isDark ? 'dark' : 'light'}
                          cursorColor={colors.primary}
                          selectionColor={colors.primary}
                          onChangeText={(value) => {
                            setPassword(value);
                            clearFieldError('password');
                          }}
                          placeholder="อย่างน้อย 8 ตัวอักษร"
                          placeholderTextColor={colors.inkSoft}
                          secureTextEntry={!showPassword}
                          style={styles.input}
                          value={password}
                        />
                        <Pressable
                          accessibilityLabel={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => setShowPassword((visible) => !visible)}
                          style={styles.passwordToggle}
                        >
                          <FeatureIcon color={colors.inkSoft} name={showPassword ? 'eye.slash.fill' : 'eye.fill'} size={18} />
                        </Pressable>
                      </View>
                      {fieldErrors.password ? <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.password}</Text> : null}

                      {mode === 'signup' ? (
                        <>
                          <Text style={styles.inputLabel}>ยืนยันรหัสผ่าน</Text>
                          <View style={[styles.inputShell, fieldErrors.confirmPassword && styles.inputShellError]}>
                            <FeatureIcon color={colors.inkSoft} name="lock.shield.fill" size={17} />
                            <TextInput
                              autoComplete="new-password"
                              keyboardAppearance={isDark ? 'dark' : 'light'}
                              cursorColor={colors.primary}
                              selectionColor={colors.primary}
                              onChangeText={(value) => {
                                setConfirmPassword(value);
                                clearFieldError('confirmPassword');
                              }}
                              placeholder="กรอกรหัสผ่านอีกครั้ง"
                              placeholderTextColor={colors.inkSoft}
                              secureTextEntry={!showConfirmPassword}
                              style={styles.input}
                              value={confirmPassword}
                            />
                            <Pressable
                              accessibilityLabel={showConfirmPassword ? 'ซ่อนรหัสผ่านที่ยืนยัน' : 'แสดงรหัสผ่านที่ยืนยัน'}
                              accessibilityRole="button"
                              hitSlop={8}
                              onPress={() => setShowConfirmPassword((visible) => !visible)}
                              style={styles.passwordToggle}
                            >
                              <FeatureIcon color={colors.inkSoft} name={showConfirmPassword ? 'eye.slash.fill' : 'eye.fill'} size={18} />
                            </Pressable>
                          </View>
                          {fieldErrors.confirmPassword ? <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.confirmPassword}</Text> : null}
                        </>
                      ) : (
                        <View style={styles.actionRow}>
                          {unverifiedEmail ? (
                            <Pressable
                              hitSlop={12}
                              onPress={handleResendVerification}
                              style={({ pressed }) => [styles.forgotPasswordButton, pressed && styles.pressed]}
                            >
                              <Text style={[styles.forgotPasswordText, { color: colors.coral || '#FF5C5C' }]}>
                                ส่งอีเมลยืนยันใหม่
                              </Text>
                            </Pressable>
                          ) : <View />}
                          <Pressable
                            hitSlop={12}
                            onPress={handleForgotPassword}
                            style={({ pressed }) => [styles.forgotPasswordButton, pressed && styles.pressed]}
                          >
                            <Text style={styles.forgotPasswordText}>ลืมรหัสผ่าน?</Text>
                          </Pressable>
                        </View>
                      )}

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
                        <FeatureIcon color={colors.primary} name="chevron.left" size={13} />
                        <Text style={styles.textButtonText}>
                          {savedAccounts.length > 0 ? 'กลับไปเลือกบัญชี' : 'ย้อนกลับ'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <View style={styles.panelIntro}>
                        <Text style={styles.panelTitle}>เข้าสู่ CampusMate</Text>
                        <Text style={styles.panelSubtitle}>ใช้บัญชีมหาวิทยาลัยหรือ Gmail ที่เคยสมัคร</Text>
                      </View>
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
                        <FeatureIcon color={colors.ink} name="envelope.fill" size={18} />
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
                          <FeatureIcon color={colors.primary} name="person.2.circle" size={16} />
                          <Text style={styles.textButtonText}>เลือกจากบัญชีที่บันทึกไว้</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
              </View>
              <LegalAuthNotice compact style={[styles.legalNotice, { paddingHorizontal: 0, paddingVertical: 4 }]} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
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
        <FeatureIcon color="#FFFFFF" name={symbol} size={19} />
      )}
      <Text style={styles.primaryButtonText}>{loading ? 'กำลังดำเนินการ...' : label}</Text>
    </Pressable>
  );
}

function SavedAccountAvatar({ account, colors, style }) {
  const imageUri = useRemoteImage(account?.avatarUri || account?.photoURL, account?.avatarRevision, account?.id);
  return imageUri ? (
    <Image source={{ uri: imageUri }} style={style} />
  ) : (
    <FeatureIcon color={colors.primary} name="person.fill" size={18} />
  );
}

const getStyles = (colors, isDark) => StyleSheet.create({
  fullBackground: { flex: 1 },
  safeArea: { flex: 1 },
  container: { flex: 1 },
  loginScroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'android' ? 24 : spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'android' ? 34 : spacing.xxl,
  },
  contentFrame: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    maxWidth: 360,
    width: '100%',
    flexGrow: 1,
  },
  loginHero: {
    alignItems: 'center',
    height: 260,
    justifyContent: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.xxl,
    position: 'relative',
    width: '100%',
  },
  loginHeroBlob: {
    borderRadius: 120,
    height: 190,
    position: 'absolute',
    transform: [{ rotate: '-8deg' }, { translateY: 20 }],
    width: 250,
  },
  loginIllustration: { height: 238, transform: [{ translateY: 16 }], width: 244 },
  inlineNotice: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  inlineNoticeError: { backgroundColor: colors.dangerSoft },
  inlineNoticeSuccess: { backgroundColor: colors.greenSoft },
  inlineNoticeText: {
    color: colors.ink,
    flex: 1,
    fontSize: type.caption2,
    fontWeight: '700',
    lineHeight: 17,
  },
  campusHint: {
    color: colors.inkMuted,
    fontSize: type.caption2,
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  loginPanel: {
    backgroundColor: isDark ? 'rgba(28, 32, 44, 0.85)' : 'rgba(255, 255, 255, 0.92)',
    borderColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.60)',
    borderWidth: 1,
    borderRadius: 24,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
    ...shadow.card,
  },
  legalNotice: { marginTop: 'auto' },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  panelIntro: { alignItems: 'center', gap: 2, marginBottom: spacing.xs },
  panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  panelSubtitle: { color: colors.inkMuted, fontSize: type.caption2, lineHeight: 17, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: isDark ? colors.primary : '#111318',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17, 19, 24, 0.05)',
    borderColor: isDark ? 'rgba(255,255,255,0.2)' : '#111318',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  signupRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', minHeight: 30 },
  signupHint: { color: colors.inkMuted, fontSize: type.caption2 },
  signupLink: { color: colors.primary, fontSize: type.caption2, fontWeight: '800' },
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
  inputShellError: { borderColor: colors.danger, borderWidth: 1.5 },
  passwordToggle: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
  },
  fieldError: {
    color: colors.danger,
    fontSize: type.caption2,
    fontWeight: '700',
    lineHeight: 16,
    marginBottom: spacing.xs,
    marginTop: -spacing.xs,
  },
  input: { color: colors.ink, flex: 1, fontSize: type.body, minHeight: 46 },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: -4,
    width: '100%',
  },
  forgotPasswordButton: { alignSelf: 'flex-end', padding: 4, zIndex: 10 },
  forgotPasswordText: { color: colors.primary, fontSize: type.caption2, fontWeight: '700' },
  textButton: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: spacing.sm,
    minHeight: 32,
  },
  textButtonText: { color: colors.primary, fontSize: type.caption, fontWeight: '700' },
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
    backgroundColor: colors.primary,
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
  otherAccountText: { color: colors.ink, fontSize: type.caption, fontWeight: '800' },
  backToLoginButton: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  backToLoginText: { color: colors.primary, fontSize: type.caption, fontWeight: '800' },
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
