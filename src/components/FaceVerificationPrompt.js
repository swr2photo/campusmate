import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AppText from './AppText';
import { useAppActions, useAppProfile } from '../context/AppContext';
import FeatureIcon from './FeatureIcon';
import FaceVerificationModal from './FaceVerificationModal';
import { useTheme } from '../theme';
import { useOverlayGate } from '../utils/overlayGate';
export const FACE_VERIFY_PROMPT = 'ยืนยันใบหน้าเพื่อให้คนอื่นเห็นโปรไฟล์ของคุณ';
export function useFaceVerificationRequired() {
  const { profile, profileLoading } = useAppProfile();
  return Boolean(profile?.id) && !profileLoading && !profile.isNewUser && profile.isFaceVerified !== true;
}

/** State + modal for starting verification from anywhere (banner, alert, SwiftUI button). */
export function useFaceVerificationFlow() {
  const { profile } = useAppProfile();
  const { markFaceVerified } = useAppActions();
  const required = useFaceVerificationRequired();
  const [open, setOpen] = useState(false);
  useOverlayGate('faceVerification', open);
  const start = useCallback(() => setOpen(true), []);
  const modal = (
    <FaceVerificationModal
      avatarUri={profile?.avatarUri}
      onClose={() => setOpen(false)}
      onSuccess={(result) => markFaceVerified?.(result?.similarity)}
      visible={open}
    />
  );
  return { required, start, modal };
}


/** Compact profile status. Verification reminders live in the notification inbox. */
export default function FaceVerificationBanner({ style }) {
  const { colors } = useTheme(), { profile, profileLoading } = useAppProfile();
  const { required, start, modal } = useFaceVerificationFlow();
  if (profileLoading || !profile?.id || profile.isNewUser) return null;
  return <><Pressable disabled={!required} accessibilityRole="button" accessibilityLabel={required ? 'เริ่มยืนยันใบหน้า' : 'ยืนยันใบหน้าแล้ว'} onPress={start}
    style={[styles.row, { backgroundColor: colors.card, borderColor: colors.line }, style]}>
    <View style={[styles.icon, { backgroundColor: colors.surfaceRaised }]}><FeatureIcon name="lock.shield.fill" size={22} color={colors.ink} /></View>
    <View style={styles.copy}><AppText style={[styles.title, { color: colors.ink }]}>{required ? 'ยืนยันใบหน้า' : 'ยืนยันใบหน้าแล้ว'}</AppText>
      <AppText style={[styles.body, { color: colors.inkMuted }]}>{required ? 'โปรไฟล์ยังไม่แสดงให้คนอื่นเห็น' : 'ตรวจสอบตัวตนเรียบร้อยแล้ว'}</AppText></View>
    <FeatureIcon name={required ? 'chevron.right' : 'checkmark.circle.fill'} size={18} color={required ? colors.inkMuted : colors.green} />
  </Pressable>{modal}</>;
}
// Kept for compatibility with older callers; automatic reminders are retired.
export function FaceVerificationNoticeHost() { return null; }
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 76, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth }, icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0, gap: 4 }, title: { fontSize: 15, fontWeight: '600' }, body: { fontSize: 13, lineHeight: 20 } });
