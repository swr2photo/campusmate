import assert from 'node:assert/strict';
import nacl from 'tweetnacl';

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
  if (code === 43 || code === 45) return 62;
  if (code === 47 || code === 95) return 63;
  return -1;
}

function base64ToBytes(value) {
  if (typeof value !== 'string') throw new Error('Invalid base64 value');
  const normalized = value.replace(/\s/g, '').replace(/=+$/, '');
  if (!normalized || normalized.length % 4 === 1) throw new Error('Invalid base64 length');
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const a = base64Value(normalized.charCodeAt(index));
    const b = base64Value(normalized.charCodeAt(index + 1));
    const c = index + 2 < normalized.length ? base64Value(normalized.charCodeAt(index + 2)) : 0;
    const d = index + 3 < normalized.length ? base64Value(normalized.charCodeAt(index + 3)) : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid base64 value');
    bytes.push((a << 2) | (b >> 4));
    if (index + 2 < normalized.length) bytes.push(((b & 15) << 4) | (c >> 2));
    if (index + 3 < normalized.length) bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}

function encryptMediaBytes(binaryBytes, conversationKey) {
  if (!conversationKey || conversationKey.length !== nacl.secretbox.keyLength) {
    throw new Error('Invalid key');
  }
  const input = binaryBytes instanceof Uint8Array ? binaryBytes : new Uint8Array(binaryBytes || []);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(input, nonce, conversationKey);
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return packed;
}

function decryptMediaBytes(encryptedBytes, conversationKey) {
  if (!conversationKey || conversationKey.length !== nacl.secretbox.keyLength) {
    throw new Error('Invalid key');
  }
  const input = encryptedBytes instanceof Uint8Array ? encryptedBytes : new Uint8Array(encryptedBytes || []);
  if (input.length <= nacl.secretbox.nonceLength) {
    throw new Error('Payload too short');
  }
  const nonce = input.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = input.slice(nacl.secretbox.nonceLength);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, conversationKey);
  if (!decrypted) {
    throw new Error('Decryption failed');
  }
  return decrypted;
}

console.log('--- Testing Zero-Knowledge Client-Side Media Encryption ---');

// 1. Mock sample JPEG image bytes
const sampleImageBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, ...Array(500).fill(42)]);
const conversationKey = nacl.randomBytes(32);
const wrongKey = nacl.randomBytes(32);

// 2. Encrypt
const encrypted = encryptMediaBytes(sampleImageBytes, conversationKey);
console.log('Original image byte size:', sampleImageBytes.length);
console.log('Encrypted payload size:', encrypted.length);
assert.equal(encrypted.length, 24 + sampleImageBytes.length + 16, 'Encrypted size must equal 24-byte nonce + data + 16-byte auth tag');
assert.notDeepEqual(encrypted.slice(24, 28), sampleImageBytes.slice(0, 4), 'Ciphertext must obscure JPEG magic numbers');

// 3. Base64 encode / decode roundtrip
const b64 = bytesToBase64(encrypted);
const restoredBytes = base64ToBytes(b64);
assert.deepEqual(restoredBytes, encrypted, 'Base64 roundtrip must be lossless');

// 4. Decrypt with correct conversation key
const decrypted = decryptMediaBytes(restoredBytes, conversationKey);
assert.deepEqual(decrypted, sampleImageBytes, 'Decrypted bytes must exactly match original image bytes');
console.log('Decryption with valid key: SUCCESS (100% byte match)');

// 5. Decrypt with wrong key must fail
assert.throws(() => {
  decryptMediaBytes(restoredBytes, wrongKey);
}, /Decryption failed/, 'Wrong key must fail decryption');
console.log('Decryption with wrong key: REJECTED as expected');

console.log('All media encryption verification tests PASSED!\n');
