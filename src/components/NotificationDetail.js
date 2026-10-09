import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import NotificationDetailContent from './NotificationDetailContent';
export default function NotificationDetail(props) {
  return <Modal visible={Boolean(props.notification)} transparent animationType="fade" onRequestClose={props.onClose}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(20,20,22,0.4)' }}>
      <Pressable onPress={props.onClose} accessibilityLabel="ปิดรายละเอียดแจ้งเตือน" style={{ position: 'absolute', inset: 0 }} />
      <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 24, overflow: 'hidden' }}><NotificationDetailContent {...props} /></View>
    </View>
  </Modal>;
}
