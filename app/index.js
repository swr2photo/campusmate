import Text from '../src/components/AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/context/AuthContext';
import { useAppProfile } from '../src/context/AppContext';
import AppSplashScreen from '../src/components/AppSplashScreen';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import { getLoggedInRoute, isBlockedCampusAccount } from '../src/utils/campusEmail';

// รอ profile นานสุด 12 วินาที ก่อนแสดงหน้า error
const PROFILE_WAIT_TIMEOUT_MS = 12000;
// retry อัตโนมัติทุก 5 วินาที
const AUTO_RETRY_INTERVAL_MS = 5000;
// retry สูงสุด 3 ครั้ง ก่อน logout
const MAX_AUTO_RETRIES = 3;

/** หน้าแสดงเมื่อโหลด profile ไม่สำเร็จ */
function ProfileLoadError({ onRetry, retryCount, isRetrying }) {
  const exhausted = retryCount >= MAX_AUTO_RETRIES;
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorIcon}>⚠️</Text>
      <Text style={styles.errorTitle}>โหลดข้อมูลไม่สำเร็จ</Text>
      <Text style={styles.errorBody}>
        {exhausted
          ? 'ไม่สามารถเชื่อมต่อได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
          : `กำลังลองใหม่อัตโนมัติ (${retryCount}/${MAX_AUTO_RETRIES})…`}
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
      >
        {isRetrying
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={styles.retryButtonText}>ลองอีกครั้ง</Text>}
      </Pressable>
    </View>
  );
}

export default function LoginRoute() {
  const { isLoggedIn, login, logout, isReady, user } = useAuth();
  const { profile, profileLoading, profileError } = useAppProfile();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(null);

  // สถานะ retry
  const [showError, setShowError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [retryKey, setRetryKey] = useState(0);     // bump เพื่อ reset timer
  const [isRetrying, setIsRetrying] = useState(false);

  const waitTimerRef = useRef(null);
  const autoRetryTimerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem('@campusmate:onboarding_seen_v1')
      .then((value) => { if (mounted) setHasSeenOnboarding(value === 'true'); })
      .catch(() => { if (mounted) setHasSeenOnboarding(false); });
    return () => { mounted = false; };
  }, []);

  /** เมื่อ profile มาแล้ว — ล้างทุก timer และ error state */
  useEffect(() => {
    if (!isLoggedIn || profile) {
      clearTimeout(waitTimerRef.current);
      clearTimeout(autoRetryTimerRef.current);
      waitTimerRef.current = null;
      autoRetryTimerRef.current = null;
      setShowError(false);
      setRetryCount(0);
      setIsRetrying(false);
      return undefined;
    }
    return undefined;
  }, [isLoggedIn, profile]);

  /**
   * Timeout guard — เริ่มนับเมื่อ logged-in แต่ profile ยังไม่มา
   * reset เมื่อ retryKey เปลี่ยน (กด retry)
   */
  useEffect(() => {
    if (!isLoggedIn || profile) return undefined;

    // profileError ขึ้นมาแล้ว → ไม่ต้องรอ timeout แสดง error ทันที
    if (profileError && !profileLoading) {
      setShowError(true);
      return undefined;
    }

    setIsRetrying(false);
    clearTimeout(waitTimerRef.current);
    waitTimerRef.current = setTimeout(() => {
      setShowError(true);
    }, PROFILE_WAIT_TIMEOUT_MS);

    return () => clearTimeout(waitTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, profile, profileError, profileLoading, retryKey]);

  /** Auto-retry เมื่อ showError=true และยังไม่ exhausted */
  useEffect(() => {
    if (!showError || retryCount >= MAX_AUTO_RETRIES) return undefined;

    clearTimeout(autoRetryTimerRef.current);
    autoRetryTimerRef.current = setTimeout(() => {
      setRetryCount((c) => c + 1);
      setRetryKey((k) => k + 1);
      setShowError(false);
      setIsRetrying(true);
    }, AUTO_RETRY_INTERVAL_MS);

    return () => clearTimeout(autoRetryTimerRef.current);
  }, [showError, retryCount]);

  /** Logout เมื่อ retry หมดแล้ว และยังไม่ได้ profile */
  useEffect(() => {
    if (showError && retryCount >= MAX_AUTO_RETRIES && !profile) {
      // ให้ผู้ใช้กดปุ่ม retry เองได้ ไม่ logout อัตโนมัติ
      // logout จะเกิดขึ้นเมื่อกดปุ่ม "ลองอีกครั้ง" ครั้งสุดท้าย
    }
  }, [showError, retryCount, profile]);

  /** กดปุ่ม retry ด้วยตัวเอง */
  const handleManualRetry = useCallback(() => {
    if (retryCount >= MAX_AUTO_RETRIES) {
      // exhausted → logout กลับ login screen
      logout().catch(() => {});
      return;
    }
    setRetryCount((c) => c + 1);
    setRetryKey((k) => k + 1);
    setShowError(false);
    setIsRetrying(true);
  }, [logout, retryCount]);

  useEffect(() => {
    if (!isBlockedCampusAccount(user, profile)) return undefined;
    logout().catch(() => {});
    return undefined;
  }, [logout, profile, user]);

  const completeOnboarding = async () => {
    await AsyncStorage.setItem('@campusmate:onboarding_seen_v1', 'true').catch(() => {});
    setHasSeenOnboarding(true);
  };

  if (isLoggedIn) {
    const destination = getLoggedInRoute(user, profile);
    if (!destination) {
      // profile ยังไม่มา
      if (showError) {
        return (
          <ProfileLoadError
            isRetrying={isRetrying}
            onRetry={handleManualRetry}
            retryCount={retryCount}
          />
        );
      }
      return <AppSplashScreen />;
    }
    return <Redirect href={destination} />;
  }

  if (!isReady) return <AppSplashScreen />;
  if (hasSeenOnboarding === null) return <AppSplashScreen />;
  if (!hasSeenOnboarding) return <OnboardingScreen onComplete={completeOnboarding} />;
  return <LoginScreen onLoginSuccess={login} />;
}

const styles = StyleSheet.create({
  errorContainer: {
    alignItems: 'center',
    backgroundColor: '#F7F7F8',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  errorTitle: {
    color: '#25272B',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: '#6B7078',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#2869C7',
    borderRadius: 14,
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 13,
    minWidth: 160,
  },
  retryButtonPressed: {
    opacity: 0.75,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
