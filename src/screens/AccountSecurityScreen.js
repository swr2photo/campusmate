import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import { useAuth } from '../context/AuthContext';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { radius, shadow, spacing, type, useTheme } from '../theme';
import {
  maskEmail,
  requestDeletionOtp,
  verifyDeletionOtp,
  verifyUserPassword,
} from '../services/accountSecurityService';
import { getStudentIdFromEmail } from '../utils/studentId';

export default function AccountSecurityScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { profile } = useAppProfile();
  const { deleteAccount } = useAppActions();
  const { showToast } = useToast();

  const [modalVisible, setModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const cooldownTimerRef = useRef(null);

  const email = user?.email || profile?.email || '';
  const studentId = profile?.studentId || getStudentIdFromEmail(email) || '-';

  // Cooldown timer effect
  useEffect(() => {
    if (otpCooldown > 0) {
      cooldownTimerRef.current = setTimeout(() => {
        setOtpCooldown((c) => c - 1);
      }, 1000);
    }
    return () => clearTimeout(cooldownTimerRef.current);
  }, [otpCooldown]);

  const handleOpenDeleteModal = () => {
    setPassword('');
    setShowPassword(false);
    setOtp('');
    setOtpSent(false);
    setErrorMessage('');
    setModalVisible(true);
  };

  const handleSendOtp = async () => {
    if (otpSending || otpCooldown > 0) return;
    setOtpSending(true);
    setErrorMessage('');

    try {
      const result = await requestDeletionOtp();
      setOtpSent(true);
      setOtpCooldown(60);
      showToast?.('ส่งรหัสยืนยัน 6 หลักไปยังอีเมลของคุณแล้ว', 'info');
      if (result?.devCode) {
        // In local development environment, surface code helper
        console.log('[AccountSecurity] OTP Code:', result.devCode);
      }
    } catch (err) {
      setErrorMessage(err?.message || 'ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setOtpSending(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!password.trim()) {
      setErrorMessage('กรุณากรอกรหัสผ่านบัญชีของคุณ (รหัสที่ตัวเองตั้ง)');
      return;
    }
    if (!otp.trim() || otp.trim().length !== 6) {
      setErrorMessage('กรุณากรอกรหัสยืนยันจากอีเมลให้ครบ 6 หลัก');
      return;
    }

    setDeleting(true);
    setErrorMessage('');

    try {
      // 1. Verify user password (รหัสที่ตัวเองตั้ง)
      await verifyUserPassword(password);

      // 2. Verify email OTP code (รหัสที่ได้รับจากอีเมล)
      await verifyDeletionOtp(otp);

      // 3. Both verified: execute irreversible account deletion
      showToast?.('กำลังลบบัญชีและข้อมูลทั้งหมด...', 'info');
      await deleteAccount();

      setModalVisible(false);
      showToast?.('ลบบัญชีถาวรเรียบร้อยแล้ว', 'success');
      router.replace('/');
    } catch (err) {
      setErrorMessage(err?.message || 'ลบบัญชีไม่สำเร็จ กรุณาตรวจสอบข้อมูลและลองใหม่');
      setDeleting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: ข้อมูลบัญชี */}
        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>ข้อมูลบัญชี</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <FeatureIcon color={colors.primary} name="envelope.fill" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.label, { color: colors.ink }]}>อีเมลที่ลงทะเบียน</Text>
            </View>
            <Text numberOfLines={1} style={[styles.value, { color: colors.inkMuted }]}>
              {email}
            </Text>
          </View>

          <View style={[styles.row, { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.iconWrap}>
              <FeatureIcon color={colors.green} name="checkmark.seal.fill" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.label, { color: colors.ink }]}>สถานะอีเมล</Text>
            </View>
            <View style={[styles.badgePill, { backgroundColor: colors.greenSoft }]}>
              <Text style={[styles.badgePillText, { color: colors.green }]}>
                {user?.emailVerified ? 'ยืนยันตัวตนแล้ว' : 'รอการยืนยัน'}
              </Text>
            </View>
          </View>

          <View style={[styles.row, { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.iconWrap}>
              <FeatureIcon color={colors.primary} name="person.text.rectangle.fill" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.label, { color: colors.ink }]}>รหัสนักศึกษา</Text>
            </View>
            <Text style={[styles.value, { color: colors.inkMuted }]}>{studentId}</Text>
          </View>
        </View>

        {/* Section 2: ความปลอดภัย */}
        <Text style={[styles.sectionLabel, { color: colors.inkMuted }]}>ความปลอดภัยและรหัสผ่าน</Text>
        <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <FeatureIcon color={colors.primary} name="lock.fill" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.label, { color: colors.ink }]}>รหัสผ่านบัญชี</Text>
            </View>
            <Text style={[styles.value, { color: colors.inkMuted }]}>••••••••</Text>
          </View>

          <View style={[styles.row, { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.iconWrap}>
              <FeatureIcon color={colors.primary} name="shield.lefthalf.filled" size={20} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.label, { color: colors.ink }]}>การยืนยัน 2 ขั้นตอน (2FA)</Text>
            </View>
            <View style={[styles.badgePill, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.badgePillText, { color: colors.primary }]}>เปิดใช้งาน</Text>
            </View>
          </View>
        </View>

        {/* Section 3: การจัดการบัญชีส่วนลึก (Danger Zone) */}
        <Text style={[styles.sectionLabel, { color: colors.danger, marginTop: spacing.xl }]}>
          การจัดการบัญชีส่วนลึก
        </Text>
        <View style={[styles.dangerCard, { backgroundColor: colors.card, borderColor: colors.dangerSoft }]}>
          <View style={styles.dangerHeader}>
            <FeatureIcon color={colors.danger} name="exclamationmark.triangle.fill" size={22} />
            <Text style={[styles.dangerTitle, { color: colors.danger }]}>การลบบัญชีผู้ใช้ถาวร</Text>
          </View>
          <Text style={[styles.dangerDesc, { color: colors.inkMuted }]}>
            เมื่อคุณยืนยันการลบบัญชี ข้อมูลโปรไฟล์ การจับคู่เพื่อน แชตทั้งหมด และประวัตินัดหมายจะถูกลบออกจากระบบทันทีอย่างถาวร และไม่สามารถกู้คืนได้อีกต่อไป
          </Text>

          <Pressable
            accessibilityLabel="ดำเนินการขอลบบัญชีอย่างถาวร"
            accessibilityRole="button"
            onPress={handleOpenDeleteModal}
            style={({ pressed }) => [
              styles.deleteBtn,
              { backgroundColor: colors.dangerSoft },
              pressed && styles.pressed,
            ]}
          >
            <FeatureIcon color={colors.danger} name="trash.fill" size={18} />
            <Text style={[styles.deleteBtnText, { color: colors.danger }]}>
              ขอลบบัญชีผู้ใช้ถาวร...
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* 2-Factor Account Deletion Modal */}
      <Modal
        animationType="fade"
        onRequestClose={() => !deleting && setModalVisible(false)}
        transparent
        visible={modalVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={[styles.warningIconBadge, { backgroundColor: colors.dangerSoft }]}>
                <FeatureIcon color={colors.danger} name="trash.fill" size={24} />
              </View>
              <Text style={[styles.modalTitle, { color: colors.ink }]}>ยืนยันการลบบัญชีถาวร</Text>
              <Text style={[styles.modalSubtitle, { color: colors.inkMuted }]}>
                เพื่อความปลอดภัย กรุณายืนยันตัวตนด้วยรหัสที่คุณตั้งไว้ และรหัส OTP ที่ได้รับทางอีเมล
              </Text>
            </View>

            {/* Error Message Notice */}
            {errorMessage ? (
              <View style={[styles.errorBox, { backgroundColor: colors.dangerSoft }]}>
                <FeatureIcon color={colors.danger} name="exclamationmark.circle.fill" size={16} />
                <Text style={[styles.errorText, { color: colors.danger }]}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Field 1: รหัสที่ตัวเองตั้ง (Account Password) */}
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.ink }]}>
                1. รหัสผ่านบัญชี (รหัสที่ตัวเองตั้ง)
              </Text>
              <View style={[styles.inputContainer, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!deleting}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (errorMessage) setErrorMessage('');
                  }}
                  placeholder="กรอกรหัสผ่านบัญชีของคุณ"
                  placeholderTextColor={colors.inkSoft}
                  secureTextEntry={!showPassword}
                  style={[styles.textInput, { color: colors.ink }]}
                  value={password}
                />
                <Pressable
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={styles.eyeBtn}
                >
                  <FeatureIcon
                    color={colors.inkSoft}
                    name={showPassword ? 'eye.slash.fill' : 'eye.fill'}
                    size={18}
                  />
                </Pressable>
              </View>
            </View>

            {/* Field 2: รหัสที่ได้รับจากอีเมล (OTP) */}
            <View style={styles.inputGroup}>
              <View style={styles.inputLabelRow}>
                <Text style={[styles.inputLabel, { color: colors.ink }]}>
                  2. รหัสยืนยันจากอีเมล ({maskEmail(email)})
                </Text>
              </View>

              <View style={styles.otpRow}>
                <View
                  style={[
                    styles.inputContainer,
                    styles.otpInputContainer,
                    { backgroundColor: colors.surfaceRaised, borderColor: colors.line },
                  ]}
                >
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!deleting}
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={(text) => {
                      setOtp(text);
                      if (errorMessage) setErrorMessage('');
                    }}
                    placeholder="รหัส 6 หลัก"
                    placeholderTextColor={colors.inkSoft}
                    style={[styles.textInput, styles.otpTextInput, { color: colors.ink }]}
                    value={otp}
                  />
                </View>

                <Pressable
                  disabled={otpSending || otpCooldown > 0 || deleting}
                  onPress={handleSendOtp}
                  style={({ pressed }) => [
                    styles.sendOtpBtn,
                    { backgroundColor: otpCooldown > 0 ? colors.surfaceRaised : colors.primary },
                    pressed && styles.pressed,
                    (otpSending || otpCooldown > 0 || deleting) && { opacity: 0.7 },
                  ]}
                >
                  {otpSending ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.sendOtpBtnText,
                        { color: otpCooldown > 0 ? colors.inkMuted : colors.onPrimary },
                      ]}
                    >
                      {otpCooldown > 0 ? `ส่งอีกครั้ง (${otpCooldown}s)` : (otpSent ? 'ส่งใหม่' : 'ส่งรหัส OTP')}
                    </Text>
                  )}
                </Pressable>
              </View>

              {otpSent ? (
                <Text style={[styles.otpHelper, { color: colors.green }]}>
                  ✓ ส่งรหัสไปยัง {maskEmail(email)} แล้ว (มีอายุ 10 นาที)
                </Text>
              ) : null}
            </View>

            {/* Modal Actions */}
            <View style={styles.modalActions}>
              <Pressable
                disabled={deleting || !password.trim() || otp.trim().length !== 6}
                onPress={handleConfirmDelete}
                style={({ pressed }) => [
                  styles.confirmDeleteBtn,
                  { backgroundColor: colors.danger },
                  pressed && styles.pressed,
                  (deleting || !password.trim() || otp.trim().length !== 6) && { opacity: 0.5 },
                ]}
              >
                {deleting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.confirmDeleteBtnText}>ยืนยันและลบบัญชีถาวร</Text>
                )}
              </Pressable>

              <Pressable
                disabled={deleting}
                onPress={() => setModalVisible(false)}
                style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
              >
                <Text style={[styles.cancelBtnText, { color: colors.inkMuted }]}>ยกเลิก</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  sectionLabel: {
    fontSize: type.caption,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  rowCopy: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  iconWrap: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  label: { fontSize: type.body, fontWeight: '700' },
  value: { fontSize: type.caption, fontWeight: '600', maxWidth: 160 },
  badgePill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  dangerCard: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.lg,
  },
  dangerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  dangerTitle: {
    fontSize: type.body,
    fontWeight: '800',
  },
  dangerDesc: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  deleteBtn: {
    alignItems: 'center',
    borderRadius: radius.md || 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: { opacity: 0.75 },

  // Modal Styles
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    ...shadow.card,
    borderRadius: radius.xl || 20,
    borderWidth: 1,
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  warningIconBadge: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginBottom: 12,
    width: 48,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  errorBox: {
    alignItems: 'center',
    borderRadius: radius.md || 10,
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  inputContainer: {
    alignItems: 'center',
    borderRadius: radius.md || 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 44,
  },
  eyeBtn: {
    padding: 6,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 10,
  },
  otpInputContainer: {
    flex: 1,
  },
  otpTextInput: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
  },
  sendOtpBtn: {
    alignItems: 'center',
    borderRadius: radius.md || 10,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 112,
    paddingHorizontal: 12,
  },
  sendOtpBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  otpHelper: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  modalActions: {
    gap: 10,
    marginTop: spacing.lg,
  },
  confirmDeleteBtn: {
    alignItems: 'center',
    borderRadius: radius.md || 10,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  confirmDeleteBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
