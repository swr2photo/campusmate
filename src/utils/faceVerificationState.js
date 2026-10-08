// Only the server's existing values may survive a general profile replacement.
export const FACE_VERIFICATION_FIELDS = ['isFaceVerified', 'faceVerifiedAt', 'faceMatchScore', 'faceVerificationStatus'];

export function withServerFaceVerification(profile, serverProfile = {}) {
  const result = { ...profile };
  for (const field of FACE_VERIFICATION_FIELDS) {
    delete result[field];
    if (serverProfile[field] !== undefined) result[field] = serverProfile[field];
  }
  return result;
}
