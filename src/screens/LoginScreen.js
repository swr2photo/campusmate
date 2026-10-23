import { Pressable } from '../components/NativePressable';
import Text from '../components/AppText';
import { AppTextInput as TextInput } from '../components/AppText';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Keyboard, NativeModules, Platform, ScrollView, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { KeyboardAwareScrollView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { GlassIconButton } from '../components/LiquidGlassSurface';
import { Mascot } from '../components/illustrations';
import { mascotLookFor } from '../components/weather/CampusMascotWidget';
import WeatherBackdrop from '../components/weather/WeatherBackdrop';
import { useCampusWeather } from '../context/WeatherContext';
import { useConfirm } from '../context/ConfirmContext';
import useResponsiveSize from '../hooks/useResponsiveSize';
import {
  CAMPUS_EMAIL_DOMAIN,
  isCampusStudentEmail,
  isLoginEmailAllowed,
} from '../utils/campusEmail';
import { evaluatePasswordRules, getPasswordError, PASSWORD_MISMATCH_MESSAGE } from '../utils/passwordPolicy';
import { useRemoteImage } from '../utils/useRemoteImage';
import { motion, radius, useTheme } from '../theme';

// One screen, four modes:
//   welcome  accounts saved on this device first, then Google, student ID, sign-up
//   account  quick sign-in for a saved account (password or Google, whichever
//            that account used last time)
//   login    student ID (@psu.ac.th is added for the user) + password
//   signup   new campus account with a live password checklist
// The hero follows the live campus weather and the mascot reacts to the form.

const appIcon = require('../../assets/icon.png');

const GOOGLE_BLUE = '#4285F4';
const SHEET_OVERLAP = 28;
const VISIBLE_ACCOUNTS = 3;
const COMPACT_MASCOT = 44;
const BACK_ICON = { ios: 'chevron.left', android: 'arrow-back', web: 'arrow-back' };
const KEY_ICON = { ios: 'key.fill', android: 'key', web: 'key' };
const ID_ICON = { ios: 'person.text.rectangle.fill', android: 'id-card', web: 'id-card' };
const CIRCLE_ICON = { ios: 'circle', android: 'ellipse-outline', web: 'ellipse-outline' };
const REMOVE_ICON = 'rectangle.portrait.and.arrow.right';
const THAI_LEADING_VOWEL = /^[เแโใไ]$/;

const METHODS = {
  google: { label: 'Google', hint: 'เข้าสู่ระบบต่อด้วย Google' },
  password: { label: 'รหัสผ่าน', hint: 'ใส่รหัสผ่านเพื่อเข้าสู่ระบบ' },
};

const PASSWORD_CHIPS = [
  ['minLength', '8 ตัวขึ้นไป'],
  ['upper', 'A-Z'],
  ['lower', 'a-z'],
  ['digit', '0-9'],
  ['special', 'อักขระพิเศษ'],
];

function scheduleWhenIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const requestId = globalThis.requestIdleCallback(callback);
    return () => globalThis.cancelIdleCallback?.(requestId);
  }
  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function authCode(error) {
  let code = String(error?.code || '').replace(/^functions\//, '');
  if (!code && error?.message) {
    const match = String(error.message).match(/auth\/[a-z0-9-]+/i);
    if (match) code = match[0].toLowerCase();
  }
  return code;
}

function getInlineAuthFeedback(error, { mode = 'login' } = {}) {
  const code = authCode(error);
  if (code === 'auth/campus-email-required') return { field: 'email', message: 'ใช้อีเมล @psu.ac.th' };
  if (code === 'auth/student-id-required') return { field: 'email', message: 'อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก' };
  if (code === 'auth/campus-email-login-only') return { field: 'email', message: 'ใช้ @psu.ac.th หรือ Gmail ที่สมัครไว้' };
  if (code === 'auth/invalid-email' || code === 'invalid-argument') return { field: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง' };
  if (code === 'auth/user-not-found') return { field: 'email', message: 'ไม่พบบัญชีนี้' };
  if (code === 'auth/campus-email-not-found' || code === 'not-found') return { field: 'email', message: 'ไม่พบอีเมลนี้ใน Google Workspace' };
  if (code === 'auth/campus-email-check-unavailable' || code === 'failed-precondition') return { field: 'email', message: 'ระบบตรวจสอบอีเมลมหาวิทยาลัยยังไม่พร้อม' };
  if (code === 'auth/email-already-in-use' || code === 'already-exists') return { field: 'email', message: 'อีเมลนี้มีบัญชีแล้ว' };
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return {
      field: 'password',
      message: 'รหัสผ่านไม่ถูกต้อง (หากเคยเข้าด้วย Google ให้กดปุ่ม Google หรือกด "ลืมรหัสผ่าน?")',
    };
  }
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return { field: 'password', message: 'รหัสผ่านไม่ตรงตามเงื่อนไข' };
  if (code === 'auth/too-many-requests' || code === 'resource-exhausted') return { message: 'ลองใหม่อีกครั้งภายหลัง' };
  if (code === 'auth/network-request-failed' || code === 'unavailable') return { message: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง' };
  if (code === 'auth/user-disabled') return { message: 'บัญชีนี้ถูกปิดใช้งาน' };
  const configurationMessage = getFirebaseConfigurationErrorMessage(error);
  if (configurationMessage) return { message: configurationMessage };
  return { message: mode === 'signup' ? 'สมัครสมาชิกไม่สำเร็จ ลองใหม่' : 'เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมลหรือรหัสผ่าน แล้วลองใหม่อีกครั้ง' };
}

function isEmailInUse(error) {
  const code = authCode(error);
  return code === 'auth/email-already-in-use' || code === 'already-exists';
}

function getShortPasswordMessage(passwordError) {
  if (passwordError === PASSWORD_MISMATCH_MESSAGE) return 'รหัสผ่านไม่ตรงกัน';
  return 'รหัสผ่านยังไม่ครบตามเงื่อนไขด้านล่าง';
}

function reportUnexpectedAuthError(label, error) {
  const code = String(error?.code || '');
  if (code === 'auth/network-request-failed' || code === 'unavailable') return;
  const detail = code || String(error?.message || '').trim();
  if (detail) console.warn(`${label}: ${detail}`);
}

function haptic(kind) {
  if (Platform.OS === 'web') return;
  const pending = kind === 'select'
    ? Haptics.selectionAsync()
    : Haptics.notificationAsync(kind === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
  pending?.catch?.(() => {});
}

function firstName(account) {
  const name = String(account?.displayName || '').trim();
  if (!name || name.includes('@')) return '';
  return Array.from(name.split(/\s+/)[0]).slice(0, 14).join('');
}

function initialOf(account) {
  const chars = Array.from(String(account?.displayName || account?.email || '?').trim());
  if (THAI_LEADING_VOWEL.test(chars[0] || '') && chars[1]) return chars[0] + chars[1];
  return (chars[0] || '?').toUpperCase();
}

function accountDetail(account) {
  const email = String(account?.email || '');
  const id = isCampusStudentEmail(email) ? email.split('@')[0] : email;
  return account?.faculty ? `${account.faculty} · ${id}` : id;
}

function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'อรุณสวัสดิ์!';
  if (hour >= 11 && hour < 16) return 'สวัสดีตอนบ่าย!';
  if (hour >= 16 && hour < 19) return 'สวัสดีตอนเย็น!';
  return 'สวัสดียามค่ำ!';
}

function formBubble({ mode, reaction, account }) {
  if (reaction === 'busy') return 'รอแป๊บนะ...';
  if (reaction === 'oops') return 'อุ๊ย! ลองใหม่อีกนิดนะ';
  if (reaction === 'yay') return 'เยี่ยมเลย!';
  if (reaction === 'shy') return 'หันหน้าแล้ว ไม่แอบดูนะ';
  if (mode === 'account') {
    const name = firstName(account);
    return name ? `คิดถึงนะ ${name}!` : 'ยินดีต้อนรับกลับ!';
  }
  if (mode === 'signup') return 'มาเป็นเพื่อนกันนะ!';
  return 'ใส่รหัสนักศึกษาได้เลย';
}

// Keyboard state comes from react-native-keyboard-controller on device; the
// web build has no soft keyboard to track.
function useDeviceKeyboardVisible() {
  return useKeyboardState((state) => state.isVisible);
}
function useNoKeyboard() {
  return false;
}
const useKeyboardVisible = Platform.OS === 'web' ? useNoKeyboard : useDeviceKeyboardVisible;
const ScrollContainer = Platform.OS === 'web' ? ScrollView : KeyboardAwareScrollView;
const scrollKeyboardProps = Platform.OS === 'web' ? {} : { bottomOffset: 96 };

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
    setActiveAction('google');
    setLoading(true);
    try {
      const result = await signInWithGoogleCredential(idToken);
      await finishAuthentication(result, 'google');
    } catch (loginError) {
      showInlineError('เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่');
    } finally {
      setLoading(false);
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
  const insets = useSafeAreaInsets();
  const layout = useResponsiveSize();
  const reduceMotion = useReducedMotion();
  const keyboardVisible = useKeyboardVisible();
  const { confirm } = useConfirm();
  const weather = useCampusWeather();
  const styles = getStyles(colors, isDark, layout);

  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mode, setMode] = useState('welcome');
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [manageAccounts, setManageAccounts] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountUsePassword, setAccountUsePassword] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [inlineNotice, setInlineNotice] = useState(null);
  const [focusedField, setFocusedField] = useState(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);

  const isAccountMode = mode === 'account' && Boolean(selectedAccount);
  const isSavedLegacyAccount = isAccountMode && !isCampusStudentEmail(selectedAccount.email);
  const accountMethod = isAccountMode ? selectedAccount.signInMethod : null;
  const accountNeedsPassword = isAccountMode && (accountMethod !== 'google' || accountUsePassword);
  const studentId = email.split('@')[0];
  const hasSavedAccounts = savedAccounts.length > 0;
  const busy = (action) => loading && activeAction === action;

  // Hero: the live campus weather behind the mascot. It is tall on the
  // welcome page, a slim bar with the back button in the forms, and only the
  // bar while the keyboard is up.
  const heroDark = isDark || weather.condition === 'night';
  const heroTheme = weather.theme;
  const heroInk = heroDark ? heroTheme.inkDark : heroTheme.ink;
  const mascotSize = Math.round(
    (layout.height < 640 ? 64 : layout.height < 720 || layout.isSmall ? 78 : layout.isLarge ? 100 : 90)
      * (layout.fontScale > 1.3 ? 0.85 : 1),
  );
  const welcomeHeight = insets.top + 12 + 40 + 6 + Math.round(mascotSize * 1.62) + 6 + SHEET_OVERLAP;
  const compactHeight = insets.top + 8 + 72 + 8 + SHEET_OVERLAP;
  const keyboardHeight = insets.top + 6 + 44 + 8 + SHEET_OVERLAP;
  const heroTarget = mode === 'welcome' ? welcomeHeight : keyboardVisible ? keyboardHeight : compactHeight;
  const heroHeight = useSharedValue(heroTarget);
  useEffect(() => {
    heroHeight.set(reduceMotion
      ? heroTarget
      : withTiming(heroTarget, { duration: motion.duration.slow, easing: Easing.out(Easing.cubic) }));
  }, [heroHeight, heroTarget, reduceMotion]);
  const heroStyle = useAnimatedStyle(() => ({ height: heroHeight.get() }));

  const look = mascotLookFor(weather.condition);
  const hasFieldError = Boolean(fieldErrors.email || fieldErrors.password || fieldErrors.confirmPassword);
  const reaction = loading
    ? 'busy'
    : inlineNotice?.tone === 'error' || hasFieldError
      ? 'oops'
      : inlineNotice?.tone === 'success'
        ? 'yay'
        : focusedField === 'password' || focusedField === 'confirmPassword'
          ? 'shy'
          : null;
  const mascotMood = reaction === 'oops' ? 'sad' : reaction === 'yay' ? 'wow' : look.mood;
  const formPose = reaction === 'busy' ? 'nod'
    : reaction === 'yay' ? 'jump'
      : reaction === 'shy' ? 'look-right'
        : focusedField === 'email' ? 'look-left'
          : mode === 'account' ? 'wave' : 'idle';

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
    haptic('error');
  };

  const showInlineError = (message) => {
    if (!message) return;
    setFieldErrors({});
    setInlineNotice({ tone: 'error', message });
    haptic('error');
  };

  const showInlineSuccess = (message) => {
    if (!message) return;
    setFieldErrors({});
    setInlineNotice({ tone: 'success', message });
    haptic('success');
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
      setAccountsReady(true);
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

  const showMode = (nextMode, { keepEmail = false } = {}) => {
    const leavingAccount = mode === 'account';
    if (nextMode !== 'account') setSelectedAccount(null);
    // A saved account's email never carries over to a form the user types into.
    setEmail((current) => (keepEmail || (!leavingAccount && isCampusStudentEmail(current)) ? current : ''));
    if (nextMode !== 'login') setUnverifiedEmail(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setAccountUsePassword(false);
    setManageAccounts(false);
    setFocusedField(null);
    clearFeedback();
    setMode(nextMode);
  };

  // Android back steps out of a form (or out of managing accounts) before it
  // would leave the app.
  useEffect(() => {
    if (mode === 'welcome' && !manageAccounts) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'welcome') setManageAccounts(false);
      else showMode('welcome');
      return true;
    });
    return () => subscription.remove();
  }, [mode, manageAccounts]);

  // A saved password account opens straight into the password field.
  useEffect(() => {
    if (mode !== 'account' || selectedAccount?.signInMethod !== 'password') return undefined;
    const timer = setTimeout(() => passwordRef.current?.focus(), 380);
    return () => clearTimeout(timer);
  }, [mode, selectedAccount]);

  const finishAuthentication = async (result, signInMethod) => {
    // Saved before the session starts so the next visit remembers how this
    // account signs in (the app saves the same account again after login).
    await saveAccount({ ...result.user, signInMethod });
    haptic('success');
    onLoginSuccess(result.user);
  };

  const handleSelectAccount = (account) => {
    haptic('select');
    setSelectedAccount(account);
    setEmail(account.email || '');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setUnverifiedEmail(null);
    setAccountUsePassword(false);
    setManageAccounts(false);
    setFocusedField(null);
    clearFeedback();
    setMode('account');
  };

  const handleRemoveAccount = async (account) => {
    const name = account.displayName || account.email;
    const accepted = await confirm({
      title: `นำ ${name} ออกจากเครื่องนี้?`,
      body: 'บัญชีและข้อมูลทั้งหมดยังอยู่ครบ เข้าสู่ระบบด้วยบัญชีนี้ใหม่ได้ทุกเมื่อ',
      cancelLabel: 'ยกเลิก',
      confirmLabel: 'นำออก',
      icon: REMOVE_ICON,
    });
    if (!accepted) return;
    const nextList = await removeSavedAccount(account.id || account.email);
    setSavedAccounts(nextList || []);
    if (!nextList || nextList.length === 0) setManageAccounts(false);
  };

  const handleUsePasswordInstead = () => {
    clearFeedback();
    setAccountUsePassword(true);
    setTimeout(() => passwordRef.current?.focus(), 150);
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
    setActiveAction('google');
    clearFeedback();
    if (Platform.OS === 'web') {
      setLoading(true);
      try {
        const result = await signInWithGoogle();
        await finishAuthentication(result, 'google');
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
      showFieldError('email', 'กรอกรหัสนักศึกษาก่อน');
      return;
    }
    if (isSavedLegacyAccount ? !isLoginEmailAllowed(cleanEmail) : !isCampusStudentEmail(cleanEmail)) {
      showFieldError('email', 'กรอกรหัสนักศึกษาให้ครบ 10 หลัก');
      return;
    }

    clearFieldError('email');
    setActiveAction('reset');
    setLoading(true);
    try {
      await sendPasswordReset(cleanEmail);
      showInlineSuccess('ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว ตรวจ Inbox หรือ Junk/Spam');
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
    setActiveAction('resend');
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
    if (loading) return;
    const errors = {};
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      errors.email = isAccountMode ? 'ไม่พบอีเมลของบัญชีนี้ ใช้บัญชีอื่นแทน' : 'กรอกรหัสนักศึกษา';
    } else if (isSavedLegacyAccount ? !isLoginEmailAllowed(cleanEmail) : !isCampusStudentEmail(cleanEmail)) {
      errors.email = isAccountMode ? 'บัญชีนี้เข้าด้วยรหัสผ่านไม่ได้ ลองใช้ Google' : 'กรอกรหัสนักศึกษาให้ครบ 10 หลัก';
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
      haptic('error');
      return;
    }

    Keyboard.dismiss();
    clearFeedback();
    setActiveAction('email');
    setLoading(true);
    try {
      const result = mode === 'signup'
        ? await signUpWithEmail(cleanEmail, password)
        : await signInWithEmail(cleanEmail, password);

      if (result.user.providerData?.some(p => p.providerId === 'password') && !result.user.emailVerified) {
        setUnverifiedEmail(cleanEmail);
        if (mode === 'signup') {
          // Keep the ID and password so "ส่งอีเมลยืนยันใหม่" and signing in
          // after the link is opened need no retyping.
          setConfirmPassword('');
          setShowConfirmPassword(false);
          setMode('login');
          showInlineSuccess('สมัครสำเร็จ! เปิดลิงก์ยืนยันในอีเมล ม.อ. แล้วกลับมากดเข้าสู่ระบบ');
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

      await finishAuthentication(result, 'password');
    } catch (loginError) {
      reportUnexpectedAuthError('Email auth error', loginError);
      if (mode === 'signup' && isEmailInUse(loginError)) {
        haptic('error');
        setFieldErrors({});
        setInlineNotice({
          tone: 'info',
          message: 'รหัสนักศึกษานี้มีบัญชีอยู่แล้ว เข้าสู่ระบบได้เลย',
          action: { label: 'เข้าสู่ระบบด้วยรหัสนี้', onPress: () => showMode('login', { keepEmail: true }) },
        });
      } else {
        showAuthError(loginError, { mode });
      }
    } finally {
      setLoading(false);
    }
  };

  const inputShell = (field) => [
    styles.inputShell,
    focusedField === field && styles.inputShellFocused,
    fieldErrors[field] && styles.inputShellError,
  ];

  const focusProps = (field) => ({
    onBlur: () => setFocusedField((current) => (current === field ? null : current)),
    onFocus: () => setFocusedField(field),
  });

  const sharedInputProps = {
    cursorColor: colors.primary,
    editable: !loading,
    keyboardAppearance: isDark ? 'dark' : 'light',
    placeholderTextColor: colors.inkSoft,
    selectionColor: colors.primary,
    style: styles.input,
  };

  const studentIdField = (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>รหัสนักศึกษา</Text>
      <View style={inputShell('email')}>
        <FeatureIcon color={focusedField === 'email' ? colors.primary : colors.inkSoft} name={ID_ICON} size={18} />
        <TextInput
          {...sharedInputProps}
          {...focusProps('email')}
          accessibilityLabel="รหัสนักศึกษา 10 หลัก"
          autoCapitalize="none"
          autoComplete="username"
          importantForAutofill="yes"
          keyboardType="number-pad"
          maxLength={10}
          onChangeText={(value) => {
            const digits = value.split('@')[0].replace(/[^0-9]/g, '').slice(0, 10);
            setEmail(digits ? `${digits}@${CAMPUS_EMAIL_DOMAIN}` : '');
            setUnverifiedEmail(null);
            clearFieldError('email');
            if (digits.length === 10 && studentId.length < 10) passwordRef.current?.focus();
          }}
          placeholder="6912345678"
          textContentType="username"
          value={studentId}
        />
        <View style={styles.suffix}>
          <Text style={styles.suffixText}>@{CAMPUS_EMAIL_DOMAIN}</Text>
        </View>
      </View>
      {fieldErrors.email ? <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.email}</Text> : null}
    </View>
  );

  const passwordField = (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{mode === 'signup' ? 'ตั้งรหัสผ่าน' : 'รหัสผ่าน'}</Text>
      <View style={inputShell('password')}>
        <FeatureIcon color={focusedField === 'password' ? colors.primary : colors.inkSoft} name="lock.fill" size={17} />
        <TextInput
          {...sharedInputProps}
          {...focusProps('password')}
          accessibilityLabel={mode === 'signup' ? 'ตั้งรหัสผ่าน' : 'รหัสผ่าน'}
          autoCapitalize="none"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          importantForAutofill="yes"
          onChangeText={(value) => {
            setPassword(value);
            clearFieldError('password');
          }}
          onSubmitEditing={mode === 'signup' ? () => confirmRef.current?.focus() : handleEmailAuth}
          placeholder={mode === 'signup' ? 'อย่างน้อย 8 ตัวอักษร' : 'ใส่รหัสผ่าน'}
          ref={passwordRef}
          returnKeyType={mode === 'signup' ? 'next' : 'go'}
          secureTextEntry={!showPassword}
          submitBehavior={mode === 'signup' ? 'submit' : 'blurAndSubmit'}
          textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          value={password}
        />
        <Pressable
          accessibilityLabel={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => setShowPassword((visible) => !visible)}
          style={styles.eyeButton}
        >
          <FeatureIcon color={colors.inkSoft} name={showPassword ? 'eye.slash.fill' : 'eye.fill'} size={19} />
        </Pressable>
      </View>
      {fieldErrors.password ? <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.password}</Text> : null}
    </View>
  );

  const recoveryLinks = (
    <View style={styles.linkRow}>
      {unverifiedEmail ? (
        <TextLink
          busy={busy('resend')}
          busyLabel="กำลังส่ง..."
          label="ส่งอีเมลยืนยันใหม่"
          onPress={handleResendVerification}
          styles={styles}
        />
      ) : <View />}
      <TextLink
        busy={busy('reset')}
        busyLabel="กำลังส่งลิงก์..."
        label="ลืมรหัสผ่าน?"
        onPress={handleForgotPassword}
        styles={styles}
      />
    </View>
  );

  const googleButton = (variant, label) => (
    <GoogleButton
      colors={colors}
      disabled={loading}
      label={label}
      loading={busy('google')}
      onPress={handleGoogleLogin}
      styles={styles}
      variant={variant}
    />
  );

  const notice = <Notice colors={colors} notice={inlineNotice} styles={styles} />;
  const visibleAccounts = showAllAccounts ? savedAccounts : savedAccounts.slice(0, VISIBLE_ACCOUNTS);
  const hiddenAccounts = savedAccounts.length - visibleAccounts.length;

  let body = null;
  if (mode === 'welcome') {
    body = accountsReady ? (
      <Animated.View entering={FadeIn.duration(motion.duration.base)} key="welcome" style={styles.modeBody}>
        <SheetHeader
          action={hasSavedAccounts ? {
            label: manageAccounts ? 'เสร็จ' : 'จัดการ',
            onPress: () => {
              haptic('select');
              setManageAccounts((value) => !value);
            },
          } : null}
          styles={styles}
          subtitle={hasSavedAccounts
            ? (manageAccounts ? 'นำบัญชีออกจากเครื่องนี้ได้ ข้อมูลบัญชียังอยู่ครบ' : 'แตะบัญชีเพื่อเข้าสู่ระบบต่อ')
            : 'เข้าสู่ระบบด้วยอีเมล @psu.ac.th หรือ Gmail ที่เคยใช้สมัคร'}
          title={hasSavedAccounts ? 'ยินดีต้อนรับกลับ' : 'เพื่อนใหม่ในรั้ว ม.อ. รออยู่'}
        />
        {notice}
        {hasSavedAccounts ? (
          <>
            <View style={styles.group}>
              {visibleAccounts.map((account, index) => (
                <AccountRow
                  account={account}
                  colors={colors}
                  disabled={loading}
                  divider={index > 0}
                  key={account.id || account.email}
                  latest={index === 0 && savedAccounts.length > 1}
                  manage={manageAccounts}
                  onRemove={handleRemoveAccount}
                  onSelect={handleSelectAccount}
                  styles={styles}
                />
              ))}
              {hiddenAccounts > 0 ? (
                <Pressable
                  accessibilityLabel={`แสดงบัญชีอีก ${hiddenAccounts} บัญชี`}
                  accessibilityRole="button"
                  onPress={() => setShowAllAccounts(true)}
                  style={({ pressed }) => [styles.moreRow, pressed && styles.rowPressed]}
                >
                  <Text style={styles.moreText}>แสดงอีก {hiddenAccounts} บัญชี</Text>
                  <FeatureIcon color={colors.accentText} name="chevron.down" size={13} />
                </Pressable>
              ) : null}
            </View>
            <OrDivider styles={styles} />
          </>
        ) : null}
        {googleButton(hasSavedAccounts ? 'outlined' : 'filled', 'ดำเนินการต่อด้วย Google')}
        <TonalButton
          disabled={loading}
          icon={ID_ICON}
          label="เข้าสู่ระบบด้วยรหัสนักศึกษา"
          onPress={() => showMode('login')}
          styles={styles}
          colors={colors}
        />
        <FooterLink hint="ยังไม่มีบัญชี?" label="สมัครสมาชิก" onPress={() => showMode('signup')} styles={styles} />
      </Animated.View>
    ) : null;
  } else if (isAccountMode) {
    const compactIdentity = keyboardVisible && accountNeedsPassword;
    body = (
      <Animated.View entering={FadeInDown.duration(motion.duration.slow)} key="account" style={styles.modeBody}>
        <IdentityCard account={selectedAccount} colors={colors} compact={compactIdentity} styles={styles} />
        {fieldErrors.email ? <Text accessibilityRole="alert" style={[styles.fieldError, styles.centerText]}>{fieldErrors.email}</Text> : null}
        {notice}
        {accountNeedsPassword ? (
          <>
            {passwordField}
            {recoveryLinks}
            <PrimaryButton
              disabled={loading}
              label="เข้าสู่ระบบ"
              loading={busy('email')}
              onPress={handleEmailAuth}
              styles={styles}
              colors={colors}
              symbol="arrow.right.circle.fill"
            />
            {accountMethod === 'google' ? null : (
              <>
                <OrDivider styles={styles} />
                {googleButton('outlined', 'ดำเนินการต่อด้วย Google')}
              </>
            )}
          </>
        ) : (
          <>
            {googleButton('filled', 'ดำเนินการต่อด้วย Google')}
            <TextLink centered label="ใช้รหัสผ่านแทน" onPress={handleUsePasswordInstead} styles={styles} />
          </>
        )}
        <FooterLink hint="ไม่ใช่บัญชีนี้?" label="ใช้บัญชีอื่น" onPress={() => showMode('login')} styles={styles} />
      </Animated.View>
    );
  } else if (mode === 'signup') {
    const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;
    body = (
      <Animated.View entering={FadeInDown.duration(motion.duration.slow)} key="signup" style={styles.modeBody}>
        <SheetHeader
          styles={styles}
          subtitle={`ใช้รหัสนักศึกษา 10 หลัก ระบบเติม @${CAMPUS_EMAIL_DOMAIN} ให้อัตโนมัติ`}
          title="สร้างบัญชีใหม่"
        />
        {notice}
        {studentIdField}
        {passwordField}
        <PasswordChecklist colors={colors} email={email} password={password} styles={styles} />
        <View style={styles.fieldBlock}>
          <Text style={styles.label}>ยืนยันรหัสผ่าน</Text>
          <View style={inputShell('confirmPassword')}>
            <FeatureIcon color={focusedField === 'confirmPassword' ? colors.primary : colors.inkSoft} name="lock.shield.fill" size={17} />
            <TextInput
              {...sharedInputProps}
              {...focusProps('confirmPassword')}
              accessibilityLabel="ยืนยันรหัสผ่าน"
              autoCapitalize="none"
              autoComplete="new-password"
              importantForAutofill="yes"
              onChangeText={(value) => {
                setConfirmPassword(value);
                clearFieldError('confirmPassword');
              }}
              onSubmitEditing={handleEmailAuth}
              placeholder="กรอกรหัสผ่านอีกครั้ง"
              ref={confirmRef}
              returnKeyType="go"
              secureTextEntry={!showConfirmPassword}
              textContentType="newPassword"
              value={confirmPassword}
            />
            <Pressable
              accessibilityLabel={showConfirmPassword ? 'ซ่อนรหัสผ่านที่ยืนยัน' : 'แสดงรหัสผ่านที่ยืนยัน'}
              accessibilityRole="button"
              hitSlop={4}
              onPress={() => setShowConfirmPassword((visible) => !visible)}
              style={styles.eyeButton}
            >
              <FeatureIcon color={colors.inkSoft} name={showConfirmPassword ? 'eye.slash.fill' : 'eye.fill'} size={19} />
            </Pressable>
          </View>
          {fieldErrors.confirmPassword ? (
            <Text accessibilityRole="alert" style={styles.fieldError}>{fieldErrors.confirmPassword}</Text>
          ) : confirmPassword ? (
            <View style={styles.matchRow}>
              <FeatureIcon color={passwordsMatch ? colors.green : colors.inkSoft} name={passwordsMatch ? 'checkmark.circle.fill' : CIRCLE_ICON} size={14} />
              <Text style={[styles.matchText, passwordsMatch && styles.matchTextOk]}>
                {passwordsMatch ? 'รหัสผ่านตรงกัน' : 'ยังไม่ตรงกับรหัสผ่านด้านบน'}
              </Text>
            </View>
          ) : null}
        </View>
        <PrimaryButton
          busyLabel="กำลังสร้างบัญชี..."
          disabled={loading}
          label="สมัครสมาชิก"
          loading={busy('email')}
          onPress={handleEmailAuth}
          styles={styles}
          colors={colors}
          symbol="person.badge.plus"
        />
        <OrDivider styles={styles} />
        {googleButton('outlined', 'ดำเนินการต่อด้วย Google')}
        <FooterLink hint="มีบัญชีอยู่แล้ว?" label="เข้าสู่ระบบ" onPress={() => showMode('login', { keepEmail: true })} styles={styles} />
      </Animated.View>
    );
  } else {
    body = (
      <Animated.View entering={FadeInDown.duration(motion.duration.slow)} key="login" style={styles.modeBody}>
        <SheetHeader
          styles={styles}
          subtitle={`ใช้รหัสนักศึกษา 10 หลัก ระบบเติม @${CAMPUS_EMAIL_DOMAIN} ให้อัตโนมัติ`}
          title="เข้าสู่ระบบ"
        />
        {notice}
        {studentIdField}
        {passwordField}
        {recoveryLinks}
        <PrimaryButton
          disabled={loading}
          label="เข้าสู่ระบบ"
          loading={busy('email')}
          onPress={handleEmailAuth}
          styles={styles}
          colors={colors}
          symbol="arrow.right.circle.fill"
        />
        <OrDivider styles={styles} />
        {googleButton('outlined', 'ดำเนินการต่อด้วย Google')}
        <FooterLink hint="ยังไม่มีบัญชี?" label="สมัครสมาชิก" onPress={() => showMode('signup', { keepEmail: true })} styles={styles} />
      </Animated.View>
    );
  }

  const latestName = hasSavedAccounts ? firstName(savedAccounts[0]) : '';
  // An opaque-looking bubble: lit windows in the night skyline must not show
  // through the text.
  const bubbleInk = heroDark ? '#1E2238' : heroTheme.ink;
  const bubbleBackground = heroDark ? 'rgba(238,240,250,0.94)' : 'rgba(255,255,255,0.9)';

  return (
    <View style={styles.root}>
      <StatusBar style={heroDark ? 'light' : 'dark'} />
      <ScrollContainer
        {...scrollKeyboardProps}
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <Animated.View style={[styles.hero, heroStyle]}>
          <View pointerEvents="none" style={[styles.backdropFrame, { height: welcomeHeight }]}>
            <WeatherBackdrop condition={weather.condition} dark={isDark} />
          </View>
          <View style={[styles.heroContent, { paddingTop: insets.top + (mode === 'welcome' ? 12 : keyboardVisible ? 6 : 8) }]}>
            {mode === 'welcome' ? (
              <Animated.View entering={FadeIn.duration(motion.duration.base)} key="hero-welcome">
                <View accessibilityRole="header" accessible style={styles.brandRow}>
                  <Image accessibilityIgnoresInvertColors source={appIcon} style={styles.brandIcon} />
                  <Text style={[styles.brandName, { color: heroInk }]}>CampusMate</Text>
                </View>
                <View style={styles.welcomeStage}>
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Mascot
                      accessory={look.outfit === 'rain' ? 'none' : undefined}
                      mood={mascotMood}
                      outfit={look.outfit}
                      pose={look.outfit === 'rain' ? 'idle' : 'wave'}
                      size={mascotSize}
                    />
                  </View>
                  <View accessible style={[styles.bubble, { backgroundColor: bubbleBackground }]}>
                    <View style={[styles.bubbleTailLeft, { borderRightColor: bubbleBackground }]} />
                    <Text numberOfLines={2} style={[styles.bubbleTitle, { color: bubbleInk }]}>
                      {latestName ? `คิดถึงนะ ${latestName}!` : hasSavedAccounts ? 'ยินดีต้อนรับกลับ!' : greetingFor()}
                    </Text>
                    <View style={styles.bubbleWeather}>
                      <FeatureIcon color={heroTheme.accent} name={heroTheme.icon} size={13} />
                      <Text numberOfLines={2} style={[styles.bubbleWeatherText, { color: bubbleInk }]}>
                        {`ม.อ. หาดใหญ่ ${weather.temperature != null ? `${weather.temperature}° · ` : '· '}${heroTheme.label}`}
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeIn.duration(motion.duration.base)} key="hero-form" style={styles.compactRow}>
                <GlassIconButton
                  accessibilityLabel="ย้อนกลับ"
                  colorScheme={heroDark ? 'dark' : 'light'}
                  fallbackBackgroundColor={heroDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.72)'}
                  icon={BACK_ICON}
                  iconColor={heroInk}
                  iconSize={19}
                  onPress={() => showMode('welcome')}
                />
                <View style={styles.compactSpacer} />
                {keyboardVisible ? null : (
                  <>
                    <View accessible style={[styles.compactBubble, { backgroundColor: bubbleBackground }]}>
                      <Text numberOfLines={2} style={[styles.compactBubbleText, { color: bubbleInk }]}>
                        {formBubble({ mode, reaction, account: selectedAccount })}
                      </Text>
                      <View style={[styles.bubbleTailRight, { borderLeftColor: bubbleBackground }]} />
                    </View>
                    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <Mascot
                        accessory={look.outfit === 'rain' ? 'none' : undefined}
                        mood={mascotMood}
                        outfit={look.outfit}
                        pose={formPose}
                        size={COMPACT_MASCOT}
                      />
                    </View>
                  </>
                )}
              </Animated.View>
            )}
          </View>
        </Animated.View>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetInner}>
            {body}
            <LegalAuthNotice compact style={styles.legal} />
          </View>
        </View>
      </ScrollContainer>
    </View>
  );
}

function SheetHeader({ title, subtitle, action, styles }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? (
        <Pressable
          accessibilityLabel={action.label === 'จัดการ' ? 'จัดการบัญชีที่บันทึกไว้' : 'เสร็จสิ้นการจัดการบัญชี'}
          accessibilityRole="button"
          hitSlop={6}
          onPress={action.onPress}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Text style={styles.headerActionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Notice({ notice, colors, styles }) {
  if (!notice) return null;
  const palette = notice.tone === 'success'
    ? { background: colors.greenSoft, foreground: colors.green, icon: 'checkmark.circle.fill' }
    : notice.tone === 'info'
      ? { background: colors.primarySoft, foreground: colors.accentText, icon: 'info.circle.fill' }
      : { background: colors.dangerSoft, foreground: colors.danger, icon: 'exclamationmark.triangle.fill' };
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      entering={FadeIn.duration(motion.duration.base)}
      style={[styles.notice, { backgroundColor: palette.background }]}
    >
      <FeatureIcon color={palette.foreground} name={palette.icon} size={18} />
      <View style={styles.noticeBody}>
        <Text style={styles.noticeText}>{notice.message}</Text>
        {notice.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={notice.action.onPress}
            style={({ pressed }) => [styles.noticeAction, pressed && styles.pressed]}
          >
            <Text style={[styles.noticeActionText, { color: palette.foreground }]}>{notice.action.label}</Text>
            <FeatureIcon color={palette.foreground} name="chevron.right" size={12} />
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

function AccountAvatar({ account, size, ring = false, colors, styles }) {
  const imageUri = useRemoteImage(account?.avatarUri || account?.photoURL, account?.avatarRevision, account?.id);
  const inner = ring ? size - 8 : size;
  const method = account?.signInMethod;
  const badge = Math.max(18, Math.round(size * 0.36));
  return (
    <View style={{ height: size, width: size }}>
      <View style={[styles.avatarFrame, { borderRadius: size / 2, height: size, width: size }, ring && { borderColor: colors.primary, borderWidth: 2 }]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={{ borderRadius: inner / 2, height: inner, width: inner }} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: account?.avatarColor || colors.primary, borderRadius: inner / 2, height: inner, width: inner }]}>
            <Text style={[styles.avatarInitial, { fontSize: Math.round(inner * 0.4) }]}>{initialOf(account)}</Text>
          </View>
        )}
      </View>
      {METHODS[method] ? (
        <View style={[styles.methodBadge, { borderRadius: badge / 2, height: badge, width: badge }]}>
          <MethodGlyph colors={colors} method={method} size={Math.round(badge * 0.58)} />
        </View>
      ) : null}
    </View>
  );
}

function MethodGlyph({ method, size, colors }) {
  if (method === 'google') return <Ionicons color={GOOGLE_BLUE} name="logo-google" size={size} />;
  return <FeatureIcon color={colors.inkMuted} name={KEY_ICON} size={size} />;
}

function AccountRow({ account, latest, manage, divider, disabled, onSelect, onRemove, colors, styles }) {
  const name = account.displayName || account.email;
  const method = METHODS[account.signInMethod];
  return (
    <View style={styles.accountRow}>
      {divider ? <View style={styles.rowDivider} /> : null}
      <Pressable
        accessibilityHint={manage ? undefined : method?.hint || 'เลือกวิธีเข้าสู่ระบบสำหรับบัญชีนี้'}
        accessibilityLabel={`${manage ? '' : 'เข้าสู่ระบบเป็น '}${name} ${accountDetail(account)}${latest ? ' ใช้ล่าสุด' : ''}`}
        accessibilityRole="button"
        android_ripple={manage ? undefined : { color: colors.surfaceContainerHighest }}
        disabled={manage || disabled}
        onPress={manage ? undefined : () => onSelect(account)}
        style={({ pressed }) => [styles.accountMain, pressed && !manage && Platform.OS === 'ios' && styles.rowPressed]}
      >
        <AccountAvatar account={account} colors={colors} ring={latest} size={50} styles={styles} />
        <View style={styles.accountText}>
          <View style={styles.accountNameRow}>
            <Text numberOfLines={1} style={styles.accountName}>{name}</Text>
            {latest ? (
              <View style={styles.latestTag}>
                <Text style={styles.latestTagText}>ล่าสุด</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={styles.accountDetail}>{accountDetail(account)}</Text>
        </View>
        {manage ? null : <FeatureIcon color={colors.inkSoft} name="chevron.right" size={15} />}
      </Pressable>
      {manage ? (
        <Animated.View entering={FadeIn.duration(motion.duration.fast)}>
          <Pressable
            accessibilityLabel={`นำบัญชี ${name} ออกจากเครื่องนี้`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => onRemove(account)}
            style={({ pressed }) => [styles.removePill, pressed && styles.pressed]}
          >
            <Text style={styles.removePillText}>นำออก</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

function IdentityCard({ account, compact, colors, styles }) {
  const name = account.displayName || account.email;
  const method = METHODS[account.signInMethod];
  if (compact) {
    return (
      <Animated.View entering={FadeIn.duration(motion.duration.fast)} style={styles.identityCompact}>
        <AccountAvatar account={account} colors={colors} size={44} styles={styles} />
        <View style={styles.accountText}>
          <Text numberOfLines={1} style={styles.accountName}>{name}</Text>
          <Text numberOfLines={1} style={styles.accountDetail}>{account.email}</Text>
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} style={styles.identity}>
      <AccountAvatar account={account} colors={colors} ring size={88} styles={styles} />
      <Text accessibilityRole="header" numberOfLines={2} style={styles.identityName}>{name}</Text>
      <Text numberOfLines={1} style={styles.identityEmail}>{account.email}</Text>
      {account.faculty || method ? (
        <View style={styles.identityChips}>
          {account.faculty ? (
            <View style={styles.chip}>
              <FeatureIcon color={colors.inkMuted} name="graduationcap.fill" size={13} />
              <Text numberOfLines={1} style={styles.chipText}>{account.faculty}</Text>
            </View>
          ) : null}
          {method ? (
            <View style={styles.chip}>
              <MethodGlyph colors={colors} method={account.signInMethod} size={12} />
              <Text numberOfLines={1} style={styles.chipText}>ครั้งก่อนเข้าด้วย{method.label}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

function PasswordChecklist({ password, email, colors, styles }) {
  const rules = evaluatePasswordRules(password, { email });
  const extra = !password ? null
    : !rules.noSpace ? 'ห้ามมีช่องว่าง'
      : !rules.notCommon ? 'รหัสนี้เดาง่ายเกินไป ลองตั้งใหม่'
        : !rules.notEmail ? 'ห้ามใช้รหัสนักศึกษาในรหัสผ่าน'
          : !rules.maxLength ? 'ยาวได้ไม่เกิน 128 ตัวอักษร'
            : null;
  const summary = PASSWORD_CHIPS
    .map(([key, label]) => `${label} ${password && rules[key] ? 'ผ่าน' : 'ยังไม่ผ่าน'}`)
    .join(', ');
  return (
    <View accessible accessibilityLabel={`เงื่อนไขรหัสผ่าน: ${summary}${extra ? `, ${extra}` : ''}`} style={styles.rules}>
      {PASSWORD_CHIPS.map(([key, label]) => {
        const ok = Boolean(password) && rules[key];
        return (
          <View key={key} style={[styles.ruleChip, ok && styles.ruleChipOk]}>
            <FeatureIcon color={ok ? colors.green : colors.inkSoft} name={ok ? 'checkmark.circle.fill' : CIRCLE_ICON} size={13} />
            <Text style={[styles.ruleText, ok && styles.ruleTextOk]}>{label}</Text>
          </View>
        );
      })}
      {extra ? <Text style={styles.ruleWarning}>{extra}</Text> : null}
    </View>
  );
}

function PrimaryButton({ label, busyLabel = 'กำลังเข้าสู่ระบบ...', loading, disabled, onPress, styles, colors, symbol }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, disabled && !loading && styles.disabled]}
    >
      {loading ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <FeatureIcon color={colors.onPrimary} name={symbol} size={19} />
      )}
      <Text style={styles.primaryButtonText}>{loading ? busyLabel : label}</Text>
    </Pressable>
  );
}

function GoogleButton({ variant, label, loading, disabled, onPress, styles, colors }) {
  const filled = variant === 'filled';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        filled ? styles.primaryButton : styles.outlinedButton,
        pressed && styles.pressed,
        disabled && !loading && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={filled ? colors.onPrimary : colors.primary} />
      ) : (
        <View style={filled ? styles.googleBadge : styles.googleBadgePlain}>
          <Ionicons color={GOOGLE_BLUE} name="logo-google" size={filled ? 15 : 18} />
        </View>
      )}
      <Text style={filled ? styles.primaryButtonText : styles.outlinedButtonText}>{label}</Text>
    </Pressable>
  );
}

function TonalButton({ icon, label, onPress, disabled, styles, colors }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tonalButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <FeatureIcon color={colors.accentText} name={icon} size={19} />
      <Text style={styles.tonalButtonText}>{label}</Text>
    </Pressable>
  );
}

function TextLink({ label, busy = false, busyLabel, onPress, centered = false, styles }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.textLink, centered && styles.textLinkCentered, pressed && styles.pressed]}
    >
      <Text style={styles.textLinkText}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

function FooterLink({ hint, label, onPress, styles }) {
  return (
    <Pressable
      accessibilityLabel={`${hint} ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.footerLink, pressed && styles.pressed]}
    >
      <Text style={styles.footerHint}>
        {hint} <Text style={styles.footerAction}>{label}</Text>
      </Text>
    </Pressable>
  );
}

function OrDivider({ styles }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.orRow}>
      <View style={styles.orLine} />
      <Text style={styles.orText}>หรือ</Text>
      <View style={styles.orLine} />
    </View>
  );
}

const getStyles = (colors, isDark, layout) => {
  const hairline = StyleSheet.hairlineWidth;
  const buttonBase = {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 12,
  };
  const buttonText = { flexShrink: 1, fontSize: 16, fontWeight: '800', textAlign: 'center' };
  return StyleSheet.create({
    root: { backgroundColor: colors.canvas, flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1 },

    hero: { overflow: 'hidden' },
    backdropFrame: { left: 0, position: 'absolute', right: 0, top: 0 },
    heroContent: { alignSelf: 'center', maxWidth: 560, paddingHorizontal: layout.gutter, width: '100%' },
    brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10, height: 40 },
    brandIcon: { borderRadius: 9, height: 32, width: 32 },
    brandName: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
    welcomeStage: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 6 },
    bubble: {
      borderCurve: 'continuous',
      borderRadius: 18,
      flex: 1,
      marginBottom: 18,
      minWidth: 0,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    bubbleTailLeft: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 7,
      borderRightWidth: 9,
      borderTopColor: 'transparent',
      borderTopWidth: 7,
      height: 0,
      left: -9,
      position: 'absolute',
      top: 18,
      width: 0,
    },
    bubbleTitle: { fontSize: 16, fontWeight: '800', lineHeight: 22 },
    bubbleWeather: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 3 },
    bubbleWeatherText: { flexShrink: 1, fontSize: 12, fontWeight: '600', lineHeight: 17, opacity: 0.85 },
    compactRow: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 44 },
    compactSpacer: { flex: 1 },
    compactBubble: {
      borderCurve: 'continuous',
      borderRadius: 16,
      flexShrink: 1,
      marginRight: 4,
      maxWidth: '62%',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    compactBubbleText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
    bubbleTailRight: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 6,
      borderLeftWidth: 8,
      borderTopColor: 'transparent',
      borderTopWidth: 6,
      height: 0,
      position: 'absolute',
      right: -8,
      top: '50%',
      marginTop: -6,
      width: 0,
    },

    sheet: {
      backgroundColor: colors.canvas,
      borderCurve: 'continuous',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      flexGrow: 1,
      marginTop: -SHEET_OVERLAP,
      paddingHorizontal: layout.gutter,
      paddingTop: 22,
    },
    sheetInner: { alignSelf: 'center', flexGrow: 1, maxWidth: 480, width: '100%' },
    modeBody: { gap: 12 },
    header: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, marginBottom: 2 },
    headerText: { flex: 1, gap: 4 },
    title: { color: colors.ink, fontSize: layout.font.title + 2, fontWeight: '800', letterSpacing: -0.3 },
    subtitle: { color: colors.inkMuted, fontSize: layout.font.caption + 1, lineHeight: 20 },
    headerAction: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 6 },
    headerActionText: { color: colors.accentText, fontSize: 15, fontWeight: '700' },

    group: {
      backgroundColor: colors.card,
      borderColor: colors.line,
      borderCurve: 'continuous',
      borderRadius: 22,
      borderWidth: isDark ? 0 : hairline,
      overflow: 'hidden',
    },
    accountRow: { alignItems: 'center', flexDirection: 'row', paddingRight: 12 },
    rowDivider: { backgroundColor: colors.line, height: hairline, left: 78, position: 'absolute', right: 0, top: 0 },
    accountMain: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 12,
      minHeight: 74,
      paddingLeft: 14,
      paddingRight: 4,
      paddingVertical: 11,
    },
    rowPressed: { backgroundColor: colors.surfaceContainerLow },
    accountText: { flex: 1, gap: 2, minWidth: 0 },
    accountNameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    accountName: { color: colors.ink, flexShrink: 1, fontSize: layout.font.body, fontWeight: '700' },
    accountDetail: { color: colors.inkMuted, fontSize: layout.font.caption },
    latestTag: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
    latestTagText: { color: colors.accentText, fontSize: 11, fontWeight: '800' },
    removePill: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.pill,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: 14,
    },
    removePillText: { color: colors.danger, fontSize: 13, fontWeight: '800' },
    moreRow: {
      alignItems: 'center',
      borderTopColor: colors.line,
      borderTopWidth: hairline,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: 48,
    },
    moreText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },

    avatarFrame: { alignItems: 'center', justifyContent: 'center' },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { color: '#FFFFFF', fontWeight: '800', includeFontPadding: false },
    methodBadge: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderColor: colors.line,
      borderWidth: 1,
      bottom: -2,
      justifyContent: 'center',
      position: 'absolute',
      right: -2,
    },

    identity: { alignItems: 'center', gap: 2, paddingBottom: 4 },
    identityName: {
      color: colors.ink,
      fontSize: layout.font.title + 1,
      fontWeight: '800',
      letterSpacing: -0.2,
      marginTop: 10,
      textAlign: 'center',
    },
    identityEmail: { color: colors.inkMuted, fontSize: 14, textAlign: 'center' },
    identityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 },
    identityCompact: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderColor: colors.line,
      borderCurve: 'continuous',
      borderRadius: 18,
      borderWidth: isDark ? 0 : hairline,
      flexDirection: 'row',
      gap: 12,
      padding: 12,
    },
    chip: {
      alignItems: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radius.pill,
      flexDirection: 'row',
      gap: 5,
      maxWidth: '100%',
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chipText: { color: colors.inkMuted, flexShrink: 1, fontSize: 12, fontWeight: '700' },

    notice: {
      alignItems: 'flex-start',
      borderCurve: 'continuous',
      borderRadius: 16,
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    noticeBody: { flex: 1, gap: 4 },
    noticeText: { color: colors.ink, fontSize: 13, fontWeight: '600', lineHeight: 19 },
    noticeAction: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 4, minHeight: 32 },
    noticeActionText: { fontSize: 13, fontWeight: '800' },

    fieldBlock: { gap: 6 },
    label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    inputShell: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderColor: colors.outlineVariant,
      borderCurve: 'continuous',
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      minHeight: 54,
      paddingLeft: 14,
      paddingRight: 5,
    },
    inputShellFocused: { borderColor: colors.primary, borderWidth: 2, paddingLeft: 13, paddingRight: 4 },
    inputShellError: { borderColor: colors.danger, borderWidth: 2, paddingLeft: 13, paddingRight: 4 },
    input: { color: colors.ink, flex: 1, fontSize: layout.font.body, minHeight: 50, minWidth: 0 },
    suffix: {
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: 10,
      marginRight: 4,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    suffixText: { color: colors.inkMuted, fontSize: 13, fontWeight: '700' },
    eyeButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
    fieldError: { color: colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 },
    centerText: { textAlign: 'center' },
    linkRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: -6 },
    textLink: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 2 },
    textLinkCentered: { alignSelf: 'center' },
    textLinkText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },

    rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -4 },
    ruleChip: {
      alignItems: 'center',
      backgroundColor: colors.chipIdle,
      borderRadius: radius.pill,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    ruleChipOk: { backgroundColor: colors.greenSoft },
    ruleText: { color: colors.inkMuted, fontSize: 12, fontWeight: '700' },
    ruleTextOk: { color: isDark ? colors.green : '#0E7A57' },
    ruleWarning: { color: colors.danger, fontSize: 12, fontWeight: '700', width: '100%' },
    matchRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    matchText: { color: colors.inkMuted, fontSize: 12, fontWeight: '700' },
    matchTextOk: { color: isDark ? colors.green : '#0E7A57' },

    primaryButton: { ...buttonBase, backgroundColor: colors.primary },
    primaryButtonText: { ...buttonText, color: colors.onPrimary },
    outlinedButton: { ...buttonBase, backgroundColor: colors.card, borderColor: colors.outlineVariant, borderWidth: 1 },
    outlinedButtonText: { ...buttonText, color: colors.ink },
    tonalButton: { ...buttonBase, backgroundColor: colors.primarySoft },
    tonalButtonText: { ...buttonText, color: colors.accentText },
    googleBadge: {
      alignItems: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: 13,
      height: 26,
      justifyContent: 'center',
      width: 26,
    },
    googleBadgePlain: { alignItems: 'center', height: 26, justifyContent: 'center', width: 26 },
    orRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    orLine: { backgroundColor: colors.outlineVariant, flex: 1, height: hairline },
    orText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    footerLink: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
    footerHint: { color: colors.inkMuted, fontSize: 14, textAlign: 'center' },
    footerAction: { color: colors.accentText, fontWeight: '800' },
    legal: { marginTop: 'auto', paddingBottom: 0, paddingHorizontal: 0, paddingTop: 18 },

    pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
    disabled: { opacity: 0.6 },
  });
};
