import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Safely enforces portrait orientation lock on handheld mobile devices (iOS & Android).
 * Uses requireOptionalNativeModule to ensure that if the current app binary does not
 * include the compiled native module, it degrades gracefully without crashing the app on startup.
 */
export async function enforcePhonePortraitLock() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const isPad = Platform.OS === 'ios' && Boolean(Platform.isPad);
  if (isPad) return;

  try {
    const NativeModule = typeof requireOptionalNativeModule === 'function'
      ? requireOptionalNativeModule('ExpoScreenOrientation')
      : null;
    if (NativeModule && typeof NativeModule.lockAsync === 'function') {
      // Resolve the public enum only after verifying the native module exists.
      // Numeric 1 is ALL, not PORTRAIT_UP, in the installed Expo SDK.
      const { lockAsync, OrientationLock } = require('expo-screen-orientation');
      await lockAsync(OrientationLock.PORTRAIT_UP);
    }
  } catch (error) {
    // Non-fatal - app.json orientation: portrait and AndroidManifest.xml enforce it at OS level
  }
}
