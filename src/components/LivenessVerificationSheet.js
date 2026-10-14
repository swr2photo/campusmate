import Text, { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import { FACE_CONSENT_VERSION, getPhotoVerification } from '../services/photoVerificationService';
import { useTheme } from '../theme';

// Liveness check backed by the Rust server: the server alone decides, this
// screen only collects consent, starts the native AWS camera and shows the
// saved decision. It never shows scores and never sets a badge itself.

const STAGES = {
  creating: 'กำลังเตรียมการตรวจ',
  capturing: 'ทำตามคำแนะนำบนหน้าจอกล้อง',
  checking: 'กำลังรอผลจากเซิร์ฟเวอร์',
};

const STEPS = [
  ['1', 'วิดีโอสั้นจากกล้องหน้า', 'ส่งตรงไปยัง Amazon Rekognition เพื่อตรวจว่ามีคนจริงอยู่หน้ากล้อง'],
  ['2', 'เทียบกับรูปโปรไฟล์หลัก', 'เซิร์ฟเวอร์เปรียบเทียบภาพจากการตรวจกับสำเนารูปหลักของคุณ แอปไม่ได้รับคะแนนหรือภาพใด'],
  ['3', 'ลบภาพเมื่อได้ผล', 'ภาพถูกลบทันทีเมื่อตัดสินผล หรือภายใน 14 วันหากต้องให้เจ้าหน้าที่ตรวจ'],
];

const ALTERNATIVES = [
  ['PHOTOSENSITIVITY', 'ไวต่อแสงและตรวจแบบไม่มีแสงกะพริบไม่ได้'],
  ['CAMERA_UNAVAILABLE', 'อุปกรณ์ไม่มีกล้องหน้าที่ใช้งานได้'],
  ['ACCESSIBILITY', 'ข้อจำกัดด้านการเข้าถึงอื่น'],
  ['OTHER', 'เหตุผลอื่น'],
];

// Reasons where a person may reasonably believe the check got it wrong.
const APPEALABLE = ['FACE_NOT_MATCHED', 'LIVENESS_NOT_CONFIRMED', 'REFERENCE_IMAGE_MISSING'];

function formatDate(iso) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
}

export default function LivenessVerificationSheet({ visible, onClose, onSuccess }) {
  const { colors, isDark } = useTheme();
  const canvas = isDark ? '#101820' : '#F7F7F8';
  const card = isDark ? '#1B2735' : '#FFFFFF';
  const ink = isDark ? '#F1F5FA' : '#25272B';
  const muted = isDark ? '#B3C2D4' : '#6B7078';
  const soft = isDark ? '#203A59' : '#EEF2F7';

  const [step, setStep] = useState('consent'); // consent | running | result | alternative
  const [consent, setConsent] = useState(false);
  const [noFlash, setNoFlash] = useState(false);
  const [stage, setStage] = useState('creating');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!visible) return undefined;
    const current = ++generation.current;
    setStep('consent');
    setConsent(false);
    setResult(null);
    setNotice('');
    const flow = getPhotoVerification();
    flow.status()
      .then((value) => {
        if (generation.current !== current) return;
        setStatus(value);
        // A decision made while the app was closed still reaches the profile.
        if (value.status === 'VERIFIED') flow.syncBadge();
      })
      .catch(() => {});
    return () => { generation.current += 1; };
  }, [visible]);

  const close = useCallback(() => {
    if (step === 'running') return; // The native camera owns the screen until it returns.
    generation.current += 1;
    onClose?.();
  }, [onClose, step]);

  const start = async () => {
    if (!consent || step === 'running') return;
    const current = ++generation.current;
    setStep('running');
    setStage('creating');
    const outcome = await getPhotoVerification().run({
      consent: true,
      noFlash,
      onStage: (value) => { if (generation.current === current) setStage(value); },
    });
    if (generation.current !== current) return;
    setResult(outcome);
    setStep('result');
    if (outcome.status === 'VERIFIED') onSuccess?.(outcome);
  };

  const appeal = async () => {
    if (busy || !result?.verificationId) return;
    setBusy(true);
    const sent = await getPhotoVerification().appeal(result.verificationId);
    setBusy(false);
    setNotice(sent.ok ? 'ส่งคำขอให้เจ้าหน้าที่ทบทวนแล้ว ผลจะแสดงในแอป' : sent.message);
  };

  const submitAlternative = async () => {
    if (busy || !reason) return;
    setBusy(true);
    const sent = await getPhotoVerification().requestAlternative({ reason, note });
    setBusy(false);
    if (sent.ok) {
      setStatus((value) => ({ ...(value || {}), alternativeRequest: 'OPEN' }));
      setNotice('ส่งคำขอแล้ว เจ้าหน้าที่จะติดต่อผ่านแอปเพื่อหาวิธีที่เหมาะสม');
      setStep('consent');
    } else {
      setNotice(sent.message);
    }
  };

  const deleteData = () => {
    Alert.alert(
      'ลบข้อมูลการยืนยันใบหน้า',
      'เครื่องหมายยืนยันจะถูกนำออก และภาพที่เก็บไว้เพื่อการตรวจจะถูกลบ คุณยืนยันใหม่ได้ภายหลัง',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบข้อมูล',
          style: 'destructive',
          onPress: async () => {
            const done = await getPhotoVerification().deleteVerification();
            setNotice(done.ok ? 'ลบข้อมูลการยืนยันแล้ว' : done.message);
            if (done.ok) setStatus((value) => ({ ...(value || {}), status: 'REVOKED', badge: null, reviewPending: false }));
          },
        },
      ],
    );
  };

  if (!visible) return null;

  const outcome = result?.status;
  const verified = outcome === 'VERIFIED';
  const review = outcome === 'REVIEW_REQUIRED';
  const title = step === 'alternative' ? 'ขอวิธียืนยันอื่น'
    : step === 'running' ? 'กำลังยืนยันใบหน้า'
      : step === 'result' ? (verified ? 'ยืนยันใบหน้าสำเร็จ' : review ? 'รอเจ้าหน้าที่ตรวจสอบ' : 'ยังยืนยันไม่ได้')
        : 'ยืนยันว่าเป็นคุณจริง';
  const icon = step === 'result' ? (verified ? 'checkmark.seal.fill' : review ? 'clock.fill' : 'exclamationmark.triangle.fill') : 'lock.shield.fill';
  const graceDate = formatDate(status?.legacyGraceUntil);
  const hasData = status && (status.badge || status.reviewPending || status.status === 'REVIEW_REQUIRED');

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={close}>
      <SafeAreaView style={[styles.page, { backgroundColor: canvas }]}>
        <View style={styles.nav}>
          <Text style={[styles.navTitle, { color: ink }]}>การยืนยันใบหน้า</Text>
          {step !== 'running' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="ปิดการยืนยันใบหน้า" onPress={close} style={[styles.close, { backgroundColor: card }]}>
              <FeatureIcon name="xmark" size={18} color={ink} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={[styles.badge, { backgroundColor: soft }]}>
              {step === 'running' ? <ActivityIndicator color="#2869C7" size="large" />
                : <FeatureIcon name={icon} size={44} color={step === 'result' && !verified && !review ? '#E27060' : '#2869C7'} />}
            </View>
            <Text accessibilityRole="header" style={[styles.title, { color: ink }]}>{title}</Text>
            <Text accessibilityLiveRegion="polite" style={[styles.description, { color: muted }]}>
              {step === 'running' ? STAGES[stage]
                : step === 'result' ? result?.message
                  : step === 'alternative' ? 'สำหรับคนที่ใช้การตรวจด้วยกล้องไม่ได้ เจ้าหน้าที่จะช่วยหาวิธีที่เหมาะสม'
                    : 'ตรวจว่ามีคนจริงอยู่หน้ากล้องและตรงกับรูปโปรไฟล์หลัก เพื่อรับเครื่องหมายยืนยันรูป'}
            </Text>
          </View>

          {notice ? (
            <View accessibilityRole="alert" style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
              <Text style={[styles.copy, { color: ink }]}>{notice}</Text>
            </View>
          ) : null}

          {step === 'consent' && status?.needsReverification ? (
            <View style={[styles.panel, { backgroundColor: card, borderColor: '#E0A100' }]}>
              <Text style={[styles.sectionTitle, { color: ink }]}>กรุณายืนยันใหม่</Text>
              <Text style={[styles.copy, { color: muted }]}>
                เครื่องหมายเดิมของคุณมาจากการเทียบรูปถ่ายแบบเก่าซึ่งไม่ได้ตรวจว่าเป็นคนจริง
                {graceDate ? ` เครื่องหมายเดิมจะถูกนำออกหลัง ${graceDate}` : ''}
              </Text>
            </View>
          ) : null}

          {step === 'consent' ? (
            <>
              <View style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
                <Text style={[styles.sectionTitle, { color: ink }]}>สิ่งที่จะเกิดขึ้น</Text>
                {STEPS.map(([number, heading, copy]) => (
                  <View key={number} style={styles.row}>
                    <View style={[styles.number, { backgroundColor: soft }]}><Text style={styles.numberText}>{number}</Text></View>
                    <View style={styles.body}>
                      <Text style={[styles.rowTitle, { color: ink }]}>{heading}</Text>
                      <Text style={[styles.copy, { color: muted }]}>{copy}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View accessibilityRole="alert" style={[styles.panel, { backgroundColor: card, borderColor: '#E27060' }]}>
                <Text style={[styles.sectionTitle, { color: ink }]}>คำเตือนเรื่องแสงกะพริบ</Text>
                <Text style={[styles.copy, { color: muted }]}>
                  การตรวจแบบปกติจะแสดงแสงสีกะพริบบนหน้าจอ หากคุณเป็นโรคลมชักที่ไวต่อแสง หรือไม่สบายเมื่อเห็นแสงกะพริบ ให้เปิดการตรวจแบบไม่มีแสงกะพริบ
                </Text>
                <View style={styles.switchRow}>
                  <Text style={[styles.rowTitle, styles.body, { color: ink }]}>ตรวจแบบไม่มีแสงกะพริบ</Text>
                  <Switch
                    accessibilityLabel="ตรวจแบบไม่มีแสงกะพริบ"
                    value={noFlash}
                    onValueChange={setNoFlash}
                    trackColor={{ true: '#2869C7' }}
                  />
                </View>
                {noFlash ? <Text style={[styles.copy, { color: muted }]}>ผลของการตรวจแบบนี้จะให้เจ้าหน้าที่ตรวจสอบก่อนให้เครื่องหมาย</Text> : null}
              </View>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consent }}
                onPress={() => setConsent((value) => !value)}
                style={styles.consent}
              >
                <View style={[styles.checkbox, { borderColor: consent ? '#2869C7' : muted, backgroundColor: consent ? '#2869C7' : 'transparent' }]}>
                  {consent ? <FeatureIcon name="checkmark" size={14} color="#FFFFFF" /> : null}
                </View>
                <Text style={[styles.copy, styles.body, { color: ink }]}>
                  ฉันยินยอมให้ประมวลผลภาพใบหน้าเพื่อยืนยันรูปโปรไฟล์ตามที่อธิบายไว้ (ฉบับ {FACE_CONSENT_VERSION})
                </Text>
              </Pressable>

              <View style={styles.note}>
                <FeatureIcon name="info.circle" size={17} color={muted} />
                <Text style={[styles.copy, styles.body, { color: muted }]}>
                  เครื่องหมายนี้ยืนยันรูปโปรไฟล์เท่านั้น ไม่ใช่การยืนยันตัวตนหรือสถานะนักศึกษา และไม่บังคับ คุณใช้แอปต่อได้ตามปกติ
                </Text>
              </View>
            </>
          ) : null}

          {step === 'alternative' ? (
            <View style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: ink }]}>เหตุผล</Text>
              {ALTERNATIVES.map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === value }}
                  onPress={() => setReason(value)}
                  style={styles.consent}
                >
                  <View style={[styles.radio, { borderColor: reason === value ? '#2869C7' : muted }]}>
                    {reason === value ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={[styles.copy, styles.body, { color: ink }]}>{label}</Text>
                </Pressable>
              ))}
              <TextInput
                accessibilityLabel="รายละเอียดเพิ่มเติม"
                placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
                placeholderTextColor={muted}
                value={note}
                onChangeText={setNote}
                maxLength={500}
                multiline
                style={[styles.input, { color: ink, borderColor: colors.line, backgroundColor: canvas }]}
              />
              <Text style={[styles.copy, { color: muted }]}>คำขอนี้ไม่ได้ให้เครื่องหมายยืนยันโดยอัตโนมัติ</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.actions, { backgroundColor: canvas, borderTopColor: colors.line }]}>
          {step === 'consent' ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !consent }}
                disabled={!consent}
                onPress={start}
                style={({ pressed }) => [styles.primary, { opacity: !consent ? 0.45 : pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.primaryText}>{noFlash ? 'เริ่มตรวจแบบไม่มีแสงกะพริบ' : 'เริ่มตรวจ'}</Text>
              </Pressable>
              {status?.alternativeRequest !== 'OPEN' ? (
                <Pressable accessibilityRole="button" onPress={() => { setNotice(''); setStep('alternative'); }} style={styles.secondary}>
                  <Text style={[styles.secondaryText, { color: muted }]}>ตรวจด้วยกล้องไม่ได้? ขอวิธีอื่น</Text>
                </Pressable>
              ) : null}
              {hasData ? (
                <Pressable accessibilityRole="button" onPress={deleteData} style={styles.secondary}>
                  <Text style={[styles.secondaryText, { color: '#C2412D' }]}>ลบข้อมูลการยืนยันของฉัน</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {step === 'running' ? (
            <View style={styles.wait}><ActivityIndicator color="#2869C7" /><Text style={[styles.waitText, { color: ink }]}>{STAGES[stage]}</Text></View>
          ) : null}
          {step === 'result' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={verified || review ? close : () => { setNotice(''); setStep('consent'); }}
                style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.primaryText}>{verified || review ? 'เสร็จสิ้น' : 'ลองใหม่'}</Text>
              </Pressable>
              {!verified && !review && result?.verificationId && APPEALABLE.includes(result.reason) ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={appeal} style={styles.secondary}>
                  <Text style={[styles.secondaryText, { color: muted }]}>ขอให้เจ้าหน้าที่ทบทวนผล</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {step === 'alternative' ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !reason || busy }}
                disabled={!reason || busy}
                onPress={submitAlternative}
                style={({ pressed }) => [styles.primary, { opacity: !reason || busy ? 0.45 : pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.primaryText}>ส่งคำขอ</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setStep('consent')} style={styles.secondary}>
                <Text style={[styles.secondaryText, { color: muted }]}>ย้อนกลับ</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 28 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12, minHeight: 68 },
  navTitle: { fontSize: 16, fontWeight: '700' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, width: '100%', maxWidth: 520, alignSelf: 'center', gap: 22 },
  hero: { alignItems: 'center', gap: 14 },
  badge: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 25, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  description: { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  panel: { padding: 20, borderWidth: 1, borderRadius: 22, gap: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12 },
  body: { flex: 1 },
  number: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  numberText: { color: '#2869C7', fontWeight: '800', fontSize: 14 },
  rowTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 2 },
  copy: { fontSize: 14, lineHeight: 22 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2869C7' },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 14, padding: 12, textAlignVertical: 'top' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  actions: { borderTopWidth: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12 },
  primary: { minHeight: 52, borderRadius: 16, backgroundColor: '#2869C7', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  secondaryText: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  wait: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  waitText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
});
