import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAdditionalUserInfo,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  signOut,
  sendEmailVerification,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { firebaseApp, firebaseConfigError } from './dbService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  assertCampusEmail,
  assertLoginEmailAllowed,
  CAMPUS_EMAIL_ALREADY_USED_MESSAGE,
  CAMPUS_EMAIL_NOT_IN_WORKSPACE_MESSAGE,
  CAMPUS_EMAIL_SENDER,
  CAMPUS_SIGNUP_REQUIRED_MESSAGE,
  campusEmailError,
  getCampusEmailErrorMessage,
  isCampusEmail,
  isLikelyNewFirebaseUser,
  normalizeEmail,
} from '../utils/campusEmail';
import { getPasswordError, PASSWORD_REQUIREMENTS_MESSAGE } from '../utils/passwordPolicy';

let auth = null;

// Firebase owns the shape and lifecycle of this value. Keep its persistence
// on the official AsyncStorage adapter so native auth initialization cannot be
// blocked by SecureStore/AES startup work. Offline app snapshots still use the
// encrypted storage utility separately.
//
// Versions that briefly used the encrypted adapter left values prefixed with
// ENC:* in AsyncStorage. They are not valid Firebase JSON, so discard only
// those old Auth entries and let the user sign in again once. Plaintext
// Firebase Auth entries from older releases remain readable.
const legacyEncryptedPrefixes = ['ENC:AESGCM:1:', 'ENC:1:'];
const authStorage = {
  async getItem(key) {
    const value = await AsyncStorage.getItem(key);
    if (value && legacyEncryptedPrefixes.some((prefix) => value.startsWith(prefix))) {
      await AsyncStorage.removeItem(key).catch(() => {});
      console.warn('[authService] Removed an incompatible legacy Auth session; sign-in is required again.');
      return null;
    }
    return value;
  },
  setItem(key, value) {
    return AsyncStorage.setItem(key, value);
  },
  removeItem(key) {
    return AsyncStorage.removeItem(key);
  },
};

if (firebaseApp) {
  if (Platform.OS === 'web') {
    auth = getAuth(firebaseApp);
  } else {
    try {
      auth = initializeAuth(firebaseApp, {
        persistence: getReactNativePersistence(authStorage),
      });
    } catch (error) {
      // Hot reload can report that Auth is already initialized. Only reuse
      // that existing instance; do not silently fall back to an unknown
      // plaintext persistence implementation when secure storage setup fails.
      if (error?.code === 'auth/already-initialized') auth = getAuth(firebaseApp);
    }
  }
}

function requireAuth() {
  if (!auth) {
    throw new Error(firebaseConfigError || 'Firebase Authentication is not initialized');
  }
  auth.languageCode = 'th';
  return auth;
}

// Firebase exposes API-key restriction failures as auth errors. They are
// configuration/network errors, not bad credentials, so screens should never
// show the raw SDK message (or tell the user that their password is wrong).
export function getFirebaseConfigurationErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('firebase configuration is missing')
    || message.includes('firebase authentication is not initialized')) {
    return 'ยังเชื่อมต่อระบบเข้าสู่ระบบไม่ได้ กรุณาตรวจสอบการตั้งค่า Firebase ของแอป';
  }
  const isApiKeyRestrictionError = code.includes('requests-from-referrer')
    || message.includes('requests-from-referrer')
    || code.includes('api-key-not-valid')
    || code.includes('invalid-api-key')
    || message.includes('api key not valid');

  if (isApiKeyRestrictionError) {
    const platformName = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'เว็บ';
    return `การตั้งค่า Firebase สำหรับแอป${platformName}ไม่อนุญาตคำขอจากอุปกรณ์ จึงยังตรวจสอบรหัสผ่านไม่ได้ กรุณาใช้ API key ของแอป${platformName} แล้วติดตั้งเวอร์ชันล่าสุด`;
  }

  return null;
}

function normalizeUser(user) {
  return {
    id: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
    providerData: user.providerData,
    creationTime: user.metadata?.creationTime || null,
    lastSignInTime: user.metadata?.lastSignInTime || null,
  };
}

const AUTH_CONTINUE_URL = 'https://campusmate-7f1ab.web.app/email-verified.html';
const FUNCTIONS_REGION = 'asia-southeast1';
const AUTH_NETWORK_RETRY_DELAY_MS = 450;

function isAuthNetworkError(error) {
  return String(error?.code || '') === 'auth/network-request-failed';
}

async function withAuthNetworkRetry(request) {
  try {
    return await request();
  } catch (error) {
    if (!isAuthNetworkError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, AUTH_NETWORK_RETRY_DELAY_MS));
    return request();
  }
}

function shouldFallbackToFirebaseEmail(error) {
  const code = String(error?.code || '').replace(/^functions\//, '');
  return code === 'not-found'
    || code === 'failed-precondition'
    || code === 'unavailable'
    || code === 'unimplemented';
}

async function rejectUnauthorizedNewUser(result) {
  const user = result?.user;
  if (!user || isCampusEmail(user.email)) return;
  const isNewUser = getAdditionalUserInfo(result)?.isNewUser === true
    || isLikelyNewFirebaseUser(normalizeUser(user));
  if (!isNewUser) return;

  try {
    await deleteUser(user);
  } catch (error) {
    console.warn('[authService] Unable to delete unauthorized new account:', error?.code || error?.message || error);
  }
  try {
    await signOutUser();
  } catch (_) {}
  throw campusEmailError('auth/campus-email-required', CAMPUS_SIGNUP_REQUIRED_MESSAGE);
}

async function sendVerifyBeforeUpdateEmail(user, email) {
  try {
    await verifyBeforeUpdateEmail(user, email, {
      url: AUTH_CONTINUE_URL,
      handleCodeInApp: false,
    });
  } catch (error) {
    if (
      error?.code === 'auth/unauthorized-continue-uri'
      || error?.code === 'auth/invalid-continue-uri'
      || error?.code === 'auth/missing-continue-uri'
      || error?.code === 'auth/argument-error'
      || error?.code === 'auth/invalid-argument'
    ) {
      await verifyBeforeUpdateEmail(user, email);
      return;
    }
    throw error;
  }
}

export async function signInWithGoogle() {
  if (Platform.OS !== 'web') {
    throw new Error('Google Sign-In บน iOS/Android ต้องตั้งค่า Google OAuth Client ID ก่อน กรุณาใช้อีเมลเข้าสู่ระบบในตอนนี้');
  }

  const provider = new GoogleAuthProvider();
  provider.addScope('profile');
  provider.addScope('email');
  const result = await signInWithPopup(requireAuth(), provider);
  await rejectUnauthorizedNewUser(result);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function signInWithGoogleCredential(id_token) {
  const credential = GoogleAuthProvider.credential(id_token);
  const result = await withAuthNetworkRetry(() => signInWithCredential(requireAuth(), credential));
  await rejectUnauthorizedNewUser(result);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

function isNativeGoogleSigninAvailable() {
  return Boolean(
    Platform.OS !== 'web' &&
      (TurboModuleRegistry?.get?.('RNGoogleSignin') || NativeModules?.RNGoogleSignin)
  );
}

export async function signOutUser() {
  if (isNativeGoogleSigninAvailable()) {
    try {
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');
      if (await GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signOut();
      }
    } catch (_) {}
  }
  await signOut(requireAuth());
}

export function isFirebaseConfigured() {
  return Boolean(auth && !firebaseConfigError);
}

export async function checkCampusEmailAvailability(email) {
  const campusEmail = assertCampusEmail(email);
  if (!firebaseApp) {
    throw new Error(firebaseConfigError || 'Firebase Authentication is not initialized');
  }

  const checkEmail = httpsCallable(
    getFunctions(firebaseApp, FUNCTIONS_REGION),
    'checkCampusEmailAvailability',
    { timeout: 10000 }
  );
  const result = await checkEmail({ email: campusEmail });
  const data = result?.data || {};
  return {
    email: campusEmail,
    exists: data.exists === true,
    ownedByCurrentUser: data.ownedByCurrentUser === true,
    workspaceExists: data.workspaceExists === true,
    workspaceCheckConfigured: data.workspaceCheckConfigured === true,
  };
}

async function assertCampusEmailAvailable(email, { allowCurrentUser = false } = {}) {
  const availability = await checkCampusEmailAvailability(email);
  if (availability.workspaceCheckConfigured && !availability.workspaceExists) {
    throw campusEmailError('auth/campus-email-not-found', CAMPUS_EMAIL_NOT_IN_WORKSPACE_MESSAGE);
  }
  if (availability.exists && !(allowCurrentUser && availability.ownedByCurrentUser)) {
    throw campusEmailError('auth/email-already-in-use', CAMPUS_EMAIL_ALREADY_USED_MESSAGE);
  }
  return availability;
}

export async function signUpWithEmail(email, password) {
  const campusEmail = assertCampusEmail(email);
  const passwordError = getPasswordError(password, { email: campusEmail });
  if (passwordError) {
    throw campusEmailError('auth/weak-password', passwordError);
  }
  await assertCampusEmailAvailable(campusEmail);
  const result = await withAuthNetworkRetry(() => createUserWithEmailAndPassword(requireAuth(), campusEmail, password));
  try {
    await sendBrandedEmailVerificationForCurrentUser();
  } catch (error) {
    try { await signOutUser(); } catch (_) {}
    throw error;
  }
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function signInWithEmail(email, password) {
  const loginEmail = assertLoginEmailAllowed(email);
  const result = await withAuthNetworkRetry(() => signInWithEmailAndPassword(requireAuth(), loginEmail, password));
  try {
    await result.user.reload();
  } catch (_) {}
  const signedInUser = requireAuth().currentUser || result.user;
  let verificationSent = false;
  if (signedInUser.providerData?.some((p) => p.providerId === 'password') && !signedInUser.emailVerified) {
    try {
      await sendBrandedEmailVerificationForCurrentUser();
      verificationSent = true;
    } catch (verifErr) {
      console.warn('[authService] Failed to resend verification email on login:', verifErr);
      if (verifErr.code === 'auth/too-many-requests' || verifErr.code === 'functions/resource-exhausted') {
        verificationSent = 'throttled';
      }
    }
  }
  return {
    mode: 'firebase',
    user: normalizeUser(signedInUser),
    verificationSent,
  };
}

export async function resendEmailVerification(email, password) {
  const authInstance = requireAuth();
  let user = authInstance.currentUser;
  let shouldSignOut = false;

  if (!user && email && password) {
    const loginEmail = assertLoginEmailAllowed(email);
    const cred = await withAuthNetworkRetry(() => signInWithEmailAndPassword(authInstance, loginEmail, password));
    user = cred.user;
    shouldSignOut = true;
  }

  if (!user) {
    throw new Error('ไม่พบข้อมูลผู้ใช้ กรุณากรอกอีเมลและรหัสผ่านเพื่อส่งอีเมลยืนยันใหม่');
  }

  if (user.emailVerified) {
    if (shouldSignOut) await signOut(authInstance);
    return { alreadyVerified: true };
  }

  const data = await sendBrandedEmailVerificationForCurrentUser();
  if (shouldSignOut) await signOut(authInstance);
  if (data?.alreadyVerified) return { alreadyVerified: true };
  return { success: true };
}

async function sendBrandedEmailVerificationForCurrentUser() {
  if (!firebaseApp) {
    throw new Error(firebaseConfigError || 'Firebase Authentication is not initialized');
  }
  const sendBrandedEmailVerification = httpsCallable(
    getFunctions(firebaseApp, FUNCTIONS_REGION),
    'sendBrandedEmailVerification',
    { timeout: 20000 }
  );
  try {
    const result = await sendBrandedEmailVerification();
    return result?.data || { sent: true };
  } catch (error) {
    if (!shouldFallbackToFirebaseEmail(error)) throw error;
    const user = requireAuth().currentUser;
    if (!user) throw error;
    await sendEmailVerification(user, {
      url: AUTH_CONTINUE_URL,
      handleCodeInApp: false,
    });
    return { sent: true, fallback: true };
  }
}

export const resendVerificationEmail = resendEmailVerification;


export function getSignInErrorMessage(error, { mode } = {}) {
  const configurationError = getFirebaseConfigurationErrorMessage(error);
  if (configurationError) return configurationError;
  let code = String(error?.code || '').replace(/^functions\//, '');
  if (!code && error?.message) {
    const match = String(error.message).match(/auth\/[a-z0-9-]+/i);
    if (match) code = match[0].toLowerCase();
  }
  if (
    code === 'auth/campus-email-required'
    || code === 'auth/student-id-required'
    || code === 'auth/campus-email-login-only'
  ) {
    return getCampusEmailErrorMessage(error);
  }
  if (code === 'auth/user-not-found') {
    return 'ไม่พบบัญชีที่ใช้อีเมลนี้ สมัครใหม่ได้เฉพาะอีเมล @psu.ac.th';
  }
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง (หากบัญชีนี้สมัครด้วย Google ให้กดปุ่ม Google หรือกด "ลืมรหัสผ่าน?" เพื่อตั้งรหัสใหม่)';
  }
  if (error?.code === 'auth/email-already-in-use') {
    return 'อีเมลนี้มีผู้ใช้งานแล้ว กรุณาเข้าสู่ระบบ';
  }
  if (error?.code === 'auth/weak-password' || error?.code === 'auth/password-does-not-meet-requirements') {
    return /[ก-๙]/.test(String(error?.message || '')) ? error.message : PASSWORD_REQUIREMENTS_MESSAGE;
  }
  if (error?.code === 'auth/invalid-email') {
    return 'รูปแบบอีเมลไม่ถูกต้อง';
  }
  if (error?.code === 'auth/too-many-requests') {
    return 'มีการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่';
  }
  if (error?.code === 'auth/network-request-failed') {
    return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาตรวจสอบสัญญาณแล้วลองใหม่';
  }
  return mode === 'signup'
    ? 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
    : null;
}

export async function requestCampusEmailChange(newEmail) {
  const campusEmail = assertCampusEmail(newEmail);
  const user = requireAuth().currentUser;
  if (!user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนยืนยันอีเมลใหม่');
  }
  if (isCampusEmail(user.email)) {
    return { alreadyCampus: true, user: normalizeUser(user) };
  }
  if (normalizeEmail(user.email) === campusEmail) {
    return { alreadyCampus: true, user: normalizeUser(user) };
  }

  // Do not fall back to verifyBeforeUpdateEmail until the authoritative
  // duplicate check has completed; that fallback must not bypass this guard.
  await assertCampusEmailAvailable(campusEmail, { allowCurrentUser: true });

  if (firebaseApp) {
    try {
      const sendCampusEmailChange = httpsCallable(
        getFunctions(firebaseApp, FUNCTIONS_REGION),
        'sendCampusEmailChange',
        { timeout: 20000 }
      );
      const result = await sendCampusEmailChange({ email: campusEmail });
      const data = result?.data || {};
      if (data.alreadyCampus) {
        return { alreadyCampus: true, user: normalizeUser(user) };
      }
      return {
        sent: true,
        email: data.email || campusEmail,
        sender: data.sender || 'noreply@getcampusmate.app',
        user: normalizeUser(user),
      };
    } catch (error) {
      if (!shouldFallbackToFirebaseEmail(error)) throw error;
      console.warn('[authService] Branded campus email send unavailable, using Firebase default:', error?.code || error?.message);
    }
  }

  await sendVerifyBeforeUpdateEmail(user, campusEmail);
  return { sent: true, email: campusEmail, user: normalizeUser(user) };
}

export async function reloadCampusEmailStatus() {
  const user = requireAuth().currentUser;
  if (!user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนยืนยันอีเมลใหม่');
  }
  await user.reload();
  return normalizeUser(requireAuth().currentUser || user);
}

export async function sendPasswordReset(email) {
  const normalizedEmail = assertLoginEmailAllowed(email);
  if (!firebaseApp) {
    throw new Error(firebaseConfigError || 'Firebase Authentication is not initialized');
  }

  const sendBrandedPasswordReset = httpsCallable(
    getFunctions(firebaseApp, FUNCTIONS_REGION),
    'sendBrandedPasswordReset',
    { timeout: 20000 }
  );
  const result = await sendBrandedPasswordReset({ email: normalizedEmail });
  const data = result?.data || {};
  return {
    sent: true,
    email: normalizedEmail,
    sender: data.sender || CAMPUS_EMAIL_SENDER,
  };
}

export async function getCurrentUserIdToken(forceRefresh = false) {
  const currentUser = requireAuth().currentUser;
  if (!currentUser) throw new Error('กรุณาเข้าสู่ระบบก่อนดำเนินการ');
  return currentUser.getIdToken(forceRefresh);
}

export function subscribeToAuthChanges(callback, onError) {
  return onAuthStateChanged(
    requireAuth(),
    async (user) => {
      if (user && user.providerData?.some(p => p.providerId === 'password') && !user.emailVerified) {
        try {
          await user.reload();
        } catch (_) {}
        if (user.emailVerified) {
          callback({ mode: 'firebase', user: normalizeUser(user) });
        } else {
          callback(null);
        }
      } else {
        callback(user ? { mode: 'firebase', user: normalizeUser(user) } : null);
      }
    },
    onError
  );
}
