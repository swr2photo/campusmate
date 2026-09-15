import React from 'react';
import { HStack, Image, Text } from '@expo/ui/swift-ui';
import { aspectRatio, clipShape, font, foregroundStyle, frame, lineLimit, resizable } from '@expo/ui/swift-ui/modifiers';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { replyLabel } from '../utils/messageReply';
export default function ReplyPreview({ reply, conversationId, color = '#667085' }) {
  const image = !['audio', 'video'].includes(reply?.mediaType) && !reply?.audioUrl ? (reply?.mediaUrl || reply?.mediaUrls?.[0]) : null;
  const { uri } = useDecryptedMedia(image, { conversationId });
  return <HStack spacing={7} alignment="center">
    {uri ? <Image uiImage={uri} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ width: 36, height: 36 }), clipShape('roundedRectangle', 6)]} /> : null}
    <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(color), lineLimit(1)]}>{replyLabel(reply)}</Text>
  </HStack>;
}
