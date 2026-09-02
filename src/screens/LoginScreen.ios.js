import React, { useState } from 'react';
import { useAssets } from 'expo-asset';
import { Keyboard, Platform, Pressable, useColorScheme, useWindowDimensions, View, Alert } from 'react-native';
import {
  Button,
  HStack,
  Host,
  Image,
  ScrollView,
  SecureField,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  aspectRatio,
  autocorrectionDisabled,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  lineLimit,
  offset,
  padding,
  resizable,
  scrollDismissesKeyboard,
  scrollIndicators,
  shadow,
  shapes,
  textContentType,
  textFieldStyle,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { getSavedAccounts, removeSavedAccount, saveAccount, enrichSavedAccountsWithFirestore } from '../services/accountStorage';
import { useRemoteImage } from '../utils/useRemoteImage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();
const loginPhoto = require('../../assets/login-campus-hero.png');
const panelShape = shapes.roundedRectangle({ cornerRadius: 28, roundedCornerStyle: 'continuous' });
const cardShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });

const darkPalette = {
  background: '#101216',
  surface: '#1B1E26',
  inputBackground: '#242832',
  text: '#F7F8FA',
  secondary: '#A2ACB9',
  tertiary: '#737D8D',
  purple: '#6C63FF',
  purpleSoft: 'rgba(108,99,255,0.18)',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255,107,107,0.14)',
  green: '#45D1A1',
};

const lightPalette = {
  background: '#F5F7FB',
  surface: '#FFFFFF',
  inputBackground: '#F0F3F9',
  text: '#10203A',
  secondary: '#5A687D',
  tertiary: '#8895A7',
  purple: '#5B5CE2',
  purpleSoft: 'rgba(91,92,226,0.12)',
  danger: '#D65454',
  dangerSoft: '#FFF0F0',
  green: '#18A878',
};

function usePalette() {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

export default function LoginScreen({ onLoginSuccess }) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  React.useEffect(() => {
    if (request) {
      console.log('Google Auth Request URL (iOS):', request.url);
    }
    if (response?.type === 'success') {
      const { id_token } = response.params;
      if (id_token) {
        handleGoogleCredential(id_token);
      }
    } else if (response?.type === 'error') {
      console.error('Google Auth Error (iOS):', response.error);
      setError('เกิดข้อผิดพลาดในการเข้าสู่ระบบด้วย Google');
    } else if (response) {
      console.log('Google Auth Response Type (iOS):', response.type);
    }
  }, [response, request]);

  const handleGoogleCredential = async (id_token) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const { signInWithGoogleCredential } = require('../services/authService');
      const result = await signInWithGoogleCredential(id_token);
      finishAuthentication(result);
    } catch (err) {
      setError(err.message || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  const colorScheme = useColorScheme();
  const { height: screenHeight } = useWindowDimensions();
  const palette = usePalette();
  const [assets] = useAssets([loginPhoto]);
  const nativeEmail = useNativeState('');
  const nativePassword = useNativeState('');
  const nativeConfirmPassword = useNativeState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const imageUri = assets?.[0]?.localUri || assets?.[0]?.uri;

  React.useEffect(() => {
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
      }
    });
  }, []);

  const showMode = (nextMode) => {
    setError('');
    setPassword('');
    nativePassword.set('');
    setConfirmPassword('');
    nativeConfirmPassword.set('');
    setMode(nextMode);
  };

  React.useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

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
    if (Platform.OS === 'web') {
      if (loading) return;
      setLoading(true);
      setError('');
      try {
        const { signInWithGoogle } = require('../services/authService');
        const result = await signInWithGoogle();
        finishAuthentication(result);
      } catch (loginError) {
        setError(loginError.message || 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setLoading(false);
      }
    } else {
      promptAsync();
    }
  };

  const handleForgotPassword = async () => {
    if (loading) return;
    if (!email.trim()) {
      setError('กรุณากรอกอีเมลที่ต้องการรีเซ็ตรหัสผ่าน');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { sendPasswordReset } = require('../services/authService');
      await sendPasswordReset(email.trim());
      Alert.alert('สำเร็จ', 'ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณแล้ว');
    } catch (err) {
      console.error('Password reset error (iOS):', err);
      if (err.code === 'auth/user-not-found') {
        setError('ไม่พบบัญชีที่ใช้อีเมลนี้ กรุณาตรวจสอบอีกครั้ง');
      } else if (err.code === 'auth/invalid-email') {
        setError('รูปแบบอีเมลไม่ถูกต้อง');
      } else if (err.code === 'auth/too-many-requests') {
        setError('คุณส่งคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
      } else {
        setError(err.message || 'ไม่สามารถส่งอีเมลรีเซ็ตรหัสผ่านได้');
      }
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

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0D14' }}>
      <Host
        colorScheme={colorScheme}
        seedColor={palette.purple}
        style={{ flex: 1 }}
        useViewportSizeMeasurement
      >
        <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          {/* Fullscreen Background Image */}
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

          {/* Fullscreen Gradient Scrim */}
          <VStack
            modifiers={[
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
              background('linear-gradient(to bottom, rgba(11,13,20,0.38) 0%, rgba(11,13,20,0.68) 42%, rgba(11,13,20,0.92) 85%)'),
            ]}
          />

          {/* Foreground Content - Fixed, Non-scrollable */}
          <VStack
            alignment="center"
            modifiers={[
              padding({ top: 40, bottom: 36, horizontal: 20 }),
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
            ]}
          >
            <Spacer />

            {/* Brand Header - Centered in Screen */}
            <VStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' })]}>
              <VStack
                alignment="center"
                modifiers={[
                  padding({ all: 16 }),
                  background('rgba(255,255,255,0.22)', shapes.circle()),
                  shadow({ radius: 18, y: 6, color: 'rgba(0,0,0,0.3)' }),
                ]}
              >
                <Image color="#FFFFFF" size={36} systemName="person.2.fill" />
              </VStack>
              <Text
                modifiers={[
                  font({ textStyle: 'largeTitle', weight: 'heavy', design: 'rounded' }),
                  foregroundStyle('#FFFFFF'),
                ]}
              >
                CampusMate
              </Text>
              <Text
                modifiers={[
                  font({ textStyle: 'subheadline', weight: 'medium' }),
                  foregroundStyle('rgba(255,255,255,0.88)'),
                ]}
              >
                พื้นที่เพื่อนใหม่ในรั้วมหาวิทยาลัย
              </Text>
            </VStack>

            <Spacer />

            {/* Form Card - Anchored at Bottom */}
            <VStack
              alignment="center"
              spacing={14}
              modifiers={[
                padding({ top: 20, bottom: 20, horizontal: 16 }),
                frame({ maxWidth: 340, alignment: 'center' }),
                background(palette.surface, panelShape),
                  shadow({ radius: 24, y: 8, color: 'rgba(0,0,0,0.32)' }),
                ]}
              >
                {error ? <ErrorMessage message={error} /> : null}

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
                        tint('#111318'),
                        frame({ maxWidth: Infinity }),
                      ]}
                    />
                  </VStack>
                ) : mode === 'google' ? (
                  <VStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
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
                        tint('#111318'),
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
                        tint('#111318'),
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
                          tint('#111318'),
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
                    ) : null}

                    <NativeInput
                      label="อีเมล"
                      nativeValue={nativeEmail}
                      onChange={setEmail}
                      palette={palette}
                      placeholder="name@university.ac.th"
                      systemImage="envelope.fill"
                      type="email"
                    />
                    <NativeInput
                      label="รหัสผ่าน"
                      nativeValue={nativePassword}
                      onChange={setPassword}
                      palette={palette}
                      placeholder="อย่างน้อย 6 ตัวอักษร"
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
                      <HStack modifiers={[frame({ maxWidth: Infinity, alignment: 'trailing' }), padding({ bottom: 8, top: 4, trailing: 4 })]}>
                        <Button
                          label="ลืมรหัสผ่าน?"
                          onPress={handleForgotPassword}
                          modifiers={[
                            buttonStyle('plain'),
                            tint(palette.purple),
                            font({ textStyle: 'caption2', weight: 'bold' }),
                            padding({ all: 8 })
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
                        tint('#111318'),
                        frame({ maxWidth: Infinity }),
                        disabled(loading),
                      ]}
                    />
                  </VStack>
                )}
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
        tint('#111318'),
        frame({ maxWidth: Infinity }),
        disabled(loading),
      ]}
    />
  );
}

function ErrorMessage({ message }) {
  const palette = usePalette();
  return (
    <HStack
      alignment="top"
      spacing={8}
      modifiers={[
        padding({ all: 12 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.dangerSoft, shapes.roundedRectangle({ cornerRadius: 14 })),
      ]}
    >
      <Image color={palette.danger} size={16} systemName="exclamationmark.triangle.fill" />
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: 'semibold' }),
          foregroundStyle(palette.danger),
          lineLimit(3),
        ]}
      >
        {message}
      </Text>
    </HStack>
  );
}

function SavedAccountRow({ acc, cardShape, onRemove, onSelect, palette }) {
  const remoteAvatar = useRemoteImage(acc.avatarUri || acc.photoURL);

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
          tint('#111318'),
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
