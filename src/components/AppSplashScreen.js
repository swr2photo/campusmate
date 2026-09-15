import React from 'react';
import { ActivityIndicator, Image, ImageBackground, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const heroImage = require('../../assets/login-campus-hero.png');
const appIcon = require('../../assets/icon.png');

export default function AppSplashScreen({ message }) {
  return (
    <ImageBackground
      source={heroImage}
      style={styles.container}
      imageStyle={styles.backgroundImage}
    >
      <LinearGradient
        colors={['rgba(11,13,20,0.38)', 'rgba(11,13,20,0.68)', 'rgba(11,13,20,0.92)']}
        locations={[0, 0.45, 0.9]}
        style={styles.gradient}
      >
        <View style={styles.centerContent}>
          <View style={styles.logoBadgeContainer}>
            <Image source={appIcon} style={styles.appLogo} />
          </View>
          <Text style={styles.appName}>CampusMate</Text>
          <Text style={styles.appTagline}>พื้นที่เพื่อนใหม่ในรั้วมหาวิทยาลัย</Text>

          {message ? (
            <View style={styles.loadingCapsule}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.loadingText}>{message}</Text>
            </View>
          ) : (
            <View style={styles.loadingIndicatorOnly}>
              <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.7)" />
            </View>
          )}
        </View>
      </LinearGradient>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0B0D14',
    flex: 1,
  },
  backgroundImage: {
    resizeMode: 'cover',
  },
  gradient: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  logoBadgeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#5B5CE2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 8,
  },
  appLogo: {
    borderRadius: 22,
    height: 84,
    width: 84,
  },
  loadingIndicatorOnly: {
    marginTop: 36,
    height: 24,
    justifyContent: 'center',
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  appTagline: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  loadingCapsule: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 40,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
