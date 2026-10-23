import { Pressable } from './NativePressable';
import Text from './AppText';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import { chatImageSize } from '../utils/chatMediaLayout';
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
  isPreview = false,
  conversationKey = null,
}) {
  const { sendMessage } = useAppActions();
  const { width: screenWidth } = useWindowDimensions();
  const mediaSize = chatImageSize(screenWidth, 1, isPreview);
  const [open, setOpen] = useState(false);
  const [openedLocally, setOpenedLocally] = useState(false);
  const opening = useRef(false);
  const longPressed = useRef(false);
  const mounted = useRef(true);
  const once = item.viewMode === 'once';
  const protectedView = isProtectedViewMode(item.viewMode);
  const watchViewerId = mine ? otherUserId : (once ? currentUserId : null);
  const viewedAt = usePeerMediaView(
    conversationId,
    item.id,
    watchViewerId,
    !conversationKey && !previewOnly && Boolean(watchViewerId) && !item.pendingSync,
  );
  const openedByPeer = mine && Boolean(viewedAt);
  const consumed = !mine && once && (Boolean(viewedAt) || openedLocally);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!previewOnly) ScreenCapture.allowScreenCaptureAsync(`chat-image-${item.id}`).catch(() => {});
    };
  }, [item.id, previewOnly]);

  const { uri } = useDecryptedMedia(item.mediaUrl, { conversationId, currentUserId, conversationKey });

  const show = async () => {
    // Opening the context menu must never also count as viewing the photo
    // when the original touch is released or cancelled by modal presentation.
    if (longPressed.current) return;
    if (previewOnly || consumed || !uri || open || opening.current) return;
    opening.current = true;
    const key = `chat-image-${item.id}`;
    try {
      await ScreenCapture.preventScreenCaptureAsync(key);
      if (!mounted.current || AppState.currentState !== 'active') {
        await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
        return;
      }
      if (!mine && protectedView && !conversationKey) {
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
    if (conversationKey && once && !mine) setOpenedLocally(true);
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
  const subtitle = item.isUploading || item.pendingSync ? 'กำลังเตรียมรูปภาพ'
    : consumed ? 'รูปภาพนี้เปิดดูได้ครั้งเดียว'
      : !uri ? 'กำลังโหลดรูปภาพ'
        : once && !mine ? 'แตะเพื่อดูรูปภาพ · ดูได้ครั้งเดียว' : 'แตะเพื่อดูรูปภาพ';

  const handleLongPress = (event) => {
    if (previewOnly || open || item.pendingSync || item.isUploading) return;
    longPressed.current = true;
    event?.stopPropagation?.();
    const details = { imageSize: mediaSize, aspectRatio: 1 };
    const touch = event?.nativeEvent;
    if ([touch?.pageX, touch?.pageY, touch?.locationX, touch?.locationY].every(Number.isFinite)) {
      details.layout = {
        x: touch.pageX - touch.locationX,
        y: touch.pageY - touch.locationY,
        width: mediaSize.width,
        height: mediaSize.height,
      };
    }
    onLongPress?.(event, details);
  };

  return (
    <View style={[styles.bubble, { width: mediaSize.width, height: mediaSize.height, aspectRatio: 1 }]}>
      <Pressable
        nativeGestureSurface
        accessibilityRole="button"
        accessibilityLabel={`${label} ${subtitle}`}
        disabled={previewOnly || open || item.pendingSync || item.isUploading}
        onPress={show}
        onPressIn={() => { longPressed.current = false; }}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={220}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        {uri ? (
          <Image
            pointerEvents="none"
            source={{ uri }}
            blurRadius={32}
            style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.65 }}
            contentFit="cover"
          />
        ) : null}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.content} pointerEvents="none">
          <View style={[styles.badge, isPreview && { width: 40, height: 40 }]}><Ionicons name={seen ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={isPreview ? 22 : 28} color="#fff" /></View>
          <Text style={{ color: '#fff', fontWeight: '700', marginTop: 7 }}>{label}</Text>
          {!isPreview ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
            if (conversationKey || !conversationId || !text || !sendMessage) return;
            await sendMessage(conversationId, text, {
              replyTo: createReplySnapshot(item),
            });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { borderRadius: 18, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#293657', flexShrink: 0 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(9,16,30,0.40)' },
  content: { alignItems: 'center', padding: 16 },
  badge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  subtitle: { color: 'rgba(255,255,255,0.86)', fontSize: 12, textAlign: 'center', marginTop: 4 },
});
