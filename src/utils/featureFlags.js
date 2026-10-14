// Initialize defaults
let rc = null;
let getBoolean = null;
let getString = null;

// Native backend: the admin console writes the same keys to app_config/remoteConfig.
const RUST_MODE = process.env.EXPO_PUBLIC_BACKEND === 'rust';
if (RUST_MODE) {
  const values = {};
  rc = values;
  getBoolean = (store, key) => store[key] === true || store[key] === 'true';
  getString = (store, key) => (typeof store[key] === 'string' ? store[key] : '');
  // Loaded lazily to keep this module free of an import cycle with services.
  setTimeout(() => {
    try {
      const { publicRpc } = require('../services/rust/backend');
      publicRpc('getAppConfig', { id: 'remoteConfig' })
        .then((result) => Object.assign(values, result?.config || {}))
        .catch(() => {});
    } catch { /* Defaults stay in effect. */ }
  }, 0);
}

if (!RUST_MODE) try {
  const remoteConfig = require('@react-native-firebase/remote-config');
  const dbService = require('../services/dbService');
  if (remoteConfig?.getRemoteConfig && dbService?.firebaseApp) {
    getBoolean = remoteConfig.getBoolean;
    getString = remoteConfig.getString;
    rc = remoteConfig.getRemoteConfig(dbService.firebaseApp);
    if (rc) {
      rc.settings = { minimumFetchIntervalMillis: typeof __DEV__ !== 'undefined' && __DEV__ ? 0 : 3600000 };
      rc.defaultConfig = {
        enable_feature_call: false,
        allowed_uids_call: '',
        allowed_emails_call: '',
        enable_feature_spotify: false,
        allowed_uids_spotify: '',
        allowed_emails_spotify: '',
      };
      if (typeof remoteConfig.fetchAndActivate === 'function') {
        remoteConfig.fetchAndActivate(rc)
          .then((activated) => console.log('RC fetched and activated:', activated, 'uids_call:', getString ? getString(rc, 'allowed_uids_call') : ''))
          .catch((e) => console.log('RC fetch error:', e));
      }
    }
  }
} catch (e) {
  rc = null;
}

export const EXPERIMENTAL_USER_IDS = ['gJrQKDW1bNNB0LzlNQ79fqiU0kl1'];
export const EXPERIMENTAL_EMAILS = ['6710210317@psu.ac.th'];
export const EXPERIMENTAL_STUDENT_IDS = ['6710210317'];

function isFeatureAllowed(user, profile, featureKey) {
  let allowedUids = [];
  let allowedEmails = [];

  try {
    if (rc && getBoolean && getString) {
      const isGloballyEnabled = getBoolean(rc, 'enable_feature_' + featureKey);
      if (isGloballyEnabled) return true;

      const rcUids = getString(rc, 'allowed_uids_' + featureKey);
      const rcEmails = getString(rc, 'allowed_emails_' + featureKey);
      
      if (rcUids) allowedUids = [...allowedUids, ...rcUids.split(',').map(s => s.trim()).filter(Boolean)];
      if (rcEmails) allowedEmails = [...allowedEmails, ...rcEmails.split(',').map(s => s.trim()).filter(Boolean)];
    }
  } catch (e) {
    console.warn('RC get error:', e);
  }

  if (!user && !profile) return false;

  const userId = String(user?.uid || user?.id || profile?.id || '').trim();
  if (userId && (allowedUids.includes(userId) || EXPERIMENTAL_USER_IDS.includes(userId))) return true;

  const email = String(user?.email || profile?.email || profile?.campusEmail || '').trim().toLowerCase();
  if (email && (allowedEmails.map(e => e.toLowerCase()).includes(email) || EXPERIMENTAL_EMAILS.map(e => e.toLowerCase()).includes(email))) return true;

  const studentId = String(profile?.studentId || '').trim();
  if (studentId && EXPERIMENTAL_STUDENT_IDS.includes(studentId)) return true;

  if (featureKey === 'call' && (profile?.canCall === true || profile?.isCallTester === true)) return true;
  if (profile?.isTester === true || profile?.role === 'admin' || profile?.role === 'tester' || profile?.isAdmin === true) return true;

  return false;
}

export function isCallFeatureAllowed(user, profile) {
  return isFeatureAllowed(user, profile, 'call');
}

export function isSpotifyFeatureAllowed(user, profile) {
  return isFeatureAllowed(user, profile, 'spotify');
}
