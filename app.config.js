const { expo } = require('./app.json');
const fs = require('fs');
const path = require('path');
const plist = require(require.resolve('@expo/plist', {
  paths: [require.resolve('expo/config-plugins')],
})).default;

// Expo Go uses the JS Firebase SDK, which cannot read the native plist itself.
// Expose only Firebase's public client configuration in the Expo manifest.
const iosServicesPath = path.resolve(__dirname, expo.ios.googleServicesFile);
const iosServices = fs.existsSync(iosServicesPath)
  ? plist.parse(fs.readFileSync(iosServicesPath, 'utf8'))
  : {};
const iosFirebaseConfig = {
  apiKey: iosServices.API_KEY || process.env.EXPO_PUBLIC_FIREBASE_IOS_API_KEY,
  appId: iosServices.GOOGLE_APP_ID || process.env.EXPO_PUBLIC_FIREBASE_IOS_APP_ID,
  projectId: iosServices.PROJECT_ID || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: iosServices.GCM_SENDER_ID || process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};
iosFirebaseConfig.authDomain = iosFirebaseConfig.projectId
  ? `${iosFirebaseConfig.projectId}.firebaseapp.com`
  : process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;

const androidMapsKey = process.env.CAMPUSMATE_ANDROID_MAPS_SDK_KEY;
const iosMapsKey = process.env.CAMPUSMATE_IOS_MAPS_SDK_KEY;
const androidAdsAppId = process.env.CAMPUSMATE_ANDROID_ADMOB_APP_ID;
const iosAdsAppId = process.env.CAMPUSMATE_IOS_ADMOB_APP_ID;

module.exports = {
  ...expo,
  plugins: [
    ...expo.plugins,
    ...(androidMapsKey || iosMapsKey ? [[
      'react-native-maps',
      {
        ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
        ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
      },
    ]] : []),
    ...(androidAdsAppId || iosAdsAppId ? [[
      'react-native-google-mobile-ads', {
        ...(androidAdsAppId ? { androidAppId: androidAdsAppId } : {}),
        ...(iosAdsAppId ? { iosAppId: iosAdsAppId } : {}),
        delayAppMeasurementInit: true,
      },
    ]] : []),
    ...(!androidAdsAppId ? ['./plugins/withDisabledMobileAds'] : []),
  ],
  extra: {
    ...expo.extra,
    iosFirebaseConfig,
    androidMapsConfigured: Boolean(androidMapsKey),
    iosMapsConfigured: Boolean(iosMapsKey),
    imageCacheDiagnostics: process.env.CAMPUSMATE_IMAGE_CACHE_DIAGNOSTICS === 'true',
    plusBackendEnabled: process.env.CAMPUSMATE_PLUS_BACKEND_ENABLED === undefined
      ? expo.extra?.plusBackendEnabled === true : process.env.CAMPUSMATE_PLUS_BACKEND_ENABLED === 'true',
    secureDiscoveryEnabled: process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === undefined
      ? expo.extra?.secureDiscoveryEnabled === true : process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED === 'true',
    revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || expo.extra?.revenueCatAndroidKey || '',
    revenueCatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || '',
    nativeAdsEnabled: process.env.CAMPUSMATE_NATIVE_ADS_ENABLED === 'true',
    androidAdsConfigured: Boolean(androidAdsAppId),
    iosAdsConfigured: Boolean(iosAdsAppId),
    nativeAdAndroidUnitId: process.env.EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_UNIT_ID || '',
    nativeAdIosUnitId: process.env.EXPO_PUBLIC_ADMOB_IOS_NATIVE_UNIT_ID || '',
  },
};
