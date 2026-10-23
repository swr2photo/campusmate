import { Pressable } from './NativePressable';
import Text from './AppText';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import FeatureIcon from './FeatureIcon';
import { FaceGestureCameraView, isFaceGestureCameraAvailable } from '../../modules/face-gesture-camera';
import { ringTicks } from '../utils/faceGestureDetector.mjs';
import { createGestureRunner } from '../utils/faceGestureRunner.mjs';
import { messageFor } from '../services/photoVerificationProtocol.mjs';
import { Mascot } from './illustrations';

// The server confirms each movement. The fallback camera captures frames
// continuously and the server says what to adjust after each batch.
const NATIVE_TRACKING = isFaceGestureCameraAvailable();
let Haptics = null;
try { Haptics = require('expo-haptics'); } catch { /* Older binary: keep visual and spoken feedback. */ }

// `detail` with on-device tracking, `sampled` for the fallback camera, which
// sees a few frames a second and needs the pose for a moment.
const COPY = {
  CENTER: { title: 'มองตรงมาที่กล้อง', detail: 'ให้ใบหน้าอยู่กลางวงกลม', sampled: 'ให้ใบหน้าอยู่กลางวงกลม ลืมตาตามปกติ', icon: 'face.smiling' },
  BLINK: { title: 'กะพริบตาช้า ๆ', detail: 'กะพริบตาแล้วลืมตาได้เลย', sampled: 'หลับตาประมาณ 1 วินาที แล้วลืมตา', icon: 'eye.slash.fill' },
  TURN_LEFT: { title: 'หันหน้าไปทางซ้าย', detail: 'หันตามน้องแล้วกลับได้เลย ไม่ต้องค้าง', sampled: 'หันไปทางซ้ายจนวงแหวนขึ้นสีเขียว แล้วหันกลับ', icon: 'arrow.left' },
  TURN_RIGHT: { title: 'หันหน้าไปทางขวา', detail: 'หันตามน้องแล้วกลับได้เลย ไม่ต้องค้าง', sampled: 'หันไปทางขวาจนวงแหวนขึ้นสีเขียว แล้วหันกลับ', icon: 'arrow.right' },
  NOD_DOWN: { title: 'ก้มหน้าลงเล็กน้อย', detail: 'ก้มตามน้องแล้วเงยกลับ ไม่ต้องค้าง', sampled: 'ก้มหน้าลงจนวงแหวนขึ้นสีเขียว แล้วเงยกลับ', icon: 'arrow.down' },
};

// What to adjust, from the server or on-device tracking, with its icon.
const HINTS = {
  NO_FACE: ['ไม่พบใบหน้า ให้ใบหน้าอยู่ในวงกลม', 'person.crop.circle.badge.questionmark'],
  MULTIPLE_FACES: ['พบหลายใบหน้า ให้มีเพียงคุณคนเดียว', 'person.2.fill'],
  FACE_NOT_MATCHED: ['ใบหน้าไม่ตรงกับรูปโปรไฟล์หลัก', 'person.fill.xmark'],
  TOO_FAR: ['ขยับโทรศัพท์เข้าใกล้หน้าอีกนิด', 'arrow.up.left.and.arrow.down.right'],
  TOO_CLOSE: ['ถอยโทรศัพท์ออกห่างเล็กน้อย', 'arrow.down.right.and.arrow.up.left'],
  OFF_CENTER: ['ขยับใบหน้าให้อยู่กลางวงกลม', 'face.smiling'],
  TOO_DARK: ['แสงน้อยไป หันหน้าเข้าหาแสง', 'sun.max.fill'],
  LOOK_STRAIGHT: ['มองตรงมาที่กล้องก่อน', 'face.smiling'],
  OPEN_EYES: ['ลืมตาและมองกล้อง', 'eye.fill'],
  CLOSE_EYES: ['หลับตาให้สนิทสักครู่ แล้วลืมตา', 'eye.slash.fill'],
  TURN_MORE: ['หันเพิ่มอีกนิด', null],
  OTHER_WAY: ['หันไปอีกฝั่ง ตรงข้ามกับครั้งก่อน', 'arrow.left.and.right.righttriangle.left.righttriangle.right.fill'],
  KEEP_LEVEL: ['หันไปด้านข้างโดยไม่ก้มหรือเงย', 'face.smiling'],
  NOD_MORE: ['ก้มหน้าลงอีกนิด', 'arrow.down'],
  HEAD_TILTED: ['ตั้งศีรษะให้ตรง ไม่เอียงคอ', 'face.smiling'],
  HOLD_STILL: ['ถือโทรศัพท์นิ่งๆ แล้วทำอีกครั้ง', 'hand.raised'],
};
const RETRY_ICON = 'arrow.triangle.2.circlepath';
/** Fallback frames: small enough to upload quickly, large enough for pose. */
const FRAME_WIDTH = 480;
// iOS captures VGA frames several times faster than full photos.
const PICTURE_SIZE = Platform.OS === 'ios' ? '640x480' : undefined;

const TICKS = 60;
const DONE = '#34C759';
const ACTIVE = '#FFFFFF';
const IDLE = 'rgba(255,255,255,0.16)';
const HINT = '#FFD60A';

const Tick = memo(function Tick({ angle, radius, length, state, origin }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.tick,
        {
          height: length,
          left: origin - 1.5,
          top: origin - length / 2,
          backgroundColor: state === 'done' ? DONE : state === 'active' ? ACTIVE : IDLE,
          transform: [{ rotate: `${angle}deg` }, { translateY: -radius }],
        },
      ]}
    />
  );
});

const POSES = { CENTER: 'center', BLINK: 'blink', TURN_LEFT: 'look-left', TURN_RIGHT: 'look-right', NOD_DOWN: 'nod' };

/** The mascot acts out the current movement above the camera, so it is clear what to do. */
const HeadGuide = memo(function HeadGuide({ gesture, animate, size, celebrate }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.guide, { width: size * 1.75, height: size * 1.75, borderRadius: size }]}
    >
      <Mascot size={size} pose={celebrate ? 'jump' : POSES[gesture] || 'center'} mood={celebrate ? 'happy' : 'calm'} accessory="none" animate={animate} />
    </View>
  );
});

/** Server-owned gesture order; this screen collects camera frames only. */
export default function FaceGestureStage({ gestures, expiresAt, submit, onDone, onFail, onCancel }) {
  const { width, height, fontScale = 1 } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [{ step, passed, progress, hint, phase }, setState] = useState({
    step: 0, passed: 0, progress: 0, hint: null, phase: 'tracking',
  });
  const [reduceMotion, setReduceMotion] = useState(true);
  const camera = useRef(null);
  const runner = useRef(null);
  const permissionRequest = useRef(null);
  const callbacks = useRef({ submit, onDone, onFail, onCancel });
  callbacks.current = { submit, onDone, onFail, onCancel };
  const nudge = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const hintPop = useRef(new Animated.Value(1)).current;
  const announcedPassed = useRef(0);
  const announcedHint = useRef(0);

  // Scroll remains available on short windows and with enlarged text.
  const diameter = Math.min(Math.max(120, width - 104), Math.max(120, height * (fontScale > 1.3 ? 0.2 : 0.32)), 290);
  const guideSize = Math.round(Math.min(60, Math.max(42, height * 0.065)));
  const tickLength = 14;
  const ring = diameter + 2 * (tickLength + 14);
  const origin = ring / 2;
  const radius = diameter / 2 + 10 + tickLength / 2;
  const gesture = gestures[step];
  const copy = COPY[gesture] || COPY.CENTER;

  const captureFrame = useCallback(async (frameId) => {
    if (NATIVE_TRACKING) {
      // Older native builds omit frameId and retain their capture method.
      return Number.isInteger(frameId) ? camera.current?.captureFrame(frameId) : camera.current?.capture();
    }
    let photo;
    let frame;
    try {
      photo = await camera.current?.takePictureAsync({ quality: 0.5, shutterSound: false, exif: false });
      if (!photo?.uri) return null;
      // Re-encoding also bakes the orientation into the pixels.
      frame = await ImageManipulator.manipulateAsync(photo.uri,
        photo.width > FRAME_WIDTH ? [{ resize: { width: FRAME_WIDTH } }] : [], {
          compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true,
        });
      return { base64: frame.base64 };
    } finally {
      // Only this capture's temporary files, never profile or gallery images.
      const uris = [...new Set([photo?.uri, frame?.uri])].filter((uri) =>
        FileSystem.cacheDirectory && uri?.startsWith(FileSystem.cacheDirectory));
      await Promise.all(uris.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
    }
  }, []);

  useEffect(() => {
    if (appActive && passed > announcedPassed.current) {
      announcedPassed.current = passed;
      const feedback = Platform.OS === 'android' && Haptics?.performAndroidHapticsAsync
        ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
        : Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success);
      feedback?.catch(() => {});
      if (appActive) AccessibilityInfo.announceForAccessibility?.(`ผ่านแล้ว ${passed} จาก ${gestures.length} ท่า`);
    }
  }, [appActive, gestures.length, passed]);

  // Each mount gets its own disposable runner. Late promises from a previous
  // mount cannot update this screen, start AWS, or clear a newer attempt.
  useEffect(() => {
    const current = createGestureRunner({
      gestures, nativeTracking: NATIVE_TRACKING, capture: captureFrame,
      submit: (...args) => callbacks.current.submit(...args),
      onChange: setState,
      onDone: () => callbacks.current.onDone?.(),
      onFail: (code) => callbacks.current.onFail?.(code),
      onCancel: () => callbacks.current.onCancel?.(),
    });
    runner.current = current;
    setState(current.getState());
    current.setActive(AppState.currentState === 'active');
    const deadline = Date.parse(expiresAt || '');
    const timer = setTimeout(() => current.fail('SESSION_EXPIRED'),
      Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 120000);
    return () => {
      clearTimeout(timer);
      current.dispose();
      if (runner.current === current) runner.current = null;
    };
  }, [captureFrame, expiresAt, gestures]);

  useEffect(() => {
    if (!permission || permission.granted) return undefined;
    let mounted = true;
    if (permission.canAskAgain) {
      // Reuse the same request across permission-state renders and React's
      // development remount, instead of reopening the prompt after denial.
      if (!permissionRequest.current) permissionRequest.current = requestPermission();
      permissionRequest.current
        .then((result) => { if (mounted && !result.granted) runner.current?.fail('CAMERA_UNAVAILABLE'); })
        .catch(() => { if (mounted) runner.current?.fail('CAMERA_UNAVAILABLE'); });
    } else runner.current?.fail('CAMERA_UNAVAILABLE');
    return () => { mounted = false; };
  }, [permission, requestPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      runner.current?.setActive(state === 'active');
      setAppActive(state === 'active');
    });
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); motion.remove(); };
  }, []);

  useEffect(() => {
    nudge.setValue(0);
    if (reduceMotion || !appActive || phase !== 'tracking' || !['TURN_LEFT', 'TURN_RIGHT', 'NOD_DOWN'].includes(gesture)) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(nudge, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(nudge, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [appActive, gesture, nudge, phase, reduceMotion]);

  useEffect(() => {
    if (phase !== 'passed' && phase !== 'done') { pop.setValue(0); return undefined; }
    if (reduceMotion) { pop.setValue(1); return undefined; }
    const animation = Animated.timing(pop, { toValue: 1, duration: 180, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [phase, pop, reduceMotion]);

  useEffect(() => {
    if (!appActive) return;
    AccessibilityInfo.announceForAccessibility?.(`ขั้นที่ ${step + 1} จาก ${gestures.length} ${copy.title}`);
    // A light tick marks each new movement; passing one gets the success haptic above.
    if (step > 0) Haptics?.selectionAsync?.()?.catch(() => {});
  }, [appActive, copy.title, gestures.length, step]);

  // A new hint pops so the change is noticed; VoiceOver hears it at most
  // every few seconds (Android uses the live region).
  useEffect(() => {
    if (!hint) return undefined;
    if (Platform.OS === 'ios' && appActive && Date.now() - announcedHint.current > 2500) {
      announcedHint.current = Date.now();
      AccessibilityInfo.announceForAccessibility?.(HINTS[hint]?.[0] || messageFor(hint));
    }
    if (reduceMotion) return undefined;
    hintPop.setValue(0.9);
    const animation = Animated.spring(hintPop, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [appActive, hint, hintPop, reduceMotion]);

  const onFaceUpdate = useCallback(({ nativeEvent }) => runner.current?.faceUpdate(nativeEvent), []);
  const onCameraError = useCallback(() => {
    if (AppState.currentState === 'active') runner.current?.fail('CAMERA_UNAVAILABLE');
  }, []);

  const ticks = useMemo(
    () => ringTicks({ total: TICKS, steps: gestures.length, passed, progress: phase === 'tracking' || phase === 'sending' ? progress : 0 }),
    [gestures.length, passed, phase, progress],
  );

  const arrowStyle = {
    transform: gesture === 'NOD_DOWN'
      ? [{ translateY: nudge.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }) }]
      : [{ translateX: nudge.interpolate({ inputRange: [0, 1], outputRange: [0, gesture === 'TURN_LEFT' ? -10 : 10] }) }],
  };
  const glyphPosition = gesture === 'TURN_LEFT' ? styles.glyphLeft
    : gesture === 'TURN_RIGHT' ? styles.glyphRight
      : gesture === 'NOD_DOWN' ? styles.glyphBottom : styles.glyphTop;
  const checkingCapturedPose = phase === 'sending' && NATIVE_TRACKING;
  const guiding = phase === 'tracking' || (phase === 'sending' && !NATIVE_TRACKING);
  const title = phase === 'done' ? 'ครบทุกท่าแล้ว เก่งมาก!' : phase === 'passed' ? 'ผ่านแล้ว!' : checkingCapturedPose ? 'กำลังตรวจท่านี้' : copy.title;
  const detail = phase === 'done' ? 'ต่อไปเป็นการตรวจว่าเป็นคนจริง'
    : phase === 'passed' ? 'เตรียมทำท่าถัดไปตามน้องได้เลย'
      : checkingCapturedPose ? 'ไม่ต้องค้างท่า'
        : NATIVE_TRACKING ? copy.detail : copy.sampled;
  const hintText = hint && guiding ? HINTS[hint]?.[0] || messageFor(hint) : null;
  const hintIcon = hint === 'TURN_MORE' ? copy.icon : HINTS[hint]?.[1] || RETRY_ICON;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ยกเลิกการยืนยันใบหน้า"
          hitSlop={8}
          onPress={() => runner.current?.cancel()}
          style={styles.close}
        >
          <FeatureIcon name="xmark" size={18} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.navTitle}>ยืนยันใบหน้า</Text>
        <Text style={styles.counter} accessibilityLabel={`ขั้นที่ ${Math.min(step + 1, gestures.length)} จาก ${gestures.length}`}>
          {Math.min(step + 1, gestures.length)}/{gestures.length}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <HeadGuide gesture={gesture} animate={!reduceMotion && appActive && guiding} size={guideSize} celebrate={phase === 'passed' || phase === 'done'} />
        <View style={[styles.stage, fontScale > 1.3 && { paddingVertical: 8 }]}>
        <Animated.View accessible accessibilityRole="progressbar" accessibilityLabel="ความคืบหน้าการทำท่าทาง"
          accessibilityValue={{ min: 0, max: gestures.length, now: passed, text: `ผ่านแล้ว ${passed} จาก ${gestures.length} ท่า` }}
          style={{ width: ring, height: ring, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] }}>
            {ticks.map((state, index) => (
              <Tick key={index} angle={(index * 360) / TICKS} radius={radius} length={tickLength} state={state} origin={origin} />
            ))}
            <View
              accessible
              accessibilityLabel="กล้องหน้าสำหรับยืนยันใบหน้า"
              style={[styles.lens, { width: diameter, height: diameter, borderRadius: diameter / 2, left: origin - diameter / 2, top: origin - diameter / 2 }]}
            >
              {permission?.granted && NATIVE_TRACKING ? (
                <FaceGestureCameraView
                  ref={camera}
                  active={appActive && phase !== 'done'}
                  onFaceUpdate={onFaceUpdate}
                  onCameraError={onCameraError}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {permission?.granted && !NATIVE_TRACKING && appActive && phase !== 'done' ? (
                <CameraView
                  ref={camera}
                  facing="front"
                  mode="picture"
                  pictureSize={PICTURE_SIZE}
                  animateShutter={false}
                  onCameraReady={() => runner.current?.cameraReady()}
                  onMountError={onCameraError}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {phase === 'passed' || phase === 'done' ? (
                <Animated.View style={[styles.passedBadge, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
                  <FeatureIcon name="checkmark" size={44} color="#FFFFFF" />
                </Animated.View>
              ) : null}
            </View>
            {guiding ? (
              <Animated.View pointerEvents="none" style={[styles.glyph, glyphPosition, arrowStyle]}>
                <FeatureIcon name={copy.icon} size={22} color="#FFFFFF" />
              </Animated.View>
            ) : null}
          </Animated.View>
        </View>

        <View style={styles.copy}>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>{title}</Text>
          <Text style={styles.detail}>{detail}</Text>
          {hintText ? (
            <Animated.View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={hintText}
              style={[styles.hintPill, { transform: [{ scale: hintPop }] }]}
            >
              <FeatureIcon name={hintIcon} size={16} color={HINT} />
              <Text style={styles.hintText}>{hintText}</Text>
            </Animated.View>
          ) : null}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000000' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, minHeight: 60 },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, flexShrink: 1, marginHorizontal: 8, color: '#FFFFFF', fontSize: 16, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  counter: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '600', minWidth: 48, textAlign: 'right' },
  content: { flexGrow: 1, paddingBottom: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  stage: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  tick: { position: 'absolute', width: 3, borderRadius: 1.5 },
  lens: { position: 'absolute', overflow: 'hidden', backgroundColor: '#111316' },
  passedBadge: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(52,199,89,0.45)' },
  glyph: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(40,105,199,0.92)', alignItems: 'center', justifyContent: 'center' },
  glyphTop: { top: 0, alignSelf: 'center' },
  glyphBottom: { bottom: 0, alignSelf: 'center' },
  glyphLeft: { left: 0, top: '50%', marginTop: -20 },
  glyphRight: { right: 0, top: '50%', marginTop: -20 },
  copy: { alignItems: 'center', paddingHorizontal: 28, gap: 8, minHeight: 140 },
  // Light halo so the mascot's dark outline reads on the black camera page.
  guide: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#EAF4FF', marginTop: 4 },
  title: { color: '#FFFFFF', fontSize: 26, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  detail: { color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  hintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', marginTop: 4, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,214,10,0.5)', backgroundColor: 'rgba(255,214,10,0.14)',
  },
  hintText: { flexShrink: 1, color: HINT, fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
});
