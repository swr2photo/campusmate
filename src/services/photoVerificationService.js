import { requireOptionalNativeModule } from 'expo-modules-core';
import { fetch } from 'expo/fetch';
import { getCurrentAuthUserId, getCurrentUserIdToken } from './authService';
import { createFirebaseIdentityClient } from './firebaseIdentityProtocol.mjs';
import { createPhotoVerification } from './photoVerificationProtocol.mjs';
import { RUST_BACKEND, rustAccessToken, rustUid, rustOrigin } from './rust/backend';

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
 * Capability check for entry points. A build that explicitly requests liveness
 * must show an unavailable result when misconfigured, never switch to a selfie.
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
    let client;
    try {
      client = createFirebaseIdentityClient({
        origin: RUST_BACKEND ? rustOrigin() : process.env.EXPO_PUBLIC_IDENTITY_BACKEND_URL,
        fetch,
        getIdToken: RUST_BACKEND ? async () => (await rustAccessToken()).token : () => getCurrentUserIdToken(),
        getUserId: RUST_BACKEND ? rustUid : getCurrentAuthUserId,
      });
    } catch {
      // Keep configuration errors in the flow's safe result handling rather
      // than throwing while React mounts the verification sheet.
      client = { request: async () => {
        throw Object.assign(new Error('Identity unavailable'), { code: 'IDENTITY_UNAVAILABLE' });
      } };
    }
    flow = createPhotoVerification({ client, bridge, consentVersion: FACE_CONSENT_VERSION });
  }
  return flow;
}
