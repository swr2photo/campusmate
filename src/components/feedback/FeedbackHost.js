import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInRight, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { usePathname } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Pressable } from '../NativePressable';
import Text, { AppTextInput as TextInput } from '../AppText';
import FeatureIcon from '../FeatureIcon';
import SlideUpSheet from '../sheets/SlideUpSheet';
import { PressScale } from '../activities/motion';
import { useAuth } from '../../context/AuthContext';
import { useLaunchFinished } from '../launch/launchState';
import useShakeGesture, { shakeSupported } from '../../hooks/useShakeGesture';
import { feedbackContext, isShakeEnabled, setFeedbackOpener, setShakeEnabled, submitAppFeedback } from '../../services/feedbackService';
import { useTheme } from '../../theme';

let captureScreen = null;
try {
  ({ captureScreen } = require('react-native-view-shot'));
} catch {
  captureScreen = null;
}

const MESSAGE_MIN = 5;
const MESSAGE_MAX = 2000;
const SHOT_WIDTH = 720;
const KINDS = {
  bug: {
    icon: 'ladybug.fill', color: '#E5484D', title: 'รายงานบัคหรือปัญหา', subtitle: 'แอปค้าง ปุ่มกดไม่ได้ หรือแสดงผลผิด',
    placeholder: 'เล่าสิ่งที่เกิดขึ้น เช่น กดส่งรูปในแชตแล้วหมุนไม่หยุด และทำอะไรก่อนหน้านั้น',
  },
  feedback: {
    icon: 'lightbulb.fill', color: '#D8901B', title: 'ส่งข้อเสนอแนะ', subtitle: 'ไอเดียหรือสิ่งที่อยากให้ปรับปรุง',
    placeholder: 'อยากให้ CampusMate มีอะไรเพิ่ม หรือปรับตรงไหนให้ใช้ง่ายขึ้น',
  },
};

async function removeFile(uri) {
  if (uri && FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory)) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/** The screen as it was when the sheet was asked for, small enough to send. */
async function captureCurrentScreen() {
  if (!captureScreen) return null;
  let raw = null;
  try {
    raw = await captureScreen({ format: 'jpg', quality: 0.8, result: 'tmpfile' });
    const small = await ImageManipulator.manipulateAsync(raw, [{ resize: { width: SHOT_WIDTH } }], {
      compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true,
    });
    return small?.base64 ? { uri: small.uri, base64: small.base64 } : null;
  } catch {
    return null;
  } finally {
    await removeFile(raw);
  }
}

/**
 * Shake (or the settings entry) opens a sheet for bug reports and
 * suggestions. Mounted once at the root, signed in only.
 */
export default function FeedbackHost() {
  const { user } = useAuth();
  const pathname = usePathname();
  const launchDone = useLaunchFinished();
  const [shakeOn, setShakeOn] = useState(true);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(null);
  const [shot, setShot] = useState(null);
  const opening = useRef(false);

  useEffect(() => { void isShakeEnabled().then(setShakeOn); }, []);

  const show = useCallback(async (nextKind = null) => {
    if (open || opening.current) return;
    opening.current = true;
    try {
      // Taken before the sheet covers the screen; sent only if chosen.
      setShot(await captureCurrentScreen());
      setKind(nextKind);
      setOpen(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } finally {
      opening.current = false;
    }
  }, [open]);

  useEffect(() => {
    setFeedbackOpener(user ? show : null);
    return () => setFeedbackOpener(null);
  }, [show, user]);

  useShakeGesture(() => { void show(null); }, shakeOn && launchDone && !open && Boolean(user));

  const close = useCallback(() => {
    setOpen(false);
    const uri = shot?.uri;
    // Let the sheet slide away before forgetting what it shows.
    setTimeout(() => { setShot(null); setKind(null); void removeFile(uri); }, 300);
  }, [shot?.uri]);

  if (!user) return null;
  return (
    <SlideUpSheet accessibilityLabel="รายงานปัญหาหรือส่งข้อเสนอแนะ" onClose={close} visible={open}>
      <FeedbackSheet
        kind={kind}
        onClose={close}
        onKind={setKind}
        onShakeChange={(value) => { setShakeOn(value); void setShakeEnabled(value); }}
        screen={pathname}
        shakeOn={shakeOn}
        shot={shot}
      />
    </SlideUpSheet>
  );
}

function FeedbackSheet({ kind, onKind, onClose, shot, screen, shakeOn, onShakeChange }) {
  const [sent, setSent] = useState(false);
  useEffect(() => { if (!kind) setSent(false); }, [kind]);
  if (sent) return <SentView onClose={onClose} />;
  if (!kind) return <MenuView onKind={onKind} onShakeChange={onShakeChange} shakeOn={shakeOn} />;
  return <FormView kind={kind} onBack={() => onKind(null)} onSent={() => setSent(true)} screen={screen} shot={shot} />;
}

function MenuView({ onKind, shakeOn, onShakeChange }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} style={styles.body}>
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: colors.primarySoft }]}>
          <FeatureIcon color={colors.primary} name="iphone.radiowaves.left.and.right" size={22} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>มีอะไรให้เราช่วยไหม?</Text>
        <Text style={[styles.subtitle, { color: colors.inkMuted }]}>แจ้งปัญหาหรือบอกไอเดียให้ทีม CampusMate</Text>
      </View>
      {Object.entries(KINDS).map(([id, item], index) => (
        <Animated.View entering={reduceMotion ? undefined : FadeInDown.delay(60 + index * 60).duration(320)} key={id}>
          <PressScale>
            <Pressable
              accessibilityHint={item.subtitle}
              accessibilityLabel={item.title}
              accessibilityRole="button"
              onPress={() => onKind(id)}
              style={({ pressed }) => [styles.option, { backgroundColor: colors.canvas, borderColor: colors.line, opacity: pressed ? 0.9 : 1 }]}
            >
              <View style={[styles.optionIcon, { backgroundColor: `${item.color}1F` }]}>
                <FeatureIcon color={item.color} name={item.icon} size={20} />
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.ink }]}>{item.title}</Text>
                <Text style={[styles.optionSubtitle, { color: colors.inkMuted }]}>{item.subtitle}</Text>
              </View>
              <FeatureIcon color={colors.inkMuted} name="chevron.right" size={14} />
            </Pressable>
          </PressScale>
        </Animated.View>
      ))}
      <View style={[styles.shakeRow, { borderColor: colors.line }]}>
        <View style={styles.optionCopy}>
          <Text style={[styles.shakeTitle, { color: colors.ink }]}>เขย่าเครื่องเพื่อเปิดเมนูนี้</Text>
          <Text style={[styles.optionSubtitle, { color: colors.inkMuted }]}>
            {shakeSupported() ? 'เปิดได้จากการตั้งค่า > ช่วยเหลือ เสมอ' : 'แอปเวอร์ชันนี้ยังไม่รองรับการเขย่า เปิดเมนูนี้ได้จากการตั้งค่า > ช่วยเหลือ'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="เขย่าเครื่องเพื่อเปิดเมนูรายงาน"
          disabled={!shakeSupported()}
          onValueChange={onShakeChange}
          trackColor={{ true: colors.primary }}
          value={shakeOn && shakeSupported()}
        />
      </View>
    </Animated.View>
  );
}

function FormView({ kind, onBack, onSent, shot, screen }) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReducedMotion();
  const item = KINDS[kind];
  const [message, setMessage] = useState('');
  const [attach, setAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const length = message.trim().length;
  const context = feedbackContext();

  const send = async () => {
    if (sending || length < MESSAGE_MIN) return;
    setSending(true);
    setError('');
    try {
      await submitAppFeedback({ kind, message: message.trim(), screen, screenshot: attach ? shot?.base64 : null });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSent();
    } catch (reason) {
      setError(reason?.message || 'ส่งรายงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setSending(false);
    }
  };

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInRight.duration(240)} style={styles.body}>
      <View style={styles.formHeader}>
        <Pressable accessibilityLabel="กลับไปเลือกประเภท" accessibilityRole="button" hitSlop={8} onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceRaised }]}>
          <FeatureIcon color={colors.ink} name="chevron.left" size={16} />
        </Pressable>
        <View style={[styles.optionIcon, { backgroundColor: `${item.color}1F` }]}>
          <FeatureIcon color={item.color} name={item.icon} size={18} />
        </View>
        <Text accessibilityRole="header" style={[styles.formTitle, { color: colors.ink }]}>{item.title}</Text>
      </View>

      <TextInput
        accessibilityLabel="รายละเอียด"
        keyboardAppearance={isDark ? 'dark' : 'light'}
        maxLength={MESSAGE_MAX}
        multiline
        onChangeText={setMessage}
        placeholder={item.placeholder}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, { backgroundColor: colors.canvas, borderColor: colors.line, color: colors.ink }]}
        textAlignVertical="top"
        value={message}
      />
      <Text style={[styles.counter, { color: colors.inkMuted }]}>{message.length}/{MESSAGE_MAX}</Text>

      {shot ? (
        <View style={[styles.shot, { borderColor: colors.line }]}>
          <Image accessibilityLabel="ภาพหน้าจอขณะเปิดเมนู" contentFit="cover" source={{ uri: shot.uri }} style={[styles.thumb, { opacity: attach ? 1 : 0.45 }]} />
          <View style={styles.optionCopy}>
            <Text style={[styles.shakeTitle, { color: colors.ink }]}>แนบภาพหน้าจอ</Text>
            <Text style={[styles.optionSubtitle, { color: colors.inkMuted }]}>ภาพอาจมีข้อมูลส่วนตัว ตรวจดูก่อนแนบ ทีมงานเท่านั้นที่เห็น</Text>
          </View>
          <Switch accessibilityLabel="แนบภาพหน้าจอ" onValueChange={setAttach} trackColor={{ true: colors.primary }} value={attach} />
        </View>
      ) : null}

      <Text style={[styles.context, { color: colors.inkMuted }]}>
        ระบบจะแนบเวอร์ชันแอป {context.appVersion || '—'}{context.appBuild ? ` (${context.appBuild})` : ''} · {Platform.OS === 'ios' ? 'iOS' : 'Android'} {context.osVersion} และหน้าที่คุณเปิดอยู่ เพื่อช่วยตรวจปัญหา
      </Text>
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger || '#E5484D' }]}>{error}</Text> : null}
      <Pressable
        accessibilityLabel="ส่งรายงาน"
        accessibilityRole="button"
        accessibilityState={{ disabled: length < MESSAGE_MIN || sending, busy: sending }}
        disabled={length < MESSAGE_MIN || sending}
        onPress={send}
        style={({ pressed }) => [styles.submit, { backgroundColor: colors.primary, opacity: length < MESSAGE_MIN ? 0.45 : pressed || sending ? 0.85 : 1 }]}
      >
        {sending ? <ActivityIndicator color="#FFFFFF" /> : <FeatureIcon color="#FFFFFF" name="arrow.right" size={16} />}
        <Text style={styles.submitText}>{sending ? 'กำลังส่ง…' : 'ส่งรายงาน'}</Text>
      </Pressable>
    </Animated.View>
  );
}

function SentView({ onClose }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const timer = setTimeout(onClose, 2600);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.body, styles.sent]}>
      <Animated.View entering={reduceMotion ? undefined : ZoomIn.springify().damping(11)} style={[styles.sentIcon, { backgroundColor: '#0B7A55' }]}>
        <FeatureIcon color="#FFFFFF" name="checkmark" size={30} />
      </Animated.View>
      <Animated.View entering={reduceMotion ? undefined : FadeInDown.delay(120).duration(300)} style={styles.sentCopy}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>ขอบคุณที่ช่วยเรา!</Text>
        <Text style={[styles.subtitle, { color: colors.inkMuted }]}>ทีมงานได้รับรายงานแล้ว และจะนำไปปรับปรุง CampusMate</Text>
      </Animated.View>
      <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.done, { borderColor: colors.line, opacity: pressed ? 0.8 : 1 }]}>
        <Text style={[styles.doneText, { color: colors.ink }]}>ปิด</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  header: { alignItems: 'center', gap: 6, marginBottom: 4 },
  headerIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, padding: 14, borderRadius: 20, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth },
  optionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, gap: 2, minWidth: 0 },
  optionTitle: { fontSize: 16, fontWeight: '700' },
  optionSubtitle: { fontSize: 12.5, lineHeight: 18 },
  shakeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth },
  shakeTitle: { fontSize: 14, fontWeight: '700' },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  formTitle: { flex: 1, fontSize: 18, fontWeight: '800' },
  input: { minHeight: 132, maxHeight: 220, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, fontSize: 15, lineHeight: 22 },
  counter: { alignSelf: 'flex-end', fontSize: 12, marginTop: -6 },
  shot: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 44, height: 78, borderRadius: 8 },
  context: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 13, fontWeight: '600' },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderRadius: 26 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  sent: { alignItems: 'center', paddingVertical: 16 },
  sentIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  sentCopy: { alignItems: 'center', gap: 6 },
  done: { minHeight: 48, paddingHorizontal: 32, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  doneText: { fontSize: 15, fontWeight: '700' },
});
