import Text from './AppText';
import React, { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { useMembership } from '../context/MembershipContext';
import { useTheme } from '../theme';
import { mayRequestNativeAd } from '../utils/adPolicy';
import { FEATURE_NO_ADS } from '../data/plans';

export default function NativeAdCard({ style }) {
  const membership = useMembership();
  const extra = Constants.expoConfig?.extra || {};
  const platformConfigured = Platform.OS === 'android' ? extra.androidAdsConfigured : Platform.OS === 'ios' ? extra.iosAdsConfigured : false;
  const adUnitId = Platform.OS === 'android' ? extra.nativeAdAndroidUnitId : extra.nativeAdIosUnitId;
  if (!adUnitId || !mayRequestNativeAd({ enabled: extra.nativeAdsEnabled, platformConfigured,
    membershipReady: membership.ready, serverConfirmed: membership.serverConfirmed, plus: membership.can(FEATURE_NO_ADS) })) return null;
  // Mounting is also the lifetime boundary: becoming Plus destroys any ad.
  return <EligibleAd adUnitId={adUnitId} style={style} />;
}

function EligibleAd({ adUnitId, style }) {
  const { colors } = useTheme();
  const ads = require('react-native-google-mobile-ads');
  const [consentReady, setConsentReady] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const info = await ads.AdsConsent.gatherConsent();
      if (!live || !info.canRequestAds) return;
      await ads.default().initialize();
      if (live) setConsentReady(true);
    })().catch(() => {});
    return () => { live = false; };
  }, []);
  const { nativeAd, status } = ads.useNativeAd({ adUnitId: consentReady ? adUnitId : null, autoLoad: consentReady });
  if (status !== 'loaded' || !nativeAd) return null; // no-fill does not leave a blank card
  const { NativeAdView, NativeMediaView, NativeAsset, NativeAssetType } = ads;
  return <NativeAdView nativeAd={nativeAd} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }, style]}>
    <Text style={[styles.label, { color: colors.inkMuted }]}>โฆษณา</Text>
    <View style={styles.header}>
      {nativeAd.icon?.url ? <NativeAsset assetType={NativeAssetType.ICON}><Image source={{ uri: nativeAd.icon.url }} style={styles.icon} /></NativeAsset> : null}
      <NativeAsset assetType={NativeAssetType.HEADLINE}><Text style={[styles.headline, { color: colors.ink }]}>{nativeAd.headline}</Text></NativeAsset>
    </View>
    <NativeMediaView style={styles.media} />
    <NativeAsset assetType={NativeAssetType.BODY}><Text style={{ color: colors.inkMuted }}>{nativeAd.body}</Text></NativeAsset>
    <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}><Text style={[styles.cta, { color: colors.onPrimary, backgroundColor: colors.primary }]}>{nativeAd.callToAction}</Text></NativeAsset>
  </NativeAdView>;
}
const styles = StyleSheet.create({ card: { borderWidth: 0, borderRadius: 26, borderCurve: 'continuous', padding: 16, gap: 12 }, label: { fontSize: 11, alignSelf: 'flex-start' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 44, height: 44, borderRadius: 10 },
  headline: { flex: 1, fontSize: 17, fontWeight: '700' }, media: { height: 180, width: '100%' }, cta: { padding: 12, textAlign: 'center', borderRadius: 12 } });
