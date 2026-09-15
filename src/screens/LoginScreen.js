import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TurboModuleRegistry,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
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
  resendVerificationEmail,
} from '../services/authService';
import FeatureIcon from '../components/FeatureIcon';
import { showLoginAlert } from '../utils/loginAlert';
import { useRemoteImage } from '../utils/useRemoteImage';
import { radius, shadow, spacing, type, useTheme } from '../theme';

const loginPhoto = require('../../assets/login-campus-hero.png');

function scheduleWhenIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const requestId = globalThis.requestIdleCallback(callback);
    return () => globalThis.cancelIdleCallback?.(requestId);
  }
  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
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

  const [authRequest, authResponse, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId,
    webClientId,
    iosClientId: isExpoGo ? undefined : process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: isExpoGo ? undefined : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    selectAccount: true,
    redirectUri,
  });

  const completeGoogleCredential = async (idToken) => {
    const result = await signInWithGoogleCredential(idToken);
    finishAuthentication(result);
  };

  useEffect(() => {
    if (authResponse?.type === 'success') {
      const { id_token } = authResponse.params || {};
      if (id_token) {
        completeGoogleCredential(id_token);
      }
    } else if (authResponse?.type === 'error') {
      showLoginAlert('เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google');
    }
  }, [authResponse]);

  const { colors, isDark } = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const styles = getStyles(colors, isDark);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState('google');
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);

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
          showLoginAlert(
            'Google Sign-In บน Expo Go ต้องใช้ Web Browser หรือโปรดทดสอบด้วย Email/Password แทน (หากต้องการใช้ Google Sign-In แบบเต็มรูปแบบ กรุณาสร้าง Development Build ด้วยคำสั่ง npx expo run:android)',
            'โหมดทดสอบ Expo Go'
          );
        }
        return;
      }
      showLoginAlert(
        'แอปกำลังทำงานบน Expo Go ซึ่งไม่มีโมดูลเนทีฟสำหรับ Google Sign-In กรุณาเข้าสู่ระบบด้วยอีเมล หรือสร้าง Development Build ด้วยคำสั่ง npx expo run:android',
        'โหมดทดสอบ Expo Go'
      );
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
        showLoginAlert('Google Sign-In ของ Android ยังไม่ตรงกับ SHA-1 ของ APK นี้ กรุณาสร้าง APK ใหม่จากโปรเจกต์นี้ หรือลงทะเบียน SHA-1 ของใบรับรองที่ใช้เซ็น APK ใน Firebase');
        return;
      }
      showLoginAlert(getFirebaseConfigurationErrorMessage(loginError) || loginError?.message || 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองใหม่อีกครั้ง');
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
        showLoginAlert(getFirebaseConfigurationErrorMessage(loginError) || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setLoading(false);
      }
    } else if (Platform.OS === 'android') {
      await handleNativeGoogleLogin();
    } else {
      if (promptAsync) {
        promptAsync();
      } else {
        showLoginAlert('Google Sign-In ยังไม่พร้อมใช้งานบนแพลตฟอร์มนี้');
      }
    }
  };

  const handleForgotPassword = async () => {
    if (loading) return;
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) {
      showLoginAlert('กรุณากรอกอีเมลของคุณในช่องด้านบนก่อน แล้วกด "ลืมรหัสผ่าน?" อีกครั้งครับ', 'ระบุอีเมล');
      return;
    }

    const performReset = async () => {
      setLoading(true);
      try {
        await sendPasswordReset(cleanEmail);
        const successMsg = 'ระบบได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยัง ' + cleanEmail + ' เรียบร้อยแล้ว กรุณาตรวจสอบกล่องข้อความ (Inbox) หรือโฟลเดอร์ Junk/Spam';
        if (Platform.OS === 'web') {
          alert('ส่งลิงก์สำเร็จ: ' + successMsg);
        } else {
          Alert.alert('ส่งลิงก์สำเร็จ', successMsg);
        }
      } catch (err) {
        console.error('Password reset error:', err);
        const configurationError = getFirebaseConfigurationErrorMessage(err);
        if (configurationError) {
          showLoginAlert(configurationError, 'การตั้งค่าระบบ');
          return;
        }
        if (err.code === 'auth/user-not-found') {
          showLoginAlert('ไม่พบบัญชีผู้ใช้ที่ใช้อีเมล ' + cleanEmail + ' กรุณาตรวจสอบอีเมลอีกครั้ง หรือสมัครสมาชิกใหม่', 'ไม่พบบัญชี');
        } else if (err.code === 'auth/invalid-email') {
          showLoginAlert('รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบความถูกต้อง เช่น example@gmail.com', 'อีเมลไม่ถูกต้อง');
        } else if (err.code === 'auth/too-many-requests') {
          showLoginAlert('คุณส่งคำขอรีเซ็ตรหัสผ่านบ่อยเกินไป เพื่อความปลอดภัยกรุณารอสักครู่แล้วลองใหม่อีกครั้ง', 'ส่งคำขอบ่อยเกินไป');
        } else if (err.code === 'auth/network-request-failed') {
          showLoginAlert('ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ กรุณาตรวจสอบสัญญาณเน็ตแล้วลองใหม่อีกครั้ง', 'การเชื่อมต่อขัดข้อง');
        } else {
          const detail = err?.message ? ' (' + err.message + ')' : '';
          showLoginAlert('ไม่สามารถส่งอีเมลรีเซ็ตรหัสผ่านได้: ' + (err?.code || 'เกิดข้อผิดพลาด') + detail, 'รีเซ็ตรหัสผ่าน');
        }
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      performReset();
    } else {
      Alert.alert(
        'รีเซ็ตรหัสผ่าน',
        'ต้องการให้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปยัง ' + cleanEmail + ' ใช่หรือไม่?',
        [
          { text: 'ยกเลิก', style: 'cancel' },
          { text: 'ส่งลิงก์', onPress: performReset },
        ]
      );
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = unverifiedEmail || email.trim();
    if (!targetEmail) {
      showLoginAlert('กรุณากรอกอีเมลและรหัสผ่านเพื่อส่งอีเมลยืนยันใหม่', 'ยืนยันอีเมล');
      return;
    }
    if (!password) {
      showLoginAlert('กรุณากรอกรหัสผ่านเพื่อส่งอีเมลยืนยันใหม่', 'ยืนยันอีเมล');
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const { resendEmailVerification } = require('../services/authService');
      const res = await resendEmailVerification(targetEmail, password);
      if (res.alreadyVerified) {
        const msg = 'บัญชีนี้ได้รับการยืนยันอีเมลแล้ว คุณสามารถเข้าสู่ระบบได้ทันที';
        if (Platform.OS === 'web') alert(msg);
        else Alert.alert('ยืนยันแล้ว', msg);
      } else {
        const msg = 'ระบบได้ส่งลิงก์ยืนยันไปยัง ' + targetEmail + ' ให้ใหม่เรียบร้อยแล้ว กรุณาตรวจสอบกล่องข้อความ (Inbox) หรือโฟลเดอร์ Junk/Spam';
        if (Platform.OS === 'web') alert(msg);
        else Alert.alert('ส่งอีเมลยืนยันแล้ว', msg);
      }
    } catch (err) {
      console.error('Resend verification error:', err);
      const configurationError = getFirebaseConfigurationErrorMessage(err);
      if (configurationError) {
        showLoginAlert(configurationError);
        return;
      }
      if (err.code === 'auth/too-many-requests') {
        showLoginAlert('คุณส่งคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', 'ยืนยันอีเมล');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        showLoginAlert('รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบรหัสผ่านอีกครั้ง', 'ยืนยันอีเมล');
      } else {
        showLoginAlert('ไม่สามารถส่งอีเมลยืนยันได้ กรุณาลองใหม่อีกครั้ง', 'ยืนยันอีเมล');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    if (mode === 'signup') {
      if (!email.trim() || !password || !confirmPassword) {
        showLoginAlert('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
      }
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
      if (!passwordRegex.test(password)) {
        showLoginAlert('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร ประกอบด้วยพิมพ์เล็ก พิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ');
        return;
      }
      if (password !== confirmPassword) {
        showLoginAlert('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
        return;
      }
    } else {
      if (!email.trim() || !password) {
        showLoginAlert('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
        return;
      }
    }

    if (loading) return;
    setLoading(true);
    try {
      const result = mode === 'signup'
        ? await signUpWithEmail(email.trim(), password)
        : await signInWithEmail(email.trim(), password);

      if (result.user.providerData?.some(p => p.providerId === 'password') && !result.user.emailVerified) {
        setUnverifiedEmail(email.trim());
        if (mode === 'signup') {
          const msg = 'สมัครสมาชิกสำเร็จ! ระบบได้ส่งอีเมลยืนยันไปยัง ' + email.trim() + ' แล้ว กรุณาตรวจสอบกล่องจดหมาย (Inbox) หรือโฟลเดอร์ Junk/Spam';
          if (Platform.OS === 'web') alert(msg);
          else Alert.alert('ตรวจสอบอีเมลของคุณ', msg);
        } else {
          let msg = '';
          if (result.verificationSent === true) {
            msg = 'บัญชีของคุณยังไม่ได้ยืนยันอีเมล ระบบได้ส่งลิงก์ยืนยันไปยัง ' + email.trim() + ' ให้ใหม่เรียบร้อยแล้ว กรุณาตรวจสอบกล่องข้อความ (Inbox) หรือโฟลเดอร์ Junk/Spam';
          } else if (result.verificationSent === 'throttled') {
            msg = 'ระบบได้ส่งลิงก์ยืนยันไปก่อนหน้านี้แล้ว กรุณาตรวจสอบกล่องข้อความ (Inbox) หรือโฟลเดอร์ Junk/Spam หากไม่พบกรุณารอสักครู่แล้วลองใหม่';
          } else {
            msg = 'กรุณายืนยันอีเมลก่อนเข้าใช้งาน (ตรวจสอบกล่องข้อความหรือ Junk/Spam ของคุณ)';
          }
          if (Platform.OS === 'web') alert(msg);
          else Alert.alert('ส่งอีเมลยืนยันแล้ว', msg);
        }
        await signOutUser();
        return;
      }

      finishAuthentication(result);
    } catch (loginError) {
      console.error('Email auth error:', loginError);
      const configurationError = getFirebaseConfigurationErrorMessage(loginError);
      if (configurationError) {
        showLoginAlert(configurationError);
        return;
      }
      if (loginError.code === 'auth/user-not-found') {
        showLoginAlert('ไม่พบบัญชีที่ใช้อีเมลนี้ กรุณาสมัครสมาชิกก่อน');
      } else if (loginError.code === 'auth/wrong-password' || loginError.code === 'auth/invalid-credential') {
        showLoginAlert('อีเมลหรือรหัสผ่านไม่ถูกต้อง (หากบัญชีนี้สมัครด้วย Google ให้เข้าสู่ระบบด้วย Google)');
      } else if (loginError.code === 'auth/email-already-in-use') {
        showLoginAlert('อีเมลนี้มีผู้ใช้งานแล้ว กรุณาเข้าสู่ระบบ');
      } else if (loginError.code === 'auth/invalid-email') {
        showLoginAlert('รูปแบบอีเมลไม่ถูกต้อง');
      } else if (loginError.code === 'auth/too-many-requests') {
        showLoginAlert('มีการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่');
      } else {
        showLoginAlert(mode === 'signup'
          ? 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
          : 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
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
                <View style={styles.headerSection}>
                  <View style={styles.brandRow}>
                    <View style={styles.brandIconCircle}>
                      <FeatureIcon color="#FFFFFF" name="person.2.fill" size={17} />
                    </View>
                    <Text style={styles.heroTitle}>CampusMate</Text>
                  </View>
                  <Text style={styles.heroSubtitle}>พื้นที่เพื่อนใหม่ในรั้วมหาวิทยาลัย</Text>
                </View>

                <View style={styles.loginPanel}>
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
                          setMode('login');
                        }}
                        style={({ pressed }) => [styles.otherAccountButton, pressed && styles.pressed]}
                      >
                        <FeatureIcon color={colors.ink} name="person.badge.plus" size={17} />
                        <Text style={styles.otherAccountText}>เข้าสู่ระบบด้วยบัญชีอื่น</Text>
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

                      <Text style={styles.inputLabel}>อีเมล</Text>
                      <View style={styles.inputShell}>
                        <FeatureIcon color={colors.inkSoft} name="envelope.fill" size={17} />
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
                        <FeatureIcon color={colors.inkSoft} name="lock.fill" size={17} />
                        <TextInput
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          onChangeText={setPassword}
                          placeholder="อย่างน้อย 8 ตัวอักษร"
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
                            <FeatureIcon color={colors.inkSoft} name="lock.shield.fill" size={17} />
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
              </View>
            </ScrollView>
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
        <FeatureIcon color="#FFFFFF" name={symbol} size={19} />
      )}
      <Text style={styles.primaryButtonText}>{loading ? 'กำลังดำเนินการ...' : label}</Text>
    </Pressable>
  );
}

function SavedAccountAvatar({ account, colors, style }) {
  const imageUri = useRemoteImage(account?.avatarUri || account?.photoURL, account?.updatedAt, account?.id);
  return imageUri ? (
    <Image source={{ uri: imageUri }} style={style} />
  ) : (
    <FeatureIcon color={colors.primary} name="person.fill" size={18} />
  );
}

const getStyles = (colors, isDark) => StyleSheet.create({
  fullBackground: { flex: 1, backgroundColor: '#0B0D14' },
  fullBackgroundImage: { resizeMode: 'cover' },
  gradientOverlay: { flex: 1 },
  safeArea: { flex: 1 },
  container: { flex: 1 },
  loginScroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'android' ? 44 : spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'android' ? 28 : spacing.xxl,
  },
  contentFrame: {
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 340,
    width: '100%',
    flexGrow: 1,
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: isDark ? 'rgba(28, 32, 44, 0.85)' : 'rgba(255, 255, 255, 0.92)',
    borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 4,
    marginBottom: spacing.lg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  heroTitle: { color: isDark ? '#FFFFFF' : '#10203A', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  heroSubtitle: { color: isDark ? '#A2ACB9' : '#5A687D', fontSize: 12, fontWeight: '600' },
  loginPanel: {
    backgroundColor: isDark ? 'rgba(28, 32, 44, 0.85)' : 'rgba(255, 255, 255, 0.92)',
    borderColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.60)',
    borderWidth: 1,
    borderRadius: 28,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    width: '100%',
    marginBottom: Platform.OS === 'android' ? 16 : 0,
    ...shadow.card,
  },
  actions: { gap: spacing.md, marginTop: spacing.sm },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: isDark ? colors.primary : '#111318',
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
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17, 19, 24, 0.05)',
    borderColor: isDark ? 'rgba(255,255,255,0.2)' : '#111318',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { color: colors.ink, fontSize: type.caption, fontWeight: '800' },
  signupRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', minHeight: 34 },
  signupHint: { color: colors.inkMuted, fontSize: type.caption },
  signupLink: { color: colors.primary, fontSize: type.caption, fontWeight: '800' },
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
    marginTop: spacing.md,
    minHeight: 36,
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
