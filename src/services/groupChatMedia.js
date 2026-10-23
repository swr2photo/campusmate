import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { bytesToBase64, base64ToBytes, encryptMediaBytes } from './chatEncryptionService';
import { verifyImageSafety } from './imageModerationService';
import { requireFirebase } from './dbService';
import { getCallable } from './callableClient';
import { RUST_BACKEND } from './rust/backend';
import { compressUploadImage } from '../utils/compressImage';
import { preCacheDecryptedMedia } from './chatMediaService';

async function putEncryptedGroupImage(partyId, groupKey, uri, size) {
  await verifyImageSafety(uri);
  const resized = await compressUploadImage(uri, size);
  const raw = await FileSystem.readAsStringAsync(resized.uri, { encoding: FileSystem.EncodingType.Base64 });
  // No upload is started until encryption succeeds.
  const encrypted = bytesToBase64(encryptMediaBytes(base64ToBytes(raw), groupKey));
  const sign = getCallable('getR2ChatUploadUrl', { timeout: 20000 });
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
      preCacheDecryptedMedia(signed.downloadUrl, resized.uri, { conversationKey: groupKey, mediaType: 'image' });
      return signed.downloadUrl;
    } finally {
      await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
    }
  }
  if (RUST_BACKEND) throw new Error('อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่');
  if (encrypted.length > 5_000_000) throw new Error('รูปภาพใหญ่เกินไปสำหรับการอัปโหลดสำรอง');
  const { app } = requireFirebase();
  const upload = httpsCallable(getFunctions(app, 'asia-southeast1'), 'uploadChatMedia', { timeout: 45000 });
  const result = (await upload({
    groupChatId: partyId, base64Data: encrypted,
    contentType: 'application/octet-stream', extension: 'enc',
  })).data;
  if (!result?.success || !result.url) throw new Error('อัปโหลดรูปภาพไม่สำเร็จ');
  preCacheDecryptedMedia(result.url, resized.uri, { conversationKey: groupKey, mediaType: 'image' });
  return result.url;
}

export async function uploadGroupImage(partyId, groupKey, uri, size) {
  if (!groupKey || groupKey.length !== 32 || !uri) throw new Error('ไม่พบรูปภาพหรือกุญแจกลุ่ม');
  return putEncryptedGroupImage(partyId, groupKey, uri, size);
}

export async function pickAndUploadGroupImage(partyId, groupKey) {
  if (!groupKey || groupKey.length !== 32) throw new Error('ไม่พบกุญแจเข้ารหัสรูปภาพ');
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;
  const asset = picked.assets[0];
  return uploadGroupImage(partyId, groupKey, asset.uri, { width: asset.width, height: asset.height });
}

export async function uploadGroupAudio(partyId, groupKey, uri) {
  if (!groupKey || groupKey.length !== 32 || !uri) throw new Error('ไม่พบไฟล์เสียงหรือกุญแจกลุ่ม');
  const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const encrypted = bytesToBase64(encryptMediaBytes(base64ToBytes(raw), groupKey));
  const sign = getCallable('getR2ChatUploadUrl', { timeout: 20000 });
  const signed = (await sign({
    groupChatId: partyId, mediaType: 'audio', extension: 'enc',
    contentType: 'application/octet-stream', uploadProtocolVersion: 2,
  })).data;
  if (!(signed?.success && signed.uploadUrl && signed.downloadUrl)) {
    throw new Error('อัปโหลดเสียงไม่สำเร็จ กรุณาลองใหม่');
  }
  const temp = `${FileSystem.cacheDirectory}group_audio_${Date.now()}_${Math.random().toString(36).slice(2)}.enc`;
  try {
    await FileSystem.writeAsStringAsync(temp, encrypted, { encoding: FileSystem.EncodingType.Base64 });
    const uploaded = await FileSystem.uploadAsync(signed.uploadUrl, temp, {
      httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: signed.uploadHeaders || { 'Content-Type': 'application/octet-stream' },
    });
    if (uploaded.status < 200 || uploaded.status >= 300) throw new Error('อัปโหลดเสียงไม่สำเร็จ');
    preCacheDecryptedMedia(signed.downloadUrl, uri, { conversationKey: groupKey, mediaType: 'audio' });
    return signed.downloadUrl;
  } finally {
    await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
  }
}
