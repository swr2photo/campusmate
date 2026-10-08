import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ChatRoomScreen from '../src/screens/ChatRoomScreen';

export default function ChatRoomRoute() {
  const { chatId } = useLocalSearchParams();
  const id = Array.isArray(chatId) ? chatId[0] : chatId;
  // Remount per conversation so switching chats never flashes the previous room.
  return <ChatRoomScreen key={id || 'chat-room'} />;
}
