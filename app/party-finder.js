import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import MeetupScreen from '../src/screens/MeetupScreen';
import { useToast } from '../src/context/ToastContext';

export default function PartyFinderRoute() {
  const { partyId } = useLocalSearchParams();
  const { showToast } = useToast();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'หาตี้ใน ม.อ.' }} />
      <MeetupScreen onToast={showToast} partyOnly targetPartyId={typeof partyId === 'string' ? partyId : null} />
    </>
  );
}
