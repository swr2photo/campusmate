import Text from './AppText';
import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { useVideoPoster } from '../hooks/useVideoPoster';
import { replyLabel } from '../utils/messageReply';
import { isProtectedMedia } from '../utils/chatVideoPolicy';

const THUMB = 36;

function ReplyThumb({ uri, blurred, isVideo }) {
  if (!uri) {
    return (
      <View style={styles.fallback}>
        <Ionicons
          name={isVideo ? 'videocam' : 'image'}
          size={16}
          color="rgba(255,255,255,0.85)"
        />
      </View>
    );
  }

  return (
    <View style={styles.thumbWrap}>
      <Image
        source={typeof uri === 'string' ? { uri } : uri}
        style={styles.thumb}
        contentFit="cover"
        blurRadius={blurred ? 18 : 0}
      />
      {blurred ? <View pointerEvents="none" style={styles.blurVeil} /> : null}
      {isVideo ? (
        <View pointerEvents="none" style={styles.playBadge}>
          <Ionicons name="play" size={10} color="#fff" style={{ marginLeft: 1 }} />
        </View>
      ) : null}
    </View>
  );
}

export default function ReplyPreview({ reply, conversationId, currentUserId, color = '#667085' }) {
  const isVideo = reply?.mediaType === 'video';
  const isAudio = reply?.mediaType === 'audio' || Boolean(reply?.audioUrl);
  const isImage = !isVideo && !isAudio && (
    reply?.mediaType === 'image'
    || reply?.mediaType === 'gif'
    || Boolean(reply?.mediaUrl)
    || Boolean(reply?.mediaUrls?.length)
  );
  const mediaUrl = reply?.mediaUrl || reply?.mediaUrls?.[0] || null;
  const blurred = isProtectedMedia(reply);

  const { uri: imageUri } = useDecryptedMedia(
    isImage ? mediaUrl : null,
    { conversationId, currentUserId, mediaType: 'image' },
  );
  const poster = useVideoPoster(
    isVideo ? mediaUrl : null,
    conversationId,
    currentUserId,
    Boolean(isVideo && mediaUrl),
  );

  const thumbUri = isVideo ? poster : imageUri;
  const showThumb = isVideo || isImage;

  return (
    <View style={styles.row}>
      {showThumb ? (
        <ReplyThumb uri={thumbUri} blurred={blurred} isVideo={isVideo} />
      ) : null}
      <Text numberOfLines={1} style={{ color, fontSize: 12, flexShrink: 1 }}>
        {replyLabel(reply)}
      </Text>
    </View>
  );
}

const styles = {
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 7,
  },
  thumbWrap: {
    borderRadius: 6,
    height: THUMB,
    overflow: 'hidden',
    position: 'relative',
    width: THUMB,
  },
  thumb: {
    height: THUMB,
    width: THUMB,
  },
  blurVeil: {
    ...{
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    backgroundColor: 'rgba(8, 12, 20, 0.28)',
  },
  playBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 9,
    bottom: 3,
    height: 16,
    justifyContent: 'center',
    position: 'absolute',
    right: 3,
    width: 16,
  },
  fallback: {
    alignItems: 'center',
    backgroundColor: 'rgba(59, 90, 254, 0.55)',
    borderRadius: 6,
    height: THUMB,
    justifyContent: 'center',
    width: THUMB,
  },
};
