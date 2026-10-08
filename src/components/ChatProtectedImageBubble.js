import Text from './AppText';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ScreenCapture from 'expo-screen-capture';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { usePeerMediaView } from '../hooks/usePeerMediaView';
import { recordMediaView } from '../services/chatVideoService';
import { isProtectedViewMode, VIDEO_MODES } from '../utils/chatVideoPolicy';
import { useAppActions } from '../context/AppContext';
import { createReplySnapshot } from '../utils/messageReply';
import ChatImageViewerModal from './ChatImageViewerModal';
import { showAlert } from '../utils/appAlert';

export default function ChatProtectedImageBubble({
  item,
  conversationId,
  currentUserId,
  otherUserId,
  mine = false,
  onLongPress,
  previewOnly = false,
}) {
  const { sendMessage } = useAppActions();
  const [open, setOpen] = useState(false);
  const opening = useRef(false);
  const mounted = useRef(true);
  const once = item.viewMode === 'once';
  const protectedView = isProtectedViewMode(item.viewMode);
  const watchViewerId = mine ? otherUserId : (once ? currentUserId : null);
  const viewedAt = usePeerMediaView(
    conversationId,
    item.id,
    watchViewerId,
    !previewOnly && Boolean(watchViewerId) && !item.pendingSync,
  );
  const openedByPeer = mine && Boolean(viewedAt);
  const consumed = !mine && once && Boolean(viewedAt);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!previewOnly) ScreenCapture.allowScreenCaptureAsync(`chat-image-${item.id}`).catch(() => {});
    };
  }, [item.id, previewOnly]);

  const { uri } = useDecryptedMedia(item.mediaUrl, { conversationId, currentUserId });

  const show = async () => {
    if (previewOnly || consumed || !uri || open || opening.current) return;
    opening.current = true;
    const key = `chat-image-${item.id}`;
    try {
      await ScreenCapture.preventScreenCaptureAsync(key);
      if (!mounted.current || AppState.currentState !== 'active') {
        await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
        return;
      }
      if (!mine && protectedView) {
        await recordMediaView(conversationId, item.id, currentUserId, { exclusive: once });
      }
      if (mounted.current && AppState.currentState === 'active') setOpen(true);
      else await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
    } catch (error) {
      await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
      if (mounted.current) showAlert('เปิดรูปไม่สำเร็จ', error.message, { tone: 'danger' });
    } finally {
      opening.current = false;
    }
  };

  const close = async () => {
    setOpen(false);
    await ScreenCapture.allowScreenCaptureAsync(`chat-image-${item.id}`).catch(() => {});
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && open) close();
    });
    return () => sub.remove();
  }, [open]);

  const seen = openedByPeer || consumed;
  const label = item.isUploading || item.pendingSync
    ? 'กำลังส่ง...'
    : seen ? 'เปิดดูแล้ว' : mine ? 'รูปภาพที่ส่ง' : VIDEO_MODES[item.viewMode];

  return (
    <View style={{ width: 220, height: 220, borderRadius: 18, overflow: 'hidden', backgroundColor: '#293657' }}>
      <Pressable
        disabled={previewOnly || open || item.pendingSync || item.isUploading}
        onPress={show}
        onLongPress={onLongPress}
        delayLongPress={220}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            blurRadius={32}
            style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.65 }}
            contentFit="cover"
          />
        ) : null}
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Ionicons name={seen ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={34} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', marginTop: 7 }}>{label}</Text>
        </View>
      </Pressable>
      {open ? (
        <ChatImageViewerModal
          visible
          images={[uri]}
          conversationId={conversationId}
          currentUserId={currentUserId}
          onClose={close}
          protectedMedia
          onSendMessage={async (text) => {
            if (!conversationId || !text || !sendMessage) return;
            await sendMessage(conversationId, text, {
              replyTo: createReplySnapshot(item),
            });
          }}
        />
      ) : null}
    </View>
  );
}
