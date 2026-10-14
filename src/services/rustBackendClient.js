import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createRustBackendClient, normalizeRustOrigin } from './rustBackendProtocol.mjs';

// This is an isolated migration client. The full app stays on its existing
// backend until every feature's data and authorization contract is migrated.
let client;
export function getRustBackendClient() {
  if (client) return client;
  const baseURL = process.env.EXPO_PUBLIC_RUST_BACKEND_URL;
  if (!baseURL) throw new Error('ยังไม่ได้ตั้งค่า Rust backend');
  // Separate credentials for separate HTTPS endpoints. Web sessions stay in memory.
  const origin = normalizeRustOrigin(baseURL);
  const endpointKey = Array.from(origin, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const key = `campusmate.native.session.${endpointKey}`;
  let webSession = null;
  const storage = Platform.OS === 'web' ? {
    read: async () => webSession, write: async value => { webSession = value; }, clear: async () => { webSession = null; },
  } : {
    read: async () => { const raw = await SecureStore.getItemAsync(key); return raw ? JSON.parse(raw) : null; },
    write: value => SecureStore.setItemAsync(key, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    clear: () => SecureStore.deleteItemAsync(key),
  };
  client = createRustBackendClient({ baseURL, fetch, storage });
  return client;
}
