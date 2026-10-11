import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const babel = require('@babel/core'), nacl = require('tweetnacl');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
// Exercise the actual private resolver without adding a test export to the app.
const source = readFileSync('src/services/chatEncryptionService.js', 'utf8') + '\nexport { resolveParticipantProfiles };';
const code = babel.transformSync(source, { babelrc: false, configFile: false,
  plugins: [presetRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
const calls = [], module = { exports: {} };
let response, failure;
new Function('require', 'module', 'exports', code)(id => {
  if (id === 'tweetnacl') return nacl;
  if (id.endsWith('secureDiscoveryService')) return { secureDiscoveryConfigured: () => true,
    secureDiscoveryCall: async (name, data) => { calls.push({ name, data }); if (failure) throw failure; return response; } };
  return {};
}, module, module.exports);
const key = byte => Buffer.alloc(32, byte).toString('base64');
const identity = { deviceId: 'thisPhone', publicKey: new Uint8Array(Buffer.alloc(32, 1)) };
const embedded = { alice: { name: 'Room Alice' }, bob: { name: 'Room Bob', avatarUri: 'room-photo',
  encryptionDevices: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`retired${i}`, { publicKey: key(2) }])) } };
response = { profiles: [{ id: 'alice', encryptionDevices: { otherPhone: { publicKey: key(3) } } },
  { id: 'bob', name: 'Not allowed to hydrate', isFaceVerified: true, encryptionDevices: { newPhone: { publicKey: key(4) } } }] };
const resolve = () => module.exports.resolveParticipantProfiles({}, 'old-room', ['alice', 'bob'], embedded, 'alice', identity);
const result = await resolve();
assert.deepEqual(calls, [{ name: 'getConversationEncryptionProfiles', data: { conversationId: 'old-room', userIds: ['alice', 'bob'] } }]);
assert.equal(result.bob.name, 'Room Bob'); assert.equal(result.bob.avatarUri, 'room-photo');
assert.equal(result.bob.isFaceVerified, undefined);
assert.deepEqual(result.bob.encryptionDevices, { newPhone: { publicKey: key(4) } });
assert.deepEqual(result.alice.encryptionDevices, { otherPhone: { publicKey: key(3) }, thisPhone: { publicKey: key(1) } });
assert.equal(Object.keys(embedded.bob.encryptionDevices).length, 5);
response = { profiles: [{ id: 'bob', encryptionDevices: {} }] };
assert.deepEqual((await resolve()).bob.encryptionDevices, {});
failure = Object.assign(new Error('not a room participant'), { code: 'permission-denied' });
await assert.rejects(resolve(), { code: 'permission-denied' });
assert.ok(calls.every(call => call.name === 'getConversationEncryptionProfiles'));
console.log('PASS: existing-room keys use member-only API, refresh retired devices, retain current identity, never hydrate public metadata or fall back after denied access');
