import { initializeApp, getApp, getApps } from 'firebase/app';
import { initializeFirestore, getFirestore, setLogLevel } from 'firebase/firestore';
import { Platform } from 'react-native';
import androidGoogleServices from '../../google-services.json';

// The Firebase Web SDK still makes REST requests when it runs in a native
// React Native app. Do not let Android fall back to the browser key: a key
// restricted to HTTP referrers has no referrer on Android and Firebase rejects
// the request before it can check the email or password.
const androidClient = androidGoogleServices?.client?.find(
  (client) => client?.client_info?.android_client_info?.package_name === 'com.campusmate.app',
) || androidGoogleServices?.client?.[0];
const androidProjectInfo = androidGoogleServices?.project_info || {};
// Prefer the package-matched values from google-services.json. EAS uploads
// this file, while .env is intentionally excluded; this also prevents a
// stale remote EXPO_PUBLIC_* value from reintroducing the browser key.
const androidApiKey = androidClient?.api_key?.[0]?.current_key
  || process.env.EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY;
const androidAppId = androidClient?.client_info?.mobilesdk_app_id
  || process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID;
const androidProjectId = androidProjectInfo.project_id
  || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const androidAuthDomain = androidProjectId
  ? `${androidProjectId}.firebaseapp.com`
  : process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
const androidMessagingSenderId = androidProjectInfo.project_number
  || process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;

const firebaseConfig = {
  apiKey: Platform.select({
    ios: process.env.EXPO_PUBLIC_FIREBASE_IOS_API_KEY,
    android: androidApiKey,
    default: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  }),
  authDomain: Platform.select({
    android: androidAuthDomain,
    default: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  }),
  projectId: Platform.select({
    android: androidProjectId,
    default: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  }),
  messagingSenderId: Platform.select({
    android: androidMessagingSenderId,
    default: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  }),
  appId: Platform.select({
    ios: process.env.EXPO_PUBLIC_FIREBASE_IOS_APP_ID,
    android: androidAppId,
    default: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  }),
};

const requiredConfigKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingConfigKeys = requiredConfigKeys.filter((key) => !firebaseConfig[key]);

export const firebaseConfigError = missingConfigKeys.length
  ? `Firebase configuration is missing: ${missingConfigKeys.join(', ')}`
  : null;

export const firebaseApp = firebaseConfigError
  ? null
  : (getApps().length ? getApp() : initializeApp(firebaseConfig));

if (firebaseApp) {
  try {
    setLogLevel('silent');
  } catch {}
}

export const db = (() => {
  if (!firebaseApp) return null;
  try {
    return initializeFirestore(firebaseApp, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    return getFirestore(firebaseApp);
  }
})();

export function requireFirebase() {
  if (firebaseConfigError || !firebaseApp || !db) {
    throw new Error(firebaseConfigError || 'Firebase is not initialized');
  }

  return { app: firebaseApp, db };
}
