const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
const metroCacheDirectory = path.join(projectRoot, '.metro-cache');
fs.mkdirSync(metroCacheDirectory, { recursive: true });

const excludedDirectories = [
  '__pycache__',
  '.expo',
  '.metro-cache',
  'android',
  'node_modules.cm-vstore-backup-20260905',
  'node_modules_router_recovery_20260829',
  'node_modules_router_recovery2_20260829',
  'npm-cache',
  'output',
  'tmp',
  'dist',
  'functions',
  'artifacts',
  'rust-backend',
  'matching-service',
  'scratch',
  '.agents',
  '.agent-device',
  '.codex',
  '.git',
  '.idea',
  '.vscode',
  'qa_arranged_20260828',
  'qa_final_20260828',
  'qa_textflow_20260828',
  'qa_textflow_20260828_check2',
  'qa_textflow_20260828_current',
  'qa_textflow_20260828_current_150',
  'qa_textflow_20260828_final',
  'qa_textflow_20260828_final_current',
  'qa_textflow_experiments',
].map((directory) => new RegExp(`${escapePath(path.join(projectRoot, directory))}(?:[\\\\/].*)?$`));

// Previous QA/export runs are kept beside the project for reference, but they
// are not application sources and can add hundreds of megabytes to Metro's
// initial file crawl.
const excludedExpoSnapshots = new RegExp(
  `${escapePath(projectRoot)}[\\\\/]\\.expo-[^\\\\/]+(?:[\\\\/].*)?$`,
);

config.resolver.blockList = [
  ...config.resolver.blockList,
  ...excludedDirectories,
  excludedExpoSnapshots,
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo/src/async-require/hmr.ts' || moduleName === 'expo/src/async-require/hmr') {
    try {
      return {
        type: 'sourceFile',
        filePath: require.resolve('expo/src/async-require/hmr.ts'),
      };
    } catch (_) {}
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Some Windows environments do not have a working Watchman service. Allow
// Expo start/export callers to opt out without changing the production bundle.
config.resolver.useWatchman = process.env.EXPO_USE_WATCHMAN !== '0';
config.fileMapCacheDirectory = metroCacheDirectory;
config.hasteMapCacheDirectory = metroCacheDirectory;

// Expo's default transform cache uses the OS temp directory. Keep both Metro
// caches beside the project so a full system drive cannot break development.
const DefaultFileStore = config.cacheStores?.[0]?.constructor;
if (DefaultFileStore) {
  config.cacheStores = [new DefaultFileStore({ root: metroCacheDirectory })];
}
config.maxWorkers = process.env.METRO_MAX_WORKERS ? parseInt(process.env.METRO_MAX_WORKERS, 10) : 4;

// Worklets must install its runtime globals before Reanimated imports use them.
// Lazy imports avoid the Expo eager-loading initialization cycle (upstream #9445).
const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions?.(...args) || {};
  return {
    ...options,
    transform: { ...options.transform, inlineRequires: true },
  };
};

module.exports = config;

function escapePath(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
