import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { evaluateVersionPolicy } from '../utils/versionUpdatePolicy';
export { compareSemver } from '../utils/versionUpdatePolicy';

const SNOOZE_STORAGE_KEY = '@campusmate:update_snoozed_at';
const SNOOZE_META_STORAGE_KEY = '@campusmate:update_snooze_meta';
const PLAY_STORE_PACKAGE = 'com.campusmate.app';
const DEFAULT_MARKET_URL = `market://details?id=${PLAY_STORE_PACKAGE}`;
const DEFAULT_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;

async function readSnoozeMeta() {
  try {
    const rawMeta = await AsyncStorage.getItem(SNOOZE_META_STORAGE_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      if (parsed && typeof parsed === 'object') {
        return {
          at: Number(parsed.at) || 0,
          updateKey: typeof parsed.updateKey === 'string' ? parsed.updateKey : '',
        };
      }
    }
    // Old timestamps have no build identity and cannot suppress a new release.
    const legacyAt = await AsyncStorage.getItem(SNOOZE_STORAGE_KEY);
    if (legacyAt) {
      return { at: parseInt(legacyAt, 10) || 0, updateKey: '' };
    }
  } catch {
    // ignore
  }
  return null;
}

function isDevelopmentRuntime() {
  // Only suppress update prompts in Expo Go. Dev clients / preview builds
  // still need to see Play Store update prompts when testing.
  return Constants.appOwnership === 'expo';
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
 * ดึงเวอร์ชันปัจจุบันของแอพจาก native binary (Play/App Store)
 * ต้องไม่ใช้ expoConfig เป็นหลัก — OTA / embed อาจเป็นเวอร์ชันใหม่กว่า
 * ทำให้ไม่ขึ้นแจ้งอัปเดตทั้งที่ยังไม่ได้อัปจากสโตร์
 */
export function getCurrentAppVersion() {
  // Prefer the installed store binary version over JS/OTA expoConfig.
  const nativeVersion = Application.nativeApplicationVersion || Constants.nativeAppVersion;
  if (nativeVersion) return String(nativeVersion);
  if (!isDevelopmentRuntime() && Platform.OS !== 'web') return '';
  return (
    Constants.expoConfig?.version
    || Constants.manifest2?.extra?.expoClient?.version
    || '1.0.0'
  );
}

/** Read versionCode / CFBundleVersion from the installed binary, never from OTA config. */
export function getCurrentAppBuild() {
  return Application.nativeBuildVersion ? String(Application.nativeBuildVersion) : '';
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
 * ประเมินจาก config ว่าควรแสดงหน้าต่างอัปเดตหรือไม่
 */
async function evaluateUpdateFromConfig(config, { ignoreSnooze = false } = {}) {
  const result = evaluateVersionPolicy(config, {
    platform: Platform.OS, currentVersion: getCurrentAppVersion(), currentBuild: getCurrentAppBuild(),
    expoGo: isDevelopmentRuntime(),
  });
  if (!result.needsUpdate) return result;
  if (!result.isForce && !ignoreSnooze) {
    const snoozeMeta = await readSnoozeMeta();
    // The same version with a newer build is a different release.
    if (
      snoozeMeta?.at
      && snoozeMeta.updateKey
      && snoozeMeta.updateKey === result.updateKey
    ) {
      const snoozeDurationMs = result.snoozeHours * 60 * 60 * 1000;
      if (Date.now() - snoozeMeta.at < snoozeDurationMs) {
        return { ...result, needsUpdate: false, snoozed: true };
      }
    }
  }

  return {
    ...result,
    playStoreUrl: result.playStoreUrl || DEFAULT_MARKET_URL,
    playStoreWebUrl: result.playStoreWebUrl || DEFAULT_WEB_URL,
  };
}

/**
 * ตรวจสอบว่าเวอร์ชันปัจจุบันต้องอัปเดตหรือไม่
 * @param {boolean} ignoreSnooze ข้ามการตรวจ snooze หรือไม่ (เช่น กรณีกดเช็คแบบ manual)
 */
export async function checkAppUpdate({ ignoreSnooze = false } = {}) {
  const config = await fetchRemoteVersionConfig();
  return evaluateUpdateFromConfig(config, { ignoreSnooze });
}

/**
 * ฟัง app_config/version แบบ realtime — แสดงอัปเดตทันทีขณะแอพเปิดอยู่
 * โดยไม่ต้องปิดแล้วเปิดแอพใหม่
 * @returns {() => void} unsubscribe
 */
export function subscribeAppUpdate(onResult, { ignoreSnooze = false } = {}) {
  if (typeof onResult !== 'function') {
    return () => {};
  }

  if (isDevelopmentRuntime()) {
    onResult({ needsUpdate: false, currentVersion: getCurrentAppVersion() });
    return () => {};
  }

  let cancelled = false;
  let revision = 0;
  let unsubscribeSnapshot = () => {};

  try {
    const { db } = requireFirebase();
    const configDocRef = doc(db, 'app_config', 'version');
    unsubscribeSnapshot = onSnapshot(
      configDocRef,
      async (snapshot) => {
        if (cancelled) return;
        const observedRevision = ++revision;
        try {
          const config = snapshot.exists() ? snapshot.data() : null;
          const result = await evaluateUpdateFromConfig(config, { ignoreSnooze });
          if (!cancelled && observedRevision === revision) onResult(result);
        } catch (error) {
          console.warn('[versionCheckService] subscribeAppUpdate evaluate error:', error?.message || error);
        }
      },
      (error) => {
        console.warn('[versionCheckService] subscribeAppUpdate error:', error?.message || error);
      }
    );
  } catch (error) {
    console.warn('[versionCheckService] subscribeAppUpdate setup error:', error?.message || error);
  }

  return () => {
    cancelled = true;
    unsubscribeSnapshot();
  };
}

/**
 * บันทึกการเลื่อนเตือนแยกตาม platform/version/build
 */
export async function snoozeUpdate(updateKey) {
  try {
    const payload = {
      at: Date.now(),
      updateKey: typeof updateKey === 'string' ? updateKey : '',
    };
    await AsyncStorage.multiSet([
      [SNOOZE_META_STORAGE_KEY, JSON.stringify(payload)],
      [SNOOZE_STORAGE_KEY, String(payload.at)],
    ]);
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
  const targetWebUrl = webFallbackUrl || (isAndroid ? DEFAULT_WEB_URL : customUrl);
  if (!targetMarketUrl && !targetWebUrl) return;

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
      if (targetWebUrl) await Linking.openURL(targetWebUrl);
    } catch (_) {}
  }
}
