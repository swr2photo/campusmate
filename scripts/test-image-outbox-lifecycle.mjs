import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const file = 'src/context/ChatImageOutboxContext.js';
const source = readFileSync(file, 'utf8');
const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
let networkEffect;
babel.traverse(ast, {
  CallExpression(path) {
    const node = path.node;
    if (node.callee.name !== 'useEffect') return;
    const dependencies = node.arguments[1];
    if (dependencies?.type === 'ArrayExpression' && dependencies.elements.some(entry => entry?.type === 'MemberExpression'
      && entry.object.name === 'state' && entry.property.name === 'ready')) networkEffect = node.arguments[0];
  },
});
assert.ok(networkEffect, 'test the provider effect that resumes the queue when hydration completes');
const effectCode = `(${source.slice(networkEffect.start, networkEffect.end)})`;
const run = (engineRef, uid, isOnline = true) => vm.runInNewContext(effectCode, { engineRef, uid, isOnline })();

test('signed-out and auth-restoring mounts do not dereference a missing engine', () => {
  for (const uid of [undefined, null, '']) assert.doesNotThrow(() => run({ current: null }, uid));
});

test('signed-in mount waits for engine hydration, then forwards the latest network state', () => {
  const ref = { current: null }, values = [];
  assert.doesNotThrow(() => run(ref, 'owner', false));
  ref.current = { owner: 'owner', engine: { setOnline: value => values.push(value) } };
  run(ref, 'owner', false); run(ref, 'owner', true); run(ref, 'owner', undefined);
  assert.deepEqual(values, [false, true, true]);
});

test('logout and account switches do not resume the old account queue', () => {
  const values = [];
  const ref = { current: { owner: 'old-owner', engine: { setOnline: value => values.push(value) } } };
  run(ref, undefined); run(ref, 'new-owner');
  ref.current = null;
  assert.doesNotThrow(() => run(ref, undefined));
  assert.deepEqual(values, []);
});

test('an unowned queue cannot pass the guard when uid is also undefined', () => {
  let calls = 0;
  run({ current: { owner: undefined, engine: { setOnline: () => calls++ } } }, undefined);
  assert.equal(calls, 0);
});

test('the guard and call use the same ref snapshot', () => {
  let reads = 0; const values = [];
  const queue = { owner: 'owner', engine: { setOnline: value => values.push(value) } };
  run({ get current() { return ++reads === 1 ? queue : null; } }, 'owner');
  assert.equal(reads, 1); assert.deepEqual(values, [true]);
});
