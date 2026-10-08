const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const env = { ...process.env, JAVA_TOOL_OPTIONS: '-Duser.language=en -Duser.country=US -Dfile.encoding=UTF-8 -Xmx512m' };

for (const key of ['CAMPUSMATE_ANDROID_MAPS_SDK_KEY', 'CAMPUSMATE_IOS_MAPS_SDK_KEY']) {
  const match = fs.readFileSync('.env', 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
  if (key.includes('ANDROID') && !match?.[1].trim()) throw new Error('Configure the restricted Android Maps SDK key');
  if (match) env[key] = match[1].trim();
}

const folder = path.resolve('artifacts/android');
fs.mkdirSync(folder, { recursive: true });
const logFile = path.join(folder, 'build-release-aab.log');
const output = fs.createWriteStream(logFile);

const command = 'gradlew.bat :app:bundleRelease --console=plain';

const appConfig = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const currentVersion = appConfig.expo?.version || 'unknown';
const currentCode = appConfig.expo?.android?.versionCode || 'unknown';
console.log(`Starting Release AAB build for versionCode ${currentCode} (v${currentVersion})...`);
console.log('Logging to:', logFile);

const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: path.resolve('android'), env });

child.stdout.on('data', (bytes) => {
  output.write(bytes);
  const text = bytes.toString();
  const matched = text.split(/\r?\n/).filter((l) => /BUILD SUCCESSFUL|BUILD FAILED|^> Task :app:|Bundled|error:/.test(l));
  for (const m of matched) console.log(m.slice(0, 300));
});

child.stderr.on('data', (bytes) => {
  output.write(bytes);
  const text = bytes.toString();
  const matched = text.split(/\r?\n/).filter((l) => /error:|FAILED/.test(l));
  for (const m of matched) console.error(m.slice(0, 300));
});

child.on('close', (code) => {
  output.end();
  console.log(`Gradle finished with exit code: ${code}`);
  if (code === 0) {
    const aabPath = path.resolve('android/app/build/outputs/bundle/release/app-release.aab');
    if (fs.existsSync(aabPath)) {
      const stats = fs.statSync(aabPath);
      console.log(`[SUCCESS] AAB generated successfully: ${aabPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }
  }
  process.exitCode = code;
});
