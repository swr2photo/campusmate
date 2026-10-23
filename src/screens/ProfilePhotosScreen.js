import { Pressable } from '../components/NativePressable';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import FaceVerificationModal from '../components/FaceVerificationModal';
import ChatImageEditorModal from '../components/ChatImageEditorModal';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { MAX_PROFILE_PHOTOS } from '../data/profilePhotos';
import { useTheme } from '../theme';
import { showAlert } from '../utils/appAlert';
import { compressProfileImage, validateImageSize, MAX_PROFILE_IMAGE_SIZE_MB } from '../utils/compressImage';
import { getImageRequestUri } from '../utils/useRemoteImage';
import { prefetchGalleryImage, uploadGalleryImage } from '../services/profileGalleryService';
import { isCommittedProfilePhoto } from '../utils/profilePhoto';

const PHOTO_ROWS = Array.from({ length: Math.ceil(MAX_PROFILE_PHOTOS / 3) }, (_, row) =>
  Array.from({ length: 3 }, (_, column) => row * 3 + column).filter(index => index < MAX_PROFILE_PHOTOS));

function photoDraft(profile) {
  return {
    avatarUri: profile?.avatarUri || null,
    gallery: (Array.isArray(profile?.gallery) ? profile.gallery : [])
      .filter((uri) => typeof uri === 'string' && uri)
      .slice(0, MAX_PROFILE_PHOTOS - 1),
  };
}

function photoKey(draft) {
  return JSON.stringify([draft.avatarUri, draft.gallery]);
}

export default function ProfilePhotosScreen({ onClose }) {
  const { colors, isDark } = useTheme();
  const { profile } = useAppProfile();
  const { saveProfile, markFaceVerified } = useAppActions();
  const { showToast, showImageModeration } = useToast();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState(() => photoDraft(profile));
  const [savedKey, setSavedKey] = useState(() => photoKey(photoDraft(profile)));
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sheet, setSheet] = useState(null);
  const [verificationVisible, setVerificationVisible] = useState(false);
  const [verificationCandidate, setVerificationCandidate] = useState(null);
  const [mayLeave, setMayLeave] = useState(false);
  const [failedImages, setFailedImages] = useState({});
  const [imageAttempts, setImageAttempts] = useState({});
  const [editingPhoto, setEditingPhoto] = useState(null);
  // Local photos whose upload has started but not finished.
  const [uploading, setUploading] = useState({});
  const candidateRef = useRef(null);
  const editingPhotoRef = useRef(null);
  const mountedRef = useRef(true);
  const profileIdRef = useRef(profile?.id);
  profileIdRef.current = profile?.id;
  const savingRef = useRef(false);
  const processingRef = useRef(false);
  const verificationPassedRef = useRef(false);
  const photoActionTimer = useRef(null);
  const dirty = photoKey(draft) !== savedKey;
  const busy = saving || processing || verificationVisible || Boolean(editingPhoto);
  const background = isDark ? '#15120F' : colors.canvas;
  const sourceKey = photoKey(photoDraft(profile));

  // Remote profile updates may refresh a clean editor, but never replace a draft.
  useEffect(() => {
    if (dirty || savingRef.current || processingRef.current || verificationVisible || editingPhotoRef.current) return;
    const next = photoDraft(profile);
    setDraft(next);
    setSavedKey(photoKey(next));
  }, [sourceKey, profile?.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; editingPhotoRef.current = null; clearTimeout(photoActionTimer.current); };
  }, []);

  useEffect(() => {
    if (mayLeave) onClose?.();
  }, [mayLeave, onClose]);

  usePreventRemove(!mayLeave && (dirty || busy), ({ data }) => {
    if (savingRef.current || processingRef.current || verificationVisible || editingPhotoRef.current) {
      showToast('กรุณารอให้การจัดการรูปภาพเสร็จสิ้นก่อน', 'info');
      return;
    }
    showAlert('ยังไม่ได้บันทึกรูปภาพ', 'ต้องการออกและยกเลิกการเปลี่ยนแปลงรูปภาพหรือไม่?', [
      { text: 'แก้ไขต่อ', style: 'cancel' },
      { text: 'ยกเลิกการเปลี่ยนแปลง', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  const reportSaveError = useCallback((error) => {
    const message = error?.message || 'บันทึกรูปภาพไม่สำเร็จ กรุณาลองอีกครั้ง';
    setErrorMessage(message);
    if (error?.isModerationViolation || error?.isModerationUnavailable) showImageModeration(error);
    else showToast(message, 'error');
  }, [showImageModeration, showToast]);

  const savePhotos = async (nextDraft = draft, { close = false, message } = {}) => {
    if (savingRef.current || processingRef.current) return false;
    if (!nextDraft.avatarUri) {
      setErrorMessage('กรุณาเพิ่มรูปโปรไฟล์หลักก่อนบันทึก');
      showToast('กรุณาเพิ่มรูปโปรไฟล์หลักก่อนบันทึก', 'info');
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    setErrorMessage('');
    try {
        // Main-photo replacement goes through verifyMainPhoto; this persists
        // gallery edits alongside the already published main photo.
      const committed = await saveProfile({
        avatarUri: nextDraft.avatarUri,
        gallery: nextDraft.gallery.filter(Boolean).slice(0, MAX_PROFILE_PHOTOS - 1),
      });
      const next = photoDraft(committed || nextDraft);
      setDraft(next);
      setSavedKey(photoKey(next));
      showToast(message || 'บันทึกรูปภาพเรียบร้อยแล้ว', 'success');
      if (close) setMayLeave(true);
      return true;
    } catch (error) {
      reportSaveError(error);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const trackUpload = (uri, upload) => {
    setUploading((current) => ({ ...current, [uri]: true }));
    upload
      .finally(() => { if (mountedRef.current) setUploading(({ [uri]: _settled, ...rest }) => rest); })
      .catch(() => {});
    return upload;
  };

  // A moderated candidate has a unique immutable URL. Keep the published
  // main photo unchanged until the server commits its verification result.
  // The new photo shows at once and uploads while the consent screen is read.
  const verifyMainPhoto = (uri, gallery = draft.gallery) => {
    if (!uri || savingRef.current || processingRef.current) return;
    const ownerId = profile?.id;
    const upload = /^https:\/\//i.test(uri) ? Promise.resolve(uri) : trackUpload(uri, uploadGalleryImage(uri, ownerId));
    const candidate = { uri, upload, gallery: [...gallery], ownerId };
    candidateRef.current = candidate;
    upload.catch((error) => {
      if (candidateRef.current !== candidate || !mountedRef.current || profileIdRef.current !== ownerId) return;
      candidateRef.current = null;
      setVerificationVisible(false);
      setVerificationCandidate(null);
      reportSaveError(error);
    });
    setVerificationCandidate(candidate);
    verificationPassedRef.current = false;
    setVerificationVisible(true);
  };

  const showPhotoPermission = () => showAlert(
    'อนุญาตการเข้าถึงรูปภาพ',
    'เปิดสิทธิ์การเข้าถึงรูปภาพในการตั้งค่าแอป เพื่อเพิ่มรูปภาพในโปรไฟล์',
    [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'เปิดการตั้งค่า', onPress: () => Linking.openSettings().catch(() => showToast('เปิดการตั้งค่าไม่ได้ กรุณาเปิดจากการตั้งค่าของอุปกรณ์', 'info')) },
    ],
  );

  const openPhotoEditor = async (index, sourceUri, replacement = false) => {
    if (!sourceUri || savingRef.current || processingRef.current || editingPhotoRef.current || verificationVisible) return;
    const ownerId = profile?.id;
    processingRef.current = true;
    setProcessingIndex(index);
    setProcessing(true);
    setErrorMessage('');
    try {
      let uri = sourceUri;
      // The editor's native rotate/crop tools need a local file. Fetch the
      // owner's current image revision rather than a stale same-URL preview.
      if (/^https?:\/\//i.test(uri)) {
        const target = `${FileSystem.cacheDirectory}profile_edit_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const response = await FileSystem.downloadAsync(getImageRequestUri(uri, index === 0 ? profile?.avatarRevision : undefined), target);
        if (response.status < 200 || response.status >= 300) throw new Error('โหลดรูปสำหรับแก้ไขไม่สำเร็จ กรุณาลองอีกครั้ง');
        uri = response.uri;
      }
      const validation = await validateImageSize(uri, null, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!validation.valid) throw new Error(validation.error);
      if (!mountedRef.current || profileIdRef.current !== ownerId) return;
      const session = { index, uri, uris: [uri], sourceUri, replacement, ownerId, gallery: [...draft.gallery] };
      editingPhotoRef.current = session;
      setEditingPhoto(session);
    } catch (error) {
      if (mountedRef.current && profileIdRef.current === ownerId) {
        setErrorMessage(error?.message || 'เปิดตัวแก้ไขรูปภาพไม่สำเร็จ');
        showToast(error?.message || 'เปิดตัวแก้ไขรูปภาพไม่สำเร็จ', 'error');
      }
    } finally {
      processingRef.current = false;
      if (mountedRef.current) setProcessing(false);
    }
  };

  const closePhotoEditor = () => {
    if (processingRef.current) return;
    editingPhotoRef.current = null;
    setEditingPhoto(null);
  };

  const applyEditedPhoto = async (result) => {
    const session = editingPhotoRef.current;
    if (!session || processingRef.current || profileIdRef.current !== session.ownerId) return;
    const editedUri = Array.isArray(result) ? result[0] : result;
    if (!editedUri) throw new Error('ไม่พบรูปภาพที่แก้ไข');
    if (!session.replacement && editedUri === session.uri) { closePhotoEditor(); return; }
    processingRef.current = true;
    setProcessingIndex(session.index);
    setProcessing(true);
    try {
      const uri = await compressProfileImage(editedUri);
      if (!mountedRef.current || editingPhotoRef.current !== session || profileIdRef.current !== session.ownerId) return;
      if (session.index === 0) {
        editingPhotoRef.current = null;
        setEditingPhoto(null);
        // Dismiss the shared native editor before opening face verification.
        // Keep the parent busy, but release the lock needed by savePhotos.
        processingRef.current = false;
        await new Promise(resolve => setTimeout(resolve, 350));
        if (mountedRef.current && profileIdRef.current === session.ownerId) await verifyMainPhoto(uri, session.gallery);
      } else {
        setDraft(current => {
          const gallery = [...current.gallery];
          gallery[session.index - 1] = uri;
          return { ...current, gallery: gallery.filter(Boolean).slice(0, MAX_PROFILE_PHOTOS - 1) };
        });
        editingPhotoRef.current = null;
        setEditingPhoto(null);
        // Upload now so saving only waits for what is still in flight.
        const upload = prefetchGalleryImage(uri, session.ownerId);
        if (upload) {
          trackUpload(uri, upload).catch((error) => {
            if (!error?.isModerationViolation || !mountedRef.current || profileIdRef.current !== session.ownerId) return;
            // A blocked photo can never be saved: take it out and say why.
            setDraft((current) => ({ ...current, gallery: current.gallery.filter((item) => item !== uri) }));
            showImageModeration(error);
          });
        }
      }
    } finally {
      processingRef.current = false;
      if (mountedRef.current) setProcessing(false);
    }
  };

  const pickPhoto = async (index) => {
    if (savingRef.current || processingRef.current || verificationVisible) return;
    processingRef.current = true;
    setProcessingIndex(index);
    setProcessing(true);
    setErrorMessage('');
    let selectedUri = null;
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          showPhotoPermission();
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const validation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!validation.valid) throw new Error(validation.error);
      selectedUri = asset.uri;
    } catch (error) {
      if (/permission|denied/i.test(String(error?.code || ''))) showPhotoPermission();
      else {
        setErrorMessage(error?.message || 'เพิ่มรูปภาพไม่สำเร็จ กรุณาลองอีกครั้ง');
        showToast(error?.message || 'เพิ่มรูปภาพไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
      }
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
    if (selectedUri) await openPhotoEditor(index, selectedUri, true);
  };

  // Let the native action sheet dismiss before presenting the system photo picker.
  const replacePhoto = (index) => {
    setSheet(null);
    clearTimeout(photoActionTimer.current);
    photoActionTimer.current = setTimeout(() => pickPhoto(index), 350);
  };

  const editPhoto = (index, uri) => {
    setSheet(null);
    clearTimeout(photoActionTimer.current);
    photoActionTimer.current = setTimeout(() => openPhotoEditor(index, uri), 350);
  };

  const makeMainPhoto = (index) => {
    setSheet(null);
    const uri = draft.gallery[index - 1];
    if (!uri) return;
    const gallery = [...draft.gallery];
    if (draft.avatarUri) gallery[index - 1] = draft.avatarUri;
    else gallery.splice(index - 1, 1);
    verifyMainPhoto(uri, gallery);
  };

  const deletePhoto = (index) => {
    setSheet(null);
    if (index === 0) {
      if (!draft.gallery.length) {
        showAlert('ต้องมีรูปโปรไฟล์หลัก', 'เพิ่มรูปอื่นก่อนลบรูปหลัก หรือเลือกเปลี่ยนรูปภาพ');
        return;
      }
      showAlert('ลบรูปโปรไฟล์หลัก?', 'รูปถัดไปจะเป็นรูปหลัก และต้องยืนยันใบหน้าอีกครั้งก่อนบันทึก', [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ลบและเลือกรูปถัดไป', style: 'destructive', onPress: () => verifyMainPhoto(draft.gallery[0], draft.gallery.slice(1)) },
      ]);
      return;
    }
    showAlert('ลบรูปภาพ?', 'รูปนี้จะถูกนำออกจากโปรไฟล์เมื่อกดบันทึก', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ลบรูปภาพ', style: 'destructive', onPress: () => setDraft((current) => ({ ...current, gallery: current.gallery.filter((_, slot) => slot !== index - 1) })) },
    ]);
  };

  const selectedIndex = typeof sheet === 'number' ? sheet : null;
  const selectedUri = selectedIndex === 0 ? draft.avatarUri : draft.gallery[(selectedIndex ?? 0) - 1];
  const sheetWidth = Math.max(1, Math.min(width - 48, 560));
  const actionStyle = [styles.action, { borderColor: colors.line }];
  const confirmPhotos = () => {
    if (!dirty) { setMayLeave(true); return; }
    if (draft.avatarUri !== profile?.avatarUri) return verifyMainPhoto(draft.avatarUri, draft.gallery);
    return savePhotos(draft, { close: true });
  };

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityLabel="กลับไปโปรไฟล์" accessibilityRole="button" disabled={busy} onPress={onClose} style={({ pressed }) => [styles.backButton, { backgroundColor: colors.surfaceRaised }, pressed && styles.pressed]}>
          <FeatureIcon name="chevron.left" size={22} color={colors.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>รูปภาพของฉัน</Text>
        <Pressable
          accessibilityLabel={saving ? 'กำลังบันทึกรูปภาพ' : 'บันทึกรูปภาพ'}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy: saving }}
          disabled={busy}
          onPress={confirmPhotos}
          style={({ pressed }) => [styles.doneButton, (pressed || busy) && styles.pressed]}
        >
          {saving ? <ActivityIndicator size="small" color="#111111" /> : <FeatureIcon name="checkmark" size={30} color="#111111" />}
        </Pressable>
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 28, 48) }]}>
        {errorMessage ? <Text selectable style={[styles.error, { color: colors.danger }]}>{errorMessage}</Text> : null}
        <View style={styles.grid}>
          {PHOTO_ROWS.map((row, rowIndex) => <View key={rowIndex} style={styles.photoRow}>
          {row.map(index => {
            // A new main photo shows while it waits for face verification.
            const pendingMain = index === 0 && verificationCandidate?.uri ? verificationCandidate.uri : null;
            const uri = index === 0 ? pendingMain || draft.avatarUri : draft.gallery[index - 1];
            return (
              <Pressable
                accessibilityLabel={uri ? `จัดการรูป${index === 0 ? 'โปรไฟล์หลัก' : `ที่ ${index + 1}`}` : `เพิ่มรูป${index === 0 ? 'โปรไฟล์หลัก' : `ที่ ${index + 1}`}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                key={index}
                onPress={() => uri ? setSheet(index) : pickPhoto(index)}
                style={({ pressed }) => [styles.photoSlot, pressed && styles.pressed]}
              >
                <View style={[styles.photoFrame, { backgroundColor: isDark ? '#000000' : colors.surfaceRaised }]}>
                  {uri ? <Image key={`${uri}:${imageAttempts[uri] || 0}`} onLoad={() => setFailedImages(current => ({ ...current, [uri]: false }))} source={{ uri: getImageRequestUri(uri, index === 0 ? profile?.avatarRevision : undefined) }} contentFit="cover" style={StyleSheet.absoluteFill} onError={() => setFailedImages((current) => ({ ...current, [uri]: true }))} /> : null}
                  {uri && failedImages[uri] ? <View style={styles.imageError}><FeatureIcon name="photo.badge.exclamationmark" size={26} color={colors.inkMuted} /><Text style={{ color: colors.inkMuted, textAlign: 'center', fontSize: 12 }}>โหลดรูปไม่สำเร็จ</Text><Pressable accessibilityRole="button" accessibilityLabel={`ลองโหลดรูปที่ ${index + 1} อีกครั้ง`} onPress={event => { event.stopPropagation(); setFailedImages(current => ({ ...current, [uri]: false })); setImageAttempts(current => ({ ...current, [uri]: (current[uri] || 0) + 1 })); }} style={{ minHeight: 48, paddingHorizontal: 6, justifyContent: 'center' }}><Text style={{ color: colors.accentText, fontWeight: '700', textAlign: 'center' }}>ลองโหลดใหม่</Text></Pressable></View> : null}
                  {(uri && uploading[uri]) || (processing && processingIndex === index) ? <View style={styles.uploadStatus} accessibilityLiveRegion="polite"><ActivityIndicator size="small" color="#FFFFFF" /><Text style={styles.uploadStatusText}>{uploading[uri] ? 'กำลังอัปโหลด…' : 'กำลังเตรียมรูป…'}</Text></View> : null}
                  {uri && index === 0 ? <View style={styles.mainBadge}><Text style={styles.mainBadgeText}>{pendingMain ? 'รอยืนยันใบหน้า' : 'รูปหลัก'}</Text></View> : null}
                </View>
                <View pointerEvents="none" style={[styles.slotAction, { backgroundColor: uri ? '#2A2724' : '#FFFFFF' }]}>
                  <FeatureIcon name={uri ? 'pencil' : 'plus'} size={uri ? 18 : 27} color={uri ? '#FFFFFF' : '#111111'} />
                </View>
              </Pressable>
            );
          })}
          </View>)}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setSheet('tips')} style={styles.tipsLink}>
          <Text style={{ color: isDark ? '#62A8FF' : colors.primary, fontSize: 16, textDecorationLine: 'underline' }}>โดดเด่นด้วยเคล็ดลับเลือกรูป</Text>
        </Pressable>

      </ScrollView>
      <Host colorScheme={isDark ? 'dark' : 'light'} style={styles.sheetHost}>
        <BottomSheet isPresented={sheet !== null} onDismiss={() => setSheet(null)} containerColor={background} contentPadding={16}>
          <RNHostView matchContents>
            <View style={{ width: sheetWidth, paddingBottom: 16 }}>
              {sheet === 'tips' ? (
                <>
                  <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>เลือกรูปที่เป็นตัวคุณ</Text>
                  <Text style={[styles.tipsText, { color: colors.inkMuted }]}>ใช้รูปที่เห็นใบหน้าชัดเจนในแสงธรรมชาติสำหรับรูปหลัก และเพิ่มรูปกิจกรรมที่ชอบ เพื่อให้เพื่อนใหม่รู้จักคุณได้มากขึ้น</Text>
                  <Text style={[styles.tipsText, { color: colors.inkMuted }]}>เลือกรูปของตัวเอง หลีกเลี่ยงรูปหมู่ที่แยกไม่ออกว่าเป็นใคร และไม่ใส่ข้อมูลส่วนตัวลงในรูปภาพ</Text>
                  <Text style={[styles.tipsText, { color: colors.inkMuted }]}>เพิ่มได้สูงสุด {MAX_PROFILE_PHOTOS} รูป รูปหลักต้องผ่านการยืนยันใบหน้า และรูปทั้งหมดจะผ่านการตรวจสอบก่อนแสดงในโปรไฟล์</Text>
                  <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={[styles.sheetClose, { backgroundColor: colors.surfaceRaised }]}><Text style={{ color: colors.ink, fontSize: 17 }}>เข้าใจแล้ว</Text></Pressable>
                </>
              ) : selectedIndex !== null && selectedUri ? (
                <>
                  <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>{selectedIndex === 0 ? 'รูปโปรไฟล์หลัก' : `รูปที่ ${selectedIndex + 1}`}</Text>
                  <Pressable accessibilityRole="button" onPress={() => editPhoto(selectedIndex, selectedUri)} style={actionStyle}><FeatureIcon name="slider.horizontal.3" color={colors.ink} size={22} /><Text style={[styles.actionText, { color: colors.ink }]}>แก้ไขรูปภาพ</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => replacePhoto(selectedIndex)} style={actionStyle}><FeatureIcon name="pencil" color={colors.ink} size={22} /><Text style={[styles.actionText, { color: colors.ink }]}>เปลี่ยนรูปภาพ</Text></Pressable>
                  {selectedIndex > 0 ? <Pressable accessibilityRole="button" onPress={() => makeMainPhoto(selectedIndex)} style={actionStyle}><FeatureIcon name="person.crop.square.fill" color={colors.ink} size={22} /><Text style={[styles.actionText, { color: colors.ink }]}>ตั้งเป็นรูปหลัก</Text></Pressable> : null}
                  <Pressable accessibilityRole="button" onPress={() => deletePhoto(selectedIndex)} style={actionStyle}><FeatureIcon name="trash" color={colors.danger} size={22} /><Text style={[styles.actionText, { color: colors.danger }]}>ลบรูปภาพ</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={[styles.sheetClose, { backgroundColor: colors.surfaceRaised }]}><Text style={{ color: colors.ink, fontSize: 17 }}>ยกเลิก</Text></Pressable>
                </>
              ) : <View />}
            </View>
          </RNHostView>
        </BottomSheet>
      </Host>
      {editingPhoto ? <ChatImageEditorModal
        visible imageUri={editingPhoto.uri} imageUris={editingPhoto.uris}
        confirmLabel="ใช้รูปนี้" showCaption={false}
        onSend={applyEditedPhoto} onClose={closePhotoEditor}
      /> : null}
      <FaceVerificationModal
        avatarUri={verificationCandidate?.uri || draft.avatarUri}
        candidateAvatarUri={verificationCandidate?.uri}
        visible={verificationVisible}
        onClose={() => {
          candidateRef.current = null;
          setVerificationVisible(false);
          setVerificationCandidate(null);
          if (!verificationPassedRef.current) showToast('ยังไม่ได้เปลี่ยนรูปหลัก ต้องยืนยันรูปใหม่ให้ผ่านก่อน', 'info');
        }}
        onSuccess={async () => {
          const candidate = verificationCandidate;
          if (!candidate || profileIdRef.current !== candidate.ownerId) return;
          // Verification started from the uploaded copy, so this has settled.
          const uploadedUri = await candidate.upload;
          const committed = await markFaceVerified?.(uploadedUri);
          if (!mountedRef.current || profileIdRef.current !== candidate.ownerId) return;
          if (!isCommittedProfilePhoto(committed, uploadedUri)) throw new Error('ยังบันทึกรูปใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง');
          verificationPassedRef.current = true;
          setDraft({ avatarUri: committed.avatarUri, gallery: candidate.gallery });
          setSavedKey(photoKey(photoDraft(committed)));
          showToast('ยืนยันใบหน้าเรียบร้อยแล้ว', 'success');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 18, paddingBottom: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 23, fontWeight: '500', textAlign: 'center' },
  doneButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 14 },
  grid: { rowGap: 16, paddingTop: 10 },
  photoRow: { flexDirection: 'row', columnGap: 14 },
  photoSlot: { position: 'relative', flex: 1, minWidth: 0, aspectRatio: 2 / 3 },
  photoFrame: { width: '100%', height: '100%', borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden' },
  slotAction: { position: 'absolute', top: -8, right: -7, width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  mainBadge: { position: 'absolute', left: 7, bottom: 7, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  mainBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  uploadBadge: { position: 'absolute', left: 7, top: 7, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  imageError: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 8, gap: 6 },
  tipsLink: { alignSelf: 'flex-start', paddingVertical: 18, minHeight: 44 },
  error: { fontSize: 14, paddingBottom: 16 },
  uploadStatus: { position: 'absolute', left: 5, right: 5, top: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', gap: 4 },
  uploadStatusText: { fontSize: 11, color: '#FFF', textAlign: 'center' },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetHost: { position: 'absolute' },
  sheetTitle: { fontSize: 22, fontWeight: '600', paddingBottom: 16 },
  tipsText: { fontSize: 16, paddingBottom: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  actionText: { flex: 1, fontSize: 17 },
  sheetClose: { alignItems: 'center', justifyContent: 'center', minHeight: 50, borderRadius: 25, paddingHorizontal: 20, paddingVertical: 10, marginTop: 16 },
  pressed: { opacity: 0.55 },
});
