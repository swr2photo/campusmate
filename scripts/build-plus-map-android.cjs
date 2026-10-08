const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const env = { ...process.env, JAVA_TOOL_OPTIONS: '-Duser.language=en -Duser.country=US -Dfile.encoding=UTF-8' };
const args = process.argv.slice(2);
const qa = args.includes('--qa');
if (qa) env.CAMPUSMATE_IMAGE_CACHE_DIAGNOSTICS = 'true';
const architecture = args.filter((arg) => arg !== '--qa');
if (args.filter((arg) => arg === '--qa').length > 1 || (architecture.length && (architecture.length !== 2 || architecture[0] !== '--abi'
  || !['x86', 'x86_64', 'arm64-v8a', 'armeabi-v7a'].includes(architecture[1])))) throw new Error('Expected --abi followed by a supported Android ABI and optional --qa');
for (const key of ['CAMPUSMATE_ANDROID_MAPS_SDK_KEY', 'CAMPUSMATE_IOS_MAPS_SDK_KEY']) {
  const match = fs.readFileSync('.env', 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
  if (key.includes('ANDROID') && !match?.[1].trim()) throw new Error('Configure the restricted Android Maps SDK key');
  if (match) env[key] = match[1].trim();
}
const folder = path.resolve('artifacts/android'); fs.mkdirSync(folder, { recursive: true });
const output = fs.createWriteStream(path.join(folder, qa ? 'plus-map-build-qa.log' : 'plus-map-build.log'));
const command = 'gradlew.bat :app:assembleRelease -Dorg.gradle.jvmargs=-Xmx2048m -PcampusmateNativeCompileJobs=1 -PcampusmatePackagerWorkers=1 --max-workers=1 --console=plain'
  + (architecture.length ? ` -PreactNativeArchitectures=${architecture[1]}` : '')
  + (qa ? ' -Pandroid.enableMinifyInReleaseBuilds=false -Pandroid.enableShrinkResourcesInReleaseBuilds=false' : '');
const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: path.resolve('android'), env });
console.log('Building with one native compile job and 2 GB heap. Launcher PID:', child.pid);
if (qa) console.log('QA only: minification/resource shrinking disabled; this is not a production release artifact.');
for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes) => {
  output.write(bytes);
  const lines = bytes.toString().split(/\r?\n/).filter((line) => /FAILED|BUILD SUCCESSFUL|BUILD FAILED|^> Task :app:|Bundled|error:/.test(line));
  for (const line of lines) console.log(line.slice(0, 400));
});
child.on('error', (error) => { output.end(); console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { output.end(); console.log('Gradle exit:', code); process.exitCode = code === 0 ? 0 : 1; });
