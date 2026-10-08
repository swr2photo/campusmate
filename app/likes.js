import React from 'react';
import { router, usePathname } from 'expo-router';
import LikesScreen from '../src/screens/LikesScreen';
import { useToast } from '../src/context/ToastContext';
import { openChatRoom } from '../src/utils/openChatRoom';

export default function LikesRoute() {
  const { showToast } = useToast();
  const pathname = usePathname();

  return (
    <LikesScreen
      onClose={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/home');
      }}
      onOpenChat={(chatId) => {
        if (chatId) {
          openChatRoom(chatId, { pathname });
        } else {
          router.replace('/(tabs)/chat');
        }
      }}
      onToast={showToast}
    />
  );
}
