import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Verified against the published archives for the pinned dependency versions.
// Keep this gate when upgrading: verify and update hashes from the new archives.
const versions = { 'react-native-worklets': '0.13.0', 'react-native-reanimated': '4.7.0' };
const hashes = {
  'react-native-worklets/src/memory/shareable.native.ts': '73c5c5c0bc87287b4a1bf45fd2d8c044452f0c253e45090e8b16a9ec11c730ed',
  'react-native-worklets/lib/module/memory/shareable.native.js': '9c33c6a42fb0162dcc375017671ee01419982c24a6cdedb3fea7bcb69a7d45e5',
  'react-native-worklets/src/memory/synchronizable.native.ts': 'e5b072bd938a41e7e840d7da2ef4543513df9e79005dc1c28acb8e592bc4f9a5',
  'react-native-worklets/lib/module/memory/synchronizable.native.js': '35bcbef587905a5c1a833dd9bf6ddac34aca4c4dda365c4879cb77b0fe269e4a',
  'react-native-worklets/src/memory/synchronizableUnpacker.native.ts': 'd3e290ecc504d09d1620f0df2eafa7c6cb680490db737ffe311efccfc38666db',
  'react-native-worklets/lib/module/memory/synchronizableUnpacker.native.js': '7df8a4812b19a0875f2e552c5ac9fcba7089ce338a0eb00bdc978f5338b07f83',
  'react-native-worklets/src/runLoop/uiRuntime/requestAnimationFrame.ts': '49e13cb578698ef14875c629924579c2f5022a702c1cbdbab582e38475fb47ae',
  'react-native-worklets/lib/module/runLoop/uiRuntime/requestAnimationFrame.js': '638b11a21d26f7cfa278d18248fd0e4b448ef194ca24e00a8633fd1b8ab3923d',
  'react-native-reanimated/src/mutables.native.ts': 'c878a84922e8c46b830748e8193dc9bf4878807c1be13e74796e71732207f8d4',
  'react-native-reanimated/lib/module/mutables.native.js': '372c54e550e91bc592ddde22c4229606fe140dc31af34b19df033bff13294731',
  'react-native-reanimated/src/mutablesCommon.ts': '220bc280c49468ffe21bca54d641ef9cc2f7e17782bb0b41781c84d59d1d1167',
  'react-native-reanimated/lib/module/mutablesCommon.js': '32e9e6b61392611703c9307be838898e565d8063ec1231d25310cfa4dd1fe4cf',
  'react-native-reanimated/src/ReanimatedModule/NativeReanimated.ts': 'b214eddae26f925b1c42ad5d1aa9a9a27fa2e42c2b9ca45c2528d39f36c83d09',
  'react-native-reanimated/lib/module/ReanimatedModule/NativeReanimated.js': 'a78169fa77c62d2dc48f36652c2fb5e0b9052890234454f24905b09f63e8bea0',
};

for (const [name, expected] of Object.entries(versions)) {
  const actual = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  if (actual !== expected) throw new Error(`${name}: verify the new version ${actual} and update the runtime integrity gate (expected ${expected}).`);
}
for (const [relative, expected] of Object.entries(hashes)) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(root, 'node_modules', relative))).digest('hex');
  if (actual !== expected) throw new Error(`${relative} differs from the published dependency. Restore the pinned package before building.`);
}
const config = require(path.join(root, 'metro.config.js'));
const options = await config.transformer.getTransformOptions([], { dev: false, platform: 'android' }, async () => []);
if (options.transform?.inlineRequires !== true) throw new Error('Worklets requires inlineRequires to avoid the initialization cycle.');
console.log('Animation runtime verified: 14 published dependency files and Metro initialization order.');
