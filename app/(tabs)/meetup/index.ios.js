import { Pressable } from '../../../src/components/NativePressable';
import React from 'react';

import { Stack, useRouter } from 'expo-router';
import MeetupScreen from '../../../src/screens/MeetupScreen.ios';
import { useToast } from '../../../src/context/ToastContext';
import FeatureIcon from '../../../src/components/FeatureIcon';
import { useTheme } from '../../../src/theme';

export default function MeetupRoute() {
  const { showToast } = useToast();
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <>
      <Stack.Screen options={{
        title: 'กิจกรรม', headerShown: true, headerTransparent: false, headerLargeTitle: false,
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="เปิดสถานที่ รายการโปรด และคอลเลกชัน"
            onPress={() => router.push('/landmarks')}
            style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <FeatureIcon name="globe" color={colors.ink} size={22} />
          </Pressable>
        ),
      }} />
      <MeetupScreen onToast={showToast} />
    </>
  );
}
