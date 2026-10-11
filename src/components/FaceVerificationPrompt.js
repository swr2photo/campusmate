import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AppText from './AppText';
import { useAppActions, useAppProfile } from '../context/AppContext';
import FeatureIcon from './FeatureIcon';
import FaceVerificationModal from './FaceVerificationModal';
import { useTheme } from '../theme';
import { useOverlayGate } from '../utils/overlayGate';
import { useAuth } from '../context/AuthContext';
export const FACE_VERIFY_PROMPT = 'ยืนยันใบหน้าเพื่อให้คนอื่นเห็นโปรไฟล์ของคุณ';

function isUserAdmin(user, profile) {
  const email = (user?.email || profile?.email || '').toLowerCase().trim();
  return email === '6710210317@psu.ac.th' || profile?.isAdmin === true || profile?.role === 'admin';
}

export function useFaceVerificationRequired() {
  const { profile, profileLoading } = useAppProfile();
  const { user } = useAuth();
  if (isUserAdmin(user, profile)) return false;
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
  const { user } = useAuth();
  const { required, start, modal } = useFaceVerificationFlow();
  if (profileLoading || !profile?.id || profile.isNewUser) return null;

  const userEmail = (user?.email || profile?.email || '').toLowerCase().trim();
  const isSuperAdmin = userEmail === '6710210317@psu.ac.th';
  const isAdmin = isSuperAdmin || profile?.isAdmin === true || profile?.role === 'admin';

  // Do not show the banner if already verified or if the user is an admin
  if (!required || isAdmin) return null;

  const title = 'ยืนยันใบหน้า';

  return (
    <>
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        onPress={start}
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.line }, style]}
      >
        <View style={styles.icon}>
          <FeatureIcon color={colors.ink} name="lock.shield.fill" size={20} />
        </View>
        <View style={styles.copy}>
          <AppText style={[styles.title, { color: colors.ink }]}>{title}</AppText>
        </View>
        <FeatureIcon color={colors.inkMuted} name="chevron.right" size={18} />
      </Pressable>
      {modal}
    </>
  );
}
// Kept for compatibility with older callers; automatic reminders are retired.
export function FaceVerificationNoticeHost() { return null; }
const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  icon: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700' },
});
