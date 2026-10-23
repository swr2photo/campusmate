import { Pressable } from '../../../src/components/NativePressable';
import NotificationBell from '../../../src/components/NotificationBell';
import { Platform, View } from 'react-native';
import React from 'react';

import { router, Stack } from 'expo-router';
import HomeScreen from '../../../src/screens/HomeScreen';
import FeatureIcon from '../../../src/components/FeatureIcon';
import { useTheme } from '../../../src/theme';
import { TourTarget } from '../../../src/context/AppTourContext';

export default function HomeRoute() {
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'หาเพื่อน',
          // On iOS, HomeScreen.ios renders its own in-page header (title, notification bell, filter button).
          // Hide Stack.Screen header on iOS to prevent duplicate/overlapping headers.
          headerShown: Platform.OS !== 'ios',
          headerTransparent: false,
          headerLargeTitle: false,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <NotificationBell />
            <TourTarget id="home.filters">
            <Pressable
              accessibilityLabel="ตั้งค่าการจับคู่"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.push('/matching-filters')}
              style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <FeatureIcon color={colors.ink} name="slider.horizontal.3" size={20} />
            </Pressable>
            </TourTarget>
            </View>
          ),
        }}
      />
      <HomeScreen />
    </>
  );
}
