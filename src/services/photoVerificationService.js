import { requireOptionalNativeModule } from 'expo-modules-core';
import { fetch } from 'expo/fetch';
import { getCurrentAuthUserId, getCurrentUserIdToken } from './authService';
import { createFirebaseIdentityClient } from './firebaseIdentityProtocol.mjs';
import { createPhotoVerification } from './photoVerificationProtocol.mjs';

// The native module wraps AWS's official SwiftUI / Jetpack Compose liveness
// components (see native-spikes/face-liveness). Until a build includes it,
// `isAvailable()` is false and the flow reports NATIVE_UNAVAILABLE instead of
// falling back to an unsafe photo upload.
const native = requireOptionalNativeModule('FaceLiveness');

const bridge = {
  isAvailable: () => Boolean(native?.present),
  async present(options) {
    try {
      return await native.present(options);
    } catch (error) {
      throw Object.assign(new Error('liveness'), { code: error?.code || 'SERVICE_UNAVAILABLE' });
    }
  },
};

export const FACE_CONSENT_VERSION = process.env.EXPO_PUBLIC_FACE_CONSENT_VERSION || 'face-consent-2026-10';

/**
 * The liveness flow replaces the old selfie check only when the build sets
 * EXPO_PUBLIC_FACE_LIVENESS=true *and* includes the native module, so a
 * misconfigured build keeps the existing flow instead of a dead button.
 */
export function isLivenessEnabled() {
  if (process.env.EXPO_PUBLIC_FACE_LIVENESS !== 'true' || !bridge.isAvailable()) return false;
  try {
    const url = new URL(process.env.EXPO_PUBLIC_IDENTITY_BACKEND_URL);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

let flow;
export function getPhotoVerification() {
  if (!flow) {
    const client = createFirebaseIdentityClient({
      origin: process.env.EXPO_PUBLIC_IDENTITY_BACKEND_URL,
      fetch,
      getIdToken: () => getCurrentUserIdToken(),
      getUserId: getCurrentAuthUserId,
    });
    flow = createPhotoVerification({ client, bridge, consentVersion: FACE_CONSENT_VERSION });
  }
  return flow;
}
