import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import React, { useState } from 'react';
import { useAssets } from 'expo-asset';
import { Keyboard, Platform, Pressable, useColorScheme, useWindowDimensions, View } from 'react-native';
import { HStack, Host, Image, ScrollView, SecureField, Spacer, TextField, useNativeState, VStack, ZStack } from '@expo/ui/swift-ui';
import { accessibilityHint, accessibilityLabel, aspectRatio, autocorrectionDisabled, background, blur, buttonBorderShape, buttonStyle, clipShape, clipped, controlSize, disabled, foregroundStyle, frame, keyboardType, lineLimit, offset, padding, resizable, scrollDismissesKeyboard, scrollIndicators, shadow, shapes, textContentType, textFieldStyle, textInputAutocapitalization, tint } from '@expo/ui/swift-ui/modifiers';
import { getSavedAccounts, removeSavedAccount, saveAccount, enrichSavedAccountsWithFirestore } from '../services/accountStorage';
import {
  getFirebaseConfigurationErrorMessage,
  getSignInErrorMessage,
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithGoogleCredential,
  signOutUser,
  resendVerificationEmail,
} from '../services/authService';
import { showLoginAlert } from '../utils/loginAlert';
import {
  CAMPUS_EMAIL_PLACEHOLDER,
  CAMPUS_LOGIN_HINT,
  CAMPUS_SIGNUP_HINT,
  getCampusEmailErrorMessage,
  getPasswordResetErrorMessage,
  getPasswordResetSentMessage,
} from '../utils/campusEmail';
import { getPasswordError, PASSWORD_MISMATCH_MESSAGE } from '../utils/passwordPolicy';
import { useConfirm } from '../context/ConfirmContext';
import { router } from 'expo-router';
import { useRemoteImage } from '../utils/useRemoteImage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import Constants from 'expo-constants';
import { showAlert } from '../utils/appAlert';

WebBrowser.maybeCompleteAuthSession();
const loginPhoto = require('../../assets/login-campus-hero.png');
const panelShape = shapes.roundedRectangle({ cornerRadius: 28, roundedCornerStyle: 'continuous' });
const cardShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });

function scheduleWhenIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const requestId = globalThis.requestIdleCallback(callback);
    return () => globalThis.cancelIdleCallback?.(requestId);
  }
  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function reportUnexpectedAuthError(label, error) {
  const code = String(error?.code || '');
  if (code === 'auth/network-request-failed' || code === 'unavailable') return;
  const detail = code || String(error?.message || '').trim();
  if (detail) console.warn(`${label}: ${detail}`);
}

const darkPalette = {
  background: '#101216',
  surface: '#1B1E26',
  inputBackground: '#242832',
  text: '#F7F8FA',
  secondary: '#A2ACB9',
  tertiary: '#737D8D',
  purple: '#88B5F2',
  purpleSoft: 'rgba(112,178,255,0.18)',
  coral: '#FF7A6B',
  coralSoft: 'rgba(255,122,107,0.16)',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255,107,107,0.14)',
  green: '#45D1A1',
};

const lightPalette = {
  background: '#F5F7FB',
  surface: '#FFFFFF',
  inputBackground: '#F0F3F9',
  text: '#25272B',
  secondary: '#5A687D',
  tertiary: '#8895A7',
  purple: '#2869C7',
  purpleSoft: 'rgba(35,123,231,0.12)',
  coral: '#F47C6B',
  coralSoft: '#FFF0ED',
  danger: '#D65454',
  dangerSoft: '#FFF0F0',
  green: '#18A878',
};

function usePalette() {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

export default function LoginScreen({ onLoginSuccess }) {
  const isExpoGo = Constants.appOwnership === 'expo';
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

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId,
    webClientId,
    iosClientId,
    androidClientId,
    selectAccount: true,
    redirectUri,
  });

  React.useEffect(() => {
    if (request?.url) {
      console.log('>>> [GOOGLE AUTH REQUEST URL]:', request.url);
    }
  }, [request]);

  React.useEffect(() => {
    if (response) {
      console.log('>>> [GOOGLE AUTH RESPONSE]:', JSON.stringify(response));
    }
    if (response?.type === 'success') {
      const { id_token } = response.params;
      if (id_token) {
        handleGoogleCredential(id_token);
      }
    } else if (response?.type === 'error') {
      showLoginAlert('เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google');
    }
  }, [response]);

  const handleGoogleCredential = async (id_token) => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await signInWithGoogleCredential(id_token);
      finishAuthentication(result);
    } catch (err) {
      showLoginAlert(
        getSignInErrorMessage(err)
          || getCampusEmailErrorMessage(err)
          || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง'
      );
    } finally {
      setLoading(false);
    }
  };

  const colorScheme = useColorScheme();
  const { confirm } = useConfirm();
  const { height: screenHeight } = useWindowDimensions();
  const palette = usePalette();
  const [assets] = useAssets([loginPhoto]);
  const nativeEmail = useNativeState('');
  const nativePassword = useNativeState('');
  const nativeConfirmPassword = useNativeState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState('google');
  const [loading, setLoading] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const imageUri = assets?.[0]?.localUri || assets?.[0]?.uri;

  React.useEffect(() => {
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
    nativePassword.set('');
    setConfirmPassword('');
    nativeConfirmPassword.set('');
    setMode(nextMode);
  };

  const finishAuthentication = (result) => {
    saveAccount(result.user);
    onLoginSuccess(result.user);
  };

  const handleSelectAccount = (acc) => {
    setSelectedAccount(acc);
    setEmail(acc.email || '');
    nativeEmail.set(acc.email || '');
    setPassword('');
    nativePassword.set('');
    setConfirmPassword('');
    nativeConfirmPassword.set('');
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
    if (Platform.OS === 'web') {
      if (loading) return;
      setLoading(true);
      try {
        const result = await signInWithGoogle();
        finishAuthentication(result);
      } catch (loginError) {
        showLoginAlert(
          getSignInErrorMessage(loginError)
            || getCampusEmailErrorMessage(loginError)
            || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง'
        );
      } finally {
        setLoading(false);
      }
    } else {
      promptAsync();
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
        const successMsg = getPasswordResetSentMessage(cleanEmail);
        if (Platform.OS === 'web') {
          alert(successMsg);
        } else {
          showAlert('ส่งคำขอแล้ว', successMsg, { tone: 'success' });
        }
      } catch (err) {
        reportUnexpectedAuthError('Password reset error', err);
        const configurationError = getFirebaseConfigurationErrorMessage(err);
        const resetError = getPasswordResetErrorMessage(err);
        if (configurationError) {
          showLoginAlert(configurationError, 'การตั้งค่าระบบ');
          return;
        }
        showLoginAlert(resetError || 'ไม่สามารถส่งอีเมลตั้งรหัสผ่านใหม่ได้ กรุณาลองใหม่', 'รีเซ็ตรหัสผ่าน');
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      performReset();
    } else {
      const ok = await confirm({
        title: 'รีเซ็ตรหัสผ่าน',
        body: 'ต้องการให้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปยัง ' + cleanEmail + ' ใช่หรือไม่?',
        confirmLabel: 'ส่งลิงก์',
        icon: 'lock.fill',
        destructive: false,
      });
      if (ok) performReset();
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
        showAlert('ยืนยันแล้ว', 'บัญชีนี้ได้รับการยืนยันอีเมลแล้ว คุณสามารถเข้าสู่ระบบได้ทันที', { tone: 'success' });
      } else {
        const msg = 'ระบบได้ส่งลิงก์ยืนยันไปยัง ' + targetEmail + ' ให้ใหม่เรียบร้อยแล้ว กรุณาตรวจ Inbox, Junk/Spam และ Quarantine ของ Outlook';
        showAlert('ส่งอีเมลยืนยันแล้ว', msg, { tone: 'success' });
      }
    } catch (err) {
      reportUnexpectedAuthError('Resend verification error (iOS)', err);
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
      const passwordError = getPasswordError(password, { email, confirmPassword });
      if (passwordError) {
        showLoginAlert(passwordError);
        return;
      }
      if (password !== confirmPassword) {
        showLoginAlert(PASSWORD_MISMATCH_MESSAGE);
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
          const msg = 'สมัครสมาชิกสำเร็จ! ระบบได้ส่งอีเมลยืนยันไปยัง ' + email.trim() + ' แล้ว กรุณาตรวจ Inbox, Junk/Spam และ Quarantine ของ Outlook';
          showAlert('ตรวจสอบอีเมลของคุณ', msg, { tone: 'info' });
        } else {
          let msg = '';
          if (result.verificationSent === true) {
            msg = 'บัญชีของคุณยังไม่ได้ยืนยันอีเมล ระบบได้ส่งลิงก์ยืนยันไปยัง ' + email.trim() + ' ให้ใหม่เรียบร้อยแล้ว กรุณาตรวจ Inbox, Junk/Spam และ Quarantine ของ Outlook';
          } else if (result.verificationSent === 'throttled') {
            msg = 'ระบบได้ส่งลิงก์ยืนยันไปก่อนหน้านี้แล้ว กรุณาตรวจ Inbox, Junk/Spam และ Quarantine ของ Outlook หากไม่พบกรุณารอสักครู่แล้วลองใหม่';
          } else {
            msg = 'กรุณายืนยันอีเมลก่อนเข้าใช้งาน (ตรวจสอบกล่องข้อความหรือ Junk/Spam ของคุณ)';
          }
          showAlert('ส่งอีเมลยืนยันแล้ว', msg, { tone: 'success' });
        }
        await signOutUser();
        return;
      }

      finishAuthentication(result);
    } catch (loginError) {
      reportUnexpectedAuthError('Email auth error (iOS)', loginError);
      showLoginAlert(
        getSignInErrorMessage(loginError, { mode })
          || (mode === 'signup' ? 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0D14' }}>
      <Host
        colorScheme={colorScheme}
        seedColor={palette.purple}
        style={{ flex: 1 }}
        useViewportSizeMeasurement
      >
        <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          {/* Fullscreen Background Image (คมชัด ไม่เบลอ) */}
          {imageUri ? (
            <Image
              uiImage={imageUri}
              modifiers={[
                resizable(),
                aspectRatio({ contentMode: 'fill' }),
                frame({ maxWidth: Infinity, maxHeight: Infinity }),
                clipped(),
              ]}
            />
          ) : (
            <ZStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background('#141722')]} />
          )}

          {/* Fullscreen Dark Gradient Overlay (ไล่เข้ม) */}
          <ZStack
            modifiers={[
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
              background({
                type: 'linearGradient',
                colors: colorScheme === 'dark'
                  ? ['rgba(11,13,20,0.40)', 'rgba(11,13,20,0.78)', 'rgba(11,13,20,0.96)']
                  : ['rgba(11,13,20,0.25)', 'rgba(11,13,20,0.60)', 'rgba(11,13,20,0.88)'],
                startPoint: { x: 0.5, y: 0 },
                endPoint: { x: 0.5, y: 1 },
              }),
            ]}
          />

          {/* Foreground Content - Fixed, Non-scrollable */}
          <VStack
            alignment="center"
            modifiers={[
              padding({ top: 48, bottom: 28, horizontal: 20 }),
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
            ]}
          >
            {/* Minimalist Floating Pill (แคปซูลจิ๋ว ลอยตัว ไม่เต็มพื้นที่) */}
            <HStack
              spacing={8}
              modifiers={[
                padding({ horizontal: 14, vertical: 7 }),
                background(
                  colorScheme === 'dark' ? 'rgba(28, 32, 44, 0.82)' : 'rgba(255, 255, 255, 0.90)',
                  shapes.capsule()
                ),
                shadow({ radius: 12, y: 3, color: 'rgba(0,0,0,0.30)' }),
              ]}
            >
              <VStack
                alignment="center"
                modifiers={[
                  padding({ all: 5 }),
                  background(palette.purple, shapes.circle()),
                ]}
              >
                <Image color="#FFFFFF" size={13} systemName="person.2.fill" />
              </VStack>

              <Text
                modifiers={[
                  font({ textStyle: 'headline', weight: 'heavy', design: 'rounded' }),
                  foregroundStyle(colorScheme === 'dark' ? '#FFFFFF' : '#25272B'),
                ]}
              >
                CampusMate
              </Text>
            </HStack>

            <Spacer />

            {/* Form Card - Anchored at Bottom (Translucent Glass Panel) */}
            <VStack
              alignment="center"
              spacing={14}
              modifiers={[
                padding({ top: 20, bottom: 20, horizontal: 16 }),
                frame({ maxWidth: 340, alignment: 'center' }),
                background(
                  colorScheme === 'dark' ? 'rgba(23, 26, 36, 0.82)' : 'rgba(255, 255, 255, 0.88)',
                  panelShape
                ),
                shadow({ radius: 24, y: 8, color: 'rgba(0,0,0,0.35)' }),
              ]}
            >
                {mode === 'saved' && savedAccounts.length > 0 ? (
                  <VStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                    <HStack spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' })]}>
                      <Image color={palette.purple} size={13} systemName="person.crop.circle.badge.checkmark" />
                      <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
                        ลงชื่อเข้าใช้อีกครั้ง
                      </Text>
                    </HStack>

                    <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
                      {savedAccounts.map((acc) => (
                        <SavedAccountRow
                          key={acc.id || acc.email}
                          acc={acc}
                          cardShape={cardShape}
                          onRemove={handleRemoveAccount}
                          onSelect={handleSelectAccount}
                          palette={palette}
                        />
                      ))}
                    </VStack>

                    <Button
                      label="เข้าสู่ระบบด้วยบัญชีอื่น"
                      onPress={() => {
                        setSelectedAccount(null);
                        setEmail('');
                        nativeEmail.set('');
                        setPassword('');
                        nativePassword.set('');
                        setMode('login');
                      }}
                      systemImage="person.badge.plus"
                      modifiers={[
                        buttonStyle('plain'),
                        tint(palette.purple),
                        frame({ maxWidth: Infinity }),
                      ]}
                    />
                  </VStack>
                ) : mode === 'google' ? (
                  <VStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                    <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary), lineLimit(4)]}>
                      {CAMPUS_LOGIN_HINT}
                    </Text>
                    <AuthButton
                      label="เข้าสู่ระบบด้วย Google"
                      loading={loading}
                      onPress={handleGoogleLogin}
                      palette={palette}
                      systemImage="person.badge.key.fill"
                    />
                    <Button
                      label="เข้าสู่ระบบด้วยอีเมล"
                      onPress={() => showMode('login')}
                      systemImage="envelope.fill"
                      modifiers={[
                        accessibilityLabel('เข้าสู่ระบบด้วยอีเมล'),
                        accessibilityHint('เปิดแบบฟอร์มอีเมลและรหัสผ่าน'),
                        buttonStyle('glass'),
                        buttonBorderShape('capsule'),
                        controlSize('large'),
                        tint(palette.text),
                        frame({ maxWidth: Infinity }),
                        disabled(loading),
                      ]}
                    />
                    <Button
                      label="ยังไม่มีบัญชี? สมัครสมาชิก"
                      onPress={() => showMode('signup')}
                      systemImage="person.badge.plus"
                      modifiers={[
                        buttonStyle('plain'),
                        tint(palette.purple),
                        frame({ maxWidth: Infinity }),
                        disabled(loading),
                      ]}
                    />
                    {savedAccounts.length > 0 ? (
                      <Button
                        label="เลือกจากบัญชีที่บันทึกไว้"
                        onPress={() => showMode('saved')}
                        systemImage="person.2.circle"
                        modifiers={[
                          buttonStyle('plain'),
                          tint(palette.secondary),
                          frame({ maxWidth: Infinity }),
                          disabled(loading),
                        ]}
                      />
                    ) : null}
                  </VStack>
                ) : (
                  <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: Infinity })]}>
                    {selectedAccount ? (
                      <HStack spacing={8} modifiers={[padding({ bottom: 2 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                        <Image color={palette.purple} size={16} systemName="person.crop.circle.fill" />
                        <Text modifiers={[font({ textStyle: 'callout', weight: 'bold' }), foregroundStyle(palette.text)]}>
                          เข้าสู่ระบบในชื่อ {selectedAccount.displayName || selectedAccount.email}
                        </Text>
                      </HStack>
                    ) : (
                      <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary), lineLimit(3)]}>
                        {mode === 'signup' ? CAMPUS_SIGNUP_HINT : CAMPUS_LOGIN_HINT}
                      </Text>
                    )}

                    <NativeInput
                      label="อีเมล"
                      nativeValue={nativeEmail}
                      onChange={setEmail}
                      palette={palette}
                      placeholder={CAMPUS_EMAIL_PLACEHOLDER}
                      systemImage="envelope.fill"
                      type="email"
                    />
                    <NativeInput
                      label="รหัสผ่าน"
                      nativeValue={nativePassword}
                      onChange={setPassword}
                      palette={palette}
                      placeholder="อย่างน้อย 8 ตัวอักษร"
                      systemImage="lock.fill"
                      type={mode === 'signup' ? 'newPassword' : 'password'}
                    />
                    {mode === 'signup' ? (
                      <NativeInput
                        label="ยืนยันรหัสผ่าน"
                        nativeValue={nativeConfirmPassword}
                        onChange={setConfirmPassword}
                        palette={palette}
                        placeholder="กรอกรหัสผ่านอีกครั้ง"
                        systemImage="lock.shield.fill"
                        type="newPassword"
                      />
                    ) : (
                      <HStack modifiers={[frame({ maxWidth: Infinity }), padding({ bottom: 8, top: 4, trailing: 4 })]}>
                        {unverifiedEmail ? (
                          <Button
                            label="ส่งอีเมลยืนยันใหม่"
                            onPress={handleResendVerification}
                            modifiers={[
                              buttonStyle('plain'),
                              tint(palette.coral),
                              font({ textStyle: 'caption2', weight: 'bold' }),
                              padding({ all: 8 }),
                            ]}
                          />
                        ) : null}
                        <Spacer />
                        <Button
                          label="ลืมรหัสผ่าน?"
                          onPress={handleForgotPassword}
                          modifiers={[
                            buttonStyle('plain'),
                            tint(palette.purple),
                            font({ textStyle: 'caption2', weight: 'bold' }),
                            padding({ all: 8 }),
                          ]}
                        />
                      </HStack>
                    )}
                    <AuthButton
                      label={mode === 'signup' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
                      loading={loading}
                      onPress={handleEmailAuth}
                      palette={palette}
                      systemImage={mode === 'signup' ? 'person.badge.plus' : 'arrow.right.circle.fill'}
                    />
                    <Button
                      label={savedAccounts.length > 0 ? 'กลับไปเลือกบัญชี' : 'ย้อนกลับ'}
                      onPress={() => showMode(savedAccounts.length > 0 ? 'saved' : 'google')}
                      systemImage="chevron.left"
                      modifiers={[
                        buttonStyle('plain'),
                        tint(palette.secondary),
                        frame({ maxWidth: Infinity }),
                        disabled(loading),
                      ]}
                    />
                  </VStack>
                )}
                <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary), lineLimit(4)]}>
                  การสมัครหรือเข้าสู่ระบบ หมายความว่าคุณมีอายุอย่างน้อย 18 ปี และยอมรับเงื่อนไขการให้บริการกับนโยบายความเป็นส่วนตัวตาม PDPA
                </Text>
                <HStack spacing={12}>
                  <Button
                    label="นโยบายความเป็นส่วนตัว"
                    onPress={() => router.push('/privacy-policy')}
                    modifiers={[buttonStyle('plain'), tint(palette.purple), controlSize('small')]}
                  />
                  <Button
                    label="เงื่อนไขการใช้บริการ"
                    onPress={() => router.push('/terms')}
                    modifiers={[buttonStyle('plain'), tint(palette.purple), controlSize('small')]}
                  />
                </HStack>
              </VStack>
          </VStack>
        </ZStack>
      </Host>
    </View>
  );
}


function NativeInput({ label, nativeValue, onChange, palette, placeholder, systemImage, type }) {
  const isSecure = type === 'password' || type === 'newPassword';
  const inputShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });
  const inputModifiers = [
    textFieldStyle('plain'),
    frame({ maxWidth: Infinity, minHeight: 40 }),
    textContentType(type === 'email' ? 'emailAddress' : type),
  ];

  if (type === 'email') {
    inputModifiers.push(
      keyboardType('email-address'),
      textInputAutocapitalization('never'),
      autocorrectionDisabled(true)
    );
  }

  return (
    <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
      <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.secondary), padding({ leading: 4 })]}>
        {label}
      </Text>
      <HStack
        spacing={12}
        modifiers={[
          padding({ horizontal: 16, vertical: 12 }),
          frame({ maxWidth: Infinity, minHeight: 52 }),
          background(palette.inputBackground, inputShape),
        ]}
      >
        <Image color={palette.purple} size={17} systemName={systemImage} />
        {isSecure ? (
          <SecureField
            onTextChange={onChange}
            placeholder={placeholder}
            text={nativeValue}
            modifiers={inputModifiers}
          />
        ) : (
          <TextField
            onTextChange={onChange}
            placeholder={placeholder}
            text={nativeValue}
            modifiers={inputModifiers}
          />
        )}
      </HStack>
    </VStack>
  );
}

function AuthButton({ label, loading, onPress, palette, systemImage }) {
  return (
    <Button
      label={loading ? 'กำลังดำเนินการ...' : label}
      onPress={onPress}
      systemImage={loading ? 'hourglass' : systemImage}
      modifiers={[
        accessibilityLabel(label),
        buttonStyle('glassProminent'),
        buttonBorderShape('capsule'),
        controlSize('large'),
        tint(palette.purple),
        frame({ maxWidth: Infinity }),
        disabled(loading),
      ]}
    />
  );
}

function SavedAccountRow({ acc, cardShape, onRemove, onSelect, palette }) {
  const remoteAvatar = useRemoteImage(acc.avatarUri || acc.photoURL, acc.avatarRevision, acc.id);

  return (
    <HStack
      spacing={10}
      modifiers={[
        padding({ horizontal: 10, vertical: 8 }),
        frame({ maxWidth: Infinity }),
        background(palette.inputBackground, cardShape),
      ]}
    >
      <ZStack
        alignment="center"
        modifiers={[
          frame({ width: 38, height: 38 }),
          background(acc.avatarColor || palette.purpleSoft, shapes.circle()),
          clipShape('circle'),
        ]}
      >
        {remoteAvatar ? (
          <Image
            uiImage={remoteAvatar}
            modifiers={[
              resizable(),
              aspectRatio({ contentMode: 'fill' }),
              frame({ width: 38, height: 38 }),
              clipShape('circle'),
            ]}
          />
        ) : (
          <Image color={palette.purple} size={18} systemName="person.fill" />
        )}
      </ZStack>

      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <Text modifiers={[font({ textStyle: 'callout', weight: 'bold' }), foregroundStyle(palette.text), lineLimit(1)]}>
          {acc.displayName || acc.email}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'regular' }), foregroundStyle(palette.secondary), lineLimit(1)]}>
          {acc.faculty ? `${acc.faculty} · ` : ''}{acc.email}
        </Text>
      </VStack>

      <Button
        label="เข้าใช้"
        onPress={() => onSelect(acc)}
        systemImage="arrow.right"
        modifiers={[
          buttonStyle('glassProminent'),
          buttonBorderShape('capsule'),
          controlSize('mini'),
          tint(palette.purple),
          lineLimit(1),
        ]}
      />

      <Button
        label=""
        onPress={() => onRemove(acc.id || acc.email)}
        systemImage="xmark"
        modifiers={[
          buttonStyle('plain'),
          tint(palette.tertiary),
        ]}
      />
    </HStack>
  );
}
