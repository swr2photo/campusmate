import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { bytesToBase64, base64ToBytes, encryptMediaBytes } from './chatEncryptionService';
import { verifyImageSafety } from './imageModerationService';
import { requireFirebase } from './dbService';
import { compressUploadImage } from '../utils/compressImage';

export async function pickAndUploadGroupImage(partyId, groupKey) {
  if (!groupKey || groupKey.length !== 32) throw new Error('ไม่พบกุญแจเข้ารหัสรูปภาพ');
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;
  const uri = picked.assets[0].uri;
  await verifyImageSafety(uri);
  const resized = await compressUploadImage(uri, {
    width: picked.assets[0].width, height: picked.assets[0].height,
  });
  const raw = await FileSystem.readAsStringAsync(resized.uri, { encoding: FileSystem.EncodingType.Base64 });
  // No upload is started until encryption succeeds.
  const encrypted = bytesToBase64(encryptMediaBytes(base64ToBytes(raw), groupKey));
  const { app } = requireFirebase();
  const functions = getFunctions(app, 'asia-southeast1');
  const sign = httpsCallable(functions, 'getR2ChatUploadUrl', { timeout: 20000 });
  const signed = (await sign({ groupChatId: partyId, mediaType: 'image', extension: 'enc', contentType: 'application/octet-stream', uploadProtocolVersion: 2 })).data;
  if (signed?.success && signed.uploadUrl && signed.downloadUrl) {
    const temp = `${FileSystem.cacheDirectory}group_${Date.now()}_${Math.random().toString(36).slice(2)}.enc`;
    try {
      await FileSystem.writeAsStringAsync(temp, encrypted, { encoding: FileSystem.EncodingType.Base64 });
      const uploaded = await FileSystem.uploadAsync(signed.uploadUrl, temp, {
        httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: signed.uploadHeaders || { 'Content-Type': 'application/octet-stream' },
      });
      if (uploaded.status < 200 || uploaded.status >= 300) throw new Error('อัปโหลดรูปภาพไม่สำเร็จ');
      return signed.downloadUrl;
    } finally {
      await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
    }
  }
  if (encrypted.length > 5_000_000) throw new Error('รูปภาพใหญ่เกินไปสำหรับการอัปโหลดสำรอง');
  const upload = httpsCallable(functions, 'uploadChatMedia', { timeout: 45000 });
  const result = (await upload({
    groupChatId: partyId, base64Data: encrypted,
    contentType: 'application/octet-stream', extension: 'enc',
  })).data;
  if (!result?.success || !result.url) throw new Error('อัปโหลดรูปภาพไม่สำเร็จ');
  return result.url;
}
