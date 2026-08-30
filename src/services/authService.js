import {
  createUserWithEmailAndPassword,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { firebaseApp, firebaseConfigError } from './dbService';
import { Storage } from '../utils/storage';

let auth = null;

if (firebaseApp) {
  if (Platform.OS === 'web') {
    auth = getAuth(firebaseApp);
  } else {
    try {
      auth = initializeAuth(firebaseApp, {
        persistence: getReactNativePersistence(Storage),
      });
    } catch (error) {
      auth = getAuth(firebaseApp);
    }
  }
}

function requireAuth() {
  if (!auth) {
    throw new Error(firebaseConfigError || 'Firebase Authentication is not initialized');
  }
  return auth;
}

function normalizeUser(user) {
  return {
    id: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
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

export async function signOutUser() {
  await signOut(requireAuth());
}

export function isFirebaseConfigured() {
  return Boolean(auth && !firebaseConfigError);
}

export async function signUpWithEmail(email, password) {
  const result = await createUserWithEmailAndPassword(requireAuth(), email, password);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(requireAuth(), email, password);
  return { mode: 'firebase', user: normalizeUser(result.user) };
}

export async function getCurrentUserIdToken() {
  const currentUser = requireAuth().currentUser;
  if (!currentUser) throw new Error('กรุณาเข้าสู่ระบบก่อนอัปโหลดรูปภาพ');
  return currentUser.getIdToken();
}

export function subscribeToAuthChanges(callback, onError) {
  return onAuthStateChanged(
    requireAuth(),
    (user) => callback(user ? { mode: 'firebase', user: normalizeUser(user) } : null),
    onError
  );
}
