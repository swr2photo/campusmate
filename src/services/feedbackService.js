import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { RUST_BACKEND, rpc } from './rust/backend';
import { getCurrentAppBuild, getCurrentAppVersion } from './versionCheckService';

const SHAKE_KEY = '@campusmate:shake_to_report';
let opener = null;

/** Set by FeedbackHost; lets settings open the same sheet as a shake. */
export function setFeedbackOpener(fn) {
  opener = fn;
}

/** Opens the feedback sheet, at the menu or straight at `kind` ('bug' | 'feedback'). */
export function openFeedbackSheet(kind = null) {
  opener?.(kind);
}

export async function isShakeEnabled() {
  try {
    return (await AsyncStorage.getItem(SHAKE_KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function setShakeEnabled(enabled) {
  try {
    await AsyncStorage.setItem(SHAKE_KEY, enabled ? 'on' : 'off');
  } catch {
    // The choice still applies until the app restarts.
  }
}

/** Device details sent with every report, so the team can reproduce it. */
export function feedbackContext() {
  return {
    appVersion: getCurrentAppVersion(),
    appBuild: getCurrentAppBuild(),
    platform: Platform.OS,
    osVersion: String(Platform.Version ?? ''),
  };
}

/** `screenshot`: base64 JPEG, only when the person chose to attach it. */
export async function submitAppFeedback({ kind, message, screen, screenshot }) {
  if (!RUST_BACKEND) {
    throw new Error('แอปเวอร์ชันนี้ส่งรายงานไม่ได้ กรุณาติดต่อทีมงานทางอีเมลจากหน้าการตั้งค่า');
  }
  return rpc('submitAppFeedback', {
    kind,
    message,
    screen,
    ...(screenshot ? { screenshot } : {}),
    ...feedbackContext(),
  });
}
