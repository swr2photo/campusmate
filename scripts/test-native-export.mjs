#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exportSnapshot, normalizeAuthUser, normalizeFirestoreValue, parseArguments, prepareOutput, PROJECT_ID } from './export-native-backend.mjs';

class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
}
class GeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
class DocumentReference { constructor(value) { this.path = value; } }

function fakeFirestore(records) {
  const collections = new Map();
  const add = (collectionPath, docPath) => {
    if (!collections.has(collectionPath)) collections.set(collectionPath, new Set());
    collections.get(collectionPath).add(docPath);
  };
  for (const docPath of Object.keys(records)) {
    const segments = docPath.split('/');
    for (let end = 2; end <= segments.length; end += 2) add(segments.slice(0, end - 1).join('/'), segments.slice(0, end).join('/'));
  }
  const collection = (collectionPath) => ({
    id: collectionPath.split('/').at(-1), path: collectionPath,
    listDocuments: async () => [...collections.get(collectionPath)].map(reference),
  });
  const reference = (docPath) => ({
    id: docPath.split('/').at(-1), path: docPath,
    listCollections: async () => [...collections.keys()].filter((value) => value.startsWith(`${docPath}/`) && value.split('/').length === docPath.split('/').length + 1).map(collection),
  });
  return {
    listCollections: async () => [...collections.keys()].filter((value) => !value.includes('/')).map(collection),
    getAll: async (...refs) => refs.map((ref) => ({
      ref, id: ref.id, exists: Object.hasOwn(records, ref.path),
      data: () => records[ref.path], createTime: new Timestamp(1), updateTime: new Timestamp(2),
    })),
  };
}
const decodeJsonl = (text) => text.trim() ? text.trim().split('\n').map((line) => JSON.parse(line)) : [];
async function removeFixture(directory) {
  // Only remove the exact test-owned mkdtemp directory under the host temp root.
  const resolved = await realpath(directory);
  const tempRoot = await realpath(os.tmpdir());
  assert.equal(path.dirname(resolved), tempRoot);
  assert.match(path.basename(resolved), /^campusmate-export-[A-Za-z0-9_-]+$/);
  await rm(resolved, { recursive: true, force: true });
}

test('normalizes typed values, redacts nested credentials, preserves ciphertext and public keys', () => {
  const audit = { fields: {}, urlParameters: 0 };
  const normalized = normalizeFirestoreValue({
    date: new Timestamp(123, 500000), location: new GeoPoint(7, 100), reference: new DocumentReference('users/a'),
    bytes: Buffer.from([1, 2]), special: Number.NaN, large: 9007199254740993n,
    nested: [{ accessToken: 'secret-a', ciphertext: 'wrapped-key', nonce: 'public-nonce', publicKey: 'public-key' }],
    refresh_token: 'secret-b', spotifyClientSecret: 'secret-client', url: 'https://media.example/image?alt=media&token=secret-c',
    signed: 'https://media.example/image?X-Amz-Signature=secret-d&X-Amz-Credential=secret-e',
  }, audit);
  assert.equal(normalized.date, 123000);
  assert.deepEqual(normalized.location, { $type: 'geopoint', latitude: 7, longitude: 100 });
  assert.deepEqual(normalized.reference, { $type: 'reference', path: 'users/a' });
  assert.equal(normalized.bytes.base64, 'AQI=');
  assert.equal(normalized.large.value, '9007199254740993');
  assert.equal(normalized.nested[0].ciphertext, 'wrapped-key');
  assert.equal(normalized.nested[0].publicKey, 'public-key');
  assert.equal(normalized.url, 'https://media.example/image?alt=media');
  assert.equal(normalized.signed, 'https://media.example/image');
  assert.doesNotMatch(JSON.stringify(normalized), /secret-[a-e]/);
  assert.equal(audit.fields.accessToken, 1);
  assert.equal(audit.fields.refresh_token, 1);
  assert.equal(audit.fields.spotifyClientSecret, 1);
  assert.equal(audit.urlParameters, 3);
});

test('auth export keeps original identity and flags reset without exporting password material or claims', () => {
  const result = normalizeAuthUser({
    uid: 'original-firebase-uid', email: 'fixture@psu.ac.th', emailVerified: true, disabled: true,
    passwordHash: 'secret-hash', passwordSalt: 'secret-salt', customClaims: { admin: true, token: 'secret-claim' },
    providerData: [{ providerId: 'password', uid: 'fixture@psu.ac.th', refreshToken: 'secret-provider-token' }],
    metadata: { creationTime: '2026-01-01T00:00:00Z' },
  });
  assert.equal(result.uid, 'original-firebase-uid');
  assert.equal(result.disabled, true);
  assert.equal(result.password_reset_required, true);
  assert.equal(result.metadata.creationTime, Date.parse('2026-01-01T00:00:00Z'));
  assert.doesNotMatch(JSON.stringify(result), /secret-|passwordHash|passwordSalt|customClaims/);
  assert.equal(normalizeAuthUser({ uid: 'oauth', providerData: [{ providerId: 'google.com', uid: 'provider-uid' }] }).credential_migration, 'provider-relink-required');
});

test('requires the exact project, explicit production confirmation, and known storage bucket', () => {
  assert.throws(() => parseArguments([]), { code: 'WRONG_PROJECT' });
  assert.throws(() => parseArguments(['--project', PROJECT_ID]), { code: 'CONFIRMATION_REQUIRED' });
  assert.throws(() => parseArguments(['--project', 'another-project', '--confirm-production-export']), { code: 'WRONG_PROJECT' });
  assert.throws(() => parseArguments(['--project', PROJECT_ID, '--confirm-production-export', '--storage-bucket', 'foreign-bucket']), { code: 'WRONG_BUCKET' });
  assert.throws(() => parseArguments(['--project', PROJECT_ID, '--confirm-production-export', '--output', 'D:/other']), { code: 'INVALID_ARGUMENTS' });
  const options = parseArguments(['--project', PROJECT_ID, '--confirm-production-export', '--run', 'fixture']);
  assert.equal(options.runName, 'fixture');
});

test('exports all nested and orphan collections, paginated auth/storage, checksums, no media bytes or secrets', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'campusmate-export-fixture-'));
  try {
    const db = fakeFirestore({
      'users/original-uid': { id: 'original-uid', email: 'fixture@psu.ac.th', accessToken: 'must-not-export', createdAt: new Timestamp(10) },
      'users/original-uid/blockedUsers/blocked-uid': { createdAt: new Timestamp(12) },
      'conversations/room/messages/msg': { encrypted: true, ciphertext: 'cipher-keep', nonce: 'nonce-keep' },
      'groupChats/group/epochs/0': { keyEnvelopes: { 'original-uid': { device: { publicKey: 'pub-keep', ciphertext: 'wrapped-keep' } } } },
      'pushTokens/token-document': { expoPushToken: 'must-not-export-push' },
      'accountDeletionOtps/original-uid': { otpHash: 'must-not-export-otp' },
    });
    const authPages = [];
    const auth = { listUsers: async (size, pageToken) => {
      authPages.push([size, pageToken]);
      return pageToken ? { users: [{ uid: 'oauth-user', providerData: [{ providerId: 'google.com', uid: 'google-id' }] }] }
        : { users: [{ uid: 'original-uid', email: 'fixture@psu.ac.th', providerData: [{ providerId: 'password', uid: 'fixture@psu.ac.th' }], passwordHash: 'must-not-export-hash' }], pageToken: 'auth-next' };
    } };
    const storagePages = [];
    const bucket = { name: `${PROJECT_ID}.firebasestorage.app`, getFiles: async (query) => {
      storagePages.push(query);
      if (query.pageToken) return [[{ name: 'legacy/b.enc', metadata: { generation: '2', size: '5', contentType: 'application/octet-stream' } }], null];
      return [[{ name: 'legacy/a.jpg', metadata: { generation: '1', size: '4', contentType: 'image/jpeg', metadata: { firebaseStorageDownloadTokens: 'must-not-export-download', ownerId: 'original-uid' } } }], { pageToken: 'storage-next' }];
    } };
    const { directory, manifest } = await exportSnapshot({ db, auth, bucket, repoRoot, runName: 'synthetic-test', now: () => new Date('2026-01-01T00:00:00Z') });
    assert.equal(manifest.completed, true);
    assert.equal(manifest.counts.documents, 4);
    assert.equal(manifest.counts.missingParentDocuments, 2);
    assert.equal(manifest.counts.authUsers, 2);
    assert.equal(manifest.counts.storageObjects, 2);
    assert.equal(manifest.counts.skippedCollections.pushTokens, 1);
    assert.equal(manifest.storage_bytes_downloaded, 0);
    assert.equal(authPages[1][1], 'auth-next');
    assert.equal(storagePages[1].pageToken, 'storage-next');
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(directory, file.name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      assert.equal(bytes.length, file.bytes);
      assert.equal(decodeJsonl(bytes.toString()).length, file.rows);
      assert.doesNotMatch(bytes.toString(), /must-not-export/);
      if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, file.name))).mode & 0o777, 0o600);
    }
    const rows = decodeJsonl(await readFile(path.join(directory, 'firestore.jsonl'), 'utf8'));
    assert(rows.some((row) => row.path === 'conversations/room/messages/msg' && row.data.ciphertext === 'cipher-keep'));
    assert(rows.some((row) => row.path === 'groupChats/group/epochs/0' && row.data.keyEnvelopes['original-uid'].device.ciphertext === 'wrapped-keep'));
    assert.equal((await readdir(path.join(repoRoot, 'artifacts', 'rust-migration'))).some((name) => name.endsWith('.partial')), false);
    await assert.rejects(prepareOutput(repoRoot, 'synthetic-test'), { code: 'OUTPUT_EXISTS' });
  } finally { await removeFixture(repoRoot); }
});

test('rejects output traversal and never marks a failed read as a completed export', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'campusmate-export-failure-'));
  try {
    await assert.rejects(prepareOutput(repoRoot, '../../escape'), { code: 'INVALID_RUN_NAME' });
    await assert.rejects(exportSnapshot({ repoRoot, runName: 'failed', db: { listCollections: async () => { throw new Error('synthetic read failure'); } } }), /synthetic read failure/);
    const base = path.join(repoRoot, 'artifacts', 'rust-migration');
    const names = await readdir(base);
    assert.equal(names.length, 1);
    assert(names[0].endsWith('.partial'));
    assert.equal((await readdir(path.join(base, names[0]))).includes('manifest.json'), false);
  } finally { await removeFixture(repoRoot); }
});

test('rejects redirected artifact directory', async (context) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'campusmate-export-symlink-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'campusmate-export-outside-'));
  try {
    try { await symlink(outside, path.join(repoRoot, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { context.skip('Host does not allow creating symbolic links'); return; } throw error; }
    await assert.rejects(prepareOutput(repoRoot, 'unsafe'), { code: 'UNSAFE_OUTPUT' });
    assert.deepEqual(await readdir(outside), []);
  } finally { await removeFixture(repoRoot); await removeFixture(outside); }
});
