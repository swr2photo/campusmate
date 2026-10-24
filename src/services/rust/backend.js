// Native (Rust + PostgreSQL) backend. `EXPO_PUBLIC_BACKEND=rust` switches the
// whole app; the Firebase code paths stay available for the legacy build.
import { getRustBackendClient } from '../rustBackendClient';
import { noteOutcome, noteRefusal } from '../serviceStatusService';

export const RUST_BACKEND = process.env.EXPO_PUBLIC_BACKEND === 'rust';

export function rustClient() {
  return getRustBackendClient();
}

export function rustUid() {
  if (!RUST_BACKEND) return null;
  try {
    return rustClient().user?.uid || null;
  } catch {
    return null;
  }
}

// A returning launch renders the cached account before the stored native
// session has been read. Callers that check the UID first wait for that
// restore (like waitForAuthReady in the Firebase build) instead of treating
// the gap as signed out. Resolves null when nobody is signed in.
export async function waitForRustSession() {
  if (!RUST_BACKEND) return null;
  try {
    return (await rustClient().ready())?.uid || null;
  } catch (error) {
    throw callableError(error);
  }
}

// Callers were written against Firebase callable errors (`functions/<code>`).
function callableError(error) {
  if (!error || error.code === 'account-changed') return error;
  let code = String(error.code || '');
  const rawMessage = error.message || 'บริการไม่พร้อมใช้งาน';
  const cleanMessage = typeof rawMessage === 'string' ? rawMessage.replace(/\s*\[\d{3}\]/g, '').trim() : rawMessage;
  const msgLower = cleanMessage.toLowerCase();

  if (!code || code === 'internal') {
    if (error.name === 'AbortError' || msgLower.includes('cancel') || msgLower.includes('abort')) {
      code = 'cancelled';
    } else if (msgLower.includes('timeout') || msgLower.includes('timed out') || msgLower.includes('deadline')) {
      code = 'deadline-exceeded';
    } else {
      code = 'internal';
    }
  }

  return Object.assign(new Error(cleanMessage), {
    code: code.startsWith('functions/') ? code : `functions/${code}`,
    details: error.details,
    status: error.status,
    cause: error,
  });
}

// Every outcome feeds the service status: a maintenance refusal shows its
// notice at once, and repeated server faults count as an outage.
function settled(result) {
  noteOutcome(null);
  return result;
}

function failed(error) {
  const wrapped = callableError(error);
  noteRefusal(wrapped);
  noteOutcome(wrapped);
  return wrapped;
}

export async function rpc(name, data = {}) {
  try {
    return settled(await rustClient().rpc(name, data || {}));
  } catch (error) {
    throw failed(error);
  }
}

export async function publicRpc(name, data = {}) {
  try {
    return settled(await rustClient().publicRpc(name, data || {}));
  } catch (error) {
    throw failed(error);
  }
}

export async function rustAccessToken() {
  return rustClient().accessToken();
}

export function rustOrigin() {
  return rustClient().origin;
}
