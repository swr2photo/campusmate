import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { CampusLandmarksView } from '../../modules/campus-landmarks';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme';
import { useToast } from '../context/ToastContext';

export default function LandmarksScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { showToast } = useToast();
  
  const storageScope = user?.id ? `user:${user.id}` : 'device:guest';
  const backendURL = process.env.EXPO_PUBLIC_LANDMARKS_API_URL?.trim() || undefined;
  
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/meetup');
  }, [router]);

  const handleSelectPlace = useCallback((place) => {
    console.log('[LandmarksScreen] Selected place:', place);
    showToast({
      title: place.name,
      message: `พิกัด: ${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`,
      preset: 'done',
    });
  }, [showToast]);

  const handleLibraryChange = useCallback((library) => {
    console.log('[LandmarksScreen] Library change:', library);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <Stack.Screen options={{ headerShown: false, title: 'สถานที่และคอลเลกชัน' }} />
      <CampusLandmarksView
        key={storageScope}
        title="สถานที่และคอลเลกชัน"
        storageScope={storageScope}
        backendURL={backendURL}
        syncEnabled={Boolean(backendURL)}
        colorScheme={isDark ? 'dark' : 'light'}
        tintColor={colors.primary}
        onClose={close}
        onSelectPlace={handleSelectPlace}
        onLibraryChange={handleLibraryChange}
        testID="campus-landmarks-library"
      />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });
