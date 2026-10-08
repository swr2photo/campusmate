import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import GroupChatRoomScreen from '../src/screens/GroupChatRoomScreen';

export default function GroupChatRoute() {
  const { partyId } = useLocalSearchParams();
  const id = Array.isArray(partyId) ? partyId[0] : partyId;
  return <GroupChatRoomScreen key={id || 'group-chat'} />;
}
