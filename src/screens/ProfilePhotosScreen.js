import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import FaceVerificationModal from '../components/FaceVerificationModal';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { MAX_PROFILE_PHOTOS } from '../data/profilePhotos';
import { useTheme } from '../theme';
import { showAlert } from '../utils/appAlert';
import { compressProfileImage, validateImageSize, MAX_PROFILE_IMAGE_SIZE_MB } from '../utils/compressImage';

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
  const [errorMessage, setErrorMessage] = useState('');
  const [sheet, setSheet] = useState(null);
  const [verificationVisible, setVerificationVisible] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState(null);
  const [mayLeave, setMayLeave] = useState(false);
  const [failedImages, setFailedImages] = useState({});
  const [gridWidth, setGridWidth] = useState(0);
  const savingRef = useRef(false);
  const processingRef = useRef(false);
  const pendingAvatarRef = useRef(null);
  const verifiedDraftRef = useRef(null);
  const verificationPassedRef = useRef(false);
  const photoActionTimer = useRef(null);
  const dirty = photoKey(draft) !== savedKey;
  const busy = saving || processing || verificationVisible;
  const background = isDark ? '#15120F' : colors.canvas;
  const sourceKey = photoKey(photoDraft(profile));

  // Remote profile updates may refresh a clean editor, but never replace a draft.
  useEffect(() => {
    if (dirty || savingRef.current || processingRef.current || verificationVisible) return;
    const next = photoDraft(profile);
    setDraft(next);
    setSavedKey(photoKey(next));
  }, [sourceKey, profile?.id]);

  useEffect(() => () => clearTimeout(photoActionTimer.current), []);

  useEffect(() => {
    if (mayLeave) onClose?.();
  }, [mayLeave, onClose]);

  usePreventRemove(!mayLeave && (dirty || busy), ({ data }) => {
    if (savingRef.current || processingRef.current || verificationVisible) {
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

  const savePhotos = async (nextDraft = draft, { close = false, verification } = {}) => {
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
      const verified = verification || (verifiedDraftRef.current?.uri === nextDraft.avatarUri ? verifiedDraftRef.current : null);
      const committed = await saveProfile({
        avatarUri: nextDraft.avatarUri,
        gallery: nextDraft.gallery.filter(Boolean).slice(0, MAX_PROFILE_PHOTOS - 1),
        ...(verified ? {
          isFaceVerified: true,
          faceMatchScore: verified.similarity,
          faceVerificationStatus: 'verified',
        } : {}),
      });
      const next = photoDraft(committed || nextDraft);
      setDraft(next);
      setSavedKey(photoKey(next));
      if (verified) markFaceVerified?.(verified.similarity);
      verifiedDraftRef.current = null;
      showToast(verified ? 'ยืนยันใบหน้าและบันทึกรูปโปรไฟล์เรียบร้อยแล้ว' : 'บันทึกรูปภาพเรียบร้อยแล้ว', 'success');
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

  const verifyMainPhoto = (uri, gallery = draft.gallery) => {
    const next = { uri, gallery: [...gallery] };
    pendingAvatarRef.current = next;
    setPendingAvatar(next);
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

  const pickPhoto = async (index) => {
    if (savingRef.current || processingRef.current || verificationVisible) return;
    processingRef.current = true;
    setProcessing(true);
    setErrorMessage('');
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
        allowsEditing: true,
        aspect: [2, 3],
        quality: 0.85,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const validation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!validation.valid) throw new Error(validation.error);
      const uri = await compressProfileImage(asset.uri);
      if (index === 0) {
        verifyMainPhoto(uri);
      } else {
        setDraft((current) => {
          const gallery = [...current.gallery];
          gallery[index - 1] = uri;
          return { ...current, gallery: gallery.filter(Boolean).slice(0, MAX_PROFILE_PHOTOS - 1) };
        });
      }
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
  };

  // Let the native action sheet dismiss before presenting the system photo picker.
  const replacePhoto = (index) => {
    setSheet(null);
    clearTimeout(photoActionTimer.current);
    photoActionTimer.current = setTimeout(() => pickPhoto(index), 350);
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

  const slotWidth = Math.max(1, ((gridWidth || Math.min(width - 40, 560)) - 28) / 3);
  const selectedIndex = typeof sheet === 'number' ? sheet : null;
  const selectedUri = selectedIndex === 0 ? draft.avatarUri : draft.gallery[(selectedIndex ?? 0) - 1];
  const sheetWidth = Math.max(1, Math.min(width - 48, 560));
  const actionStyle = [styles.action, { borderColor: colors.line }];

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
          onPress={() => dirty ? savePhotos(draft, { close: true }) : setMayLeave(true)}
          style={({ pressed }) => [styles.doneButton, (pressed || busy) && styles.pressed]}
        >
          {saving ? <ActivityIndicator size="small" color="#111111" /> : <FeatureIcon name="checkmark" size={30} color="#111111" />}
        </Pressable>
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 28, 48) }]}>
        {errorMessage ? <Text selectable style={[styles.error, { color: colors.danger }]}>{errorMessage}</Text> : null}
        <View style={styles.grid} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)}>
          {Array.from({ length: MAX_PROFILE_PHOTOS }, (_, index) => {
            const uri = index === 0 ? draft.avatarUri : draft.gallery[index - 1];
            return (
              <Pressable
                accessibilityLabel={uri ? `จัดการรูป${index === 0 ? 'โปรไฟล์หลัก' : `ที่ ${index + 1}`}` : `เพิ่มรูป${index === 0 ? 'โปรไฟล์หลัก' : `ที่ ${index + 1}`}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                key={index}
                onPress={() => uri ? setSheet(index) : pickPhoto(index)}
                style={({ pressed }) => [styles.photoSlot, { width: slotWidth, height: slotWidth * 1.5 }, pressed && styles.pressed]}
              >
                <View style={[styles.photoFrame, { backgroundColor: isDark ? '#000000' : colors.surfaceRaised }]}>
                  {uri ? <Image source={{ uri }} contentFit="cover" style={StyleSheet.absoluteFill} onError={() => setFailedImages((current) => ({ ...current, [uri]: true }))} /> : null}
                  {uri && failedImages[uri] ? <View style={styles.imageError}><FeatureIcon name="photo.badge.exclamationmark" size={26} color={colors.inkMuted} /><Text style={{ color: colors.inkMuted, textAlign: 'center', fontSize: 12 }}>รูปภาพไม่พร้อมใช้งาน</Text></View> : null}
                  {uri && index === 0 ? <View style={styles.mainBadge}><Text style={styles.mainBadgeText}>รูปหลัก</Text></View> : null}
                </View>
                <View pointerEvents="none" style={[styles.slotAction, { backgroundColor: uri ? '#2A2724' : '#FFFFFF' }]}>
                  <FeatureIcon name={uri ? 'pencil' : 'plus'} size={uri ? 18 : 27} color={uri ? '#FFFFFF' : '#111111'} />
                </View>
              </Pressable>
            );
          })}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setSheet('tips')} style={styles.tipsLink}>
          <Text style={{ color: isDark ? '#62A8FF' : colors.primary, fontSize: 16, textDecorationLine: 'underline' }}>โดดเด่นด้วยเคล็ดลับเลือกรูป</Text>
        </Pressable>
        {processing ? <View style={styles.processing}><ActivityIndicator color={colors.ink} /><Text style={{ color: colors.inkMuted }}>กำลังประมวลผลรูปภาพ...</Text></View> : null}
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
      <FaceVerificationModal
        avatarUri={pendingAvatar?.uri || draft.avatarUri}
        visible={verificationVisible}
        onClose={() => {
          setVerificationVisible(false);
          setPendingAvatar(null);
          pendingAvatarRef.current = null;
          if (!verificationPassedRef.current) showToast('ยกเลิกการเปลี่ยนรูปหลัก เนื่องจากยังไม่ได้ยืนยันใบหน้า', 'info');
        }}
        onSuccess={async (result) => {
          const pending = pendingAvatarRef.current;
          if (!pending || verificationPassedRef.current) return;
          verificationPassedRef.current = true;
          const next = { avatarUri: pending.uri, gallery: pending.gallery };
          verifiedDraftRef.current = { uri: pending.uri, similarity: result.similarity };
          setDraft(next);
          await savePhotos(next, { verification: result });
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 16, paddingTop: 10 },
  photoSlot: { position: 'relative' },
  photoFrame: { width: '100%', height: '100%', borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden' },
  slotAction: { position: 'absolute', top: -8, right: -7, width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  mainBadge: { position: 'absolute', left: 7, bottom: 7, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  mainBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  imageError: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 8, gap: 6 },
  tipsLink: { alignSelf: 'flex-start', paddingVertical: 18, minHeight: 44 },
  error: { fontSize: 14, paddingBottom: 16 },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetHost: { position: 'absolute' },
  sheetTitle: { fontSize: 22, fontWeight: '600', paddingBottom: 16 },
  tipsText: { fontSize: 16, paddingBottom: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  actionText: { flex: 1, fontSize: 17 },
  sheetClose: { alignItems: 'center', justifyContent: 'center', minHeight: 50, borderRadius: 25, paddingHorizontal: 20, paddingVertical: 10, marginTop: 16 },
  pressed: { opacity: 0.55 },
});
