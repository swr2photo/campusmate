import Text from './AppText';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { prepareRecordedVideo } from '../services/chatVideoService';
import { showAlert } from '../utils/appAlert';

const PHOTO_TIMEOUT_MS = 12000;
const PROCESS_TIMEOUT_MS = 18000;
const MAX_PHOTO_EDGE = 1920;
const MIN_RECORD_MS = 1200;

function withTimeout(promise, ms, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function pickPictureSize(sizes = []) {
  if (!Array.isArray(sizes) || !sizes.length) return undefined;
  const parsed = sizes
    .map((value) => {
      const match = String(value).match(/(\d+)\s*x\s*(\d+)/i);
      if (!match) return null;
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (!width || !height) return null;
      return { value, width, height, longEdge: Math.max(width, height), pixels: width * height };
    })
    .filter(Boolean)
    .sort((a, b) => b.pixels - a.pixels);
  const preferred = parsed.find((item) => item.longEdge <= MAX_PHOTO_EDGE && item.longEdge >= 1280)
    || parsed.find((item) => item.longEdge <= MAX_PHOTO_EDGE)
    || parsed[0];
  return preferred?.value;
}

async function capturePhoto(cameraRef) {
  const camera = cameraRef.current;
  if (!camera) throw new Error('กล้องยังไม่พร้อม');

  // Prefer onPictureSaved so devices that stall on the processed promise still
  // deliver the file. Keep a hard timeout so the shutter never stays locked.
  const photo = await withTimeout(new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const options = {
      quality: 1,
      exif: false,
      shutterSound: Platform.OS === 'ios',
      // Android CameraX processing hangs on some OEMs; skip native pipeline and
      // normalize with ImageManipulator instead.
      skipProcessing: Platform.OS === 'android',
      onPictureSaved: (picture) => {
        if (picture?.uri) finish(picture);
      },
    };

    Promise.resolve(camera.takePictureAsync(options))
      .then((immediate) => {
        if (immediate?.uri) finish(immediate);
      })
      .catch((error) => finish(null, error));
  }), PHOTO_TIMEOUT_MS, 'กล้องตอบสนองช้า กรุณาลองใหม่อีกครั้ง');

  if (!photo?.uri) throw new Error('ไม่สามารถบันทึกรูปได้');

  const width = Number(photo.width) || 0;
  const height = Number(photo.height) || 0;
  const longEdge = Math.max(width, height);
  const actions = [];
  if (longEdge > MAX_PHOTO_EDGE && width > 0 && height > 0) {
    if (width >= height) actions.push({ resize: { width: MAX_PHOTO_EDGE } });
    else actions.push({ resize: { height: MAX_PHOTO_EDGE } });
  }

  return withTimeout(
    ImageManipulator.manipulateAsync(photo.uri, actions, {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    }),
    PROCESS_TIMEOUT_MS,
    'ประมวลผลรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  );
}

function ToolButton({
  accessibilityLabel,
  disabled = false,
  onPress,
  children,
  active = false,
  style,
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        active && styles.toolActive,
        pressed && !disabled && styles.toolPressed,
        disabled && styles.toolDisabled,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export default function ChatCameraModal({ recipientName, recipientAvatar, onCapture, onClose }) {
  const insets = useSafeAreaInsets();
  const camera = useRef(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const recordingRef = useRef(false);
  const stopTimer = useRef(null);
  const permissionPrompt = useRef(false);
  const closeRef = useRef(onClose);
  const captureGeneration = useRef(0);
  closeRef.current = onClose;

  const [permission, requestPermission] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [facing, setFacing] = useState('back');
  const [mode, setMode] = useState('picture');
  const [flash, setFlash] = useState(false);
  const [grid, setGrid] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [pictureSize, setPictureSize] = useState(undefined);
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cameraKey, setCameraKey] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !permissionPrompt.current) {
        mounted.current = false;
        camera.current?.stopRecording?.();
        closeRef.current();
      }
    });
    return () => {
      mounted.current = false;
      clearTimeout(stopTimer.current);
      captureGeneration.current += 1;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => {
      setElapsed(Math.min(60, (Date.now() - started.current) / 1000));
    }, 100);
    return () => clearInterval(timer);
  }, [recording]);

  const remountCamera = useCallback(() => {
    setReady(false);
    setCameraKey((value) => value + 1);
  }, []);

  const close = () => {
    mounted.current = false;
    captureGeneration.current += 1;
    if (recordingRef.current) camera.current?.stopRecording?.();
    onClose();
  };

  const finish = (asset) => {
    if (mounted.current) onCapture(asset);
  };

  const handleCameraReady = useCallback(async () => {
    try {
      const sizes = await camera.current?.getAvailablePictureSizesAsync?.();
      const nextSize = pickPictureSize(sizes);
      if (mounted.current && nextSize) setPictureSize(nextSize);
    } catch {
      // Default sensor size is fine when enumeration fails.
    } finally {
      if (mounted.current) setReady(true);
    }
  }, []);

  const selectMode = async (value) => {
    if (busy.current || recordingRef.current || mode === value) return;
    busy.current = true;
    permissionPrompt.current = true;
    try {
      if (value === 'video' && !microphone?.granted && !(await requestMicrophone()).granted) {
        showAlert('ต้องอนุญาตไมโครโฟน', 'เปิดสิทธิ์ไมโครโฟนเพื่อบันทึกวิดีโอพร้อมเสียง', { tone: 'warning' });
        return;
      }
      if (mounted.current) {
        setReady(false);
        setMode(value);
      }
    } catch (error) {
      if (mounted.current) showAlert('เปิดโหมดวิดีโอไม่สำเร็จ', error.message, { tone: 'danger' });
    } finally {
      busy.current = false;
      permissionPrompt.current = false;
    }
  };

  const capture = async () => {
    if (recordingRef.current) {
      if (!stopTimer.current) {
        stopTimer.current = setTimeout(() => {
          stopTimer.current = null;
          if (recordingRef.current) camera.current?.stopRecording?.();
        }, Math.max(0, MIN_RECORD_MS - (Date.now() - started.current)));
      }
      return;
    }
    if (!ready || busy.current || !camera.current) return;

    const generation = ++captureGeneration.current;
    busy.current = true;

    try {
      if (mode === 'video') {
        permissionPrompt.current = true;
        const microphoneGranted = microphone?.granted || (await requestMicrophone()).granted;
        permissionPrompt.current = false;
        if (!microphoneGranted) {
          showAlert('ต้องอนุญาตไมโครโฟน', 'เปิดสิทธิ์ไมโครโฟนเพื่อบันทึกวิดีโอพร้อมเสียง', { tone: 'warning' });
          return;
        }
        if (!mounted.current || generation !== captureGeneration.current) return;

        started.current = Date.now();
        setElapsed(0);
        recordingRef.current = true;
        setRecording(true);

        const video = await withTimeout(
          camera.current.recordAsync({
            maxDuration: 60,
            maxFileSize: 24 * 1024 * 1024,
          }),
          70_000,
          'บันทึกวิดีโอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        );

        recordingRef.current = false;
        if (!mounted.current || generation !== captureGeneration.current) return;
        setRecording(false);
        setProcessing(true);

        if (video?.uri) {
          const prepared = await prepareRecordedVideo(
            video.uri,
            Math.round(Date.now() - started.current),
          );
          if (generation === captureGeneration.current) {
            finish({ ...prepared, type: 'video' });
          }
        }
      } else {
        setProcessing(true);
        const result = await capturePhoto(camera);
        if (!mounted.current || generation !== captureGeneration.current) return;
        finish({ ...result, type: 'image', uris: [result.uri] });
      }
    } catch (error) {
      if (mounted.current && generation === captureGeneration.current) {
        showAlert('บันทึกไม่สำเร็จ', error?.message || 'กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
        // Recover from native capture stalls by remounting the preview session.
        remountCamera();
      }
    } finally {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
      permissionPrompt.current = false;
      busy.current = false;
      recordingRef.current = false;
      if (mounted.current && generation === captureGeneration.current) {
        setProcessing(false);
        setRecording(false);
      }
    }
  };

  const library = async () => {
    if (busy.current || recordingRef.current) return;
    busy.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: false,
        quality: 1,
        videoMaxDuration: 60,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.type === 'video') {
        if (!Number.isFinite(asset.duration) || asset.duration <= 0) {
          throw new Error('ไม่สามารถตรวจสอบความยาววิดีโอได้');
        }
        onCapture(asset);
        return;
      }
      const width = Number(asset.width) || 0;
      const height = Number(asset.height) || 0;
      const longEdge = Math.max(width, height);
      const actions = [];
      if (longEdge > MAX_PHOTO_EDGE && width > 0 && height > 0) {
        if (width >= height) actions.push({ resize: { width: MAX_PHOTO_EDGE } });
        else actions.push({ resize: { height: MAX_PHOTO_EDGE } });
      }
      const photo = await withTimeout(
        ImageManipulator.manipulateAsync(asset.uri, actions, {
          compress: 0.9,
          format: ImageManipulator.SaveFormat.JPEG,
        }),
        PROCESS_TIMEOUT_MS,
        'ประมวลผลรูปไม่สำเร็จ',
      );
      onCapture({ ...photo, type: 'image', uris: [photo.uri] });
    } catch (error) {
      showAlert('เลือกสื่อไม่สำเร็จ', error.message, { tone: 'danger' });
    } finally {
      busy.current = false;
    }
  };

  const displayName = recipientName || 'เพื่อน';
  const canUseCamera = Boolean(permission?.granted);

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.stage}>
          {canUseCamera ? (
            <CameraView
              key={`cam-${facing}-${mode}-${cameraKey}`}
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode={mode}
              mirror={facing === 'front'}
              flash={flash ? 'on' : 'off'}
              enableTorch={mode === 'video' && flash}
              zoom={zoom}
              pictureSize={pictureSize}
              videoQuality="1080p"
              videoBitrate={4_500_000}
              animateShutter={Platform.OS === 'ios'}
              onCameraReady={handleCameraReady}
              onMountError={() => {
                setReady(false);
                showAlert('เปิดกล้องไม่สำเร็จ', 'ลองปิดแล้วเปิดกล้องอีกครั้ง', { tone: 'danger' });
              }}
            />
          ) : (
            <View style={styles.permission}>
              <View style={styles.permissionIcon}>
                <Ionicons color="#fff" name="camera-outline" size={36} />
              </View>
              <Text style={styles.permissionTitle}>ถ่ายรูปและวิดีโอส่งให้เพื่อน</Text>
              <Text style={styles.permissionCopy}>อนุญาตกล้องเพื่อเริ่มถ่ายจากแชต</Text>
              <Pressable
                accessibilityLabel={permission?.canAskAgain === false ? 'เปิดการตั้งค่า' : 'อนุญาตกล้อง'}
                onPress={() => (
                  permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()
                )}
                style={styles.allow}
              >
                <Text style={styles.allowText}>
                  {permission?.canAskAgain === false ? 'เปิดการตั้งค่า' : 'อนุญาตกล้อง'}
                </Text>
              </Pressable>
            </View>
          )}

          {grid ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {[1, 2].map((index) => (
                <React.Fragment key={index}>
                  <View style={[styles.gridVertical, { left: `${(index * 100) / 3}%` }]} />
                  <View style={[styles.gridHorizontal, { top: `${(index * 100) / 3}%` }]} />
                </React.Fragment>
              ))}
            </View>
          ) : null}

          <LinearGradient
            colors={['rgba(0,0,0,0.72)', 'transparent']}
            pointerEvents="none"
            style={[styles.topShade, { height: insets.top + 120 }]}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.82)']}
            pointerEvents="none"
            style={styles.bottomShade}
          />

          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <ToolButton accessibilityLabel="ปิดกล้อง" onPress={close}>
              <Ionicons color="#fff" name="close" size={26} />
            </ToolButton>

            <View style={styles.recipientChip}>
              {recipientAvatar ? (
                <Image source={{ uri: recipientAvatar }} style={styles.recipientAvatar} />
              ) : (
                <View style={styles.recipientAvatarFallback}>
                  <Ionicons color="#fff" name="person" size={14} />
                </View>
              )}
              <View style={styles.recipientCopy}>
                <Text numberOfLines={1} style={styles.recipientLabel}>ส่งถึง</Text>
                <Text numberOfLines={1} style={styles.recipientName}>{displayName}</Text>
              </View>
            </View>

            <ToolButton
              accessibilityLabel={flash ? 'ปิดแฟลช' : 'เปิดแฟลช'}
              active={flash}
              disabled={recording || processing}
              onPress={() => setFlash((value) => !value)}
            >
              <Ionicons color={flash ? '#FFD56A' : '#fff'} name={flash ? 'flash' : 'flash-off'} size={22} />
            </ToolButton>
          </View>

          {canUseCamera ? (
            <View style={[styles.sideTools, { top: insets.top + 96 }]}>
              <ToolButton
                accessibilityLabel="เปิดหรือปิดเส้นตาราง"
                active={grid}
                disabled={recording || processing}
                onPress={() => setGrid((value) => !value)}
              >
                <Ionicons color={grid ? '#FFD56A' : '#fff'} name="grid-outline" size={20} />
              </ToolButton>
              <ToolButton
                accessibilityLabel="ปรับซูมกล้อง"
                active={zoom > 0}
                disabled={recording || processing}
                onPress={() => setZoom((value) => (value === 0 ? 0.18 : 0))}
              >
                <Text style={[styles.zoomText, zoom > 0 && styles.zoomTextActive]}>
                  {zoom > 0 ? '2×' : '1×'}
                </Text>
              </ToolButton>
            </View>
          ) : null}

          {recording ? (
            <View style={[styles.recordingBadge, { top: insets.top + 72 }]}>
              <View style={styles.redDot} />
              <Text style={styles.recordingText}>
                00:{String(Math.floor(elapsed)).padStart(2, '0')} / 01:00
              </Text>
            </View>
          ) : null}

          <View style={[styles.bottomControls, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.modeRow}>
              {[['picture', 'รูปภาพ'], ['video', 'วิดีโอ']].map(([value, label]) => {
                const selected = mode === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityLabel={label}
                    disabled={recording || processing}
                    onPress={() => selectMode(value)}
                    style={[styles.modeChip, selected && styles.modeChipSelected]}
                  >
                    <Text style={[styles.modeChipText, selected && styles.modeChipTextSelected]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>
              {processing
                ? 'กำลังบันทึก…'
                : recording
                  ? 'แตะอีกครั้งเพื่อหยุด'
                  : mode === 'video'
                    ? 'วิดีโอชัดสูงสุด 60 วินาที'
                    : 'แตะชัตเตอร์เพื่อถ่าย'}
            </Text>

            <View style={styles.shutterRow}>
              <Pressable
                accessibilityLabel="เลือกรูปหรือวิดีโอจากคลัง"
                disabled={recording || processing}
                onPress={library}
                style={({ pressed }) => [
                  styles.galleryButton,
                  pressed && !recording && !processing && styles.toolPressed,
                  (recording || processing) && styles.toolDisabled,
                ]}
              >
                <Ionicons color="#fff" name="images-outline" size={24} />
              </Pressable>

              <Pressable
                accessibilityLabel={
                  recording
                    ? 'หยุดบันทึกวิดีโอ'
                    : mode === 'video'
                      ? 'เริ่มบันทึกวิดีโอ'
                      : 'ถ่ายรูป'
                }
                disabled={!ready || processing || !canUseCamera}
                onPress={capture}
                style={({ pressed }) => [
                  styles.shutterOuter,
                  mode === 'video' && styles.shutterOuterVideo,
                  recording && styles.shutterOuterRecording,
                  pressed && ready && !processing && styles.shutterPressed,
                  (!ready || processing || !canUseCamera) && styles.toolDisabled,
                ]}
              >
                <View
                  style={[
                    styles.shutterInner,
                    mode === 'video' && styles.shutterInnerVideo,
                    recording && styles.shutterInnerRecording,
                  ]}
                >
                  {processing ? <ActivityIndicator color={mode === 'video' ? '#fff' : '#111'} /> : null}
                </View>
              </Pressable>

              <Pressable
                accessibilityLabel="สลับกล้องหน้าและหลัง"
                disabled={recording || processing}
                onPress={() => {
                  setReady(false);
                  setFacing((value) => (value === 'back' ? 'front' : 'back'));
                }}
                style={({ pressed }) => [
                  styles.flipButton,
                  pressed && !recording && !processing && styles.toolPressed,
                  (recording || processing) && styles.toolDisabled,
                ]}
              >
                <Ionicons color="#fff" name="camera-reverse-outline" size={26} />
              </Pressable>
            </View>
          </View>

          {processing ? (
            <View pointerEvents="none" style={styles.processingScrim}>
              <View style={styles.processingCard}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.processingText}>
                  {mode === 'video' ? 'กำลังเตรียมวิดีโอ' : 'กำลังบันทึกรูปชัด'}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#050607',
    flex: 1,
  },
  stage: {
    backgroundColor: '#0B0D10',
    flex: 1,
  },
  topShade: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bottomShade: {
    bottom: 0,
    height: 280,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    zIndex: 5,
  },
  recipientChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(12,14,18,0.55)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 10,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  recipientAvatar: {
    borderRadius: 14,
    height: 28,
    width: 28,
  },
  recipientAvatarFallback: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  recipientCopy: {
    flexShrink: 1,
    paddingRight: 4,
  },
  recipientLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  recipientName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  tool: {
    alignItems: 'center',
    backgroundColor: 'rgba(12,14,18,0.5)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  toolActive: {
    backgroundColor: 'rgba(255,213,106,0.16)',
    borderColor: 'rgba(255,213,106,0.35)',
  },
  toolPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  toolDisabled: {
    opacity: 0.38,
  },
  sideTools: {
    gap: 12,
    left: 16,
    position: 'absolute',
    zIndex: 5,
  },
  zoomText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  zoomTextActive: {
    color: '#FFD56A',
  },
  recordingBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(8,10,12,0.72)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
    zIndex: 5,
  },
  redDot: {
    backgroundColor: '#FF4B5C',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  recordingText: {
    color: '#fff',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  bottomControls: {
    bottom: 0,
    gap: 14,
    left: 0,
    paddingHorizontal: 22,
    paddingTop: 18,
    position: 'absolute',
    right: 0,
    zIndex: 5,
  },
  modeRow: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  modeChip: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  modeChipSelected: {
    backgroundColor: '#fff',
  },
  modeChipText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '700',
  },
  modeChipTextSelected: {
    color: '#111',
  },
  hint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  shutterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  galleryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  flipButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 26,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  shutterOuter: {
    alignItems: 'center',
    borderColor: '#fff',
    borderRadius: 44,
    borderWidth: 4,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  shutterOuterVideo: {
    borderColor: 'rgba(255,255,255,0.92)',
  },
  shutterOuterRecording: {
    borderColor: '#FF4B5C',
  },
  shutterPressed: {
    transform: [{ scale: 0.94 }],
  },
  shutterInner: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  shutterInnerVideo: {
    backgroundColor: '#FF4B5C',
  },
  shutterInnerRecording: {
    borderRadius: 10,
    height: 28,
    width: 28,
  },
  processingScrim: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    zIndex: 8,
  },
  processingCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(12,14,18,0.78)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  processingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  permission: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  permissionIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 28,
    height: 72,
    justifyContent: 'center',
    marginBottom: 4,
    width: 72,
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  permissionCopy: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  allow: {
    backgroundColor: '#fff',
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  allowText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '800',
  },
  gridVertical: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth,
  },
  gridHorizontal: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
