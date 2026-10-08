import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Local, read-only readiness check. Never prints keys, secrets or full environment contents.
const readEnv = (file) => {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
};
const client = { ...readEnv('.env'), ...process.env };
const server = { ...readEnv('functions/.env'), ...readEnv('functions/.env.campusmate-7f1ab') };
const present = (value) => Boolean(value?.trim());
const result = {
  changesMade: false,
  client: {
    androidSdkKeyPresent: present(client.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY),
    iosSdkKeyPresent: present(client.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY),
    backendEnabled: client.CAMPUSMATE_PLUS_BACKEND_ENABLED === 'true',
    secureDiscoveryEnabled: client.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === 'true',
  },
  server: {
    membershipEnabled: server.CAMPUSMATE_PLUS_ENABLED === 'true',
    sandboxEnabled: server.CAMPUSMATE_PLUS_ALLOW_SANDBOX === 'true',
    secretManager: 'Not checked by this local script',
  },
  requiredDashboardConfiguration: {
    packageOrBundleId: 'com.campusmate.app', entitlement: 'campusmate_plus',
    currentOfferingPackages: ['$rc_monthly', '$rc_annual'],
    actualStoreProductsAndPrices: 'Must be verified in store and RevenueCat dashboards',
  },
};
mkdirSync('artifacts/server-staging', { recursive: true });
writeFileSync('artifacts/server-staging/membership-config-readiness.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
