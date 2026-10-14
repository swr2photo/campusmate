#!/usr/bin/env node
// Read-only migration export. Importing this module never initializes Firebase.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ID = 'campusmate-7f1ab';
export const EXPORT_VERSION = 1;
// Credentials and temporary capabilities are deliberately reissued after migration.
export const EXCLUDED_COLLECTIONS = new Set([
  'accountDeletionOtps', 'faceVerificationSessions', 'pushTokens',
  'likePageCursors', 'discoveryPageCursors',
]);
const SECRET_FIELDS = new Set([
  'password', 'passwordhash', 'passwordsalt', 'refreshtoken', 'accesstoken',
  'idtoken', 'firebaseidtoken', 'customtoken', 'sessiontoken', 'authtoken',
  'appchecktoken', 'pushtoken', 'expopushtoken', 'fcmtoken', 'devicetoken',
  'notificationtokens', 'token', 'tokens', 'otp', 'otphash', 'verificationcode',
  'resettoken', 'apikey', 'secret', 'privatekey', 'secretkey', 'serviceaccount',
  'smtppassword', 'authorization', 'bearertoken', 'firebasestoragedownloadtokens',
  'oobcode', 'sessioncookie', 'clientsecret', 'secretaccesskey', 'accesskeyid',
]);
const sensitiveName = (key) => {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SECRET_FIELDS.has(normalized) || /(?:token|tokens|secret|password|privatekey|secretkey|credentials)$/.test(normalized);
};
const urlSecret = (key) => sensitiveName(key) || /^(?:x-amz-|x-goog-)/i.test(key)
  || /^(?:signature|credential|policy|key-pair-id)$/i.test(key);

function increment(record, key) {
  const current = Object.hasOwn(record, key) ? record[key] : 0;
  Object.defineProperty(record, key, { value: current + 1, writable: true, enumerable: true, configurable: true });
}
function milliseconds(value) {
  if (value == null) return null;
  const number = typeof value?.toMillis === 'function' ? value.toMillis()
    : value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

/** Epoch milliseconds for dates; tags preserve other Firestore-specific types. */
export function normalizeFirestoreValue(value, audit = { fields: {}, urlParameters: 0 }) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $type: 'number', value: String(value) };
  if (typeof value === 'bigint') return { $type: 'integer', value: value.toString() };
  if (typeof value === 'string') {
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      const url = new URL(value);
      let changed = false;
      for (const key of [...url.searchParams.keys()]) {
        if (urlSecret(key)) { url.searchParams.delete(key); audit.urlParameters += 1; changed = true; }
      }
      if (url.username || url.password) { url.username = ''; url.password = ''; changed = true; audit.urlParameters += 1; }
      return changed ? url.toString() : value;
    } catch { return value; }
  }
  if (value instanceof Date || (typeof value?.toMillis === 'function' && typeof value.seconds === 'number')) {
    const timestamp = milliseconds(value);
    if (timestamp == null) throw Object.assign(new Error('Invalid timestamp'), { code: 'INVALID_TIMESTAMP' });
    return timestamp;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $type: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (value.constructor?.name === 'GeoPoint') return { $type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value.constructor?.name === 'DocumentReference') return { $type: 'reference', path: value.path };
  if (Array.isArray(value)) return value.map((entry) => normalizeFirestoreValue(entry, audit));
  if (typeof value !== 'object') throw Object.assign(new Error('Unsupported Firestore value'), { code: 'UNSUPPORTED_VALUE' });
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (sensitiveName(key)) { increment(audit.fields, key); continue; }
    if (value[key] === undefined) continue;
    result[key] = normalizeFirestoreValue(value[key], audit);
  }
  return result;
}

export function normalizeAuthUser(user) {
  if (typeof user.uid !== 'string' || !user.uid || user.uid.length > 128) {
    throw Object.assign(new Error('Invalid source identity'), { code: 'INVALID_IDENTITY' });
  }
  const providers = (user.providerData || []).map((provider) => ({
    providerId: provider.providerId, uid: provider.uid,
    email: provider.email || null, displayName: provider.displayName || null, photoURL: provider.photoURL || null,
  }));
  const passwordResetRequired = providers.some((provider) => provider.providerId === 'password') || Boolean(user.passwordHash);
  // Do not use UserRecord.toJSON(): it can include password hashes and salts.
  return {
    uid: user.uid, email: user.email || null, emailVerified: user.emailVerified === true,
    disabled: user.disabled === true, displayName: user.displayName || null,
    photoURL: user.photoURL || null, providers,
    metadata: {
      creationTime: milliseconds(user.metadata?.creationTime),
      lastSignInTime: milliseconds(user.metadata?.lastSignInTime),
      lastRefreshTime: milliseconds(user.metadata?.lastRefreshTime),
    },
    password_reset_required: passwordResetRequired,
    credential_migration: passwordResetRequired ? 'password-reset-required' : 'provider-relink-required',
  };
}

async function rejectSymlink(target) {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Object.assign(new Error('Unsafe output directory'), { code: 'UNSAFE_OUTPUT' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** No caller-controlled absolute path; exports stay below this repository. */
export async function prepareOutput(repoRoot, runName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runName)) throw Object.assign(new Error('Invalid run name'), { code: 'INVALID_RUN_NAME' });
  const root = await realpath(repoRoot);
  const artifacts = path.join(root, 'artifacts');
  const base = path.join(artifacts, 'rust-migration');
  for (const directory of [artifacts, base]) {
    await rejectSymlink(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rejectSymlink(directory);
    const resolved = await realpath(directory);
    if (resolved !== directory) throw Object.assign(new Error('Output path redirects outside repository'), { code: 'UNSAFE_OUTPUT' });
  }
  const destination = path.join(base, runName);
  try { await lstat(destination); throw Object.assign(new Error('Export already exists'), { code: 'OUTPUT_EXISTS' }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = path.join(base, `.${runName}-${randomUUID()}.partial`);
  await mkdir(staging, { mode: 0o700 });
  return { staging, destination };
}

async function jsonlWriter(directory, name) {
  const handle = await open(path.join(directory, name), 'wx', 0o600);
  const hash = createHash('sha256');
  let count = 0, bytes = 0, closed = false;
  return {
    async append(value) {
      const line = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.writeFile(line); hash.update(line); count += 1; bytes += line.length;
    },
    async close() {
      if (!closed) { await handle.sync(); await handle.close(); closed = true; }
    },
    summary() { return { name, rows: count, bytes, sha256: hash.digest('hex') }; },
  };
}

/** Injected clients make the traversal and redaction testable without a cloud project. */
export async function exportSnapshot({ db, auth, bucket, repoRoot, runName, projectId = PROJECT_ID, now = () => new Date() }) {
  if (projectId !== PROJECT_ID) throw Object.assign(new Error('Unexpected project'), { code: 'WRONG_PROJECT' });
  const startedAt = now().toISOString();
  const { staging, destination } = await prepareOutput(repoRoot, runName);
  const writers = [];
  const audit = { fields: {}, urlParameters: 0 };
  const counts = { documents: 0, missingParentDocuments: 0, collectionGroups: {}, skippedCollections: {}, authUsers: 0, storageObjects: 0 };
  try {
    const documents = await jsonlWriter(staging, 'firestore.jsonl'); writers.push(documents);
    const identities = await jsonlWriter(staging, 'auth-users.jsonl'); writers.push(identities);
    const storage = await jsonlWriter(staging, 'storage-objects.jsonl'); writers.push(storage);
    const rootCollections = await db.listCollections();
    const visit = async (collection) => {
      if (EXCLUDED_COLLECTIONS.has(collection.id)) { increment(counts.skippedCollections, collection.id); return; }
      // listDocuments includes missing parent documents with existing children.
      const refs = (await collection.listDocuments()).sort((a, b) => a.path.localeCompare(b.path));
      for (let offset = 0; offset < refs.length; offset += 200) {
        const page = refs.slice(offset, offset + 200);
        const snapshots = await db.getAll(...page);
        for (const snapshot of snapshots) {
          if (snapshot.exists) {
            await documents.append({ path: snapshot.ref.path, id: snapshot.id, collection: collection.path,
              create_time_ms: milliseconds(snapshot.createTime), update_time_ms: milliseconds(snapshot.updateTime),
              data: normalizeFirestoreValue(snapshot.data(), audit) });
            counts.documents += 1; increment(counts.collectionGroups, collection.id);
          } else counts.missingParentDocuments += 1;
          const children = await snapshot.ref.listCollections();
          for (const child of children.sort((a, b) => a.path.localeCompare(b.path))) await visit(child);
        }
      }
    };
    for (const collection of rootCollections.sort((a, b) => a.path.localeCompare(b.path))) await visit(collection);
    let userPage;
    do {
      const result = await auth.listUsers(1000, userPage);
      for (const user of result.users) {
        await identities.append(normalizeFirestoreValue(normalizeAuthUser(user), audit)); counts.authUsers += 1;
      }
      userPage = result.pageToken;
    } while (userPage);
    let objectPage;
    do {
      const [files, nextQuery] = await bucket.getFiles({ autoPaginate: false, maxResults: 200, ...(objectPage ? { pageToken: objectPage } : {}) });
      for (const file of files) {
        const metadata = file.metadata?.generation ? file.metadata : (await file.getMetadata())[0];
        await storage.append({ bucket: bucket.name, name: file.name, generation: metadata.generation || null,
          size: metadata.size || null, contentType: metadata.contentType || null,
          created_ms: milliseconds(metadata.timeCreated), updated_ms: milliseconds(metadata.updated),
          crc32c: metadata.crc32c || null, md5Hash: metadata.md5Hash || null,
          cacheControl: metadata.cacheControl || null, storageClass: metadata.storageClass || null,
          metadata: normalizeFirestoreValue(metadata.metadata || {}, audit),
          reference: `gs://${bucket.name}/${file.name}` });
        counts.storageObjects += 1;
      }
      objectPage = nextQuery?.pageToken;
    } while (objectPage);
    for (const writer of writers) await writer.close();
    const manifest = {
      format_version: EXPORT_VERSION, project_id: projectId, started_at: startedAt, finished_at: now().toISOString(),
      completed: true, consistency: 'multiple-read-times-requires-write-freeze-or-change-reconciliation',
      timestamps: 'epoch-milliseconds-sub-millisecond-precision-discarded',
      password_credentials_exported: false, secret_fields_redacted: audit,
      excluded_collection_names: [...EXCLUDED_COLLECTIONS].sort(), counts,
      storage_bytes_downloaded: 0, files: writers.map((writer) => writer.summary()),
    };
    const handle = await open(path.join(staging, 'manifest.json'), 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(staging, destination);
    return { directory: destination, manifest };
  } finally {
    // Failed exports retain ignored .partial data for an operator to handle; no recursive deletion.
    await Promise.all(writers.map((writer) => writer.close().catch(() => {})));
  }
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--confirm-production-export') { options.confirm = true; continue; }
    if (!['--project', '--run', '--storage-bucket'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw Object.assign(new Error('Invalid arguments'), { code: 'INVALID_ARGUMENTS' });
    }
    if (options[key]) throw Object.assign(new Error('Duplicate argument'), { code: 'INVALID_ARGUMENTS' });
    options[key] = args[++index];
  }
  if (options['--project'] !== PROJECT_ID) throw Object.assign(new Error('Explicit source project required'), { code: 'WRONG_PROJECT' });
  if (!options.confirm) throw Object.assign(new Error('Production export confirmation required'), { code: 'CONFIRMATION_REQUIRED' });
  const storageBucket = options['--storage-bucket'] || `${PROJECT_ID}.firebasestorage.app`;
  if (![`${PROJECT_ID}.firebasestorage.app`, `${PROJECT_ID}.appspot.com`].includes(storageBucket)) {
    throw Object.assign(new Error('Unexpected storage bucket'), { code: 'WRONG_BUCKET' });
  }
  return { projectId: PROJECT_ID, runName: options['--run'] || `snapshot-${new Date().toISOString().replace(/[^0-9]/g, '')}`, storageBucket };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw Object.assign(new Error('Emulator settings detected'), { code: 'EMULATOR_ENVIRONMENT' });
  }
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const require = createRequire(path.join(repoRoot, 'functions', 'package.json'));
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId, storageBucket: options.storageBucket }, `migration-export-${randomUUID()}`);
  try {
    const { manifest } = await exportSnapshot({ ...options, repoRoot, db: getFirestore(app), auth: getAuth(app), bucket: getStorage(app).bucket() });
    // Counts only: never print account records, emails, document paths or credentials.
    console.log(`Private export completed: ${manifest.counts.documents} documents, ${manifest.counts.authUsers} identities, ${manifest.counts.storageObjects} object references.`);
    console.log(`Run: ${options.runName}. Review the private manifest before import; no production data was changed.`);
  } finally { await deleteApp(app); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Admin SDK error messages may include private paths or account identifiers.
    const knownCodes = new Set(['INVALID_TIMESTAMP', 'UNSUPPORTED_VALUE', 'INVALID_IDENTITY', 'UNSAFE_OUTPUT',
      'INVALID_RUN_NAME', 'OUTPUT_EXISTS', 'WRONG_PROJECT', 'INVALID_ARGUMENTS', 'CONFIRMATION_REQUIRED',
      'WRONG_BUCKET', 'EMULATOR_ENVIRONMENT']);
    const code = knownCodes.has(error?.code) ? error.code : 'EXPORT_FAILED';
    console.error(`Export stopped (${code}). No source data was changed. A private .partial directory may remain.`);
    process.exitCode = 1;
  });
}
