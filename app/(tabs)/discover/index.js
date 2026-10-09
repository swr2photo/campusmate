import React from 'react';
import { router, Stack, usePathname } from 'expo-router';
import LikesScreen from '../../../src/screens/LikesScreen';
import { useToast } from '../../../src/context/ToastContext';
import { openChatRoom } from '../../../src/utils/openChatRoom';

export default function DiscoverRoute() {
  const { showToast } = useToast();
  const pathname = usePathname();
  return (
    <>
      <Stack.Screen
        options={{
          title: 'ถูกใจ',
          headerShown: true,
          headerTransparent: false,
          headerLargeTitle: false,
          headerRight: () => null,
        }}
      />
      <LikesScreen
        onOpenChat={(chatId) => {
          if (chatId) {
            openChatRoom(chatId, { pathname });
          } else {
            router.navigate('/chat');
          }
        }}
        onToast={showToast}
      />
    </>
  );
}
