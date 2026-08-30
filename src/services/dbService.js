import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const requiredConfigKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingConfigKeys = requiredConfigKeys.filter((key) => !firebaseConfig[key]);

export const firebaseConfigError = missingConfigKeys.length
  ? `Firebase configuration is missing: ${missingConfigKeys.join(', ')}`
  : null;

export const firebaseApp = firebaseConfigError
  ? null
  : (getApps().length ? getApp() : initializeApp(firebaseConfig));

export const db = firebaseApp ? getFirestore(firebaseApp) : null;

export function requireFirebase() {
  if (firebaseConfigError || !firebaseApp || !db) {
    throw new Error(firebaseConfigError || 'Firebase is not initialized');
  }

  return { app: firebaseApp, db };
}
