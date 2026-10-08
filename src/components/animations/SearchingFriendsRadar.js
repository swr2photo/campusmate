import Text from '../AppText';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import LottieViewSafe from './LottieViewSafe';
import { RADAR_SEARCH_LOTTIE } from './lottieData';
import FeatureIcon from '../FeatureIcon';

/**
 * SearchingFriendsRadar
 * Animated radar scanning animation for discovery / loading nearby friends.
 */
export default function SearchingFriendsRadar({
  title = 'กำลังค้นหาเพื่อนรอบตัว...',
  subtitle = 'โปรดรอสักครู่ ระบบกำลังจับคู่ผู้ใช้ในมหาวิทยาลัย',
  lottieSource = RADAR_SEARCH_LOTTIE,
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.radarWrapper}>
        <LottieViewSafe
          source={lottieSource}
          autoPlay
          loop
          style={styles.lottie}
          fallback={
            <View style={styles.fallbackIcon}>
              <FeatureIcon name="magnifyingglass" size={48} color="#3B5AFE" />
            </View>
          }
        />
      </View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    width: '100%',
  },
  radarWrapper: {
    alignItems: 'center',
    height: 180,
    justifyContent: 'center',
    marginBottom: 16,
    width: 180,
  },
  lottie: {
    height: '100%',
    width: '100%',
  },
  fallbackIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(59, 90, 254, 0.1)',
    borderRadius: 50,
    height: 100,
    justifyContent: 'center',
    width: 100,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 14,
    textAlign: 'center',
  },
});
