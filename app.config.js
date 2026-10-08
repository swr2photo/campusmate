const { expo } = require('./app.json');

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
