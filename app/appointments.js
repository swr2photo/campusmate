import React from 'react';
import { Stack } from 'expo-router';
import AppointmentHistoryScreen from '../src/screens/AppointmentHistoryScreen';

export default function AppointmentsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'ประวัติการนัดหมาย', headerShown: false }} />
      <AppointmentHistoryScreen />
    </>
  );
}
