import Text from '../src/components/AppText';
import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function SpotifyCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    // ให้เวลา WebBrowser จัดการกับ Promise สักครู่ แล้วค่อยเด้งกลับหน้าเดิมเนียนๆ
    const timer = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/profile');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1DB954" />
      <Text style={styles.text}>กำลังกลับเข้าสู่แอป...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#191414',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#FFF',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
});
