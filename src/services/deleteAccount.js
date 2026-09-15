/**
 * Delete Account Service
 *
 * Deletes all user data from Firestore, R2, and local storage.
 * Uses a Cloud Function (deleteUserData) for server-side cleanup
 * of data the client cannot access (e.g. other users' decisions).
 */
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { signOutUser, getCurrentUserIdToken } from './authService';
import { clearOfflineDataForUser } from './offlineStorage';
import { clearEncryptionIdentity } from './chatEncryptionService';

/**
 * Delete the current user's avatar from R2 storage.
 */
async function deleteR2Avatar(userId) {
  const workerUrl = (process.env.EXPO_PUBLIC_WORKER_URL || 'https://campusmate-upload.comcamp.workers.dev').replace(/\/$/, '');
  const idToken = await getCurrentUserIdToken();

  try {
    const response = await fetch(`${workerUrl}/avatar/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error('Avatar deletion failed');
    }
  } catch (error) {
    // Non-blocking — avatar will be orphaned but not a security risk
    console.warn('[DeleteAccount] R2 avatar deletion failed; account was not deleted.');
    throw error;
  }
}

/**
 * Main delete account function — called from AppContext.
 *
 * Flow:
 * 1. Try server-side Cloud Function first (handles incoming decisions from other users)
 * 2. Delete R2 avatar
 * 3. Clear local offline cache
 * 4. Sign out
 */
export async function deleteAccountData(userId) {
  if (!userId) throw new Error('ไม่พบ User ID');

  // Remove the public avatar first. If this fails, stop before deleting the
  // account so a public copy cannot be left behind after account deletion.
  await deleteR2Avatar(userId);

  // Try Cloud Function next; it handles incoming decisions, conversations,
  // server-owned notification records, and the Firebase Auth identity.
  try {
    const { app } = requireFirebase();
    const functions = getFunctions(app, 'asia-southeast1');
    const deleteUserDataFn = httpsCallable(functions, 'deleteUserData');
    await deleteUserDataFn({ userId });
  } catch {
    // Fail closed. A client-side fallback cannot safely cascade message
    // subcollections or remove server-owned notification records.
    console.warn('[DeleteAccount] Cloud Function failed; account was not deleted.');
    throw new Error('ลบบัญชีไม่สำเร็จ ระบบลบบัญชีต้องพร้อมใช้งานก่อน กรุณาลองใหม่อีกครั้ง');
  }

  // Clear local offline cache
  await clearOfflineDataForUser(userId);
  await clearEncryptionIdentity(userId);

  // Sign out
  await signOutUser();
}
