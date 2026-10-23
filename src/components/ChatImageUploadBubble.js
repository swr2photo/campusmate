import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Text from './AppText';
import { Pressable } from './NativePressable';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';
import { chatImageSize } from '../utils/chatMediaLayout';
import { useChatImageOutbox } from '../context/ChatImageOutboxContext';

export default function ChatImageUploadBubble({ item }) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const { retry, remove } = useChatImageOutbox(item.conversationId);
  const [actionError, setActionError] = useState('');
  const size = chatImageSize(width, item.width && item.height ? item.width / item.height : 1);
  const failed = item.status === 'failed';
  const percent = item.stage === 'uploading' && Number.isFinite(item.progress) ? Math.min(99, Math.floor(item.progress * 100)) : null;
  const label = failed ? item.error || 'ส่งรูปภาพไม่สำเร็จ' : item.stage === 'waiting' ? 'รอการเชื่อมต่อ' : percent == null ? 'กำลังส่งรูปภาพ…' : `กำลังส่ง ${percent}%`;
  return <View style={styles.row}>
    <View style={{ width: size.width, maxWidth: '100%' }}>
      <View style={[styles.photo, { width: size.width, height: size.height, backgroundColor: colors.card }]} accessibilityLabel={label} accessibilityLiveRegion="polite">
        <Image source={{ uri: item.uri }} contentFit="cover" style={StyleSheet.absoluteFill} transition={0} />
        <View style={styles.status}>
          {failed ? <FeatureIcon name="exclamationmark.circle.fill" color="#FFF" size={18} /> : <ActivityIndicator color="#FFF" size="small" />}
          <Text numberOfLines={2} style={styles.statusText}>{failed ? 'ส่งไม่สำเร็จ' : label}</Text>
        </View>
      </View>
      {item.caption ? <Text style={[styles.caption, { color: colors.ink }]}>{item.caption}</Text> : null}
      {item.viewMode !== 'chat' ? <Text style={[styles.hint, { color: colors.inkMuted }]}>{item.viewMode === 'once' ? 'ดูได้ครั้งเดียว' : 'ดูซ้ำได้แบบป้องกันหน้าจอ'}</Text> : null}
      {failed ? <>
        <Text style={[styles.hint, { color: colors.inkMuted }]}>{label}</Text>
        <View style={styles.actions}>
          {item.retryable !== false ? <Pressable accessibilityRole="button" onPress={() => retry(item.id)} style={[styles.action, { backgroundColor: colors.primarySoft }]}><Text style={{ color: colors.ink }}>ลองส่งใหม่</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={() => { setActionError(''); void remove(item.id).catch(() => setActionError('ลบรายการไม่ได้ กรุณาลองอีกครั้ง')); }} style={styles.action}><Text style={{ color: colors.inkMuted }}>ลบ</Text></Pressable>
        </View>
        {actionError ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.inkMuted }]}>{actionError}</Text> : null}
      </> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { width: '100%', alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 6 },
  photo: { borderRadius: 18, borderCurve: 'continuous', overflow: 'hidden' },
  status: { position: 'absolute', left: 8, right: 8, bottom: 8, borderRadius: 16, padding: 10,
    backgroundColor: 'rgba(0,0,0,0.66)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: '#FFF', fontSize: 12, flexShrink: 1 },
  caption: { paddingVertical: 6, fontSize: 16 }, hint: { fontSize: 12, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 }, action: { minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24 },
});
