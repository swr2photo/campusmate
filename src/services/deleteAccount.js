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
import { clearActiveUser, removeSavedAccount } from './accountStorage';
import { clearFastBootData } from './fastBootService';
import {
  doc,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

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
 * 1. Delete R2 avatar
 * 2. Proactive client-side cleanup of own profile, decisions, and conversations
 * 3. Server-side Cloud Function (deleteUserData) to cascade-delete everything
 * 4. Clear local offline cache and sign out
 */
export async function deleteAccountData(userId, email = null) {
  if (!userId) throw new Error('ไม่พบ User ID');

  // Remove the public avatar first. If this fails, stop before deleting the
  // account so a public copy cannot be left behind after account deletion.
  await deleteR2Avatar(userId);

  // Proactive client-side cleanup:
  // Immediately mark profile as deleted and drop outgoing decisions so any active peers
  // get real-time listener updates without waiting for server function latency.
  try {
    const { db } = requireFirebase();
    // 1. Mark own public profile as deleted
    await updateDoc(doc(db, 'profiles', userId), {
      isDeleted: true,
      isDiscoverable: false,
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // 2. Delete own outgoing decisions
    const outgoingSnap = await getDocs(
      query(collection(db, 'decisions'), where('fromUserId', '==', userId))
    ).catch(() => null);
    if (outgoingSnap && !outgoingSnap.empty) {
      await Promise.all(outgoingSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    }

    // 3. Mark own conversations as hidden
    const convSnap = await getDocs(
      query(collection(db, 'conversations'), where('participants', 'array-contains', userId))
    ).catch(() => null);
    if (convSnap && !convSnap.empty) {
      await Promise.all(
        convSnap.docs.map((c) =>
          updateDoc(c.ref, {
            [`participantSettings.${userId}.isHidden`]: true,
            [`participantSettings.${userId}.hiddenAt`]: serverTimestamp(),
            [`participantSettings.${userId}.historyClearedAt`]: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {})
        )
      );
    }
  } catch (clientCleanupErr) {
    console.warn('[DeleteAccount] Proactive client cleanup non-blocking error:', clientCleanupErr?.message || clientCleanupErr);
  }

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

  // Remove from saved account switcher so deleted account doesn't reappear
  // on the login screen. This must happen before sign-out so the login view
  // never sees the stale card.
  await removeSavedAccount(userId).catch(() => {});
  if (email) {
    await removeSavedAccount(email).catch(() => {});
  }
  await clearActiveUser().catch(() => {});

  // Clear fast boot and local offline cache
  await clearFastBootData().catch(() => {});
  await clearOfflineDataForUser(userId);
  await clearEncryptionIdentity(userId);

  // Sign out
  await signOutUser();
}
