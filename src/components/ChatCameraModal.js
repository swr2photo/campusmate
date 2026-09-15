import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { prepareRecordedVideo } from '../services/chatVideoService';

export default function ChatCameraModal({ recipientName, onCapture, onClose }) {
  const insets = useSafeAreaInsets();
  const camera = useRef(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const recordingRef = useRef(false);
  const stopTimer = useRef(null);
  const permissionPrompt = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [permission, requestPermission] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [facing, setFacing] = useState('back');
  const [mode, setMode] = useState('picture');
  const [flash, setFlash] = useState(false);
  const [grid, setGrid] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' && !permissionPrompt.current) { mounted.current = false; camera.current?.stopRecording(); closeRef.current(); }
    });
    return () => { mounted.current = false; clearTimeout(stopTimer.current); subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(Math.min(60, (Date.now() - started.current) / 1000)), 100);
    return () => clearInterval(timer);
  }, [recording]);
  const close = () => {
    mounted.current = false;
    if (recordingRef.current) camera.current?.stopRecording();
    onClose();
  };
  const finish = asset => { if (mounted.current) onCapture(asset); };
  const selectMode = async value => {
    if (busy.current || mode === value) return;
    busy.current = true;
    permissionPrompt.current = true;
    try {
      if (value === 'video' && !microphone?.granted && !(await requestMicrophone()).granted) {
        Alert.alert('ต้องอนุญาตไมโครโฟน', 'เปิดสิทธิ์ไมโครโฟนเพื่อบันทึกวิดีโอพร้อมเสียง');
        return;
      }
      if (mounted.current) { setReady(false); setMode(value); }
    } catch (error) {
      if (mounted.current) Alert.alert('เปิดโหมดวิดีโอไม่สำเร็จ', error.message);
    } finally { busy.current = false; permissionPrompt.current = false; }
  };
  const capture = async () => {
    if (recordingRef.current) {
      // CameraX needs time to receive frames before a valid clip can be finalized.
      if (!stopTimer.current) stopTimer.current = setTimeout(() => {
        stopTimer.current = null;
        if (recordingRef.current) camera.current?.stopRecording();
      }, Math.max(0, 1200 - (Date.now() - started.current)));
      return;
    }
    if (!ready || busy.current) return;
    busy.current = true;
    try {
      if (mode === 'video') {
        permissionPrompt.current = true;
        const microphoneGranted = microphone?.granted || (await requestMicrophone()).granted;
        permissionPrompt.current = false;
        if (!microphoneGranted) {
          Alert.alert('ต้องอนุญาตไมโครโฟน', 'เปิดสิทธิ์ไมโครโฟนเพื่อบันทึกวิดีโอพร้อมเสียง');
          return;
        }
        if (!mounted.current) return;
        started.current = Date.now(); setElapsed(0); recordingRef.current = true; setRecording(true);
        const video = await camera.current.recordAsync({ maxDuration: 60, maxFileSize: 24 * 1024 * 1024 });
        recordingRef.current = false;
        if (!mounted.current) return;
        setRecording(false); setProcessing(true);
        if (video?.uri) finish({ ...await prepareRecordedVideo(video.uri, Math.round((Date.now() - started.current))), type: 'video' });
      } else {
        setProcessing(true);
        const photo = await camera.current.takePictureAsync({ quality: 0.85 });
        if (!photo?.uri || !mounted.current) return;
        const actions = photo.width > 1440 ? [{ resize: { width: 1440 } }] : [];
        const result = await ImageManipulator.manipulateAsync(photo.uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
        finish({ ...result, type: 'image', uris: [result.uri] });
      }
    } catch (error) {
      if (mounted.current) Alert.alert('บันทึกไม่สำเร็จ', error.message || 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      clearTimeout(stopTimer.current); stopTimer.current = null;
      permissionPrompt.current = false;
      busy.current = false; recordingRef.current = false;
      if (mounted.current) { setProcessing(false); setRecording(false); }
    }
  };
  const library = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false, quality: 0.85, videoMaxDuration: 60 });
      if (result.canceled) return;
      const asset = result.assets[0];
      // The OS picker temporarily deactivates the camera screen. Selection still
      // returns to its owner; do not keep a live camera session under the picker.
      if (asset.type === 'video') {
        if (!Number.isFinite(asset.duration) || asset.duration <= 0) throw new Error('ไม่สามารถตรวจสอบความยาววิดีโอได้');
        // Let ChatVideoComposer trim long library clips before applying the
        // 60-second upload policy.
        onCapture(asset);
      }
      else {
        const photo = await ImageManipulator.manipulateAsync(asset.uri, asset.width > 1440 ? [{ resize: { width: 1440 } }] : [], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
        onCapture({ ...photo, type: 'image', uris: [photo.uri] });
      }
    } catch (error) { Alert.alert('เลือกสื่อไม่สำเร็จ', error.message); }
    finally { busy.current = false; }
  };
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <View style={styles.root}>
      <View style={[styles.heading, { paddingTop: insets.top + 9 }]}><Text style={styles.headingText}>ส่งข้อความถึง <Text style={{ fontWeight: '800' }}>{recipientName || 'เพื่อน'}</Text></Text></View>
      <View style={styles.stage}>
        {permission?.granted ? <CameraView key={`${mode}-${facing}`} ref={camera} style={StyleSheet.absoluteFill}
          facing={facing} mode={mode} flash={flash ? 'on' : 'off'} enableTorch={mode === 'video' && flash} zoom={zoom}
          videoQuality="720p" videoBitrate={2000000} onCameraReady={() => setReady(true)} onMountError={() => { setReady(false); Alert.alert('เปิดกล้องไม่สำเร็จ', 'ลองปิดแล้วเปิดกล้องอีกครั้ง'); }} />
          : <View style={styles.permission}>
            <Ionicons name="camera-outline" size={52} color="#fff" /><Text style={styles.permissionTitle}>ถ่ายรูปและวิดีโอส่งให้เพื่อน</Text>
            <Text style={styles.hint}>อนุญาตให้ใช้กล้องเพื่อเริ่มถ่าย</Text>
            <Pressable style={styles.allow} onPress={() => permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()}><Text style={{ fontWeight: '700' }}>{permission?.canAskAgain === false ? 'เปิดการตั้งค่า' : 'อนุญาตกล้อง'}</Text></Pressable>
          </View>}
        {grid && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[1, 2].map(i => <React.Fragment key={i}><View style={[styles.gridVertical, { left: `${i * 100 / 3}%` }]} /><View style={[styles.gridHorizontal, { top: `${i * 100 / 3}%` }]} /></React.Fragment>)}
        </View>}
        <LinearGradient pointerEvents="none" colors={['#0008', 'transparent']} style={styles.topShade} />
        <View style={styles.topControls}>
          <View style={{ width: 46 }} />
          <Pressable accessibilityLabel={flash ? 'ปิดแฟลช' : 'เปิดแฟลช'} disabled={recording} onPress={() => setFlash(v => !v)} style={styles.tool}><Ionicons name={flash ? 'flash' : 'flash-off'} size={27} color={flash ? '#ffd773' : '#fff'} /></Pressable>
          <Pressable accessibilityLabel="ปิดกล้อง" onPress={close} style={styles.tool}><Ionicons name="close" size={34} color="#fff" /></Pressable>
        </View>
        {permission?.granted && <View style={styles.sideTools}>
          <Pressable accessibilityLabel="เปิดหรือปิดเส้นตาราง" onPress={() => setGrid(v => !v)} style={styles.tool}><Ionicons name="grid-outline" size={25} color={grid ? '#ffd773' : '#fff'} /></Pressable>
          <Pressable accessibilityLabel="ปรับซูมกล้อง" onPress={() => setZoom(v => v === 0 ? 0.15 : 0)} style={styles.tool}><Text style={styles.zoom}>{zoom ? '+' : '1x'}</Text></Pressable>
        </View>}
        {recording && <View style={styles.recording}><View style={styles.redDot} /><Text style={styles.white}>00:{String(Math.floor(elapsed)).padStart(2, '0')} / 01:00</Text></View>}
        <View style={styles.bottomControls}>
          <Text style={styles.hint}>{recording ? 'แตะเพื่อหยุดบันทึก' : mode === 'video' ? 'วิดีโอสูงสุด 60 วินาที' : 'แตะเพื่อถ่ายรูป'}</Text>
          <View style={styles.shutterRow}>
            <Pressable accessibilityLabel="เลือกรูปหรือวิดีโอจากคลัง" disabled={recording || processing} onPress={library} style={styles.gallery}><Ionicons name="images-outline" size={27} color="#fff" /></Pressable>
            <Pressable accessibilityLabel={recording ? 'หยุดบันทึกวิดีโอ' : mode === 'video' ? 'เริ่มบันทึกวิดีโอ' : 'ถ่ายรูป'} disabled={!ready || processing} onPress={capture} style={[styles.shutter, recording && { borderColor: '#ff4a5c' }]}>
              {processing ? <ActivityIndicator color="#fff" /> : <View style={[styles.shutterInside, mode === 'video' && { backgroundColor: '#ff4a5c' }, recording && { width: 30, height: 30, borderRadius: 7 }]} />}
            </Pressable>
            <Pressable accessibilityLabel="สลับกล้องหน้าและหลัง" disabled={recording || processing} onPress={() => { setReady(false); setFacing(v => v === 'back' ? 'front' : 'back'); }} style={styles.flip}><Ionicons name="camera-reverse-outline" size={30} color="#fff" /></Pressable>
          </View>
        </View>
      </View>
      <View style={[styles.modes, { paddingBottom: Math.max(insets.bottom, 18) }]}>
        {[['picture', 'รูปภาพ'], ['video', 'วิดีโอ']].map(([value, label]) => <Pressable key={value} disabled={recording || processing} onPress={() => selectMode(value)} style={[styles.mode, mode === value && styles.modeSelected]}>
          <Text style={[styles.white, mode === value && { fontWeight: '800' }]}>{label}</Text>
        </Pressable>)}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' }, heading: { paddingBottom: 17, alignItems: 'center' }, headingText: { color: '#fff', fontSize: 16 },
  stage: { flex: 1, overflow: 'hidden', borderRadius: 24, backgroundColor: '#101010' }, topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
  topControls: { position: 'absolute', top: 12, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tool: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#0003' },
  sideTools: { position: 'absolute', left: 14, top: '40%', gap: 20 }, zoom: { color: '#fff', fontSize: 20, fontWeight: '700' },
  bottomControls: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 24, paddingTop: 18, backgroundColor: '#0005', gap: 20 },
  shutterRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  shutter: { width: 86, height: 86, borderRadius: 43, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  shutterInside: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff' },
  gallery: { width: 48, height: 48, borderRadius: 13, borderColor: '#fff', borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2229' },
  flip: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#3339', alignItems: 'center', justifyContent: 'center' },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 18 }, mode: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20 }, modeSelected: { backgroundColor: '#262626' },
  white: { color: '#fff', fontSize: 14 }, hint: { color: '#ddd', fontSize: 12, textAlign: 'center' },
  recording: { position: 'absolute', top: 80, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 20, backgroundColor: '#0009' }, redDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4a5c' },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15, padding: 24 }, permissionTitle: { color: '#fff', fontSize: 18, fontWeight: '700' }, allow: { backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 24, paddingVertical: 14 },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#fff4' }, gridHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#fff4' },
});
