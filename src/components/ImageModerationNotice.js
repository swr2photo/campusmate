import Text from './AppText';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';

export default function ImageModerationNotice({ notice, onClose }) {
  const { colors } = useTheme();
  const unavailable = notice?.isModerationUnavailable;
  return (
    <Modal visible={!!notice} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.card }]}>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={unavailable ? 'cloud-offline-outline' : 'image-outline'} size={30} color={colors.primary} />
            </View>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
              {unavailable ? 'ยังตรวจสอบภาพไม่ได้' : 'ภาพนี้ยังไม่ผ่านเกณฑ์'}
            </Text>
            <Text style={[styles.message, { color: colors.inkMuted }]}>{notice?.message}</Text>
            <View style={[styles.note, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.detail, { color: colors.inkMuted }]}>
                {unavailable
                  ? 'นี่เป็นปัญหาการตรวจสอบ ไม่ได้หมายความว่าภาพของคุณมีเนื้อหาไม่เหมาะสม กรุณาลองส่งหรือบันทึกอีกครั้ง'
                  : 'การตรวจสอบอัตโนมัติอาจคลาดเคลื่อนได้ หากเป็นภาพทั่วไป คุณสามารถเลือกภาพอื่นหรือลองใหม่ได้'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose}
              style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
              <Text style={styles.buttonText}>กลับไปแก้ไข</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(8,15,30,0.5)' },
  card: { width: '100%', maxWidth: 420, maxHeight: '85%', borderRadius: 28, overflow: 'hidden' },
  content: { padding: 24 },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 23, fontWeight: '700', marginBottom: 12 },
  message: { fontSize: 16, lineHeight: 25 },
  note: { padding: 16, borderRadius: 16, marginVertical: 20 },
  detail: { fontSize: 14, lineHeight: 23 },
  button: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 14 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
