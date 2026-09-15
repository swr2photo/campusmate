import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';

const SNOOZE_STORAGE_KEY = '@campusmate:update_snoozed_at';
const PLAY_STORE_PACKAGE = 'com.campusmate.app';
const DEFAULT_MARKET_URL = `market://details?id=${PLAY_STORE_PACKAGE}`;
const DEFAULT_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;

function isDevelopmentRuntime() {
  return (typeof __DEV__ !== 'undefined' && __DEV__)
    || Constants.executionEnvironment === 'storeClient'
    || Constants.appOwnership === 'expo';
}

/**
 * ส่งเวอร์ชันปัจจุบันไปยังเซิร์ฟเวอร์เมื่อมีผู้เรียกใช้แบบ explicit เท่านั้น
 * เวอร์ชันที่ยังไม่เผยแพร่บน Google Play ต้องไม่เลื่อน latestVersion เอง
 */
export async function reportAppVersionToServer(version) {
  // Preview versions must not change the production update configuration.
  if (isDevelopmentRuntime()) return;

  try {
    const { app } = requireFirebase();
    const functions = getFunctions(app, 'asia-southeast1');
    const reportFn = httpsCallable(functions, 'reportAppVersion');
    await reportFn({ version });
  } catch {
    // Non-blocking background reporting
  }
}

/**
 * ดึงเวอร์ชันปัจจุบันของแอพจาก expoConfig หรือ fallback
 */
export function getCurrentAppVersion() {
  return (
    Constants.expoConfig?.version
    || Constants.nativeAppVersion
    || Constants.manifest2?.extra?.expoClient?.version
    || '1.1.5'
  );
}

/**
 * เปรียบเทียบ semantic versions (เช่น "1.1.5" กับ "1.2.0")
 * @returns {number} 1 ถ้า v1 > v2, -1 ถ้า v1 < v2, 0 ถ้าเท่ากัน
 */
export function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const clean = (v) => String(v).replace(/^v/i, '').trim();
  const parts1 = clean(v1).split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = clean(v2).split('.').map((p) => parseInt(p, 10) || 0);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i += 1) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * ดึงการตั้งค่าเวอร์ชันล่าสุดจาก Firestore collection app_config/version
 */
export async function fetchRemoteVersionConfig() {
  try {
    const { db } = requireFirebase();
    const configDocRef = doc(db, 'app_config', 'version');
    const snapshot = await getDoc(configDocRef);
    if (!snapshot.exists()) {
      return null;
    }
    return snapshot.data();
  } catch (error) {
    console.warn('[versionCheckService] fetchRemoteVersionConfig error:', error?.message || error);
    return null;
  }
}

/**
 * ตรวจสอบว่าเวอร์ชันปัจจุบันต้องอัปเดตหรือไม่
 * @param {boolean} ignoreSnooze ข้ามการตรวจ snooze หรือไม่ (เช่น กรณีกดเช็คแบบ manual)
 */
export async function checkAppUpdate({ ignoreSnooze = false } = {}) {
  const currentVersion = getCurrentAppVersion();
  // Expo Go and development builds cannot be updated through the app's store listing.
  if (isDevelopmentRuntime()) {
    return { needsUpdate: false, currentVersion };
  }

  const config = await fetchRemoteVersionConfig();

  if (!config || config.enabled === false) {
    return { needsUpdate: false, currentVersion };
  }

  const latestVersion = config.latestVersion || config.version;
  const minVersion = config.minVersion;
  const forceUpdateFlag = Boolean(config.forceUpdate);

  if (!latestVersion) {
    return { needsUpdate: false, currentVersion };
  }

  // Firestore is the source of the Play Store release state. A locally
  // installed APK/AAB must never trigger an update prompt before the release
  // has actually been published on Google Play.
  if (config.playStorePublished !== true) {
    return { needsUpdate: false, currentVersion, latestVersion, playStorePublished: false };
  }

  // มีเวอร์ชันที่ใหม่กว่าเวอร์ชันในเครื่องหรือไม่
  const isOutdated = compareSemver(latestVersion, currentVersion) > 0;
  if (!isOutdated) {
    return { needsUpdate: false, currentVersion, latestVersion };
  }

  // เป็นการบังคับอัปเดตหรือไม่ (ถ้าต่ำกว่า minVersion หรือตั้ง forceUpdate เป็น true)
  const isBelowMinVersion = minVersion ? compareSemver(currentVersion, minVersion) < 0 : false;
  const isForce = forceUpdateFlag || isBelowMinVersion;

  // ถ้าไม่ใช่การบังคับ และไม่ได้สั่ง ignoreSnooze ให้เช็คว่าเคย snooze ไว้ไหม
  if (!isForce && !ignoreSnooze) {
    const snoozedAt = await AsyncStorage.getItem(SNOOZE_STORAGE_KEY).catch(() => null);
    if (snoozedAt) {
      const snoozedTime = parseInt(snoozedAt, 10);
      const snoozeDurationMs = (Number(config.snoozeHours) || 24) * 60 * 60 * 1000;
      if (Date.now() - snoozedTime < snoozeDurationMs) {
        return { needsUpdate: false, snoozed: true, currentVersion, latestVersion };
      }
    }
  }

  return {
    needsUpdate: true,
    isForce,
    currentVersion,
    latestVersion,
    title: config.title || 'มีเวอร์ชันใหม่พร้อมใช้งาน',
    message: config.message || `CampusMate เวอร์ชัน ${latestVersion} พร้อมให้อัปเดตแล้ว`,
    releaseNotes: config.releaseNotes || '• ปรับปรุงประสิทธิภาพและความเสถียรของแอพพลิเคชัน',
    playStoreUrl: config.playStoreUrl || DEFAULT_MARKET_URL,
    playStoreWebUrl: config.playStoreWebUrl || DEFAULT_WEB_URL,
    appStoreUrl: config.appStoreUrl,
  };
}

/**
 * บันทึกการเลื่อนเวลาเตือนอัปเดต (Snooze)
 */
export async function snoozeUpdate() {
  try {
    await AsyncStorage.setItem(SNOOZE_STORAGE_KEY, String(Date.now()));
  } catch (err) {
    console.warn('[versionCheckService] snoozeUpdate error:', err);
  }
}

/**
 * เปิดหน้า Google Play Store (หรือ App Store บน iOS)
 */
export async function openAppStore(customUrl, webFallbackUrl) {
  const isAndroid = Platform.OS === 'android';
  const targetMarketUrl = customUrl || (isAndroid ? DEFAULT_MARKET_URL : '');
  const targetWebUrl = webFallbackUrl || DEFAULT_WEB_URL;

  try {
    if (targetMarketUrl) {
      const supported = await Linking.canOpenURL(targetMarketUrl).catch(() => false);
      if (supported) {
        await Linking.openURL(targetMarketUrl);
        return;
      }
    }
    // Fallback ไปเปิดเบราว์เซอร์
    await Linking.openURL(targetWebUrl);
  } catch (error) {
    console.error('[versionCheckService] openAppStore error:', error);
    // Fallback ครั้งสุดท้าย
    try {
      await Linking.openURL(DEFAULT_WEB_URL);
    } catch (_) {}
  }
}
