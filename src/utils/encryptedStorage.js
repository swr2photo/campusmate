/**
 * Encrypted Storage Utility
 *
 * Encrypts large payloads before storing them in AsyncStorage.
 * The encryption key is generated once and kept in expo-secure-store
 * (iOS Keychain / Android EncryptedSharedPreferences).
 *
 * On web, data is stored as-is because localStorage is already
 * sandboxed per origin.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const ENCRYPTION_KEY_ALIAS = 'campusmate_enc_key_v1';

// ---------- helpers ----------

let _cachedKey = null;

async function getOrCreateEncryptionKey() {
  if (_cachedKey) return _cachedKey;

  const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_ALIAS);
  if (existing) {
    _cachedKey = existing;
    return existing;
  }

  // Generate a 256-bit key encoded as hex (64 chars)
  const key = Crypto.getRandomBytes(32)
    .reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');
  await SecureStore.setItemAsync(ENCRYPTION_KEY_ALIAS, key);
  _cachedKey = key;
  return key;
}

/**
 * Simple XOR-based stream cipher using a key-derived pad.
 * This is NOT AES, but provides meaningful confidentiality for
 * data-at-rest against casual inspection on rooted devices.
 *
 * For truly sensitive payloads (e.g. medical / financial), swap this
 * out for SubtleCrypto AES-GCM when Expo adds native support.
 */
function xorEncrypt(plaintext, keyHex) {
  const data = new TextEncoder().encode(plaintext);
  const keyBytes = [];
  for (let i = 0; i < keyHex.length; i += 2) {
    keyBytes.push(parseInt(keyHex.substring(i, i + 2), 16));
  }

  const output = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    output[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }

  // Encode as base64 via binary string
  let binaryStr = '';
  for (let i = 0; i < output.length; i++) {
    binaryStr += String.fromCharCode(output[i]);
  }
  return btoa(binaryStr);
}

function xorDecrypt(cipherBase64, keyHex) {
  const binaryStr = atob(cipherBase64);
  const data = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    data[i] = binaryStr.charCodeAt(i);
  }

  const keyBytes = [];
  for (let i = 0; i < keyHex.length; i += 2) {
    keyBytes.push(parseInt(keyHex.substring(i, i + 2), 16));
  }

  const output = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    output[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }

  return new TextDecoder().decode(output);
}

// ---------- Public API ----------

const ENCRYPTED_PREFIX = 'ENC:1:';

/**
 * Store a value with encryption (native) or plaintext (web).
 */
export async function setEncryptedItem(key, value) {
  if (Platform.OS === 'web') {
    return AsyncStorage.setItem(key, value);
  }
  try {
    const encKey = await getOrCreateEncryptionKey();
    const encrypted = xorEncrypt(value, encKey);
    return AsyncStorage.setItem(key, ENCRYPTED_PREFIX + encrypted);
  } catch (error) {
    // Fallback to plaintext if encryption fails
    console.warn('[EncryptedStorage] Encryption failed, storing plaintext:', error);
    return AsyncStorage.setItem(key, value);
  }
}

/**
 * Retrieve and decrypt a value.  Handles both encrypted and legacy
 * plaintext values transparently so the migration is seamless.
 */
export async function getEncryptedItem(key) {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;

  if (Platform.OS === 'web' || !raw.startsWith(ENCRYPTED_PREFIX)) {
    // Plaintext (web or legacy data written before encryption was added)
    return raw;
  }

  try {
    const encKey = await getOrCreateEncryptionKey();
    const ciphertext = raw.slice(ENCRYPTED_PREFIX.length);
    return xorDecrypt(ciphertext, encKey);
  } catch (error) {
    console.warn('[EncryptedStorage] Decryption failed, returning raw:', error);
    return raw;
  }
}

/**
 * Remove an encrypted item.
 */
export async function removeEncryptedItem(key) {
  return AsyncStorage.removeItem(key);
}

/**
 * Remove multiple encrypted items.
 */
export async function multiRemoveEncryptedItems(keys) {
  return AsyncStorage.multiRemove(keys);
}
