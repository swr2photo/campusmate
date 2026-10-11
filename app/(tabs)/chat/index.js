import React from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import ChatScreen from '../../../src/screens/ChatScreen';

export default function ChatRoute() {
  return (
    <>
      <Stack.Screen options={{ headerRight: () => null, headerShown: Platform.OS !== 'android', title: 'ข้อความ', headerTransparent: false, headerLargeTitle: false }} />
      <ChatScreen />
    </>
  );
}
