import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const stage = path.join(root, 'artifacts/face-verification-staging');

if (process.argv.slice(2).some((a) => a !== '--deploy')) {
  throw new Error('Use --deploy or no argument');
}

mkdirSync(stage, { recursive: true });

for (const name of [
  'faceVerificationEntry.js',
  'faceVerificationFunctions.js',
  'faceVerification.js',
  'package-lock.json',
]) {
  cpSync(path.join(root, 'functions', name), path.join(stage, name));
}

// Copy .env if present
if (existsSync(path.join(root, 'functions/.env'))) {
  cpSync(path.join(root, 'functions/.env'), path.join(stage, '.env'));
}

const manifest = JSON.parse(readFileSync(path.join(root, 'functions/package.json'), 'utf8'));
manifest.main = 'faceVerificationEntry.js';
writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));

if (!existsSync(path.join(stage, 'node_modules'))) {
  symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'node_modules'), 'junction');
}

writeFileSync(
  path.join(stage, 'firebase.json'),
  JSON.stringify(
    {
      functions: {
        source: '.',
        codebase: 'default',
        runtime: 'nodejs22',
        ignore: ['node_modules', '.git', 'firebase.json', '*-debug.log'],
      },
    },
    null,
    2
  )
);

console.log('Face verification functions staged successfully.');

if (process.argv.includes('--deploy')) {
  const args = [
    'deploy',
    '--config',
    'artifacts/face-verification-staging/firebase.json',
    '--only',
    'functions:startFaceVerificationSession,functions:completeFaceVerification',
    '--project',
    'campusmate-7f1ab',
    '--non-interactive',
  ];
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `firebase ${args.join(' ')}`], { cwd: root, stdio: 'inherit' })
      : spawnSync('firebase', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status === 0 ? 0 : 1;
}
