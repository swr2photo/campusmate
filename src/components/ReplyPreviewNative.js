import React from 'react';
import { Image, Text, View } from 'react-native';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { replyLabel } from '../utils/messageReply';
export default function ReplyPreview({ reply, conversationId, color = '#667085' }) {
  const image = !['audio', 'video'].includes(reply?.mediaType) && !reply?.audioUrl ? (reply?.mediaUrl || reply?.mediaUrls?.[0]) : null;
  const { uri } = useDecryptedMedia(image, { conversationId });
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
    {uri ? <Image source={{ uri }} style={{ width: 36, height: 36, borderRadius: 6 }} /> : null}
    <Text numberOfLines={1} style={{ color, fontSize: 12, flexShrink: 1 }}>{replyLabel(reply)}</Text>
  </View>;
}
