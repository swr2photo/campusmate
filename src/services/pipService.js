import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

const { PipModule } = NativeModules;

export const isPipSupported = Platform.OS === 'android' && Boolean(PipModule);

/**
 * Enter Android Picture-in-Picture mode (pops out of the app)
 */
export function enterPip() {
  if (isPipSupported && PipModule?.enterPip) {
    try {
      PipModule.enterPip();
    } catch (e) {
      console.warn('[pipService] enterPip error:', e);
    }
  }
}

/**
 * Tell Android whether the user is actively in a call, so it can auto-enter PiP on swipe/home
 */
export function setPipCallState(inCall, isVideo = false) {
  if (isPipSupported && PipModule?.setInCall) {
    try {
      PipModule.setInCall(Boolean(inCall), Boolean(isVideo));
    } catch (e) {
      console.warn('[pipService] setInCall error:', e);
    }
  }
}

/**
 * Listen for when the app enters or exits Android Picture-in-Picture mode
 */
export function addPipListener(callback) {
  if (!isPipSupported) return () => {};
  const subscription = DeviceEventEmitter.addListener('onPictureInPictureModeChanged', callback);
  return () => {
    subscription.remove();
  };
}
