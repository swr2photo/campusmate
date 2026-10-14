// Native (Rust + PostgreSQL) backend. `EXPO_PUBLIC_BACKEND=rust` switches the
// whole app; the Firebase code paths stay available for the legacy build.
import { getRustBackendClient } from '../rustBackendClient';

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

// Callers were written against Firebase callable errors (`functions/<code>`).
function callableError(error) {
  if (!error || error.code === 'account-changed') return error;
  const code = String(error.code || 'internal');
  return Object.assign(new Error(error.message || 'บริการไม่พร้อมใช้งาน'), {
    code: code.startsWith('functions/') ? code : `functions/${code}`,
    details: error.details,
    status: error.status,
    cause: error,
  });
}

export async function rpc(name, data = {}) {
  try {
    return await rustClient().rpc(name, data || {});
  } catch (error) {
    throw callableError(error);
  }
}

export async function publicRpc(name, data = {}) {
  try {
    return await rustClient().publicRpc(name, data || {});
  } catch (error) {
    throw callableError(error);
  }
}

export async function rustAccessToken() {
  return rustClient().accessToken();
}

export function rustOrigin() {
  return rustClient().origin;
}
