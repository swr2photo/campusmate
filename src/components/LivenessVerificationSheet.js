import { Pressable } from './NativePressable';
import NativeCard from './NativeCard';
import Text, { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';
import { BottomSheet, RNHostView } from '@expo/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import FaceGestureStage from './FaceGestureStage';
import { getPhotoVerification } from '../services/photoVerificationService';
import { resendEmailVerification } from '../services/authService';
import { messageFor } from '../services/photoVerificationProtocol.mjs';
import { GlassIconButton } from './LiquidGlassSurface';
import NativeButton from './NativeButton';
import { CheckingScene, FaceScanScene, Mascot, ResultScene } from './illustrations';
import { useResponsiveSize } from '../hooks/useResponsiveSize';
import { useTheme } from '../theme';

// Liveness check backed by the Rust server: the server alone decides, this
// screen only collects consent, runs the Face ID-style gestures and the
// native AWS camera, and shows the saved decision. It never shows scores and
// never sets a badge itself.

const STAGES = {
  creating: ['กำลังเตรียมกล้องให้นะ', 'ใช้เวลาแค่ไม่กี่วินาที'],
  gestures: ['ทำท่าทางตามน้องมาสคอต', 'มองตรง หันซ้าย หันขวา ก้มหน้า และกะพริบตา'],
  capturing: ['ทำตามคำแนะนำบนหน้าจอกล้อง', 'อยู่ในที่สว่าง และให้ใบหน้าอยู่กลางกรอบ'],
  checking: ['กำลังตรวจสอบให้อยู่นะ', 'ปกติใช้เวลาไม่เกินครึ่งนาที อย่าเพิ่งปิดหน้านี้'],
};

const STEPS = [
  ['hand.wave.fill', 'ทำท่าตามมาสคอต', 'ภาพท่าทางไม่ถูกเก็บไว้'],
  ['camera.viewfinder', 'ตรวจว่าเป็นคนจริง', 'ด้วย Amazon Rekognition'],
  ['person.crop.square.fill', 'เทียบกับรูปหลัก', 'แอปไม่เห็นคะแนนใด ๆ'],
  ['trash.fill', 'ลบภาพเมื่อได้ผล', 'หรือภายใน 14 วัน'],
];

const ALTERNATIVES = [
  ['PHOTOSENSITIVITY', 'ไวต่อแสงและตรวจแบบไม่มีแสงกะพริบไม่ได้'],
  ['CAMERA_UNAVAILABLE', 'อุปกรณ์ไม่มีกล้องหน้าที่ใช้งานได้'],
  ['ACCESSIBILITY', 'ข้อจำกัดด้านการเข้าถึงอื่น'],
  ['OTHER', 'เหตุผลอื่น'],
];

// Reasons where a person may reasonably believe the check got it wrong.
const APPEALABLE = ['FACE_NOT_MATCHED', 'LIVENESS_NOT_CONFIRMED', 'REFERENCE_IMAGE_MISSING'];
// The check stopped before any face was looked at, so "didn't pass" would be
// wrong: say it could not start, and why.
const NOT_STARTED = new Set([
  'EMAIL_NOT_VERIFIED', 'CAMPUS_EMAIL_REQUIRED', 'unauthenticated', 'resource-exhausted', 'CONSENT_REQUIRED',
  'NATIVE_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'CAMERA_UNAVAILABLE', 'PHOTO_UPLOAD_FAILED',
]);
// The server only verifies faces for accounts with a confirmed campus email.
const EMAIL_GATES = ['EMAIL_NOT_VERIFIED', 'CAMPUS_EMAIL_REQUIRED'];

function formatDate(iso) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
}

/** `candidateAvatarUri`: the new main photo's URL, or a promise of it while it uploads. */
export default function LivenessVerificationSheet({ visible, onClose, onSuccess, candidateAvatarUri = null }) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const { gutter, font, illustration } = useResponsiveSize();
  const canvas = colors.canvas;
  const card = colors.card;
  const ink = colors.ink;
  const muted = colors.inkMuted;

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
  const [termsVisible, setTermsVisible] = useState(false);
  // While set, the Face ID-style gesture screen owns the modal.
  const [gestureRun, setGestureRun] = useState(null);
  const generation = useRef(0);
  const pendingGesture = useRef(null);
  const attempt = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    const current = ++generation.current;
    setStep('consent');
    setConsent(false);
    setResult(null);
    setGestureRun(null);
    setNotice('');
    setTermsVisible(false);
    const flow = getPhotoVerification();
    flow.status()
      .then((value) => {
        if (generation.current !== current) return;
        setStatus(value);
        // A decision made while the app was closed still reaches the profile.
        if (value.status === 'VERIFIED') flow.syncBadge();
      })
      .catch(() => {});
    return () => {
      generation.current += 1;
      attempt.current?.abort();
      attempt.current = null;
      pendingGesture.current?.('CANCELLED');
      pendingGesture.current = null;
    };
  }, [candidateAvatarUri, visible]);

  const close = useCallback(() => {
    generation.current += 1;
    attempt.current?.abort();
    attempt.current = null;
    pendingGesture.current?.('CANCELLED');
    setGestureRun(null);
    setTermsVisible(false);
    onClose?.();
  }, [onClose]);

  // The flow hands over the server's gesture order; the stage resolves once
  // the server passed the last step, or rejects with a safe reason code.
  const performGestures = useCallback(({ gestures, expiresAt, submit }, current) => {
    return new Promise((resolve, reject) => {
      if (generation.current !== current) {
        reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }));
        return;
      }
      let settled = false;
      const settle = (code) => {
        if (settled) return;
        settled = true;
        if (pendingGesture.current === settle) pendingGesture.current = null;
        if (generation.current === current) setGestureRun(null);
        if (code) reject(Object.assign(new Error(code), { code }));
        else resolve({ completed: true });
      };
      pendingGesture.current = settle;
      setGestureRun({
        gestures,
        expiresAt,
        submit,
        done: () => settle(),
        fail: settle,
      });
    });
  }, []);

  const start = async () => {
    if (!consent || step === 'running' || attempt.current) return;
    const current = ++generation.current;
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setStep('running');
    setStage('creating');
    // A new main photo may still be uploading; it started when it was chosen.
    let candidate;
    try {
      candidate = await candidateAvatarUri;
    } catch {
      if (generation.current !== current) return;
      attempt.current = null;
      setResult({ status: 'FAILED', reason: 'PHOTO_UPLOAD_FAILED' });
      setStep('result');
      return;
    }
    if (generation.current !== current) return;
    const outcome = await getPhotoVerification().run({
      consent: true,
      noFlash,
      candidateAvatarUri: candidate,
      signal: controller.signal,
      performGestures: (options) => performGestures(options, current),
      // Metro / Expo Go testing: gestures work, the AWS step needs a native build.
      previewWithoutLiveness: __DEV__,
      onStage: (value) => { if (generation.current === current) setStage(value); },
    });
    if (generation.current !== current) return;
    attempt.current = null;
    // Diagnose by safe reason code only: no camera frame, credentials or
    // raw provider response belongs in the device log.
    if (__DEV__ && /^[A-Z_]{1,60}$/.test(outcome.reason || '')) console.info('[PhotoVerification]', outcome.reason);
    setGestureRun(null);
    setResult(outcome);
    setStep('result');
    if (outcome.status === 'VERIFIED') {
      try { await onSuccess?.(outcome); }
      catch { setNotice('ยืนยันแล้ว แต่โหลดโปรไฟล์ใหม่ไม่สำเร็จ กรุณาลองเปิดหน้าโปรไฟล์อีกครั้ง'); }
    }
  };

  const resendEmail = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sent = await resendEmailVerification();
      setNotice(sent?.alreadyVerified
        ? 'อีเมลของคุณยืนยันแล้ว กด "ยืนยันอีเมลแล้ว ลองอีกครั้ง" ได้เลย'
        : 'ส่งอีเมลยืนยันแล้ว เปิดลิงก์ในอีเมลแล้วกลับมาลองอีกครั้ง');
    } catch (error) {
      setNotice(error?.message || 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusy(false);
    }
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
  const failed = step === 'result' && !verified && !review;
  const notStarted = failed && NOT_STARTED.has(result?.reason);
  const emailGate = failed && EMAIL_GATES.includes(result?.reason);
  const stageCopy = STAGES[stage] || STAGES.creating;
  const title = step === 'alternative' ? 'ขอวิธียืนยันอื่น'
    : step === 'running' ? stageCopy[0]
      : step === 'result' ? (verified ? 'ยืนยันใบหน้าสำเร็จแล้ว!' : review ? 'ส่งให้เจ้าหน้าที่ช่วยดูแล้ว'
        : emailGate ? 'ยืนยันอีเมลก่อนนะ' : notStarted ? 'ยังเริ่มตรวจใบหน้าไม่ได้' : 'ยังไม่ผ่าน ไม่เป็นไรนะ')
        : 'ยืนยันว่าเป็นคุณจริง';
  const description = step === 'running' ? stageCopy[1]
    : step === 'result' ? (verified ? result?.message : messageFor(result?.reason || outcome))
      : step === 'alternative' ? 'สำหรับคนที่ใช้การตรวจด้วยกล้องไม่ได้ เจ้าหน้าที่จะช่วยหาวิธีที่เหมาะกับคุณ'
        : 'ใช้เวลาไม่ถึง 1 นาที แล้วเพื่อน ๆ จะเห็นเครื่องหมายยืนยันบนรูปของคุณ';
  const graceDate = formatDate(status?.legacyGraceUntil);
  const hasData = status && (status.badge || status.reviewPending || status.status === 'REVIEW_REQUIRED');
  // One full-screen column: art and copy on top, details in the middle and
  // the actions at the bottom. Short screens or large text scroll the whole
  // page instead of splitting it into a scroller and a pinned footer.
  const heroArt = Math.round(Math.min(illustration.hero, Math.max(96, height * 0.17)));
  const bigArt = Math.round(Math.min(illustration.hero + 20, Math.max(120, height * 0.26)));
  const art = step === 'running' ? <CheckingScene size={bigArt} />
    : step === 'result' ? <ResultScene kind={verified ? 'success' : review ? 'review' : 'oops'} size={bigArt} />
      : step === 'alternative' ? <Mascot size={illustration.compact * 0.7} mood="calm" />
        : <FaceScanScene size={heroArt} />;
  const goAlternative = () => { setNotice(''); setStep('alternative'); };

  return (
    <Modal
      animationType="slide"
      presentationStyle="fullScreen"
      visible={visible}
      onRequestClose={termsVisible ? () => setTermsVisible(false) : close}
    >
      {gestureRun ? (
        <FaceGestureStage
          gestures={gestureRun.gestures}
          expiresAt={gestureRun.expiresAt}
          submit={gestureRun.submit}
          onDone={gestureRun.done}
          onFail={gestureRun.fail}
          onCancel={close}
        />
      ) : (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.page, { backgroundColor: canvas }]}>
        <ScrollView
          contentContainerStyle={[styles.screen, { paddingHorizontal: gutter }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <GlassIconButton
              accessibilityLabel="ปิดการยืนยันใบหน้า"
              fallbackBackgroundColor={card}
              icon="xmark"
              iconColor={ink}
              iconSize={16}
              onPress={close}
              size={44}
            />
          </View>

          <View style={[styles.hero, step === 'running' && styles.heroCentered]}>
            {/* The art is decorative; the title and description carry the state. */}
            {art}
            <Text accessibilityRole="header" style={[styles.title, { color: ink, fontSize: font.display }]}>{title}</Text>
            <Text accessibilityLiveRegion="polite" style={[styles.description, { color: muted }]}>{description}</Text>
          </View>

          {notice ? (
            <NativeCard accessibilityRole="alert" style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
              <Text style={[styles.copy, { color: ink }]}>{notice}</Text>
            </NativeCard>
          ) : null}

          {step === 'consent' && status?.needsReverification ? (
            <NativeCard style={[styles.panel, { backgroundColor: colors.amberSoft, borderWidth: 0 }]}>
              <Text style={[styles.sectionTitle, { color: ink }]}>ขอให้ยืนยันอีกครั้งนะ</Text>
              <Text style={[styles.copy, { color: muted }]}>
                เครื่องหมายเดิมมาจากการเทียบรูปแบบเก่าที่ไม่ได้ตรวจว่าเป็นคนจริง
                {graceDate ? ` และจะถูกนำออกหลัง ${graceDate}` : ''}
              </Text>
            </NativeCard>
          ) : null}

          {step === 'consent' ? (
            <>
              <View accessibilityRole="list" style={styles.stepGrid}>
                {STEPS.map(([stepIcon, heading, caption]) => (
                  <View key={heading} accessible accessibilityLabel={`${heading} ${caption}`} style={[styles.stepTile, { backgroundColor: card }]}>
                    <View style={[styles.stepIcon, { backgroundColor: colors.primarySoft }]}>
                      <FeatureIcon name={stepIcon} size={15} color={colors.accentText} />
                    </View>
                    <View style={styles.body}>
                      <Text numberOfLines={2} style={[styles.stepTitle, { color: ink }]}>{heading}</Text>
                      <Text numberOfLines={2} style={[styles.stepCaption, { color: muted }]}>{caption}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Photosensitivity warning and its opt-out in one row. */}
              <View style={[styles.flashRow, { backgroundColor: card }]}>
                <View style={[styles.stepIcon, { backgroundColor: colors.amberSoft }]}>
                  <FeatureIcon name="eye.slash.fill" size={15} color={colors.amber} />
                </View>
                <View style={styles.body}>
                  <Text style={[styles.stepTitle, { color: ink }]}>ตรวจแบบไม่มีแสงกะพริบ</Text>
                  <Text style={[styles.stepCaption, { color: muted }]}>
                    {noFlash ? 'เจ้าหน้าที่จะช่วยดูผลก่อนให้เครื่องหมาย' : 'การตรวจปกติมีแสงสีกะพริบ เปิดไว้หากคุณไวต่อแสง'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="ตรวจแบบไม่มีแสงกะพริบ"
                  ios_backgroundColor={colors.line}
                  trackColor={{ false: colors.line, true: colors.primary }}
                  thumbColor="#FFFFFF"
                  value={noFlash}
                  onValueChange={setNoFlash}
                />
              </View>
            </>
          ) : null}

          {failed ? (
            <NativeCard style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: ink }]}>เคล็ดลับให้ผ่านง่ายขึ้น</Text>
              {[
                ['sun.max.fill', 'อยู่ในที่สว่าง ให้แสงส่องที่หน้า'],
                ['eye.fill', 'ถอดแว่นกันแดด หมวก หรือหน้ากากก่อน'],
                ['iphone', 'ถือโทรศัพท์ระดับสายตา แล้วมองกล้องตรง ๆ'],
              ].map(([tipIcon, tip]) => (
                <View key={tip} style={styles.tipRow}>
                  <FeatureIcon name={tipIcon} size={18} color={colors.primary} />
                  <Text style={[styles.copy, styles.body, { color: ink }]}>{tip}</Text>
                </View>
              ))}
            </NativeCard>
          ) : null}

          {step === 'alternative' ? (
            <NativeCard style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: ink }]}>เหตุผล</Text>
              {ALTERNATIVES.map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === value }}
                  onPress={() => setReason(value)}
                  style={styles.consent}
                >
                  <View style={[styles.radio, { borderColor: reason === value ? colors.primary : muted }]}>
                    {reason === value ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
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
            </NativeCard>
          ) : null}

          {/* Pushes the actions to the bottom whenever the page is shorter than the screen. */}
          <View style={styles.spacer} />

          {step === 'consent' ? (
            <View style={styles.actions}>
              <Pressable accessibilityRole="checkbox" accessibilityLabel="ยินยอมให้ประมวลผลภาพใบหน้าเพื่อยืนยันรูปโปรไฟล์"
                accessibilityState={{ checked: consent }} onPress={() => setConsent((value) => !value)}
                style={[styles.consent, styles.consentRow, { backgroundColor: consent ? colors.primarySoft : card, borderColor: consent ? colors.primary : 'transparent' }]}>
                <View style={[styles.checkbox, { borderColor: consent ? colors.primary : muted, backgroundColor: consent ? colors.primary : 'transparent' }]}>
                  {consent ? <FeatureIcon name="checkmark" size={14} color="#FFFFFF" /> : null}
                </View>
                <Text style={[styles.copy, styles.body, { color: ink, fontWeight: '600' }]}>ฉันยินยอมให้ใช้ภาพใบหน้าเพื่อยืนยันรูปโปรไฟล์</Text>
              </Pressable>
              <NativeButton disabled={!consent} label={noFlash ? 'เริ่มตรวจแบบไม่มีแสงกะพริบ' : 'เริ่มตรวจ'} onPress={start}
                accessibilityLabel={consent ? 'เริ่มตรวจใบหน้า' : 'เริ่มตรวจใบหน้า กรุณาให้ความยินยอมก่อน'}
                variant="borderedProminent" color={colors.primary} foregroundColor="#FFFFFF" style={[styles.primary, { opacity: consent ? 1 : 0.5 }]} />
              <View style={styles.links}>
                <Pressable accessibilityRole="button" accessibilityLabel="อ่านรายละเอียดข้อตกลงการยืนยันรูป" onPress={() => setTermsVisible(true)} style={styles.link}>
                  <Text style={[styles.secondaryText, { color: colors.accentText, fontWeight: '700' }]}>อ่านรายละเอียด</Text>
                </Pressable>
                {status?.alternativeRequest !== 'OPEN' ? (
                  <Pressable accessibilityRole="button" onPress={goAlternative} style={styles.link}>
                    <Text style={[styles.secondaryText, { color: colors.accentText }]}>ใช้กล้องไม่ได้? ขอวิธีอื่น</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={[styles.legal, { color: muted }]}>ยืนยันเฉพาะรูปโปรไฟล์ ไม่ใช่การยืนยันตัวตน และไม่บังคับ</Text>
              {hasData ? (
                <Pressable accessibilityRole="button" onPress={deleteData} style={styles.link}>
                  <Text style={[styles.secondaryText, { color: colors.danger }]}>ลบข้อมูลการยืนยันของฉัน</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {step === 'result' ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={verified || review ? close : () => { setNotice(''); setStep('consent'); }}
                style={({ pressed }) => [styles.primary, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.primaryText}>{verified || review ? 'กลับไปที่โปรไฟล์' : emailGate ? 'ยืนยันอีเมลแล้ว ลองอีกครั้ง' : 'ลองอีกครั้ง'}</Text>
              </Pressable>
              {result?.reason === 'EMAIL_NOT_VERIFIED' ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={resendEmail} style={styles.link}>
                  <Text style={[styles.secondaryText, { color: colors.accentText }]}>{busy ? 'กำลังส่งอีเมล…' : 'ส่งอีเมลยืนยันอีกครั้ง'}</Text>
                </Pressable>
              ) : null}
              {!verified && !review && !emailGate ? (
                <View style={styles.links}>
                  <Pressable accessibilityRole="button" onPress={goAlternative} style={styles.link}>
                    <Text style={[styles.secondaryText, { color: colors.accentText }]}>ใช้วิธีอื่น</Text>
                  </Pressable>
                  {result?.verificationId && APPEALABLE.includes(result.reason) ? (
                    <Pressable accessibilityRole="button" disabled={busy} onPress={appeal} style={styles.link}>
                      <Text style={[styles.secondaryText, { color: muted }]}>ขอให้เจ้าหน้าที่ทบทวนผล</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {step === 'alternative' ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !reason || busy }}
                disabled={!reason || busy}
                onPress={submitAlternative}
                style={({ pressed }) => [styles.primary, { backgroundColor: colors.primary, opacity: !reason || busy ? 0.45 : pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.primaryText}>ส่งคำขอ</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setStep('consent')} style={styles.link}>
                <Text style={[styles.secondaryText, { color: muted }]}>ย้อนกลับ</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
        <BottomSheet isPresented={termsVisible} onDismiss={() => setTermsVisible(false)} snapPoints={['full']} containerColor={canvas} contentPadding={0}>
          <RNHostView style={{ height: Math.max(240, height * 0.78) }}>
            <View style={[styles.terms, { backgroundColor: canvas }]}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: ink }]}>รายละเอียดข้อตกลงการยืนยันรูป</Text>
              <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
                <Text style={[styles.copy, { color: ink }]}>คุณยินยอมให้ใช้ภาพใบหน้าและวิดีโอจากกล้องเพื่อเทียบกับรูปโปรไฟล์หลักและตรวจว่าเป็นคนจริง โดยส่งไปยัง Amazon Rekognition เพื่อประมวลผล</Text>
                <Text style={[styles.copy, { color: ink }]}>ภาพท่าทางไม่ถูกเก็บไว้ ภาพจากการตรวจคนจริงถูกลบเมื่อได้ผล หรือเก็บไว้ไม่เกิน 14 วันหากต้องให้เจ้าหน้าที่ทบทวน คุณขอลบข้อมูลการยืนยันได้</Text>
                <Text style={[styles.copy, { color: ink }]}>เครื่องหมายนี้ยืนยันรูปโปรไฟล์เท่านั้น ไม่ใช่การยืนยันตัวตนตามกฎหมายหรือสถานะนักศึกษา การยืนยันไม่บังคับ คุณเลือกไว้ภายหลังหรือขอวิธีอื่นได้</Text>
              </ScrollView>
              <NativeButton label="ปิดรายละเอียด" onPress={() => setTermsVisible(false)} color={colors.primary} foregroundColor="#FFFFFF" variant="borderedProminent" style={styles.primary} />
            </View>
          </RNHostView>
        </BottomSheet>
      </SafeAreaView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  screen: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingBottom: 12, gap: 14 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 4 },
  hero: { alignItems: 'center', gap: 8, marginTop: -8 },
  heroCentered: { flexGrow: 1, justifyContent: 'center', marginTop: 0 },
  title: { lineHeight: 36, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  description: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 340 },
  panel: { padding: 18, borderWidth: 1, borderRadius: 22, borderCurve: 'continuous', gap: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  body: { flex: 1, minWidth: 0 },
  stepGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stepTile: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 18, borderCurve: 'continuous' },
  stepIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  stepCaption: { fontSize: 12, lineHeight: 16 },
  flashRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 18, borderCurve: 'continuous' },
  copy: { fontSize: 14, lineHeight: 22 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6 },
  consentRow: { borderRadius: 16, borderCurve: 'continuous', borderWidth: 1.5, paddingHorizontal: 14 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 14, padding: 12, textAlignVertical: 'top' },
  spacer: { flexGrow: 1, minHeight: 4 },
  actions: { gap: 8 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 18 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  legal: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: -6 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  terms: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 16 },
  primary: { minHeight: 52, borderRadius: 26, borderCurve: 'continuous', backgroundColor: '#2869C7', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  secondaryText: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
});
