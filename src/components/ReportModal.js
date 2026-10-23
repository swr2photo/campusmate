import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useRef, useState } from 'react';
import { Modal, View, ScrollView, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { showAlert } from '../utils/appAlert';
import { GlassBackground, GlassIconButton, useLiquidGlass, useSheetGlassTint } from './LiquidGlassSurface';

const REPORT_REASONS = [
  { id: 'nudity', label: 'ภาพลามกอนาจาร / โป๊เปลือย', icon: 'exclamationmark.triangle' },
  { id: 'harassment', label: 'การคุกคาม / ข่มขู่ / กลั่นแกล้ง', icon: 'hand.raised' },
  { id: 'scam', label: 'สแปม / หลอกลวง / โฆษณา', icon: 'shield.slash' },
  { id: 'violence', label: 'ความรุนแรง / สิ่งผิดกฎหมาย', icon: 'flame' },
  { id: 'other', label: 'พฤติกรรมไม่เหมาะสมอื่นๆ', icon: 'ellipsis.circle' },
];

export default function ReportModal({
  isOpen,
  onClose,
  onSubmit,
  targetName = 'ผู้ใช้นี้',
  isMessageReport = false,
  colors = {},
}) {
  const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0].id);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();

  const palette = {
    card: colors.card || '#1A1E26',
    canvas: colors.canvas || '#13161C',
    ink: colors.ink || '#FFFFFF',
    inkMuted: colors.inkMuted || '#8F9CAE',
    line: colors.line || 'rgba(255,255,255,0.12)',
    primary: colors.primary || '#EE6B5D',
    danger: '#FF4B4B',
  };

  const handleClose = () => {
    if (submitting || submitLock.current) return;
    setDetails('');
    setSelectedReason(REPORT_REASONS[0].id);
    onClose?.();
  };

  const handleSubmit = async () => {
    if (submitLock.current) return;
    if (!selectedReason) {
      showAlert('กรุณาเลือกเหตุผล', 'โปรดระบุเหตุผลในการรายงาน', { tone: 'warning' });
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      await onSubmit?.({
        reason: selectedReason,
        details: details.trim(),
      });
      setDetails('');
      setSelectedReason(REPORT_REASONS[0].id);
      onClose?.();
      showAlert(
        'รายงานเรียบร้อยแล้ว',
        'ขอบคุณสำหรับการรายงาน เราจะตรวจสอบเนื้อหาและดำเนินการตามมาตรฐานความปลอดภัยโดยเร็วที่สุด',
        { tone: 'success' }
      );
    } catch (err) {
      showAlert('ส่งรายงานไม่สำเร็จ', err.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={isOpen}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable onPress={handleClose} style={StyleSheet.absoluteFill} />
        
        <NativeCard style={[styles.card, glass
          ? { backgroundColor: 'transparent', borderColor: 'transparent' }
          : { backgroundColor: palette.card, borderColor: palette.line }]}>
          <GlassBackground style={{ borderRadius: 24 }} tintColor={glassTint} />
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(255, 75, 75, 0.15)' }]}>
              <FeatureIcon color={palette.danger} name="exclamationmark.bubble.fill" size={20} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: palette.ink }]}>
                {isMessageReport ? 'รายงานข้อความ/รูปภาพ' : `รายงาน ${targetName}`}
              </Text>
              <Text style={[styles.subtitle, { color: palette.inkMuted }]}>
                รายงานจะถูกส่งให้ผู้ดูแลระบบตรวจสอบโดยรักษาข้อมูลเป็นความลับ
              </Text>
            </View>
            <GlassIconButton
              accessibilityLabel="ปิด"
              fallbackBackgroundColor="transparent"
              hitSlop={10}
              icon="xmark"
              iconColor={palette.inkMuted}
              iconSize={16}
              onPress={handleClose}
              size={44}
            />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.scroll}>
            {/* Reason Selection */}
            <Text style={[styles.sectionLabel, { color: palette.ink }]}>เลือกเหตุผลในการรายงาน</Text>
            <View style={styles.reasonList}>
              {REPORT_REASONS.map((item) => {
                const isSelected = selectedReason === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityState={{ checked: isSelected, disabled: submitting }}
                    disabled={submitting}
                    onPress={() => setSelectedReason(item.id)}
                    style={({ pressed }) => [
                      styles.reasonItem,
                      { backgroundColor: palette.canvas, borderColor: isSelected ? palette.danger : palette.line },
                      isSelected && styles.reasonItemSelected,
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <View style={[styles.radio, isSelected && { borderColor: palette.danger }]}>
                      {isSelected ? <View style={[styles.radioInner, { backgroundColor: palette.danger }]} /> : null}
                    </View>
                    <Text style={[styles.reasonText, { color: palette.ink }, isSelected && { fontWeight: '700' }]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Additional Details */}
            <Text style={[styles.sectionLabel, { color: palette.ink, marginTop: 14 }]}>รายละเอียดเพิ่มเติม (ถ้ามี)</Text>
            <TextInput
              accessibilityLabel="รายละเอียดเพิ่มเติมในการรายงาน"
              editable={!submitting}
              maxLength={500}
              multiline
              numberOfLines={3}
              onChangeText={setDetails}
              placeholder="ระบุรายละเอียดเพิ่มเติมเพื่อช่วยในการตรวจสอบ..."
              placeholderTextColor={palette.inkMuted}
              style={[
                styles.textArea,
                { backgroundColor: palette.canvas, borderColor: palette.line, color: palette.ink },
              ]}
              value={details}
            />

            {/* Safety policy note */}
            <Text style={[styles.policyNotice, { color: palette.inkMuted }]}>
              ทีมงานจะตรวจสอบรายงานตามนโยบายความปลอดภัย หากไม่ต้องการพบหรือสนทนากับผู้ใช้นี้ คุณสามารถบล็อกผู้ใช้ได้
            </Text>
          </ScrollView>

          {/* Actions */}
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ยกเลิกการรายงาน"
              disabled={submitting}
              onPress={handleClose}
              style={({ pressed }) => [styles.cancelBtn, { borderColor: palette.line }, pressed && { opacity: 0.75 }]}
            >
              <Text style={[styles.cancelBtnText, { color: palette.inkMuted }]}>ยกเลิก</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={submitting ? 'กำลังส่งรายงาน' : 'ส่งรายงาน'}
              accessibilityState={{ busy: submitting, disabled: submitting }}
              disabled={submitting}
              onPress={handleSubmit}
              style={({ pressed }) => [styles.submitBtn, { backgroundColor: palette.primary }, pressed && { opacity: 0.8 }]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>ส่งรายงาน</Text>
              )}
            </Pressable>
          </View>
        </NativeCard>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    elevation: 10,
    maxHeight: '85%',
    maxWidth: 420,
    paddingHorizontal: 20,
    paddingVertical: 18,
    width: '100%',
    zIndex: 10,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 14,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  policyNotice: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  radio: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 9,
    borderWidth: 1.8,
    height: 18,
    justifyContent: 'center',
    marginRight: 10,
    width: 18,
  },
  radioInner: {
    borderRadius: 4.5,
    height: 9,
    width: 9,
  },
  reasonItem: {
    minHeight: 48,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reasonItemSelected: {
    borderWidth: 1.5,
  },
  reasonList: {
    marginTop: 8,
  },
  reasonText: {
    flex: 1,
    fontSize: 14,
  },
  scroll: {
    maxHeight: 380,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  submitBtn: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  textArea: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 13.5,
    lineHeight: 18,
    marginTop: 8,
    minHeight: 70,
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 2,
  },
});
