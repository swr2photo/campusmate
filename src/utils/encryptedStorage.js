/**
 * AES-GCM storage for offline snapshots and queued operations.
 *
 * This is separate from chat E2EE: it protects the local cache while the
 * device is offline. Native keys stay in iOS Keychain/Android Keystore via
 * SecureStore. Web uses a per-origin key because SecureStore is unavailable.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const ENCRYPTION_KEY_ALIAS = 'campusmate_enc_key_v1';
const WEB_ENCRYPTION_KEY_ALIAS = `${ENCRYPTION_KEY_ALIAS}_web`;
const AES_PREFIX = 'ENC:AESGCM:1:';
const LEGACY_XOR_PREFIX = 'ENC:1:';
let cachedKey = null;

function bytesToBase64(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < input.length; index += 3) {
    const first = input[index];
    const second = index + 1 < input.length ? input[index + 1] : 0;
    const third = index + 2 < input.length ? input[index + 2] : 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += index + 1 < input.length ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    output += index + 2 < input.length ? alphabet[third & 63] : '=';
  }
  return output;
}

function base64Value(code) {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

function base64ToBytes(value) {
  const normalized = String(value || '').replace(/\s/g, '').replace(/=+$/, '');
  if (!normalized || normalized.length % 4 === 1) throw new Error('Invalid base64');
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const a = base64Value(normalized.charCodeAt(index));
    const b = base64Value(normalized.charCodeAt(index + 1));
    const c = index + 2 < normalized.length ? base64Value(normalized.charCodeAt(index + 2)) : 0;
    const d = index + 3 < normalized.length ? base64Value(normalized.charCodeAt(index + 3)) : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid base64');
    bytes.push((a << 2) | (b >> 4));
    if (index + 2 < normalized.length) bytes.push(((b & 15) << 4) | (c >> 2));
    if (index + 3 < normalized.length) bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}

function utf8ToBase64(value) {
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(String(value))
    : Uint8Array.from(unescape(encodeURIComponent(String(value))), (character) => character.charCodeAt(0));
  return bytesToBase64(bytes);
}

function base64ToUtf8(value) {
  const bytes = base64ToBytes(value);
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return decodeURIComponent(escape(binary));
}

function makeKey() {
  return Array.from(Crypto.getRandomBytes(32))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readKey() {
  if (Platform.OS === 'web') return AsyncStorage.getItem(WEB_ENCRYPTION_KEY_ALIAS);
  return SecureStore.getItemAsync(ENCRYPTION_KEY_ALIAS);
}

async function writeKey(key) {
  if (Platform.OS === 'web') return AsyncStorage.setItem(WEB_ENCRYPTION_KEY_ALIAS, key);
  return SecureStore.setItemAsync(ENCRYPTION_KEY_ALIAS, key);
}

async function getOrCreateEncryptionKey() {
  if (cachedKey) return cachedKey;
  const existing = await readKey();
  if (/^[0-9a-f]{64}$/i.test(existing || '')) {
    cachedKey = existing;
    return cachedKey;
  }
  cachedKey = makeKey();
  await writeKey(cachedKey);
  return cachedKey;
}

async function encryptAesGcm(value, keyHex) {
  const encryptionKey = await Crypto.AESEncryptionKey.import(keyHex, 'hex');
  const sealed = await Crypto.aesEncryptAsync(utf8ToBase64(value), encryptionKey);
  return `${AES_PREFIX}${await sealed.combined('base64')}`;
}

async function decryptAesGcm(value, keyHex) {
  const encryptionKey = await Crypto.AESEncryptionKey.import(keyHex, 'hex');
  // Expo Crypto's Android bridge currently exposes fromCombined as ByteArray
  // even though its JavaScript type also accepts a base64 string.
  const sealed = Crypto.AESSealedData.fromCombined(base64ToBytes(value), { ivLength: 12, tagLength: 16 });
  const plaintextBase64 = await Crypto.aesDecryptAsync(sealed, encryptionKey, { output: 'base64' });
  return base64ToUtf8(plaintextBase64);
}

// Read-only compatibility for data written by the old XOR implementation.
function legacyXorDecrypt(cipherBase64, keyHex) {
  const data = base64ToBytes(cipherBase64);
  const keyBytes = [];
  for (let index = 0; index < keyHex.length; index += 2) keyBytes.push(parseInt(keyHex.slice(index, index + 2), 16));
  const output = Uint8Array.from(data, (byte, index) => byte ^ keyBytes[index % keyBytes.length]);
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(output);
  let binary = '';
  for (const byte of output) binary += String.fromCharCode(byte);
  return decodeURIComponent(escape(binary));
}

export async function setEncryptedItem(key, value) {
  const encryptionKey = await getOrCreateEncryptionKey();
  const encrypted = await encryptAesGcm(String(value), encryptionKey);
  return AsyncStorage.setItem(key, encrypted);
}

export async function getEncryptedItem(key) {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;

  const encryptionKey = await getOrCreateEncryptionKey();
  try {
    if (raw.startsWith(AES_PREFIX)) {
      return await decryptAesGcm(raw.slice(AES_PREFIX.length), encryptionKey);
    }

    if (raw.startsWith(LEGACY_XOR_PREFIX)) {
      const legacyValue = legacyXorDecrypt(raw.slice(LEGACY_XOR_PREFIX.length), encryptionKey);
      // Upgrade old local data on first read. A failed upgrade does not make
      // the new write path fall back to plaintext.
      try {
        await setEncryptedItem(key, legacyValue);
      } catch (migrationError) {
        console.warn('[EncryptedStorage] Legacy cache migration failed:', migrationError);
        return null;
      }
      return legacyValue;
    }

    // One-time migration for snapshots written before encryption existed.
    try {
      await setEncryptedItem(key, raw);
    } catch (migrationError) {
      console.warn('[EncryptedStorage] Plaintext cache migration failed:', migrationError);
      return null;
    }
    return raw;
  } catch (error) {
    console.warn('[EncryptedStorage] AES-GCM decryption failed:', error);
    return null;
  }
}

export async function removeEncryptedItem(key) {
  return AsyncStorage.removeItem(key);
}

export async function multiRemoveEncryptedItems(keys) {
  return AsyncStorage.multiRemove(keys);
}
