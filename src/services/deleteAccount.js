/**
 * Delete Account Service
 *
 * Deletes all user data from Firestore, R2, and local storage.
 * Uses a Cloud Function (deleteUserData) for server-side cleanup
 * of data the client cannot access (e.g. other users' decisions).
 */
import { doc, deleteDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { signOutUser, getCurrentUserIdToken } from './authService';
import { clearOfflineDataForUser } from './offlineStorage';

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
      console.warn('[DeleteAccount] R2 avatar deletion failed:', response.status);
    }
  } catch (error) {
    // Non-blocking — avatar will be orphaned but not a security risk
    console.warn('[DeleteAccount] R2 avatar deletion error:', error);
  }
}

/**
 * Client-side cleanup: delete data that the current user has permission to delete.
 */
async function clientSideCleanup(userId) {
  const { db } = requireFirebase();
  const batch = writeBatch(db);

  // 1. Delete user's private profile
  batch.delete(doc(db, 'users', userId));

  // 2. Delete user's public profile
  batch.delete(doc(db, 'profiles', userId));

  await batch.commit();

  // 3. Delete outgoing AND incoming decisions (client now has permission in firestore.rules)
  const outgoingDecisions = await getDocs(
    query(collection(db, 'decisions'), where('fromUserId', '==', userId))
  );
  const incomingDecisions = await getDocs(
    query(collection(db, 'decisions'), where('toUserId', '==', userId))
  );

  const decisionDocs = [...outgoingDecisions.docs, ...incomingDecisions.docs];
  if (decisionDocs.length > 0) {
    const decisionBatch = writeBatch(db);
    // Use Set to prevent deleting the same doc twice if somehow from == to
    const seenIds = new Set();
    decisionDocs.forEach((d) => {
      if (!seenIds.has(d.id)) {
        seenIds.add(d.id);
        decisionBatch.delete(d.ref);
      }
    });
    await decisionBatch.commit();
  }

  // 4. Delete conversations where user is a participant
  const conversations = await getDocs(
    query(collection(db, 'conversations'), where('participants', 'array-contains', userId))
  );
  if (!conversations.empty) {
    const convBatch = writeBatch(db);
    conversations.docs.forEach((d) => convBatch.delete(d.ref));
    await convBatch.commit();
  }

  // Note: pushTokens and notificationDeliveries cannot be deleted by the client
  // due to firestore.rules restrictions (they are meant to be managed by Cloud Functions).
  // However, without Cloud Functions (Blaze Plan), they are never created anyway.
}

/**
 * Main delete account function — called from AppContext.
 *
 * Flow:
 * 1. Try server-side Cloud Function first (handles incoming decisions from other users)
 * 2. Fallback to client-side cleanup if Cloud Function is not deployed
 * 3. Delete R2 avatar
 * 4. Clear local offline cache
 * 5. Sign out
 */
export async function deleteAccountData(userId) {
  if (!userId) throw new Error('ไม่พบ User ID');

  // Try Cloud Function first
  try {
    const { app } = requireFirebase();
    const functions = getFunctions(app, 'asia-southeast1');
    const deleteUserDataFn = httpsCallable(functions, 'deleteUserData');
    await deleteUserDataFn({ userId });
  } catch (error) {
    // If Cloud Function is not deployed or fails, do client-side cleanup
    console.warn('[DeleteAccount] Cloud Function failed, doing client-side cleanup:', error.message);
    await clientSideCleanup(userId);
  }

  // Delete avatar from R2
  await deleteR2Avatar(userId);

  // Clear local offline cache
  await clearOfflineDataForUser(userId);

  // Sign out
  await signOutUser();
}
