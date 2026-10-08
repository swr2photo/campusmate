import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const imagePolicySource = readFileSync(new URL('../src/utils/imagePolicy.js', import.meta.url), 'utf8');
const { getMediaCacheKey } = await import(`data:text/javascript;base64,${Buffer.from(imagePolicySource).toString('base64')}`);

// Run the real client upload function with its native and Firebase boundaries mocked.
const source = readFileSync(new URL('../src/services/chatMediaService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace(/^export \{[^}]+\};?\r?\n/gm, '')
  .replace(/^export /gm, '');

function makeClient(options = {}) {
  const calls = { puts: [], uploadBytes: 0, uploadString: 0, downloadUrl: 0, readBase64: 0, deleted: [], logs: [] };
  const putResults = [...(options.putResults || [200])];
  const signedUrl = 'https://signed.example.test/secret-object?signature=private-token';
  const downloadUrl = 'https://download.example.test/object.enc';
  const fileSystem = {
    cacheDirectory: 'file:///cache/',
    EncodingType: { Base64: 'base64' },
    FileSystemUploadType: { BINARY_CONTENT: 'binary' },
    uploadAsync: async (url, uri, settings) => {
      calls.puts.push({ url, uri, settings });
      const result = putResults.shift();
      if (result instanceof Error) throw result;
      return { status: result ?? 200 };
    },
    getInfoAsync: async () => ({ exists: true, size: options.fileSize || 1024 }),
    readAsStringAsync: async () => {
      calls.readBase64 += 1;
      return 'AA==';
    },
    writeAsStringAsync: async () => {},
    deleteAsync: async (uri) => { calls.deleted.push(uri); },
  };
  const context = vm.createContext({
    console: {
      info: (...args) => calls.logs.push(args),
      warn: (...args) => calls.logs.push(args),
    },
    Uint8Array,
    getMediaCacheKey,
    setTimeout: (callback) => { callback(); },
    FileSystem: fileSystem,
    Platform: { OS: 'android' },
    ImagePicker: {},
    ImageManipulator: {},
    validateChatVideo: () => {},
    requireFirebase: () => ({ app: {} }),
    verifyImageSafety: options.verifyImageSafety || (async () => true),
    getFunctions: () => ({}),
    httpsCallable: () => async () => {
      if (options.signerError) throw options.signerError;
      return { data: options.signerData || { success: true, uploadUrl: signedUrl, downloadUrl } };
    },
    getStorage: () => ({}),
    ref: () => ({}),
    uploadBytes: async () => {
      calls.uploadBytes += 1;
      if (options.uploadBytesError) throw options.uploadBytesError;
    },
    uploadString: async () => { calls.uploadString += 1; },
    getDownloadURL: async () => {
      calls.downloadUrl += 1;
      if (options.downloadUrlError) throw options.downloadUrlError;
      return 'https://firebase.example.test/object';
    },
    fetch: async () => ({
      blob: async () => {
        if (options.blobError) throw options.blobError;
        return { bytes: true };
      },
    }),
    base64ToBytes: () => new Uint8Array([1]),
    encryptMediaBytes: () => {
      if (options.encryptionError) throw options.encryptionError;
      return new Uint8Array([2]);
    },
    bytesToBase64: () => 'Ag==',
  });
  vm.runInContext(source, context);
  return { upload: context.uploadChatMedia, calls, signedUrl, downloadUrl };
}

const uploadOptions = { conversationId: 'conversation', mediaType: 'audio', extension: 'm4a', conversationKey: new Uint8Array(32) };

test('R2 success avoids the Firebase fallback and logs no signed URL', async () => {
  const { upload, calls, signedUrl, downloadUrl } = makeClient();
  assert.equal(await upload('file:///audio.m4a', uploadOptions), downloadUrl);
  assert.equal(calls.puts.length, 1);
  assert.equal(calls.uploadBytes, 0);
  assert.equal(calls.uploadString, 0);
  const logs = JSON.stringify(calls.logs);
  assert.equal(logs.includes(signedUrl), false);
  assert.match(logs, /"stage":"signer"/);
  assert.match(logs, /"stage":"r2_put"/);
  assert.match(logs, /"durationMs":\d+/);
});

test('Worker upload forwards the complete signed Authorization and cache header set', async () => {
  const uploadHeaders = { Authorization: 'Bearer test-capability', 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' };
  const { upload, calls } = makeClient({ signerData: { success: true, provider: 'r2', uploadUrl: 'https://media.example.test/upload/chat_media/room/test.enc', downloadUrl: 'https://media.example.test/chat_media/room/test.enc', uploadHeaders } });
  await upload('file:///audio.m4a', uploadOptions);
  assert.deepEqual(calls.puts[0].settings.headers, uploadHeaders);
  assert.equal(JSON.stringify(calls.logs).includes('test-capability'), false);
});

test('R2 retries one transient 503 response using the same signed URL', async () => {
  const { upload, calls, signedUrl, downloadUrl } = makeClient({ putResults: [503, 200] });
  assert.equal(await upload('file:///audio.m4a', uploadOptions), downloadUrl);
  assert.equal(calls.puts.length, 2);
  assert.ok(calls.puts.every(({ url }) => url === signedUrl));
  assert.equal(calls.uploadBytes, 0);
});

test('R2 retries one network error, then succeeds', async () => {
  const { upload, calls, downloadUrl } = makeClient({ putResults: [new TypeError('Network request failed'), 200] });
  assert.equal(await upload('file:///audio.m4a', uploadOptions), downloadUrl);
  assert.equal(calls.puts.length, 2);
  assert.equal(calls.uploadBytes, 0);
});

test('R2 stops after three transient attempts, then uploads once to Firebase', async () => {
  const { upload, calls } = makeClient({ putResults: [429, 503, 502] });
  assert.equal(await upload('file:///audio.m4a', uploadOptions), 'https://firebase.example.test/object');
  assert.equal(calls.puts.length, 3);
  assert.equal(calls.uploadBytes, 1);
  assert.equal(calls.uploadString, 0);
});

test('R2 refreshes the signed URL after a 403, then succeeds without Firebase', async () => {
  const { upload, calls, downloadUrl } = makeClient({ putResults: [403, 200] });
  assert.equal(await upload('file:///audio.m4a', uploadOptions), downloadUrl);
  assert.equal(calls.puts.length, 2);
  assert.equal(calls.uploadBytes, 0);
});

test('R2 does not keep retrying forever after repeated 403 responses', async () => {
  const { upload, calls } = makeClient({ putResults: [403, 403, 403] });
  assert.equal(await upload('file:///audio.m4a', uploadOptions), 'https://firebase.example.test/object');
  assert.equal(calls.puts.length, 3);
  assert.equal(calls.uploadBytes, 1);
});

test('Firebase uploadBytes failure does not cause a duplicate base64 upload', async () => {
  const error = new Error('Firebase upload failed');
  const { upload, calls } = makeClient({ putResults: [403, 403, 403], uploadBytesError: error });
  await assert.rejects(upload('file:///audio.m4a', uploadOptions), (caught) => caught === error);
  assert.equal(calls.uploadBytes, 1);
  assert.equal(calls.uploadString, 0);
});

test('Firebase download URL failure does not upload the file again', async () => {
  const error = new Error('Firebase URL failed');
  const { upload, calls } = makeClient({ putResults: [403, 403, 403], downloadUrlError: error });
  await assert.rejects(upload('file:///audio.m4a', uploadOptions), (caught) => caught === error);
  assert.equal(calls.uploadBytes, 1);
  assert.equal(calls.uploadString, 0);
  assert.equal(calls.downloadUrl, 1);
});

test('Firebase uses base64 only when reading the local blob fails', async () => {
  const { upload, calls } = makeClient({ putResults: [403, 403, 403], blobError: new Error('Blob read failed') });
  assert.equal(await upload('file:///audio.m4a', uploadOptions), 'https://firebase.example.test/object');
  assert.equal(calls.uploadBytes, 0);
  assert.equal(calls.uploadString, 1);
  assert.equal(calls.readBase64, 2); // encryption read, then Firebase base64 fallback
});

test('video uploads never fall back to Firebase after R2 failure', async () => {
  const { upload, calls } = makeClient({ putResults: [403, 403, 403] });
  await assert.rejects(
    upload('file:///clip.mp4', { conversationId: 'conversation', mediaType: 'video', extension: 'mp4', conversationKey: new Uint8Array(32) }),
    /อัปโหลดวิดีโอ/,
  );
  assert.equal(calls.uploadBytes, 0);
  assert.equal(calls.uploadString, 0);
});

test('image moderation fails before encryption and before any upload', async () => {
  const violation = new Error('Blocked image');
  const { upload, calls } = makeClient({ verifyImageSafety: async () => { throw violation; } });
  await assert.rejects(upload('file:///image.jpg', {
    conversationId: 'conversation', mediaType: 'image', conversationKey: new Uint8Array(32),
  }), (caught) => caught === violation);
  assert.equal(calls.puts.length, 0);
  assert.equal(calls.uploadBytes, 0);
  assert.equal(calls.readBase64, 0);
  assert.equal(calls.deleted.length, 0);
});

test('missing keys and encryption errors never upload plaintext through either provider', async () => {
  for (const options of [{ missingKey: true }, { encryptionError: new Error('Encryption failed') }]) {
    const { upload, calls } = makeClient(options);
    await assert.rejects(upload('file:///image.jpg', { ...uploadOptions, mediaType: 'image', conversationKey: options.missingKey ? undefined : uploadOptions.conversationKey }));
    assert.equal(calls.puts.length, 0);
    assert.equal(calls.uploadBytes, 0);
    assert.equal(calls.uploadString, 0);
  }
});
