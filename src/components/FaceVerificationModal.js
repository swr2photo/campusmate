import Text from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Dimensions, Modal, Platform, Pressable, SafeAreaView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import FeatureIcon from './FeatureIcon';
import FaceVerificationDetails from './FaceVerificationDetails';
import { startFaceVerificationSession, submitFaceVerification } from '../services/faceVerificationService';
import { useTheme } from '../theme';

function ovalSize(windowWidth) {
  const width = Math.min(windowWidth * 0.72, 280);
  return { width, height: width * 1.35 };
}

const REUSABLE_SESSION_REASONS = new Set([
  'no_face_detected',
  'multiple_faces_detected',
  'low_face_confidence',
  'face_too_small',
  'face_blurry',
  'face_lighting',
  'face_pose',
  'sunglasses',
  'face_occluded',
  'invalid_selfie',
]);

// CameraX's JPEG ImageReader aborts in the native layer on older Android
// camera drivers (including the connected API 25 emulator). System capture
// uses its own compatible camera implementation and still requires a live photo.
const USE_SYSTEM_CAMERA = Platform.OS === 'android' && Number(Platform.Version) <= 25;

export default function FaceVerificationModal({
  visible,
  onClose,
  onSuccess,
  avatarUri,
}) {
  const { colors, isDark } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [introduced, setIntroduced] = useState(false);
  const generation = useRef(0);
  const capturing = useRef(false);
  const sessionRef = useRef({ id: null, pending: null });
  const sessionTicket = useRef(0);
  const [modalReady, setModalReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [windowWidth, setWindowWidth] = useState(() => Dimensions.get('window').width);
  const oval = ovalSize(windowWidth);

  const clearSession = () => {
    sessionTicket.current += 1;
    sessionRef.current = { id: null, pending: null };
  };

  const warmSession = () => {
    if (sessionRef.current.id || sessionRef.current.pending) return;
    const ticket = sessionTicket.current;
    sessionRef.current.pending = startFaceVerificationSession()
      .then((id) => {
        if (sessionTicket.current !== ticket) return null;
        sessionRef.current.id = id;
        return id;
      })
      .catch(() => null)
      .finally(() => {
        if (sessionTicket.current === ticket) sessionRef.current.pending = null;
      });
  };

  const claimSession = async () => {
    const readyId = sessionRef.current.id;
    if (readyId) {
      sessionRef.current.id = null;
      return readyId;
    }
    const pending = sessionRef.current.pending;
    if (pending) {
      sessionRef.current.pending = null;
      const id = await pending;
      sessionRef.current.id = null;
      if (id) return id;
    }
    return startFaceVerificationSession();
  };

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => setWindowWidth(window.width));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!visible) {
      generation.current += 1;
      capturing.current = false;
      clearSession();
      setModalReady(false);
      setCameraReady(false);
    } else {
      warmSession();
    }
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { listener.remove(); generation.current += 1; };
  }, [visible]);

  const [step, setStep] = useState('idle'); // 'idle' | 'capturing' | 'verifying' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [similarityScore, setSimilarityScore] = useState(null);

  const handleReset = useCallback(() => {
    setStep('idle');
    setErrorMessage('');
    setSimilarityScore(null);
  }, []);

  const handleClose = useCallback(() => {
    generation.current += 1;
    capturing.current = false;
    clearSession();
    setModalReady(false);
    setIntroduced(false);
    handleReset();
    onClose?.();
  }, [handleReset, onClose]);

  const handleCaptureAndVerify = async () => {
    if (capturing.current || (!USE_SYSTEM_CAMERA && (!cameraRef.current || !cameraReady))) return;
    capturing.current = true;
    const attempt = ++generation.current;
    let timer;

    try {
      setStep('capturing');
      let photo;
      if (USE_SYSTEM_CAMERA) {
        const result = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, mediaTypes: ['images'], quality: 0.8, allowsEditing: false });
        if (generation.current !== attempt) return;
        if (result.canceled) { setStep('idle'); return; }
        photo = result.assets?.[0];
      } else {
      const photoPromise = cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
        exif: true,
        shutterSound: false,
      });
      const timeoutPromise = new Promise((_, reject) =>
        timer = setTimeout(() => reject(new Error('กล้องไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง')), 12000)
      );
      photo = await Promise.race([photoPromise, timeoutPromise]);
      clearTimeout(timer);
      }
      if (generation.current !== attempt) return;

      if (!photo?.uri) {
        throw new Error('ไม่สามารถบันทึกภาพถ่ายได้ กรุณาลองใหม่อีกครั้ง');
      }

      setStep('verifying');
      const sessionId = await claimSession();
      if (generation.current !== attempt) return;
      const result = await submitFaceVerification({
        sessionId,
        selfieUri: photo.uri,
      });
      if (generation.current !== attempt) return;

      if (result.success) {
        setSimilarityScore(result.similarity);
        setStep('success');
        onSuccess?.(result);
      } else {
        if (REUSABLE_SESSION_REASONS.has(result.reason)) sessionRef.current.id = sessionId;
        else warmSession();
        setErrorMessage(result.message || 'ใบหน้าไม่ตรงกับรูปโปรไฟล์หลัก');
        setStep('error');
      }
    } catch (err) {
      if (generation.current !== attempt) return;
      warmSession();
      console.warn('[FaceVerification] Verification flow error:', err);
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการตรวจสอบ กรุณาลองใหม่อีกครั้ง');
      setStep('error');
    } finally { clearTimeout(timer); if (generation.current === attempt) capturing.current = false; }
  };

  if (!visible) return null;

  return (
    <Modal
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      transparent={false}
      visible={visible}
      onRequestClose={handleClose}
      onShow={() => setModalReady(true)}
    >
      <View style={styles.container}>
        {!introduced || !permission?.granted || USE_SYSTEM_CAMERA || ['verifying', 'success', 'error'].includes(step) ? (
          <FaceVerificationDetails
            step={step}
            errorMessage={errorMessage}
            avatarUri={avatarUri}
            permissionGranted={permission?.granted}
            onClose={handleClose}
            onPrimary={async () => {
              const requestGeneration = generation.current;
              handleReset();
              const granted = permission?.granted || (await requestPermission()).granted;
              if (generation.current !== requestGeneration) return;
              if (!granted) {
                setErrorMessage('กรุณาอนุญาตการเข้าถึงกล้องในการตั้งค่าแอป แล้วลองอีกครั้ง');
                setStep('error');
                return;
              }
              if (USE_SYSTEM_CAMERA) await handleCaptureAndVerify();
              else { setCameraReady(false); setIntroduced(true); }
            }}
          />
        ) : (
          <View style={styles.cameraWrapper}>
            {modalReady && foreground && step !== 'verifying' && step !== 'success' && <CameraView
              facing="front"
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              mode="picture"
              animateShutter={false}
              onCameraReady={() => setCameraReady(true)}
              onMountError={() => { setCameraReady(false); setErrorMessage('เปิดกล้องไม่ได้ กรุณาปิดแล้วลองอีกครั้ง'); setStep('error'); }}
            />}

            <View style={styles.overlay} pointerEvents="box-none">
              <SafeAreaView style={styles.header}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleClose}
                  style={styles.closeButton}
                >
                  <FeatureIcon color="#FFFFFF" name="xmark" size={20} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>ยืนยันใบหน้า</Text>
                <View style={styles.headerSpacer} />
              </SafeAreaView>

              <View style={styles.ovalStage} pointerEvents="none">
                <View style={styles.maskBand} />
                <View style={[styles.ovalRow, { height: oval.height }]}>
                  <View style={styles.maskSide} />
                  <View
                    style={[
                      styles.ovalCutout,
                      { width: oval.width, height: oval.height, borderRadius: oval.width / 2 },
                      step === 'verifying' && styles.ovalVerifying,
                      step === 'success' && styles.ovalSuccess,
                      step === 'error' && styles.ovalError,
                    ]}
                  />
                  <View style={styles.maskSide} />
                </View>
                <View style={styles.maskBand} />
              </View>

              {/* Status / Instructions Footer */}
              <View style={styles.footer}>
                {step === 'idle' && (
                  <>
                    <Text style={styles.instructionText}>
                      จัดใบหน้าให้อยู่ตรงกลางกรอบวงรี{'\n'}มองตรงมาที่กล้องในที่แสงสว่างเพียงพอ
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={handleCaptureAndVerify}
                      disabled={!cameraReady}
                      style={styles.captureButton}
                    >
                      <View style={styles.captureButtonInner} />
                    </TouchableOpacity>
                  </>
                )}

                {(step === 'capturing' || step === 'verifying') && (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator color="#FFFFFF" size="large" />
                    <Text style={styles.loadingTitle}>กำลังตรวจสอบใบหน้า...</Text>
                    <Text style={styles.loadingSubtitle}>
                      กำลังเปรียบเทียบใบหน้ากับรูปโปรไฟล์หลัก
                    </Text>
                  </View>
                )}

                {step === 'success' && (
                  <View style={styles.resultBox}>
                    <FeatureIcon color="#10B981" name="checkmark.seal.fill" size={54} />
                    <Text style={styles.resultTitle}>ยืนยันใบหน้าสำเร็จ!</Text>
                    <Text style={styles.resultSubtitle}>
                      ความตรงกัน {similarityScore}%{'\n'}ได้รับตราสัญลักษณ์ยืนยันตัวตนเรียบร้อยแล้ว
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={handleClose}
                      style={[styles.primaryButton, { backgroundColor: '#10B981', marginTop: 16 }]}
                    >
                      <Text style={styles.primaryButtonText}>เสร็จสิ้น</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {step === 'error' && (
                  <View style={styles.resultBox}>
                    <FeatureIcon color="#EF4444" name="exclamationmark.triangle.fill" size={48} />
                    <Text style={styles.resultErrorTitle}>การยืนยันไม่ผ่าน</Text>
                    <Text style={styles.resultSubtitle}>{errorMessage}</Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={handleReset}
                        style={[styles.primaryButton, { backgroundColor: '#2869C7', flex: 1 }]}
                      >
                        <Text style={styles.primaryButtonText}>ลองใหม่อีกครั้ง</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={handleClose}
                        style={[styles.cancelSecondaryButton, { flex: 1 }]}
                      >
                        <Text style={styles.cancelSecondaryText}>ปิด</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionContent: {
    maxWidth: 380,
    alignItems: 'center',
  },
  iconBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  permissionDescription: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 14,
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 40,
  },
  ovalStage: {
    flex: 1,
  },
  maskBand: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  ovalRow: {
    flexDirection: 'row',
  },
  maskSide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  ovalCutout: {
    borderWidth: 3.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
  },
  ovalVerifying: {
    borderColor: '#3B82F6',
  },
  ovalSuccess: {
    borderColor: '#10B981',
  },
  ovalError: {
    borderColor: '#EF4444',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 44 : 28,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captureButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FFFFFF',
  },
  loadingBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    width: '100%',
  },
  loadingTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  loadingSubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  resultBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    width: '100%',
  },
  resultTitle: {
    color: '#10B981',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 12,
  },
  resultErrorTitle: {
    color: '#EF4444',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 12,
  },
  resultSubtitle: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  cancelSecondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelSecondaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
