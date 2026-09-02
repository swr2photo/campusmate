import React from 'react';
import ChatScreen from '../../../src/screens/ChatScreen';

import { Stack } from 'expo-router';

export default function ChatRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'ข้อความ' }} />
      <ChatScreen />
    </>
  );
}

