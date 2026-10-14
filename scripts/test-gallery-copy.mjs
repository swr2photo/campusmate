#!/usr/bin/env node
// Synthetic local snapshots and injected cloud adapters only; no credentials/media.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { copyGalleryObjects, createFirebaseSource, createR2Destination, crc32cBase64, parseArguments, readGallerySnapshot } from './copy-gallery-to-r2.mjs';
import { PROJECT_ID } from './export-native-backend.mjs';

const bytes = Buffer.from('synthetic gallery fixture');
const digest = (algorithm, value, encoding) => createHash(algorithm).update(value).digest(encoding);
const object = {
  bucket: `${PROJECT_ID}.firebasestorage.app`, name: 'profile_gallery/fixture/a.jpg',
  generation: '12345678901234567890', size: bytes.length, contentType: 'image/jpeg',
  md5Hash: digest('md5', bytes, 'base64'), crc32c: crc32cBase64(bytes),
};
const metadata = (value = object) => ({ ...value, size: String(value.size) });
const head = (value = object) => ({ ContentLength: value.size, ContentType: value.contentType, ETag: '"fixture-etag"' });
const statusError = (status) => Object.assign(new Error('private provider error'), { $metadata: { httpStatusCode: status } });

async function fixture(context, rows = [metadata()]) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'campusmate-gallery-'));
  context.after(async () => {
    const resolved = await realpath(repoRoot);
    assert.equal(path.dirname(resolved), await realpath(os.tmpdir()));
    assert.match(path.basename(resolved), /^campusmate-gallery-[A-Za-z0-9_-]+$/);
    await rm(resolved, { recursive: true, force: true });
  });
  const directory = path.join(repoRoot, 'artifacts', 'rust-migration', 'fixture');
  await mkdir(directory, { recursive: true });
  const contents = { 'auth-users.jsonl': '', 'firestore.jsonl': '',
    'storage-objects.jsonl': rows.map((row) => `${JSON.stringify(row)}\n`).join('') };
  const manifest = { format_version: 1, project_id: PROJECT_ID, completed: true, password_credentials_exported: false,
    files: Object.entries(contents).map(([name, text]) => ({ name, rows: name === 'storage-objects.jsonl' ? rows.length : 0,
      bytes: Buffer.byteLength(text), sha256: digest('sha256', text, 'hex') })) };
  for (const [name, text] of Object.entries(contents)) await writeFile(path.join(directory, name), text);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return { repoRoot, runName: 'fixture', directory, manifest };
}

function adapters({ existing = null, sourceBytes = bytes, sourceMetadata = metadata(), targetBytes = bytes } = {}) {
  const calls = [], writes = [];
  let stored = existing;
  return { calls, writes,
    source: { async download(value) { calls.push(['source', value]); return { metadata: sourceMetadata, bytes: sourceBytes }; } },
    destination: {
      async head(key) { calls.push(['head', key]); if (!stored) throw statusError(404); return stored; },
      async get(key, etag, size) { calls.push(['get', key, etag, size]); return targetBytes; },
      async put(value, body) { writes.push({ value, body }); stored = head(value); },
    },
  };
}

test('requires explicit run, rejects traversal/duplicates/unknown arguments, defaults to dry run', () => {
  assert.deepEqual(parseArguments(['--run', 'good-run_1']), { runName: 'good-run_1', apply: false });
  assert.deepEqual(parseArguments(['--apply', '--run', 'good']), { runName: 'good', apply: true });
  for (const args of [[], ['--run', '..'], ['--run', '.'], ['--run', '../escape'], ['--run', 'a/b'],
    ['--run', 'a', '--run', 'b'], ['--run', 'a', '--apply', '--apply'], ['--run', 'a', '--other']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('reads exporter metadata verbatim and validates manifest SHA-256/bytes/rows locally', async (context) => {
  const f = await fixture(context, [metadata(), { bucket: object.bucket, name: 'chat_media/ignored.enc' }]);
  assert.deepEqual(await readGallerySnapshot(f), [object]);
  const file = path.join(f.directory, 'storage-objects.jsonl');
  await writeFile(file, (await readFile(file, 'utf8')).replace('12345678901234567890', '12345678901234567891'));
  await assert.rejects(readGallerySnapshot(f), { code: 'SOURCE_INTEGRITY_FAILED' });
});

test('refuses foreign/incomplete/malformed manifests and storage row/count tampering', async (context) => {
  for (const mutation of [
    (m) => { m.project_id = 'foreign'; }, (m) => { m.completed = false; },
    (m) => { m.password_credentials_exported = true; }, (m) => { m.files[0].name = '../escape'; },
    (m) => { m.files[2].rows += 1; }, (m) => { m.files[2].bytes += 1; },
  ]) {
    const f = await fixture(context); mutation(f.manifest);
    await writeFile(path.join(f.directory, 'manifest.json'), JSON.stringify(f.manifest));
    await assert.rejects(readGallerySnapshot(f));
  }
});

test('rejects foreign buckets, encoded/unsafe names, duplicates and unpinned gallery metadata', async (context) => {
  for (const changed of [
    { bucket: 'foreign' }, { name: 'profile_gallery/fixture/../x.jpg' }, { name: 'profile_gallery/fixture/..' },
    { name: 'profile_gallery/fixture/a%2Fb.jpg' }, { generation: null }, { size: '5242881' },
    { contentType: 'text/html' }, { md5Hash: null, crc32c: null }, { crc32c: 'not-base64' },
  ]) {
    const f = await fixture(context, [{ ...metadata(), ...changed }]);
    await assert.rejects(readGallerySnapshot(f));
  }
  const f = await fixture(context, [metadata(), metadata()]);
  await assert.rejects(readGallerySnapshot(f), { code: 'DUPLICATE_GALLERY_OBJECT' });
});

test('rejects redirected export directories', async (context) => {
  const f = await fixture(context);
  const alias = path.join(f.repoRoot, 'artifacts', 'rust-migration', 'alias');
  try { await symlink(f.directory, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { context.skip('host cannot create test junction'); return; } throw error; }
  await assert.rejects(readGallerySnapshot({ ...f, runName: 'alias' }), { code: 'UNSAFE_SOURCE' });
});

test('CRC32C matches the independent standard check vector', () => {
  assert.equal(crc32cBase64(Buffer.from('123456789')), '4waSgw==');
});

test('copies pinned bytes and verifies the destination before reporting success', async () => {
  const f = adapters();
  const result = await copyGalleryObjects({ objects: [object], ...f });
  assert.deepEqual(result, { galleryObjects: 1, copied: 1, verifiedExisting: 0 });
  assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].body, bytes);
  assert.equal(f.calls.filter(([kind]) => kind === 'get').length, 1);
});

test('HTTP 403/500/network HEAD failures stop without source reads or writes', async () => {
  for (const error of [statusError(403), statusError(500), new Error('network failure')]) {
    const f = adapters(); f.destination.head = async () => { throw error; };
    await assert.rejects(copyGalleryObjects({ objects: [object], ...f }));
    assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
  }
});

test('verifies existing destination bytes and MIME instead of trusting key existence', async () => {
  const f = adapters({ existing: head() });
  assert.deepEqual(await copyGalleryObjects({ objects: [object], ...f }), { galleryObjects: 1, copied: 0, verifiedExisting: 1 });
  assert.equal(f.writes.length, 0); assert.equal(f.calls.some(([kind]) => kind === 'source'), false);
  for (const bad of [adapters({ existing: head(), targetBytes: Buffer.alloc(bytes.length) }),
    adapters({ existing: { ...head(), ContentType: 'image/png' } })]) {
    await assert.rejects(copyGalleryObjects({ objects: [object], ...bad })); assert.equal(bad.writes.length, 0);
  }
});

test('source generation/metadata/checksum drift stops before PUT', async () => {
  for (const f of [adapters({ sourceMetadata: { ...metadata(), generation: '2' } }),
    adapters({ sourceMetadata: { ...metadata(), contentType: 'image/png' } }),
    adapters({ sourceBytes: Buffer.alloc(bytes.length) })]) {
    await assert.rejects(copyGalleryObjects({ objects: [object], ...f })); assert.equal(f.writes.length, 0);
  }
});

test('a concurrent conditional-create conflict is accepted only after verifying identical bytes', async () => {
  for (const valid of [true, false]) {
    const f = adapters({ targetBytes: valid ? bytes : Buffer.alloc(bytes.length) });
    let count = 0;
    f.destination.head = async () => { if (++count === 1) throw statusError(404); return head(); };
    f.destination.put = async () => { throw statusError(412); };
    const operation = copyGalleryObjects({ objects: [object], ...f });
    if (valid) assert.equal((await operation).verifiedExisting, 1);
    else await assert.rejects(operation);
  }
});

test('corruption after PUT fails verification and cannot report copy success', async () => {
  const f = adapters({ targetBytes: Buffer.alloc(bytes.length) });
  await assert.rejects(copyGalleryObjects({ objects: [object], ...f }), { code: 'OBJECT_CHECKSUM_MISMATCH' });
  assert.equal(f.writes.length, 1);
});

test('Firebase adapter pins the string generation, validates before download and disables decompression', async () => {
  const calls = [];
  const storage = { bucket(bucket) { calls.push(['bucket', bucket]); return { file(name, options) {
    calls.push(['file', name, options]);
    return { getMetadata: async () => [metadata()], async download(options) { calls.push(['download', options]); return [bytes]; } };
  } }; } };
  const source = createFirebaseSource(storage);
  assert.deepEqual(await source.download(object), { metadata: metadata(), bytes });
  assert.deepEqual(calls[1], ['file', object.name, { generation: object.generation }]);
  assert.deepEqual(calls[2], ['download', { validation: 'crc32c', decompress: false }]);
  calls.length = 0;
  await assert.rejects(source.download({ ...object, generation: '1' }), { code: 'SOURCE_GENERATION_MISMATCH' });
  assert.equal(calls.some(([kind]) => kind === 'download'), false);
});

test('R2 adapter preserves MIME, creates conditionally, pins GET ETag and closes oversized streams', async () => {
  class Command { constructor(input) { this.input = input; } }
  const commands = []; let body;
  const destination = createR2Destination({ bucket: 'fixture-target',
    HeadObjectCommand: Command, GetObjectCommand: Command, PutObjectCommand: Command,
    client: { async send(command) { commands.push(command.input); return { Body: body }; } },
  });
  await destination.put({ ...object, contentType: 'image/png' }, bytes);
  assert.equal(commands[0].IfNoneMatch, '*'); assert.equal(commands[0].ContentType, 'image/png');
  assert.equal(commands[0].ContentMD5, object.md5Hash);
  body = Readable.from([bytes]); assert.deepEqual(await destination.get(object.name, '"known"', bytes.length), bytes);
  assert.equal(commands[1].IfMatch, '"known"'); assert.equal(body.destroyed, true);
  body = Readable.from([Buffer.alloc(bytes.length + 1)]);
  await assert.rejects(destination.get(object.name, '"known"', bytes.length), { code: 'DESTINATION_MISMATCH' });
  assert.equal(body.destroyed, true);
});
