const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
const metroCacheDirectory = path.join(projectRoot, '.metro-cache');
fs.mkdirSync(metroCacheDirectory, { recursive: true });
const excludedDirectories = [
  '__pycache__',
  '.metro-cache',
  'node_modules_router_recovery_20260829',
  'node_modules_router_recovery2_20260829',
  'npm-cache',
  'output',
  'qa_arranged_20260828',
  'qa_final_20260828',
  'qa_textflow_20260828',
  'qa_textflow_20260828_check2',
  'qa_textflow_20260828_current',
  'qa_textflow_20260828_current_150',
  'qa_textflow_20260828_final',
  'qa_textflow_20260828_final_current',
  'qa_textflow_experiments',
].map((directory) => new RegExp(`${escapePath(path.join(projectRoot, directory))}\\\\.*`));

config.resolver.blockList = [...config.resolver.blockList, ...excludedDirectories];
config.fileMapCacheDirectory = metroCacheDirectory;
config.hasteMapCacheDirectory = metroCacheDirectory;

// Expo's default transform cache uses the OS temp directory. Keep both Metro
// caches beside the project so a full system drive cannot break development.
const DefaultFileStore = config.cacheStores?.[0]?.constructor;
if (DefaultFileStore) {
  config.cacheStores = [new DefaultFileStore({ root: metroCacheDirectory })];
}

module.exports = config;

function escapePath(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
