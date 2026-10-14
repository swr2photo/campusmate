// Native sessions for the Rust backend. Existing Firebase sign-ins are moved
// once (same UID) and legacy passwords keep working: the server verifies a
// legacy password with Firebase on the first native sign-in and rehashes it.
import { getAuth, signOut as firebaseSignOut } from 'firebase/auth';
import { firebaseApp } from '../dbService';
import { publicRpc, rpc, rustClient } from './backend';
import { resetBackendEvents } from './events';

function normalize(user) {
  if (!user?.uid) return null;
  return {
    id: user.uid,
    email: user.email || '',
    displayName: null,
    photoURL: null,
    emailVerified: user.emailVerified === true,
    role: user.role || 'user',
    providerData: [],
    creationTime: null,
    lastSignInTime: null,
  };
}

// Screens map Firebase Auth codes to Thai messages; keep those codes.
function authError(error, mode = 'signin') {
  const code = String(error?.code || '');
  const mapped = {
    unauthenticated: 'auth/invalid-credential',
    'resource-exhausted': 'auth/too-many-requests',
    'already-exists': 'auth/email-already-in-use',
    unavailable: 'auth/network-request-failed',
  }[code] || (code === 'invalid-argument' && mode === 'signup' ? 'auth/weak-password' : null);
  if (error?.details?.reason === 'MIGRATION_PENDING') {
    return Object.assign(new Error(error.message), { code: 'auth/migration-pending' });
  }
  if (!mapped) return error;
  return Object.assign(new Error(error.message || mapped), { code: mapped, cause: error });
}

async function afterSignIn(user) {
  resetBackendEvents();
  let verificationSent = false;
  if (!user.emailVerified) {
    try {
      await rpc('sendBrandedEmailVerification');
      verificationSent = true;
    } catch (error) {
      if (String(error?.code || '').includes('resource-exhausted')) verificationSent = 'throttled';
    }
  }
  return { mode: 'rust', user: normalize(user), verificationSent };
}

export async function signInWithEmail(email, password) {
  try {
    return await afterSignIn(await rustClient().signIn(email, password));
  } catch (error) {
    throw authError(error);
  }
}

export async function signUpWithEmail(email, password) {
  try {
    const user = await rustClient().signUp(email, password);
    resetBackendEvents();
    return { mode: 'rust', user: normalize(user) };
  } catch (error) {
    throw authError(error, 'signup');
  }
}

export async function signInWithGoogleIdToken(idToken) {
  try {
    const user = await rustClient().signInWithGoogle(idToken);
    resetBackendEvents();
    return { mode: 'rust', user: normalize(user) };
  } catch (error) {
    throw authError(error);
  }
}

export async function signOutUser() {
  resetBackendEvents();
  await rustClient().signOut();
}

export function getCurrentAuthUserId() {
  return rustClient().user?.uid || null;
}

export async function getCurrentAccessToken() {
  return (await rustClient().accessToken()).token;
}

// A still-valid Firebase session from the previous app version becomes a
// native session for the same account, then the Firebase session is ended.
async function migrateFirebaseSession() {
  if (!firebaseApp) return null;
  let auth;
  try { auth = getAuth(firebaseApp); } catch { return null; }
  if (typeof auth.authStateReady === 'function') {
    await Promise.race([auth.authStateReady().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
  const current = auth.currentUser;
  if (!current) return null;
  const idToken = await current.getIdToken(true);
  try {
    const user = await rustClient().exchangeFirebase(idToken);
    await firebaseSignOut(auth).catch(() => {});
    return user;
  } catch (error) {
    if (error?.details?.reason === 'MIGRATION_PENDING' || error?.code === 'unauthenticated') {
      await firebaseSignOut(auth).catch(() => {});
    }
    throw error;
  }
}

export function subscribeToAuthChanges(callback, onError) {
  const client = rustClient();
  let restored = false;
  let active = true;
  const forward = (user) => {
    if (!active || !restored) return;
    // Same rule as the Firebase build: unverified password accounts stay on
    // the sign-in screen until the email link is opened.
    callback(user && user.emailVerified ? { mode: 'rust', user: normalize(user) } : null);
  };
  const unsubscribe = client.subscribe(forward);
  (async () => {
    try {
      let user = await client.restore();
      if (!user) user = await migrateFirebaseSession().catch((error) => { onError?.(error); return null; });
      if (user) resetBackendEvents();
    } catch (error) {
      onError?.(error);
    } finally {
      restored = true;
      forward(client.user);
    }
  })();
  return () => { active = false; unsubscribe(); };
}

export async function reloadUser() {
  const user = await rustClient().refreshUser();
  return normalize(user);
}

export async function resendEmailVerification(email, password) {
  const client = rustClient();
  if (!client.user && email && password) {
    const user = await client.signIn(email, password).catch((error) => { throw authError(error); });
    if (user.emailVerified) return { alreadyVerified: true };
  }
  const result = await rpc('sendBrandedEmailVerification');
  if (result?.alreadyVerified) return { alreadyVerified: true };
  return { success: true };
}

export async function sendPasswordReset(email) {
  const result = await publicRpc('sendBrandedPasswordReset', { email });
  return { sent: true, email, sender: result?.sender || 'noreply@getcampusmate.app' };
}

export async function checkCampusEmailAvailability(email) {
  const data = await publicRpc('checkCampusEmailAvailability', { email });
  return {
    email: data?.email || email,
    exists: data?.exists === true,
    ownedByCurrentUser: data?.ownedByCurrentUser === true,
    workspaceExists: data?.workspaceExists === true,
    workspaceCheckConfigured: data?.workspaceCheckConfigured === true,
  };
}

export async function requestCampusEmailChange(newEmail) {
  const user = normalize(rustClient().user);
  const data = await rpc('sendCampusEmailChange', { email: newEmail });
  if (data?.alreadyCampus) return { alreadyCampus: true, user };
  return { sent: true, email: data?.email || newEmail, sender: data?.sender || 'noreply@getcampusmate.app', user };
}

export async function reloadCampusEmailStatus() {
  return reloadUser();
}
