import { requireNativeView, requireOptionalNativeModule } from 'expo';
import React, { forwardRef } from 'react';

// Builds without this module (Expo Go, older development builds) get null,
// and the gesture screen uses the expo-camera/server-probe path.
function loadNativeView() {
  const module = requireOptionalNativeModule('FaceGestureCamera');
  try {
    return module?.isAvailable?.() ? requireNativeView('FaceGestureCamera') : null;
  } catch {
    return null;
  }
}

const NativeFaceGestureCameraView = loadNativeView();

export function isFaceGestureCameraAvailable() {
  return NativeFaceGestureCameraView !== null;
}

/**
 * Front camera with on-device face tracking.
 * Props: `active`, `onFaceUpdate({ nativeEvent })`, `onCameraError({ nativeEvent: { code } })`.
 * `ref.current.capture()` resolves `{ base64, width, height }`: one upright,
 * unmirrored JPEG frame kept in memory only.
 * New builds emit a frameId; captureFrame(frameId) returns that exact detected
 * frame, so a brief gesture does not need to be held for the next frame.
 */
export const FaceGestureCameraView = forwardRef(function FaceGestureCameraView(props, ref) {
  return NativeFaceGestureCameraView ? <NativeFaceGestureCameraView ref={ref} {...props} /> : null;
});
