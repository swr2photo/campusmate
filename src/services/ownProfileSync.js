import { subscribeToUserProfile } from './firestoreService';
import { getOfflineQueue } from './offlineStorage';
import { withServerFaceVerification } from '../utils/faceVerificationState';

// Only unsent edits on this device override a committed remote profile.
// Verification remains server-owned even when a queued full profile is present.
export function mergePendingOwnProfile(serverProfile, pending = []) {
  const merged = pending.reduce((data, operation) => {
    const payload = operation.payload || {};
    if (operation.type === 'saveProfile') return { ...data, ...payload.profile };
    if (operation.type === 'updateMeetup') return { ...data, meetup: payload.meetup };
    if (operation.type === 'saveMatchingPreferences') return { ...data, matchingPreferences: payload.matchingPreferences };
    if (operation.type === 'saveLocationEnabled') return { ...data, locationEnabled: payload.locationEnabled };
    return data;
  }, serverProfile);
  return { ...withServerFaceVerification(merged, serverProfile), id: serverProfile.id };
}

export function subscribeToOwnProfileUpdates(userId, onProfile, onError, isCurrentUser = () => true) {
  let active = true, revision = 0;
  const isActive = () => active && isCurrentUser();
  const stop = subscribeToUserProfile(userId, async (serverProfile) => {
    if (!isActive() || serverProfile?.id !== userId) return;
    const currentRevision = ++revision;
    try {
      const pending = await getOfflineQueue(userId);
      if (!isActive() || currentRevision !== revision) return;
      onProfile(mergePendingOwnProfile(serverProfile, pending));
    } catch (error) {
      if (isActive() && currentRevision === revision) onError?.(error);
    }
  }, (error) => { if (isActive()) onError?.(error); });
  return () => { active = false; revision++; stop(); };
}
