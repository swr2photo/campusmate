import React from 'react';
import { ActivityIndicator, ImageBackground, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import FeatureIcon from './FeatureIcon';

const heroImage = require('../../assets/login-campus-hero.png');

export default function AppSplashScreen({ message = 'กำลังเข้าสู่ระบบ...' }) {
  return (
    <ImageBackground
      source={heroImage}
      style={styles.container}
      imageStyle={styles.backgroundImage}
    >
      <LinearGradient
        colors={['rgba(11,13,20,0.42)', 'rgba(11,13,20,0.72)', 'rgba(11,13,20,0.92)']}
        locations={[0, 0.5, 0.9]}
        style={styles.gradient}
      >
        <View style={styles.centerContent}>
          <View style={styles.logoCircle}>
            <FeatureIcon color="#FFFFFF" name="person.2.fill" size={40} />
          </View>

          <Text style={styles.appName}>CampusMate</Text>
          <Text style={styles.appTagline}>พื้นที่เพื่อนใหม่ในรั้วมหาวิทยาลัย</Text>

          <View style={styles.loadingCapsule}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.loadingText}>{message}</Text>
          </View>
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
  logoCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 44,
    borderWidth: 1,
    height: 88,
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    width: 88,
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
