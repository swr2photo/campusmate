import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { validateChatVideo } from '../utils/chatVideoPolicy';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage';
import { requireFirebase } from './dbService';
import { verifyImageSafety } from './imageModerationService';
import {
  encryptMediaBytes,
  decryptMediaBytes,
  bytesToBase64,
  base64ToBytes,
} from './chatEncryptionService';

const memoryMediaCache = new Map();
const MAX_MEDIA_CACHE_SIZE = 200;
const pendingMediaLoads = new Map();

function readMemoryMediaCache(mediaUrl) {
  if (!memoryMediaCache.has(mediaUrl)) return null;
  const cached = memoryMediaCache.get(mediaUrl);
  memoryMediaCache.delete(mediaUrl);
  memoryMediaCache.set(mediaUrl, cached);
  return cached;
}

function writeMemoryMediaCache(mediaUrl, localUri) {
  memoryMediaCache.delete(mediaUrl);
  if (memoryMediaCache.size >= MAX_MEDIA_CACHE_SIZE) {
    const firstKey = memoryMediaCache.keys().next().value;
    if (firstKey) memoryMediaCache.delete(firstKey);
  }
  memoryMediaCache.set(mediaUrl, localUri);
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export { verifyImageSafety };

export async function pickChatImages(options = {}) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: options.selectionLimit || 10,
    quality: 0.85,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  const maxDimension = 1440;
  const processed = await Promise.all(
    result.assets.map(async (asset) => {
      const needResize = (asset.width && asset.width > maxDimension) || (asset.height && asset.height > maxDimension);
      const actions = needResize ? [{ resize: { width: maxDimension } }] : [];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        actions,
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      return {
        uri: manipulated.uri,
        width: manipulated.width,
        height: manipulated.height,
      };
    })
  );

  return processed;
}

export async function pickChatImage() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.85,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const maxDimension = 1440;
  const needResize = (asset.width && asset.width > maxDimension) || (asset.height && asset.height > maxDimension);
  const actions = needResize ? [{ resize: { width: maxDimension } }] : [];

  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    actions,
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );

  return {
    uri: manipulated.uri,
    width: manipulated.width,
    height: manipulated.height,
  };
}

export async function takeChatPhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('กรุณาอนุญาตการเข้าถึงกล้องเพื่อถ่ายรูป');
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.85,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const maxDimension = 1440;
  const needResize = (asset.width && asset.width > maxDimension) || (asset.height && asset.height > maxDimension);
  const actions = needResize ? [{ resize: { width: maxDimension } }] : [];

  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    actions,
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );

  return {
    uri: manipulated.uri,
    width: manipulated.width,
    height: manipulated.height,
  };
}

export async function ensureLocalFileUri(uri) {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('ph://')) {
    return uri;
  }

  if (Platform.OS === 'ios') {
    // 1. Try MediaLibrary.getAssetInfoAsync if available
    try {
      const MediaLibrary = require('expo-media-library/legacy');
      const assetId = uri.replace('ph://', '');
      const info = await MediaLibrary.getAssetInfoAsync(assetId, { shouldDownloadFromNetwork: true });
      if (info?.localUri && info.localUri.startsWith('file://')) {
        return info.localUri;
      }
    } catch {
      // Fall through to copyAsync
    }

    // 2. Native FileSystem.copyAsync supports ph:// directly on iOS
    try {
      const destPath = `${FileSystem.cacheDirectory}ph_asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: destPath });
      return destPath;
    } catch (copyErr) {
      console.warn('[ensureLocalFileUri] Failed to copy ph:// asset to cache:', copyErr?.message || copyErr);
    }
  }

  return uri;
}

export async function uploadChatMedia(localUri, { conversationId, mediaType = 'image', extension, conversationKey, videoDuration }) {
  if (!localUri || !conversationId) {
    throw new Error('Missing file URI or conversation ID');
  }

  const fileUri = await ensureLocalFileUri(localUri);

  if (mediaType === 'video') {
    const info = await FileSystem.getInfoAsync(fileUri);
    validateChatVideo({ uri: fileUri, duration: videoDuration, fileSize: info.size });
    if (!conversationKey) throw new Error('ไม่พบกุญแจเข้ารหัสวิดีโอ');
  }

  // Pre-upload safety check on unencrypted local URI
  if (mediaType === 'image') {
    await verifyImageSafety(fileUri);
  }

  const { app } = requireFirebase();
  let uploadUri = fileUri;
  let ext = extension || (mediaType === 'video' ? 'mp4' : (mediaType === 'audio' ? 'm4a' : 'jpg'));
  let contentType = mediaType === 'video' ? 'video/mp4' : (mediaType === 'audio' ? 'audio/mp4' : 'image/jpeg');
  let tempEncUri = null;

  // Zero-Knowledge Client-Side Encryption:
  // If conversationKey is provided, encrypt binary bytes on-device with TweetNaCl (secretbox)
  if (conversationKey) {
    try {
      const rawBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const rawBytes = base64ToBytes(rawBase64);
      const encryptedBytes = encryptMediaBytes(rawBytes, conversationKey);
      const encryptedBase64 = bytesToBase64(encryptedBytes);

      tempEncUri = `${FileSystem.cacheDirectory}enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.enc`;
      await FileSystem.writeAsStringAsync(tempEncUri, encryptedBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      uploadUri = tempEncUri;
      ext = 'enc';
      contentType = 'application/octet-stream';
    } catch (encryptErr) {
      if (mediaType === 'video') throw encryptErr;
      console.warn('[ChatMedia] Media encryption failed, proceeding unencrypted:', encryptErr);
    }
  }

  try {
    // 1. Try secure Cloudflare R2 presigned upload first
    try {
      const functions = getFunctions(app, 'asia-southeast1');
      const getR2UploadUrlFn = httpsCallable(functions, 'getR2ChatUploadUrl');
      const r2Result = await getR2UploadUrlFn({
        conversationId,
        mediaType,
        extension: ext,
        contentType,
      });

      const data = r2Result.data || {};
      if (data.success && data.uploadUrl && data.downloadUrl) {
        if (uploadUri.startsWith('file://') || uploadUri.startsWith('content://')) {
          const uploadRes = await FileSystem.uploadAsync(data.uploadUrl, uploadUri, {
            httpMethod: 'PUT',
            headers: {
              'Content-Type': data.contentType || contentType,
            },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          });

          if (uploadRes.status >= 200 && uploadRes.status < 300) {
            writeMemoryMediaCache(data.downloadUrl, localUri);
            return data.downloadUrl;
          }
          // A rejected native PUT will also reject an identical fetch PUT. Skip
          // the duplicate full-file transfer and use the storage fallback.
          throw new Error(`R2 upload failed (HTTP ${uploadRes.status})`);
        }

        // Fallback to fetch for blob/content URIs
        const fileBlob = await (await fetch(uploadUri)).blob();
        const putRes = await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': data.contentType || contentType,
          },
          body: fileBlob,
        });

        if (putRes.ok) {
          writeMemoryMediaCache(data.downloadUrl, fileUri);
          return data.downloadUrl;
        }
      }
    } catch (r2Err) {
      console.warn('[ChatMedia] R2 presigned upload skipped or failed, falling back to Firebase Storage:', r2Err?.message || r2Err);
    }

    // 2. Fallback to Firebase Storage (file is still encrypted .enc if conversationKey was provided!)
    const storage = getStorage(app, 'campusmate-7f1ab.firebasestorage.app');
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const storageRef = ref(storage, `chat_media/${conversationId}/${fileName}`);

    try {
      const response = await fetch(uploadUri);
      const blob = await response.blob();
      await uploadBytes(storageRef, blob, { contentType });
      const downloadUrl = await getDownloadURL(storageRef);
      writeMemoryMediaCache(downloadUrl, fileUri);
      return downloadUrl;
    } catch (err) {
      // Fallback using base64 upload if fetch blob fails
      const base64 = await FileSystem.readAsStringAsync(uploadUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await uploadString(storageRef, base64, 'base64', { contentType });
      const downloadUrl = await getDownloadURL(storageRef);
      writeMemoryMediaCache(downloadUrl, fileUri);
      return downloadUrl;
    }
  } finally {
    if (tempEncUri) {
      FileSystem.deleteAsync(tempEncUri, { idempotent: true }).catch(() => {});
    }
  }
}

/**
 * Returns a local URI for displaying or playing media.
 * - If local, returns localUri directly.
 * - If legacy unencrypted (.jpg, .m4a, etc.), returns mediaUrl directly.
 * - If encrypted (.enc), checks disk cache -> if missing, downloads, decrypts with conversationKey, caches, and returns cached file URI.
 */
export async function getDecryptedMediaUri(mediaUrl, { conversationKey, mediaType = 'image' } = {}) {
  if (!mediaUrl) return null;
  const loadKey = `${mediaType}:${mediaUrl}:${conversationKey ? bytesToBase64(conversationKey) : ''}`;
  if (pendingMediaLoads.has(loadKey)) return pendingMediaLoads.get(loadKey);
  const loading = loadDecryptedMediaUri(mediaUrl, { conversationKey, mediaType });
  pendingMediaLoads.set(loadKey, loading);
  try { return await loading; }
  finally { if (pendingMediaLoads.get(loadKey) === loading) pendingMediaLoads.delete(loadKey); }
}

async function loadDecryptedMediaUri(mediaUrl, { conversationKey, mediaType = 'image' } = {}) {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith('file://') || mediaUrl.startsWith('content://') || mediaUrl.startsWith('data:')) {
    return mediaUrl;
  }

  // Check in-memory cache first
  const cached = readMemoryMediaCache(mediaUrl);
  if (cached) {
    if (cached.startsWith('file://')) {
      const info = await FileSystem.getInfoAsync(cached).catch(() => null);
      if (info?.exists) return cached;
      memoryMediaCache.delete(mediaUrl);
    } else {
      return cached;
    }
  }

  const urlHash = hashString(mediaUrl);
  const targetExt = mediaType === 'video' ? 'mp4' : (mediaType === 'audio' ? 'm4a' : 'jpg');
  const cacheDir = `${FileSystem.cacheDirectory}decrypted_media/`;
  const cachedFileUri = `${cacheDir}${urlHash}.${targetExt}`;

  // Ensure cache directory exists
  const dirInfo = await FileSystem.getInfoAsync(cacheDir).catch(() => null);
  if (!dirInfo?.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});
  }

  // Check if disk cache already exists
  const fileInfo = await FileSystem.getInfoAsync(cachedFileUri).catch(() => null);
  if (fileInfo?.exists && fileInfo.size > 0) {
    writeMemoryMediaCache(mediaUrl, cachedFileUri);
    return cachedFileUri;
  }

  // If not encrypted (.enc), download to local cache so that native components (e.g. iOS SwiftUI Image) can display it directly
  const isEncrypted = /\.enc(?:$|[?&#])/i.test(decodeURIComponent(mediaUrl));
  if (!isEncrypted) {
    try {
      const downloadRes = await FileSystem.downloadAsync(mediaUrl, cachedFileUri);
      if (downloadRes.status >= 200 && downloadRes.status < 300) {
        writeMemoryMediaCache(mediaUrl, cachedFileUri);
        return cachedFileUri;
      }
      await FileSystem.deleteAsync(cachedFileUri, { idempotent: true }).catch(() => {});
      if (mediaType === 'video') throw new Error(`ดาวน์โหลดวิดีโอไม่สำเร็จ (HTTP ${downloadRes.status})`);
      return null;
    } catch (error) {
      await FileSystem.deleteAsync(cachedFileUri, { idempotent: true }).catch(() => {});
      if (mediaType === 'video') throw error;
      return null;
    }
  }

  if (!conversationKey) {
    if (mediaType === 'video') throw new Error('ยังโหลดกุญแจวิดีโอไม่ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง');
    console.warn('[ChatMedia] Cannot decrypt media: conversationKey not available');
    return null;
  }

  // Download encrypted file and decrypt locally
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempEncPath = `${cacheDir}tmp_${urlHash}_${suffix}.enc`;
  const tempPlainPath = `${cacheDir}tmp_${urlHash}_${suffix}.${targetExt}`;
  try {
    const downloadRes = await FileSystem.downloadAsync(mediaUrl, tempEncPath);
    if (downloadRes.status < 200 || downloadRes.status >= 300) {
      throw new Error(`Failed to download encrypted media (HTTP ${downloadRes.status})`);
    }

    const encBase64 = await FileSystem.readAsStringAsync(tempEncPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const encBytes = base64ToBytes(encBase64);
    const decryptedBytes = decryptMediaBytes(encBytes, conversationKey);
    const decryptedBase64 = bytesToBase64(decryptedBytes);

    await FileSystem.writeAsStringAsync(tempPlainPath, decryptedBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.moveAsync({ from: tempPlainPath, to: cachedFileUri });

    writeMemoryMediaCache(mediaUrl, cachedFileUri);
    return cachedFileUri;
  } catch (decryptErr) {
    console.warn('[ChatMedia] Decrypt media failed:', decryptErr?.message || decryptErr);
    if (mediaType === 'video') throw decryptErr;
    return null;
  } finally {
    FileSystem.deleteAsync(tempEncPath, { idempotent: true }).catch(() => {});
    FileSystem.deleteAsync(tempPlainPath, { idempotent: true }).catch(() => {});
  }
}

export function getSyncCachedMediaUri(mediaUrl, mediaType = 'image') {
  if (!mediaUrl) return null;
  if (mediaUrl.startsWith('file://') || mediaUrl.startsWith('content://') || mediaUrl.startsWith('data:')) {
    return mediaUrl;
  }
  const cached = readMemoryMediaCache(mediaUrl);
  if (cached) {
    return cached;
  }
  // On React Native (Android / web): unencrypted image URLs are loaded natively by <Image>
  if (mediaType === 'image' && !mediaUrl.includes('.enc')) {
    return mediaUrl;
  }
  return null;
}

export function preCacheDecryptedMedia(mediaUrl, localUri) {
  if (!mediaUrl || !localUri) return;
  writeMemoryMediaCache(mediaUrl, localUri);
}

export function formatAudioDuration(seconds = 0) {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function meteringToLevel(metering) {
  if (metering === undefined || metering === null || isNaN(metering)) return 0.2;
  // Metering in dB typically ranges from -160 to 0 dB (-55 to -5 dB for speech).
  const minDb = -52;
  const maxDb = -4;
  const clamped = Math.max(minDb, Math.min(maxDb, metering));
  const normalized = (clamped - minDb) / (maxDb - minDb);
  return Math.max(0.12, Math.min(1.0, normalized));
}

let currentRecorder = null;

export async function startAudioRecording() {
  const { AudioModule, RecordingPresets } = require('expo-audio');
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) {
    throw new Error('กรุณาอนุญาตการเข้าถึงไมโครโฟนเพื่อบันทึกเสียง');
  }

  await AudioModule.setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    playsInSilentModeIOS: true,
  });

  if (currentRecorder) {
    try {
      await currentRecorder.stop();
    } catch {}
    currentRecorder = null;
  }

  const recordingConfig = {
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  };

  const recorder = new AudioModule.AudioRecorder(recordingConfig);
  await recorder.prepareToRecordAsync(recordingConfig);
  recorder.record();
  currentRecorder = recorder;
  return recorder;
}

export function getRecordingStatus() {
  if (!currentRecorder) return null;
  try {
    return currentRecorder.getStatus ? currentRecorder.getStatus() : null;
  } catch {
    return null;
  }
}

export async function ensureAudioPlaybackMode() {
  try {
    const { AudioModule } = require('expo-audio');
    await AudioModule.setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      playsInSilentModeIOS: true,
    });
  } catch (err) {
    console.warn('[ChatMedia] ensureAudioPlaybackMode failed:', err?.message || err);
  }
}

export async function stopAudioRecording() {
  if (!currentRecorder) return null;
  const recorder = currentRecorder;
  currentRecorder = null;
  await recorder.stop();
  const uri = recorder.uri;
  const duration = Math.max(1, Math.round(recorder.currentTime || 0));
  await ensureAudioPlaybackMode();
  return { uri, duration };
}

export async function cancelAudioRecording() {
  if (!currentRecorder) return;
  const recorder = currentRecorder;
  currentRecorder = null;
  try {
    await recorder.stop();
  } catch {}
  await ensureAudioPlaybackMode();
}


export async function purgeDecryptedVideo(mediaUrl) {
  memoryMediaCache.delete(mediaUrl);
  const path = FileSystem.cacheDirectory + 'decrypted_media/' + hashString(mediaUrl) + '.mp4';
  await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
}
