import {
  createUserWithEmailAndPassword,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { firebaseApp, firebaseConfigError } from './dbService';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  return auth;
}

// Firebase exposes API-key restriction failures as auth errors. They are
// configuration/network errors, not bad credentials, so screens should never
// show the raw SDK message (or tell the user that their password is wrong).
export function getFirebaseConfigurationErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
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
  };
}

export async function signInWithGoogle() {
  if (Platform.OS !== 'web') {
    throw new Error('Google Sign-In บน iOS/Android ต้องตั้งค่า Google OAuth Client ID ก่อน กรุณาใช้อีเมลเข้าสู่ระบบในตอนนี้');
  }

  const provider = new GoogleAuthProvider();
  provider.addScope('profile');
  provider.addScope('email');
  const result = await signInWithPopup(requireAuth(), provider);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function signInWithGoogleCredential(id_token) {
  const credential = GoogleAuthProvider.credential(id_token);
  const result = await signInWithCredential(requireAuth(), credential);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function signOutUser() {
  try {
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    if (await GoogleSignin.hasPreviousSignIn()) {
      await GoogleSignin.signOut();
    }
  } catch (_) {}
  await signOut(requireAuth());
}

export function isFirebaseConfigured() {
  return Boolean(auth && !firebaseConfigError);
}

export async function signUpWithEmail(email, password) {
  const result = await createUserWithEmailAndPassword(requireAuth(), email, password);
  await sendEmailVerification(result.user);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(requireAuth(), email, password);
  let verificationSent = false;
  if (result.user.providerData?.some((p) => p.providerId === 'password') && !result.user.emailVerified) {
    try {
      await sendEmailVerification(result.user);
      verificationSent = true;
    } catch (verifErr) {
      console.warn('[authService] Failed to resend verification email on login:', verifErr);
      if (verifErr.code === 'auth/too-many-requests') {
        verificationSent = 'throttled';
      }
    }
  }
  return {
    mode: 'firebase',
    user: normalizeUser(result.user),
    verificationSent,
  };
}

export async function resendEmailVerification(email, password) {
  const authInstance = requireAuth();
  let user = authInstance.currentUser;
  let shouldSignOut = false;

  if (!user && email && password) {
    const cred = await signInWithEmailAndPassword(authInstance, email, password);
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

  await sendEmailVerification(user);
  if (shouldSignOut) await signOut(authInstance);
  return { success: true };
}

export const resendVerificationEmail = resendEmailVerification;


export async function sendPasswordReset(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('กรุณาระบุอีเมลที่ต้องการรีเซ็ตรหัสผ่าน');
  }

  const authInstance = requireAuth();

  // Try sending with custom reset.html action URL first
  try {
    const actionCodeSettings = {
      url: 'https://campusmate-7f1ab.web.app/reset.html',
      handleCodeInApp: false,
    };
    return await sendPasswordResetEmail(authInstance, normalizedEmail, actionCodeSettings);
  } catch (err) {
    console.warn('[authService] sendPasswordReset with actionCodeSettings failed, retrying standard reset:', err?.code, err?.message);
    // If custom continue URL / actionCodeSettings is rejected for ANY reason, retry with default Firebase reset
    if (
      err.code === 'auth/unauthorized-continue-uri' ||
      err.code === 'auth/invalid-continue-uri' ||
      err.code === 'auth/missing-continue-uri' ||
      err.code === 'auth/argument-error' ||
      err.code === 'auth/invalid-argument' ||
      err.code === 'auth/internal-error'
    ) {
      return await sendPasswordResetEmail(authInstance, normalizedEmail);
    }
    throw err;
  }
}

export async function getCurrentUserIdToken() {
  const currentUser = requireAuth().currentUser;
  if (!currentUser) throw new Error('กรุณาเข้าสู่ระบบก่อนอัปโหลดรูปภาพ');
  return currentUser.getIdToken();
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
