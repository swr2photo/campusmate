import NotificationBell from '../../../src/components/NotificationBell';
import { View } from 'react-native';
import React from 'react';
import { Pressable } from 'react-native';
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
          headerShown: true,
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
