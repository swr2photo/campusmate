import ChatVideoComposer from './ChatVideoComposer';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VIDEO_MODES } from '../utils/chatVideoPolicy';
import ChatImageEditorModal from './ChatImageEditorModal';

const modeIcons = { once: 'radio-button-on-outline', replay: 'play-circle-outline', chat: 'chatbubble-outline' };
const descriptions = { once: 'เปิดได้ครั้งเดียว ปิดแล้วจะเปิดซ้ำไม่ได้', replay: 'เปิดดูซ้ำได้ พร้อมป้องกันแคปหน้าจอ', chat: 'เก็บรูปหรือวิดีโอไว้ในบทสนทนา' };

function VideoPreview({ uri }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain"
    allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />;
}

export default function ChatMediaComposer(props) {
  if (props.asset.type === 'video') return <ChatVideoComposer {...props} />;
  return <ImageMediaComposer {...props} />;
}

function ImageMediaComposer({ asset, recipientName, recipientAvatar, onSend, onClose }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState(asset.mode || 'chat');
  const [showModes, setShowModes] = useState(false);
  const [caption, setCaption] = useState(asset.caption || '');
  const [showCaption, setShowCaption] = useState(Boolean(asset.caption));
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(Boolean(asset.edit));
  const [uris, setUris] = useState(() => asset.uris?.length ? asset.uris : [asset.uri]);
  const video = asset.type === 'video';
  const close = () => { if (!sendingRef.current) onClose(); };
  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try { await onSend({ ...asset, ...(!video ? { uri: uris[0], uris } : {}), caption: caption.trim() }, mode); onClose(); }
    catch (error) { Alert.alert('ส่งสื่อไม่สำเร็จ', error.message || 'กรุณาลองใหม่อีกครั้ง'); }
    finally { sendingRef.current = false; setSending(false); }
  };
  if (editing) return <ChatImageEditorModal visible imageUri={uris[index]} imageUris={uris}
    initialCaption={caption} confirmLabel="ใช้รูปนี้" onClose={() => setEditing(false)}
    onSend={(result, editedCaption) => {
      setUris(Array.isArray(result) ? result : [result]); setCaption(editedCaption);
      setShowCaption(Boolean(editedCaption)); setEditing(false);
    }} />;
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.preview}>
        {video ? <VideoPreview uri={asset.uri} /> : <Image source={{ uri: uris[index] }} style={StyleSheet.absoluteFill} contentFit="contain" />}
        <View style={styles.toolbar}>
          <Pressable accessibilityLabel="ปิดพรีวิว" disabled={sending} onPress={close} style={styles.tool}><Ionicons name="close" size={30} color="#fff" /></Pressable>
          <View style={styles.toolsRight}>
            {!video && <Pressable accessibilityLabel="แต่งรูปภาพ" disabled={sending} onPress={() => setEditing(true)} style={styles.tool}>
              <Ionicons name="color-wand-outline" size={24} color="#fff" />
            </Pressable>}
            <Pressable accessibilityLabel="เพิ่มคำบรรยาย" disabled={sending} onPress={() => setShowCaption(v => !v)} style={styles.tool}><Text style={styles.aa}>Aa</Text></Pressable>
          </View>
        </View>
        <View pointerEvents="none" style={styles.recipient}><Text numberOfLines={1} style={styles.recipientText}>ส่งถึง {recipientName || 'เพื่อน'}</Text></View>
        {video && <View style={styles.duration}><Text style={styles.white}>{Math.ceil(asset.duration / 1000)} วินาที</Text></View>}
        {!video && uris.length > 1 && <View style={styles.pages}>
          <Pressable disabled={index === 0} onPress={() => setIndex(i => i - 1)} accessibilityLabel="รูปก่อนหน้า" style={styles.tool}><Ionicons name="chevron-back" size={24} color={index === 0 ? '#666' : '#fff'} /></Pressable>
          <Text style={styles.white}>{index + 1} / {uris.length}</Text>
          <Pressable disabled={index === uris.length - 1} onPress={() => setIndex(i => i + 1)} accessibilityLabel="รูปถัดไป" style={styles.tool}><Ionicons name="chevron-forward" size={24} color={index === uris.length - 1 ? '#666' : '#fff'} /></Pressable>
        </View>}
        {showCaption && <TextInput autoFocus multiline maxLength={500} editable={!sending} value={caption} onChangeText={setCaption}
          accessibilityLabel="คำบรรยายสื่อ" placeholder="เพิ่มคำบรรยาย…" placeholderTextColor="#ccc" style={styles.caption} />}
        {sending && <View style={styles.uploading}><ActivityIndicator color="#fff" size="large" /><Text style={styles.white}>กำลังส่ง…</Text></View>}
      </View>
      {showModes && <View style={styles.modeSheet}>
        <Text style={styles.sheetTitle}>เลือกวิธีการดู</Text>
        {Object.entries(VIDEO_MODES).map(([value, label]) => <Pressable key={value} accessibilityRole="radio"
          accessibilityState={{ checked: mode === value }} disabled={sending} onPress={() => { setMode(value); setShowModes(false); }} style={styles.modeRow}>
          <Ionicons name={modeIcons[value]} size={29} color="#fff" />
          <View style={{ flex: 1 }}><Text style={styles.modeTitle}>{label}</Text><Text style={styles.description}>{descriptions[value]}</Text></View>
          {mode === value && <Ionicons name="checkmark-circle" color="#fff" size={24} />}
        </Pressable>)}
      </View>}
      <View style={styles.footer}>
        <Pressable accessibilityLabel={`วิธีการดู: ${VIDEO_MODES[mode]}`} accessibilityRole="button" accessibilityState={{ expanded: showModes }}
          disabled={sending} onPress={() => setShowModes(v => !v)} style={styles.modeButton}>
          <Ionicons name={modeIcons[mode]} size={29} color="#fff" />
          <Text style={styles.modeLabel}>{VIDEO_MODES[mode]}</Text><Ionicons name={showModes ? 'chevron-up' : 'chevron-down'} size={15} color="#aaa" />
        </Pressable>
        <Pressable accessibilityLabel="ส่งสื่อ" disabled={sending} onPress={send} style={[styles.send, sending && { opacity: 0.5 }]}>
          {recipientAvatar ? <Image source={{ uri: recipientAvatar }} style={styles.avatar} /> : <Ionicons name="arrow-up" size={23} color="#000" />}
          <Text style={styles.sendText}>ส่ง</Text>
        </Pressable>
      </View>
      {mode !== 'chat' && <Text style={styles.protection}>ป้องกันแคปหน้าจอ{mode === 'once' ? ' · ปิดแล้วจะเปิดดูอีกไม่ได้' : ''}</Text>}
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1, backgroundColor: '#101010', borderRadius: 26, overflow: 'hidden' },
  toolbar: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' },
  tool: { width: 46, height: 46, borderRadius: 25, backgroundColor: '#252525bb', alignItems: 'center', justifyContent: 'center' },
  toolsRight: { flexDirection: 'row', gap: 10 }, aa: { color: '#fff', fontSize: 25, fontWeight: '500' },
  recipient: { position: 'absolute', top: 72, left: 24, right: 24, alignItems: 'center' }, recipientText: { color: '#fff', fontSize: 13, textShadowColor: '#000', textShadowRadius: 5 },
  duration: { position: 'absolute', right: 16, top: 76, padding: 7, borderRadius: 10, backgroundColor: '#0008' },
  pages: { position: 'absolute', bottom: 85, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caption: { position: 'absolute', bottom: 22, left: 18, right: 18, borderRadius: 20, padding: 15, maxHeight: 110, backgroundColor: '#181818dd', color: '#fff', fontSize: 16 },
  white: { color: '#fff', fontSize: 14 }, uploading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000a', alignItems: 'center', justifyContent: 'center', gap: 12 },
  footer: { minHeight: 90, paddingHorizontal: 20, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modeButton: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1, minHeight: 48 }, modeLabel: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  send: { backgroundColor: '#fff', borderRadius: 32, height: 54, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 30, height: 30, borderRadius: 15 }, sendText: { color: '#000', fontSize: 17, fontWeight: '700' },
  protection: { textAlign: 'center', color: '#999', fontSize: 11, marginBottom: 3 },
  modeSheet: { marginHorizontal: 12, marginTop: 10, backgroundColor: '#1c1c1e', borderRadius: 24, padding: 18 },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 10 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 66 }, modeTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  description: { color: '#aaa', fontSize: 11, marginTop: 3 },
});
