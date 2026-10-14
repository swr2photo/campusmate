#!/usr/bin/env node
// --run NAME validates a completed private export; --apply enables cloud copying.
// Importing this module never initializes Firebase, R2 or credentials.
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ID } from './export-native-backend.mjs';

const RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const BUCKETS = new Set([`${PROJECT_ID}.firebasestorage.app`, `${PROJECT_ID}.appspot.com`]);
const FILES = new Set(['auth-users.jsonl', 'firestore.jsonl', 'storage-objects.jsonl']);
const GALLERY = /^profile_gallery\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const canonicalBase64 = (value, length) => typeof value === 'string'
  && Buffer.from(value, 'base64').length === length && Buffer.from(value, 'base64').toString('base64') === value;

export function parseArguments(args) {
  let runName, apply = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--run' && runName === undefined && args[index + 1] && !args[index + 1].startsWith('--')) {
      runName = args[++index];
    } else if (args[index] === '--apply' && !apply) apply = true;
    else fail('INVALID_ARGUMENTS');
  }
  if (typeof runName !== 'string' || !RUN.test(runName)) fail('INVALID_RUN_NAME');
  return { runName, apply };
}

async function regularFile(target, maxBytes) {
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) fail('UNSAFE_SOURCE');
  const handle = await open(target, 'r');
  const current = await handle.stat();
  if (!current.isFile() || current.dev !== metadata.dev || current.ino !== metadata.ino) {
    await handle.close(); fail('UNSAFE_SOURCE');
  }
  return handle;
}

function galleryRow(row) {
  if (!row || typeof row !== 'object' || !BUCKETS.has(row.bucket) || typeof row.name !== 'string') fail('INVALID_OBJECT');
  // Storage names are already literal names; decoding them would select another object.
  if (!row.name.startsWith('profile_gallery/')) return null;
  if (!GALLERY.test(row.name) || typeof row.generation !== 'string' || !/^[1-9][0-9]{0,29}$/.test(row.generation)
    || typeof row.size !== 'string' || !/^[1-9][0-9]*$/.test(row.size)
    || !integer(Number(row.size)) || Number(row.size) > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(row.contentType)
    || (row.md5Hash != null && !canonicalBase64(row.md5Hash, 16))
    || (row.crc32c != null && !canonicalBase64(row.crc32c, 4))
    || (!row.md5Hash && !row.crc32c)) fail('INVALID_GALLERY_OBJECT');
  return { bucket: row.bucket, name: row.name, generation: row.generation, size: Number(row.size),
    contentType: row.contentType, md5Hash: row.md5Hash || null, crc32c: row.crc32c || null };
}

/** Check storage bytes/row counts against the export manifest before cloud access. */
export async function readGallerySnapshot({ repoRoot, runName }) {
  if (typeof runName !== 'string' || !RUN.test(runName)) fail('INVALID_RUN_NAME');
  const root = await realpath(repoRoot);
  let directory = root;
  for (const part of ['artifacts', 'rust-migration', runName]) {
    directory = path.join(directory, part);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) fail('UNSAFE_SOURCE');
  }
  const manifestFile = await regularFile(path.join(directory, 'manifest.json'), 1024 * 1024);
  let manifest;
  try { manifest = JSON.parse(await manifestFile.readFile('utf8')); }
  finally { await manifestFile.close(); }
  if (manifest.format_version !== 1 || manifest.project_id !== PROJECT_ID || manifest.completed !== true
    || manifest.password_credentials_exported !== false || !Array.isArray(manifest.files) || manifest.files.length !== FILES.size) fail('INVALID_MANIFEST');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || !FILES.has(file.name) || seen.has(file.name) || !integer(file.rows) || !integer(file.bytes)
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('INVALID_MANIFEST');
    seen.add(file.name);
  }
  const expected = manifest.files.find((file) => file.name === 'storage-objects.jsonl');
  const handle = await regularFile(path.join(directory, expected.name), expected.bytes);
  const objects = [], names = new Set(), hash = createHash('sha256');
  let bytes = 0, rows = 0, pending = Buffer.alloc(0);
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk); bytes += chunk.length;
      if (bytes > expected.bytes) fail('SOURCE_INTEGRITY_FAILED');
      pending = Buffer.concat([pending, chunk]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        if (newline > 2 * 1024 * 1024) fail('INVALID_OBJECT');
        const row = JSON.parse(pending.subarray(0, newline).toString('utf8'));
        pending = pending.subarray(newline + 1); rows += 1;
        const object = galleryRow(row);
        if (object) {
          if (names.has(object.name)) fail('DUPLICATE_GALLERY_OBJECT');
          names.add(object.name); objects.push(object);
        }
      }
      if (pending.length > 2 * 1024 * 1024) fail('INVALID_OBJECT');
    }
  } finally { await handle.close(); }
  if (pending.length || bytes !== expected.bytes || rows !== expected.rows || hash.digest('hex') !== expected.sha256) fail('SOURCE_INTEGRITY_FAILED');
  return objects;
}

const CRC32C_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  return crc >>> 0;
});
// GCS exports CRC32C as a base64 big-endian 32-bit value.
export function crc32cBase64(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC32C_TABLE[(crc ^ byte) & 0xff];
  const digest = Buffer.alloc(4); digest.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return digest.toString('base64');
}

function verifyBytes(object, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== object.size
    || (object.md5Hash && createHash('md5').update(bytes).digest('base64') !== object.md5Hash)
    || (object.crc32c && crc32cBase64(bytes) !== object.crc32c)) fail('OBJECT_CHECKSUM_MISMATCH');
}

function verifySourceMetadata(object, metadata) {
  if (String(metadata?.generation) !== object.generation || String(metadata?.size) !== String(object.size)
    || metadata?.contentType !== object.contentType
    || (object.md5Hash && metadata?.md5Hash !== object.md5Hash)
    || (object.crc32c && metadata?.crc32c !== object.crc32c)) fail('SOURCE_GENERATION_MISMATCH');
}

async function verifyDestination(object, destination, metadata) {
  if (metadata?.ContentLength !== object.size || metadata?.ContentType !== object.contentType
    || typeof metadata?.ETag !== 'string' || !metadata.ETag) fail('DESTINATION_MISMATCH');
  const bytes = await destination.get(object.name, metadata.ETag, object.size);
  verifyBytes(object, bytes);
  return bytes;
}

async function head(destination, name) {
  try { return await destination.head(name); }
  catch (error) {
    // Only an actual HTTP 404 proves absence; permission/network failures stop copying.
    if (error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/** Injected adapters prove behavior without credentials or live media. */
export async function copyGalleryObjects({ objects, source, destination }) {
  const report = { galleryObjects: objects.length, copied: 0, verifiedExisting: 0 };
  for (const object of objects) {
    const existing = await head(destination, object.name);
    if (existing) {
      await verifyDestination(object, destination, existing);
      report.verifiedExisting += 1;
      continue;
    }
    const { metadata, bytes } = await source.download(object);
    verifySourceMetadata(object, metadata);
    verifyBytes(object, bytes);
    try {
      await destination.put(object, bytes);
    } catch (error) {
      // A competing creator must not be overwritten. Accept identical verified bytes only.
      if (error?.$metadata?.httpStatusCode !== 412) throw error;
      const raced = await head(destination, object.name);
      if (!raced) fail('DESTINATION_CHANGED');
      await verifyDestination(object, destination, raced);
      report.verifiedExisting += 1;
      continue;
    }
    const uploaded = await head(destination, object.name);
    if (!uploaded) fail('DESTINATION_MISSING');
    const copied = await verifyDestination(object, destination, uploaded);
    if (!createHash('sha256').update(copied).digest().equals(createHash('sha256').update(bytes).digest())) fail('DESTINATION_MISMATCH');
    report.copied += 1;
  }
  return report;
}

async function boundedBody(body, expectedSize) {
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') fail('DESTINATION_MISMATCH');
  const chunks = []; let size = 0;
  try {
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > expectedSize) fail('DESTINATION_MISMATCH');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally { body.destroy?.(); }
}

export function createR2Destination({ client, bucket, HeadObjectCommand, GetObjectCommand, PutObjectCommand }) {
  return {
    head: (key) => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    async get(key, etag, size) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag }));
      return boundedBody(response.Body, size);
    },
    put: (object, bytes) => client.send(new PutObjectCommand({ Bucket: bucket, Key: object.name, Body: bytes,
      ContentType: object.contentType, ContentMD5: createHash('md5').update(bytes).digest('base64'),
      CacheControl: 'public, max-age=31536000, immutable', IfNoneMatch: '*' })),
  };
}

export function createFirebaseSource(storage) {
  return { async download(object) {
    const file = storage.bucket(object.bucket).file(object.name, { generation: object.generation });
    const [metadata] = await file.getMetadata();
    verifySourceMetadata(object, metadata);
    const [bytes] = await file.download({ validation: object.crc32c ? 'crc32c' : 'md5', decompress: false });
    return { metadata, bytes };
  } };
}

async function main() {
  const { runName, apply } = parseArguments(process.argv.slice(2));
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const objects = await readGallerySnapshot({ repoRoot, runName });
  if (!apply) { console.log(JSON.stringify({ galleryObjects: objects.length, validated: true, applied: false })); return; }
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) fail('EMULATOR_ENVIRONMENT');
  for (const key of ['R2_ENDPOINT', 'R2_MEDIA_ACCESS_KEY_ID', 'R2_MEDIA_SECRET_ACCESS_KEY', 'R2_MEDIA_BUCKET']) {
    if (!process.env[key]) fail('COPY_CONFIGURATION_REQUIRED');
  }
  if (!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/.test(process.env.R2_ENDPOINT)
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(process.env.R2_MEDIA_BUCKET)) fail('INVALID_DESTINATION');
  const require = createRequire(path.join(repoRoot, 'functions', 'package.json'));
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
  const { getStorage } = require('firebase-admin/storage');
  const sdk = require('@aws-sdk/client-s3');
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'gallery-migration');
  const client = new sdk.S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.R2_MEDIA_ACCESS_KEY_ID, secretAccessKey: process.env.R2_MEDIA_SECRET_ACCESS_KEY } });
  try {
    const source = createFirebaseSource(getStorage(app));
    console.log(JSON.stringify(await copyGalleryObjects({ objects, source,
      destination: createR2Destination({ client, bucket: process.env.R2_MEDIA_BUCKET, ...sdk }) })));
  } finally { client.destroy(); await deleteApp(app); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // SDK/JSON errors can contain private identifiers, URLs and provider responses.
    console.error('Gallery copy stopped. Keep the write freeze; verify the private snapshot and provider access before retrying.');
    process.exitCode = 1;
  });
}
