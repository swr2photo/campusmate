const { withAndroidManifest } = require('expo/config-plugins');
module.exports = (config) => withAndroidManifest(config, (result) => {
  // The linked SDK must not auto-initialize without an AdMob account/app ID.
  result.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const application = result.modResults.manifest.application[0];
  application.provider = (application.provider || []).filter((entry) => entry.$['android:name'] !== 'com.google.android.gms.ads.MobileAdsInitProvider');
  application.provider.push({ $: { 'android:name': 'com.google.android.gms.ads.MobileAdsInitProvider',
    'android:authorities': '${applicationId}.mobileadsinitprovider', 'tools:node': 'remove' } });
  return result;
});
