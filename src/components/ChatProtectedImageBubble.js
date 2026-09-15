import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenCapture from 'expo-screen-capture';
import { useDecryptedMedia } from '../hooks/useDecryptedMedia';
import { claimOnceVideo, watchOnceVideo } from '../services/chatVideoService';
import { VIDEO_MODES } from '../utils/chatVideoPolicy';
import ChatImageViewerModal from './ChatImageViewerModal';

export default function ChatProtectedImageBubble({ item, conversationId, currentUserId, mine = false, onLongPress, previewOnly = false }) {
  const [open, setOpen] = useState(false); const [consumed, setConsumed] = useState(false);
  const opening = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!previewOnly) ScreenCapture.allowScreenCaptureAsync(`chat-image-${item.id}`).catch(() => {});
    };
  }, [item.id, previewOnly]);
  useEffect(() => item.viewMode === 'once' ? watchOnceVideo(conversationId, item.id, currentUserId, () => setConsumed(true)) : undefined, [conversationId, currentUserId, item.id, item.viewMode]);
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
      if (item.viewMode === 'once') { await claimOnceVideo(conversationId, item.id, currentUserId); setConsumed(true); }
      if (mounted.current && AppState.currentState === 'active') setOpen(true);
      else await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
    } catch (error) { await ScreenCapture.allowScreenCaptureAsync(key).catch(() => {}); if (mounted.current) Alert.alert('เปิดรูปไม่สำเร็จ', error.message); }
    finally { opening.current = false; }
  };
  const close = async () => { setOpen(false); await ScreenCapture.allowScreenCaptureAsync(`chat-image-${item.id}`).catch(() => {}); };
  useEffect(() => { const sub = AppState.addEventListener('change', s => { if (s !== 'active' && open) close(); }); return () => sub.remove(); }, [open]);
  return <View style={{ width: 220, height: 220, borderRadius: 18, overflow: 'hidden', backgroundColor: '#293657' }}>
    <Pressable disabled={previewOnly || open} onPress={show} onLongPress={onLongPress} delayLongPress={220}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      {uri && <Image source={{ uri }} blurRadius={32} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.65 }} contentFit="cover" />}
      <View style={{ position: 'absolute', alignItems: 'center' }}><Ionicons name={consumed ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={34} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', marginTop: 7 }}>{consumed ? 'เปิดดูแล้ว' : mine ? 'รูปภาพที่ส่ง' : VIDEO_MODES[item.viewMode]}</Text></View>
    </Pressable>
    {open && <ChatImageViewerModal visible images={[uri]} conversationId={conversationId} currentUserId={currentUserId} onClose={close} protectedMedia />}
  </View>;
}
