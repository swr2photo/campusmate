import React from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack } from 'expo-router';
import MeetupScreen from '../../../src/screens/MeetupScreen';
import FeatureIcon from '../../../src/components/FeatureIcon';
import { useToast } from '../../../src/context/ToastContext';
import { useTheme } from '../../../src/theme';

export default function MeetupRoute() {
  const { showToast } = useToast();
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'กิจกรรม',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                accessibilityLabel="ประวัติการนัดหมาย"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.push('/appointments')}
              >
                <FeatureIcon color={colors.ink} name="calendar.badge.clock" size={20} />
              </Pressable>
            </View>
          ),
        }}
      />
      <MeetupScreen onToast={showToast} />
    </>
  );
}
